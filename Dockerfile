FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --include=dev

# Copy source and build frontend
COPY . .
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
