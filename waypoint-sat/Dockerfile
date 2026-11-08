FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_PERSISTENCE_MODE=server
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/model.ts src/companion-types.ts src/intelligence-types.ts src/work-check.ts ./src/
COPY src/data ./src/data
USER node
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "server/index.mjs"]
