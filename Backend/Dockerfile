# ─────────────────────────────────────────────────────────────────────────────
# AI Governance Backend — container image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install production dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source
COPY src ./src

# Run as the built-in non-root user
USER node

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080

CMD ["node", "src/server.js"]
