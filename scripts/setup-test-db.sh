#!/bin/bash

# Test Database Setup Script
# Creates and initializes the test database for Traversion test suite

set -e

# Configuration
DB_HOST=${TEST_DB_HOST:-localhost}
DB_PORT=${TEST_DB_PORT:-5432}
DB_NAME=${TEST_DB_NAME:-traversion_test}
DB_USER=${TEST_DB_USER:-traversion}
DB_PASSWORD=${TEST_DB_PASSWORD:-traversion_secret}

echo "Setting up test database: $DB_NAME"

# Check if PostgreSQL is running
if ! pg_isready -h $DB_HOST -p $DB_PORT -q; then
    echo "Error: PostgreSQL is not running on $DB_HOST:$DB_PORT"
    echo "Please start PostgreSQL or update connection settings"
    exit 1
fi

# Create test database if it doesn't exist
echo "Creating test database..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c \
    "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c \
    "CREATE DATABASE $DB_NAME"

# Install TimescaleDB extension
echo "Installing TimescaleDB extension..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c \
    "CREATE EXTENSION IF NOT EXISTS timescaledb"

# Run schema initialization
echo "Initializing test database schema..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME \
    -f "$(dirname "$0")/../init-db/01-schema.sql"

# Create test data if needed
echo "Creating test data..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME <<EOF
-- Insert test tenant
INSERT INTO tenants (id, name, subdomain) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Test Tenant', 'test')
ON CONFLICT (id) DO NOTHING;

-- Insert test service
INSERT INTO services (id, tenant_id, service_id, service_name) 
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'test-service',
    'Test Service'
) ON CONFLICT (id) DO NOTHING;
EOF

echo "Test database setup complete!"
echo ""
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "User: $DB_USER"
echo ""
echo "Run tests with:"
echo "  npm test"
echo "  npm run test:unit"
echo "  npm run test:integration"