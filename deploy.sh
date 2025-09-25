#!/bin/bash

# Traversion Production Deployment Script

set -e

echo "🚀 Starting Traversion deployment..."

# Check for required environment variables
if [ -z "$JWT_SECRET" ]; then
    echo "❌ Error: JWT_SECRET environment variable is required"
    exit 1
fi

if [ -z "$DB_PASSWORD" ]; then
    echo "❌ Error: DB_PASSWORD environment variable is required"
    exit 1
fi

# Build the application
echo "📦 Building Docker image..."
docker build -t traversion:latest .

# Run database migrations
echo "🗄️ Running database migrations..."
docker-compose run --rm app node src/database/migrations.js

# Start services
echo "🎯 Starting services..."
docker-compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check health
echo "🏥 Checking service health..."
curl -f http://localhost:3335/health || {
    echo "❌ Health check failed"
    docker-compose logs app
    exit 1
}

echo "✅ Deployment successful!"
echo "📊 Application running at http://localhost:3335"
echo "📚 API Documentation at http://localhost:3335/api-docs"
