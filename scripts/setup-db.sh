#!/bin/bash
# Energia Power LLC - Database Setup Script
# Run this to create tables when using Docker for PostgreSQL

set -e
echo "Setting up database via Docker..."

# Ensure postgres is running
docker compose up postgres -d 2>/dev/null || true

# Wait for postgres to be ready
sleep 5

# Run prisma db push from app container (connects to postgres on Docker network)
docker compose run --rm -e DATABASE_URL="postgresql://energia:energia_dev_password@postgres:5432/energia_db" app npx prisma db push

echo "Database setup complete."
