# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY data ./data
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data ./data
COPY package*.json ./
RUN chown -R node:node /app
USER node
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 CMD node dist/health/healthcheck.js
CMD ["node", "dist/index.js"]
