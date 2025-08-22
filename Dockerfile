# Multi-stage build for production optimization
FROM node:18-alpine AS dependencies

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Run tests
RUN npm test

# Production stage
FROM node:18-alpine AS production

# Install security updates
RUN apk update && apk upgrade && apk add --no-cache \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S traversion -u 1001 -G nodejs

WORKDIR /app

# Copy dependencies from dependencies stage
COPY --from=dependencies --chown=traversion:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=traversion:nodejs . .

# Create necessary directories
RUN mkdir -p /app/backups /app/logs /tmp && \
    chown -R traversion:nodejs /app/backups /app/logs /tmp

# Set permissions
RUN chmod -R 755 /app && \
    chmod -R 777 /app/backups /app/logs /tmp

# Switch to non-root user
USER traversion

# Expose ports
EXPOSE 3333 3334 9090

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3333/api/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "src/api/server.js"]