# Multi-stage Dockerfile for Next.js standalone build
# Optimized for production deployment on AWS App Runner

# ==============================================================================
# Stage 1: Dependencies
# ==============================================================================
FROM node:18-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies needed for build)
RUN npm ci

# ==============================================================================
# Stage 2: Builder
# ==============================================================================
FROM node:18-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Set environment variable for build
# This will be overridden at runtime by App Runner
ENV NEXT_PUBLIC_API_BASE_URL=https://api.airefill.app/v1

# Build Next.js application
# This creates the standalone output in .next/standalone
RUN npm run build

# ==============================================================================
# Stage 3: Runner
# ==============================================================================
FROM node:18-alpine AS runner
WORKDIR /app

# Set NODE_ENV to production
ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Change ownership to nextjs user
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose port 3000
EXPOSE 3000

# Runtime environment variables (HOSTNAME, PORT) are set by CDK at runtime
# No need to hardcode them here - CDK is the single source of truth

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the Next.js server
CMD ["node", "server.js"]

