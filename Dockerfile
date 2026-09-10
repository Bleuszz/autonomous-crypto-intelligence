FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NITRO_PRESET=node-server
ENV SKIP_DB_MIGRATE=1
ENV VITE_AUTH_ENABLED=false
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/.output ./.output
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/scripts/migration-plan.mjs ./scripts/migration-plan.mjs
COPY --from=build /app/scripts/engine-worker.mjs ./scripts/engine-worker.mjs
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node .output/server/index.mjs"]
