# Build context = repo root so we can copy both backend/ and types/.
# backend/src imports @shared/* which tsconfig maps to ../types/* (repo-root types/).
FROM node:20-slim AS build
WORKDIR /app
# Install deps first for better layer caching.
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci
# Copy backend source + the shared types it imports via @shared -> ../types.
COPY backend/ ./backend/
COPY types/ ./types/
# tsup/esbuild bundles @shared into build/index.js, but EXTERNALIZES deps
# (@colyseus/*, express) — they must exist in node_modules at runtime.
RUN cd backend && npm run build
# Drop devDependencies so we can ship these exact node_modules to the runtime image.
RUN cd backend && npm prune --omit=dev

FROM node:20-slim AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=8080
# Copy the already-installed (pruned) production deps + bundle. package.json also
# gives Node the "type":"module" it needs to load the ESM bundle.
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/build ./build
EXPOSE 8080
CMD ["node", "build/index.js"]
