import dotenv from "dotenv";
import pg from "pg";
import { spawn } from "node:child_process";
import logger from "../utils/logger.js";

dotenv.config();

const { Pool } = pg;

// Default to in-cluster service port-forward on 5433, falling back to local postgres password
const connectionString =
  process.env.DATABASE_URL ||
  (process.env.POSTGRES_PASSWORD
    ? `postgresql://litellm:${process.env.POSTGRES_PASSWORD}@127.0.0.1:5433/litellm`
    : "");

let pool = null;
let portForwardSpawned = false;

function ensurePortForward() {
  if (portForwardSpawned) return;
  try {
    const child = spawn(
      "kubectl",
      ["port-forward", "-n", "litellm", "svc/postgres-service", "5433:5432"],
      { stdio: "ignore", detached: true },
    );
    child.unref();
    portForwardSpawned = true;
    logger.info("Spawned background kubectl port-forward for postgres-service on 5433");
  } catch (err) {
    logger.warn("Could not auto-spawn kubectl port-forward", { error: err.message });
  }
}

if (connectionString) {
  try {
    pool = new Pool({
      connectionString,
      max: parseInt(process.env.DB_POOL_MAX || "10", 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      logger.error("Unexpected error on idle PostgreSQL client", {
        message: err.message,
      });
      if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
        ensurePortForward();
      }
    });
  } catch (err) {
    logger.error("Failed to initialize PostgreSQL pool", { message: err.message });
  }
} else {
  logger.warn(
    "DATABASE_URL not configured. Database-backed admin queries will report database unavailable.",
  );
}

/**
 * Executes a parameterized SQL query safely.
 * @param {string} text - SQL query text with $1, $2, ... placeholders
 * @param {Array} [params] - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = []) {
  if (!pool) {
    const error = new Error("Database connection not configured (DATABASE_URL missing)");
    error.code = "DB_NOT_CONFIGURED";
    throw error;
  }
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === "development" && duration > 200) {
      logger.warn("Slow query detected", { text, duration, rows: res.rowCount });
    }
    return res;
  } catch (err) {
    // If port forward died or wasn't running, attempt to spawn and retry once
    if (err.code === "ECONNREFUSED" && !portForwardSpawned) {
      logger.info("PostgreSQL connection refused, attempting auto-recovery via kubectl port-forward...");
      ensurePortForward();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return pool.query(text, params);
    }
    logger.error("Database query failed", { text, error: err.message });
    throw err;
  }
}

/**
 * Checks whether PostgreSQL is responsive.
 * @returns {Promise<boolean>}
 */
export async function isDatabaseReady() {
  if (!pool) return false;
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    return false;
  }
}

export default {
  query,
  isDatabaseReady,
  get pool() {
    return pool;
  },
};
