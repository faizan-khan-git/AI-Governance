/**
 * Minimal structured logger. Keeps output as single-line JSON so it plays well
 * with cluster log collectors, while never emitting secrets.
 */
const write = (level, message, meta = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
};

const logger = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
  debug: (message, meta) => {
    if (process.env.NODE_ENV !== "production") {
      write("debug", message, meta);
    }
  },
};

export default logger;
