#!/usr/bin/env node
/**
 * issue-jwt.mjs — mint an HS256 role JWT for testing / client provisioning.
 *
 * The token is signed with the Backend's AUTH_JWT_SECRET (falling back to
 * LITELLM_JWT_SECRET), the same secret the authenticate middleware verifies
 * against. Send the printed token as: Authorization: Bearer <token>
 *
 * Usage:
 *   node scripts/issue-jwt.mjs --role dev
 *   node scripts/issue-jwt.mjs --role admin --sub alice@example.com --exp 24h
 *
 * Options:
 *   --role  dev | standard | admin        (required)
 *   --sub   subject/identity              (default: the role name)
 *   --exp   lifetime: Ns|Nm|Nh|Nd or raw seconds (default: 8h)
 */
import config from "../src/config/index.js";
import { signJwt } from "../src/auth/jwt.js";
import { ALL_ROLES, isValidRole } from "../src/auth/roles.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

function parseDurationSeconds(value, fallbackSeconds) {
  if (!value) return fallbackSeconds;
  const match = /^(\d+)([smhd])?$/.exec(String(value).trim());
  if (!match) {
    throw new Error(`Invalid --exp value: ${value}`);
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] ?? "s";
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return amount * multipliers[unit];
}

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

const role = args.role;
if (!isValidRole(role)) {
  fail(`--role must be one of: ${ALL_ROLES.join(", ")}`);
}

const secret = config.rbac.jwtSecret;
if (!secret) {
  fail(
    "No JWT secret configured. Set AUTH_JWT_SECRET (or LITELLM_JWT_SECRET) in the Backend environment.",
  );
}

let expiresInSeconds;
try {
  expiresInSeconds = parseDurationSeconds(args.exp, 8 * 3600);
} catch (error) {
  fail(error.message);
}

const subject = args.sub ?? role;
const token = signJwt({ role, sub: subject }, secret, { expiresInSeconds });

process.stdout.write(`${token}\n`);
