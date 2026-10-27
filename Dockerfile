FROM node:22-alpine

WORKDIR /app

# Zero runtime dependencies: the addon uses only Node's built-in `fetch`,
# `URL`, `Request`, `Response` and `node:http`.
COPY package.json ./
COPY worker.js server.js ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
