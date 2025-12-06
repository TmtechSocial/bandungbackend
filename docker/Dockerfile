# Production Dockerfile for Bandung Backend
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Create app user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S bandung-backend -u 1001

# Install dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production --omit=dev && \
    npm cache clean --force

# Copy application code
COPY --chown=bandung-backend:nodejs src/ ./src/
COPY --chown=bandung-backend:nodejs firebase-service-account.json ./
COPY --chown=bandung-backend:nodejs .env.example ./

# Create necessary directories
RUN mkdir -p logs uploads && \
    chown -R bandung-backend:nodejs logs uploads

# Switch to non-root user
USER bandung-backend

# Expose port
EXPOSE 8010

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8010/health/liveness', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start application
CMD ["node", "src/server.js"]