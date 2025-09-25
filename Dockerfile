# Multi-stage Dockerfile for Traversion
# Stage 1: Builder
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application source
COPY src/ ./src/
COPY swagger.yaml ./
COPY .env.example ./

# Stage 2: Runtime
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    git \
    tini \
    && addgroup -g 1000 traversion \
    && adduser -D -u 1000 -G traversion traversion

# Set working directory
WORKDIR /app

# Copy from builder
COPY --from=builder --chown=traversion:traversion /app/node_modules ./node_modules
COPY --chown=traversion:traversion package*.json ./
COPY --chown=traversion:traversion src/ ./src/
COPY --chown=traversion:traversion swagger.yaml ./
COPY --chown=traversion:traversion .env.example ./

# Create data directories
RUN mkdir -p .traversion/logs .traversion/backups && \
    chown -R traversion:traversion .traversion

# Set environment defaults
ENV NODE_ENV=production \
    PORT=3335 \
    LOG_LEVEL=info \
    DATA_DIR=/app/.traversion

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://localhost:3335/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Use non-root user
USER traversion

# Expose port
EXPOSE 3335

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start application
CMD ["node", "src/app.js"]
