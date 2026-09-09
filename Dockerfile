# Hosted deployments don't use the ESPN browser handoff (it would open a window
# on the server), so Playwright is skipped here to keep the image small.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=optional --omit=dev

COPY server ./server
COPY public ./public

# Linked accounts persist here. Mount a volume or the store resets on redeploy.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV ROTOBOT_HOSTED=1
EXPOSE 3000

CMD ["node", "server/index.js"]
