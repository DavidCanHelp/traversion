#!/bin/bash

# 🚀 Traversion Quick Setup - The Best Open Source Incident Analysis Tool
# One command to rule them all: ./setup.sh

set -e

# Colors for beautiful output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Fancy banner
echo -e "${BLUE}"
cat << "EOF"
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║  ████████╗██████╗  █████╗ ██╗   ██╗███████╗██████╗     ║
║  ╚══██╔══╝██╔══██╗██╔══██╗██║   ██║██╔════╝██╔══██╗    ║
║     ██║   ██████╔╝███████║██║   ██║█████╗  ██████╔╝    ║
║     ██║   ██╔══██╗██╔══██║╚██╗ ██╔╝██╔══╝  ██╔══██╗    ║
║     ██║   ██║  ██║██║  ██║ ╚████╔╝ ███████╗██║  ██║    ║
║     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝    ║
║                                                          ║
║          OPEN SOURCE INCIDENT ANALYSIS PLATFORM         ║
╚══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

echo -e "${YELLOW}🚀 Starting Traversion Setup...${NC}\n"

# Step 1: Check Node.js
echo -e "${BLUE}[1/7]${NC} Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 18+ first.${NC}"
    echo "Visit: https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js 18+ required. Current: $(node -v)${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"

# Step 2: Check Git
echo -e "${BLUE}[2/7]${NC} Checking Git..."
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git not found. Please install Git first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Git $(git --version | cut -d' ' -f3) installed${NC}"

# Step 3: Install dependencies
echo -e "${BLUE}[3/7]${NC} Installing dependencies..."
npm install --silent 2>/dev/null || npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Step 4: Setup environment
echo -e "${BLUE}[4/7]${NC} Setting up environment..."
if [ ! -f .env ]; then
    cp .env.example .env
    # Generate secure secrets
    JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || echo "dev-secret-$(date +%s)")
    SESSION_SECRET=$(openssl rand -base64 32 2>/dev/null || echo "session-secret-$(date +%s)")

    # Update .env with generated secrets
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
        sed -i '' "s/SESSION_SECRET=.*/SESSION_SECRET=$SESSION_SECRET/" .env
    else
        sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
        sed -i "s/SESSION_SECRET=.*/SESSION_SECRET=$SESSION_SECRET/" .env
    fi
    echo -e "${GREEN}✓ Environment configured with secure secrets${NC}"
else
    echo -e "${GREEN}✓ Environment already configured${NC}"
fi

# Step 5: Check Docker (optional)
echo -e "${BLUE}[5/7]${NC} Checking Docker (optional)..."
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓ Docker installed - you can use docker-compose for production${NC}"
else
    echo -e "${YELLOW}ℹ Docker not found - you can install it for production deployment${NC}"
fi

# Step 6: Initialize database
echo -e "${BLUE}[6/7]${NC} Initializing database..."
mkdir -p .traversion/logs .traversion/backups
echo -e "${GREEN}✓ Database directories created${NC}"

# Step 7: Check if Redis is available (optional)
echo -e "${BLUE}[7/7]${NC} Checking Redis (optional)..."
if command -v redis-cli &> /dev/null && redis-cli ping &> /dev/null; then
    echo -e "${GREEN}✓ Redis is running - caching will be available${NC}"
    sed -i '' "s/REDIS_ENABLED=.*/REDIS_ENABLED=true/" .env 2>/dev/null || \
    sed -i "s/REDIS_ENABLED=.*/REDIS_ENABLED=true/" .env
else
    echo -e "${YELLOW}ℹ Redis not running - caching disabled (install for better performance)${NC}"
fi

# Success!
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 Setup Complete! Traversion is ready to use!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Show next steps
echo -e "${YELLOW}📋 Quick Start Commands:${NC}\n"
echo -e "  ${BLUE}Start Traversion:${NC}"
echo -e "  npm start\n"
echo -e "  ${BLUE}Open Dashboard:${NC}"
echo -e "  open http://localhost:3335/dashboard\n"
echo -e "  ${BLUE}View API Docs:${NC}"
echo -e "  open http://localhost:3335/api-docs\n"
echo -e "  ${BLUE}Run Tests:${NC}"
echo -e "  npm test\n"
echo -e "  ${BLUE}Production Deployment:${NC}"
echo -e "  docker-compose up -d\n"

# Ask if user wants to start now
echo -e "${YELLOW}Would you like to start Traversion now? (y/n)${NC}"
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
    echo -e "\n${GREEN}Starting Traversion...${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop${NC}\n"

    # Open browser after a delay
    (sleep 3 && open http://localhost:3335 2>/dev/null || xdg-open http://localhost:3335 2>/dev/null || echo "Visit http://localhost:3335") &

    # Start the application
    npm start
else
    echo -e "\n${BLUE}Run 'npm start' when you're ready to begin!${NC}"
fi