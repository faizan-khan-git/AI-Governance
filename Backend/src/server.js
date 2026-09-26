import { createApp } from "./app.js";
import config, { validateConfig } from "./config/index.js";
import logger from "./utils/logger.js";

/**
 * Server entry point. Validates configuration, starts the HTTP server, and
 * wires graceful shutdown + last-resort crash handlers.
 */
function start() {
  const errors = validateConfig();
  if (errors.length > 0) {
    for (const message of errors) {
      logger.error("Invalid configuration", { message });
    }
    logger.error(
      "Refusing to start due to configuration errors. See .env.example.",
    );
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info("AI Governance backend started", {
      port: config.port,
      env: config.env,
      litellmBaseUrl: config.litellm.baseUrl,
      defaultModel: config.defaults.model,
    });
  });

  const shutdown = (signal) => {
    logger.info("Received shutdown signal, closing server", { signal });
    server.close(() => {
      logger.info("Server closed. Bye.");
      process.exit(0);
    });
    // Force-exit if connections do not drain in time.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", { reason: String(reason) });
  });
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", {
      message: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
}

start();
