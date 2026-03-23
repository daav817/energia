# Energia Power LLC - Database Setup Script
# Run this to create tables when using Docker for PostgreSQL

Write-Host "Setting up database via Docker..." -ForegroundColor Cyan

# Ensure postgres is running
docker compose up postgres -d 2>$null

# Wait for postgres to be ready
Start-Sleep -Seconds 5

# Run prisma db push from app container (connects to postgres on Docker network)
docker compose run --rm -e DATABASE_URL="postgresql://energia:energia_dev_password@postgres:5432/energia_db" app npx prisma db push

if ($LASTEXITCODE -eq 0) {
    Write-Host "Database setup complete." -ForegroundColor Green
} else {
    Write-Host "Database setup failed. Ensure Docker is running and postgres container is up." -ForegroundColor Red
    exit 1
}
