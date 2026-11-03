import { createApp } from "./app.js";
import config, { getConfigWarnings, validateConfig } from "./config/index.js";
import logger from "./utils/logger.js";
import { isGoogleConfigured } from "./auth/google.js";
import {
  purgeExpiredSessions,
  purgeExpiredTranscripts,
} from "./services/transcript.service.js";

/**
 * Housekeeping: enforce the transcript retention window and drop stale sessions.
 * Runs once shortly after boot and then every 6 hours. Failures are logged and
 * ignored: retention is important but must never take the service down.
 */
function startHousekeeping() {
  const run = async () => {
    try {
      await purgeExpiredSessions();
      await purgeExpiredTranscripts();
    } catch (error) {
      logger.warn("Housekeeping failed", { message: error.message });
    }
  };
  const timer = setTimeout(run, 60 * 1000);
  timer.unref();
  const interval = setInterval(run, 6 * 60 * 60 * 1000);
  interval.unref();
}

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

  for (const message of getConfigWarnings()) {
    logger.warn("Configuration warning", { message });
  }

  if (!isGoogleConfigured()) {
    logger.warn(
      "Company sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Only service-account credentials will be accepted.",
    );
  }

  const app = createApp();

  const server = app.listen(config.port, config.host, () => {
    logger.info("AI Governance backend started", {
      host: config.host,
      port: config.port,
      env: config.env,
      litellmBaseUrl: config.litellm.baseUrl,
      defaultModel: config.defaults.model,
      googleSignIn: isGoogleConfigured(),
      bootstrapAdmins: config.identity.bootstrapAdmins.length,
      storeTranscripts: config.identity.storeTranscripts,
      transcriptRetentionDays: config.identity.transcriptRetentionDays,
    });
    startHousekeeping();
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
