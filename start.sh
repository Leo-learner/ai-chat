#!/bin/bash
# ═══════════════════════════════════════════════════════
# AI Chat — Start Script
# 1. Creates .env from .env.example if missing
# 2. Installs dependencies if needed
# 3. Starts the server
# 4. Starts ngrok tunnel (if installed)
# ═══════════════════════════════════════════════════════

set -e

cd "$(dirname "$0")"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        🤖 AI Chat Server            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# Create .env if not exists
if [ ! -f .env ]; then
  echo ""
  echo -e "${YELLOW}⚠ No .env file found. Creating from .env.example...${NC}"
  cp .env.example .env
  echo "  Please edit .env and add your API keys!"
  echo "  nano .env  (or use any text editor)"
  echo ""
fi

# Source .env for non-secret config
source <(grep -v '^#' .env | grep -v '^$' | sed 's/^/export /')

# Source secrets from outside project (API keys, JWT secret)
source ./scripts/load-secrets.sh

PORT=${PORT:-3000}

# Install deps
if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies..."
  npm install
  echo ""
fi

# Build frontend assets (minify JS/CSS)
if [ -f "scripts/build-frontend.js" ]; then
  echo "📦 Building frontend..."
  node scripts/build-frontend.js
  echo ""
fi

# Start server in background
echo -e "${GREEN}🚀 Starting server on port ${PORT}...${NC}"
node server.js &
SERVER_PID=$!

# Wait for server
sleep 1

# Start ngrok
if command -v ngrok &> /dev/null; then
  echo ""
  echo -e "${GREEN}🌐 Starting ngrok tunnel on port ${PORT}...${NC}"

  NGROK_CMD="ngrok http ${PORT}"
  if [ -n "$NGROK_AUTH_TOKEN" ]; then
    ngrok config add-authtoken "$NGROK_AUTH_TOKEN" 2>/dev/null || true
  fi

  ngrok http ${PORT} --log=stdout > ngrok.log 2>&1 &
  NGROK_PID=$!

  sleep 2

  # Get ngrok URL
  NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | grep -o '"public_url":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -n "$NGROK_URL" ]; then
    echo ""
    echo -e "${BLUE}══════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  🌍 Public URL: ${NGROK_URL}${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════${NC}"
  else
    echo "  (ngrok starting, check http://127.0.0.1:4040)"
  fi
else
  echo ""
  echo -e "${YELLOW}⚠ ngrok not installed.${NC}"
  echo "  Install: brew install ngrok"
  echo -e "  ${BLUE}Server running at: http://localhost:${PORT}${NC}"
fi

echo ""
echo "Press Ctrl+C to stop all services"

# Cleanup on exit
cleanup() {
  echo ""
  echo "🛑 Shutting down..."
  kill $SERVER_PID 2>/dev/null || true
  kill $NGROK_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# Keep running
wait
