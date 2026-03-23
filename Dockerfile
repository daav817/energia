# Energia Power LLC - CRM & Brokerage Management
# Development-focused Dockerfile

FROM node:20-alpine

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# Copy package files and prisma schema (needed for postinstall)
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install dependencies (postinstall runs prisma generate)
RUN npm install

# Copy rest of app (will be overwritten by volume mount in dev)
COPY . .

EXPOSE 3000

# Default: run dev server (overridden by docker-compose)
CMD ["sh", "-c", "npx prisma migrate deploy 2>/dev/null || npx prisma db push && npm run dev"]
