#!/bin/bash

# Traversion Test Suite Runner

echo "🧪 Running Traversion Test Suite..."

# Set test environment
export NODE_ENV=test
export JWT_SECRET=test-secret-key
export LOG_LEVEL=error

# Run different test suites
echo ""
echo "1️⃣ Running Unit Tests..."
npm test -- --testPathPattern="unit" --silent

echo ""
echo "2️⃣ Running Integration Tests..."
npm test -- --testPathPattern="integration/app" --silent

echo ""
echo "3️⃣ Running API Tests..."
npm test -- --testPathPattern="integration/api" --silent

echo ""
echo "4️⃣ Running Coverage Report..."
npm test -- --coverage --silent

echo ""
echo "✅ Test suite completed!"
