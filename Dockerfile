FROM node:22-slim

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
COPY engine/package.json engine/
COPY client/package.json client/
COPY server/package.json server/

# Install ALL dependencies (dev deps needed for build)
RUN npm ci

# Copy source code
COPY . .

# Build all workspaces: engine → client → server
RUN npm run build

# Production runtime
ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "run", "start"]
