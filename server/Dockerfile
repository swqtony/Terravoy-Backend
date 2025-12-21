FROM node:20-alpine

WORKDIR /app

# Install deps
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy application code and migrations
COPY server/src ./src
COPY server/scripts ./scripts
COPY db ./db

ENV PORT=3000

CMD ["node", "src/app.js"]
