import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import config from "./config/index.js";
import routes from "./routes/index.js";
import notFound from "./middlewares/notFound.js";
import errorHandler from "./middlewares/errorHandler.js";

/**
 * Build and configure the Express application.
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();

  // Behind a k8s Service / ingress — trust the proxy for correct client IPs.
  app.set("trust proxy", 1);

  // Security headers.
  app.use(helmet());

  // CORS. "*" allows all origins; otherwise restrict to the configured list.
  const corsOrigin = config.cors.origin.includes("*")
    ? "*"
    : config.cors.origin;
  app.use(cors({ origin: corsOrigin }));

  // Request logging (skip in test to keep output clean).
  if (config.env !== "test") {
    app.use(morgan(config.env === "production" ? "combined" : "dev"));
  }

  // Body parsers: accept both raw text/plain and JSON.
  app.use(express.text({ type: "text/plain", limit: "256kb" }));
  app.use(express.json({ limit: "256kb" }));

  // Basic rate limiting to protect the upstream gateway budget.
  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: {
          code: "rate_limited",
          message: "Too many requests. Please slow down.",
        },
      },
    }),
  );

  // Routes.
  app.use("/", routes);

  // 404 + centralized error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
