# LAST ROUND match server (online 1v1).
# The web client is a static site and is built separately with `npm run build`.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY server ./server
RUN npm run server:build

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8787
WORKDIR /app
# The bundle is a single ES module with no runtime dependencies.
COPY --from=build /app/dist-server/index.js ./index.js
RUN echo '{"type":"module"}' > package.json
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "index.js"]
