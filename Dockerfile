# syntax=docker/dockerfile:1

# --- Compilation ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Les modules natifs (SQLite, Argon2) fournissent leurs binaires tout prêts : pas de compilation.
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev

# --- Image finale (légère, sans outils de compilation) --------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist/client
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# La base et les sauvegardes vivent dans /data (volume), lisible par l'utilisateur « node ».
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/main.js"]
