#!/bin/bash
# ═══════════════════════════════════════════════════════
# AI Chat — Monitor Script (check-only, no side effects)
# Outputs structured status for cron job consumption
# ═══════════════════════════════════════════════════════

cd "$(dirname "$0")/.."

# Source PORT from .env
source <(grep -v '^#' .env 2>/dev/null | grep -v '^$' | sed 's/^/export /')
PORT=${PORT:-3000}

# Check server
if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/" 2>/dev/null | grep -q "200\|301\|302\|304"; then
  SERVER_STATUS="running"
else
  SERVER_STATUS="down"
fi

# Check ngrok process
if pgrep -f "ngrok http ${PORT}" > /dev/null 2>&1; then
  NGROK_STATUS="running"
  # Try to get URL
  NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | python3 -c \
    "import json,sys; d=json.load(sys.stdin); ts=d.get('tunnels',[]); print(ts[0]['public_url'] if ts else 'unknown')" 2>/dev/null)
  [ -z "$NGROK_URL" ] && NGROK_URL="unknown"
else
  NGROK_STATUS="down"
  NGROK_URL=""
fi

# Check recent errors in server.log (last 50 lines for ERROR/Exception)
RECENT_ERRORS=$(tail -50 server.log 2>/dev/null | grep -ci "error\|exception\|traceback" 2>/dev/null || true)
[ -z "$RECENT_ERRORS" ] && RECENT_ERRORS=0

# Output structured info
echo "SERVER_STATUS=${SERVER_STATUS}"
echo "NGROK_STATUS=${NGROK_STATUS}"
echo "NGROK_URL=${NGROK_URL}"
echo "PORT=${PORT}"
echo "RECENT_ERRORS=${RECENT_ERRORS}"

# Exit code: 0 = all good, 1 = something wrong
if [ "$SERVER_STATUS" = "running" ] && [ "$NGROK_STATUS" = "running" ] && [ "$RECENT_ERRORS" -lt 5 ]; then
  exit 0
else
  exit 1
fi