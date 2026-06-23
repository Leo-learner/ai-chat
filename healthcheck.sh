#!/bin/bash
# ═══════════════════════════════════════════════════════
# AI Chat Healthcheck — 每30分钟检查服务器和ngrok状态
# ═══════════════════════════════════════════════════════

set -e

cd "$(dirname "$0")"
LOG_FILE="./healthcheck.log"
MAX_RETRY=3

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

if ! source ./scripts/use-node-abi127.sh; then
  log "Node.js ABI 127 runtime not found"
  exit 1
fi

# Source PORT from .env
source <(grep -v '^#' .env 2>/dev/null | grep -v '^$' | sed 's/^/export /')
PORT=${PORT:-3000}

check_server() {
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}" 2>/dev/null | grep -q "200\|301\|302"
}

check_ngrok() {
  # Check if ngrok process is running
  pgrep -f "ngrok http ${PORT}" > /dev/null 2>&1
}

get_ngrok_url() {
  curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['tunnels'][0]['public_url'])" 2>/dev/null
}

start_server() {
  log "Starting server on port ${PORT}..."
  nohup "$AI_CHAT_NODE_BIN" ./server.js > ./server.log 2>&1 &
  SERVER_PID=$!
  sleep 3
  if check_server; then
    log "Server started (PID ${SERVER_PID})"
    return 0
  fi
  log "Server failed to start"
  return 1
}

start_ngrok() {
  log "Starting ngrok on port ${PORT}..."
  # Kill any existing ngrok
  pkill -f "ngrok http ${PORT}" 2>/dev/null || true
  sleep 1
  nohup ngrok http ${PORT} --log=stdout > ./ngrok.log 2>&1 &
  NGROK_PID=$!
  sleep 4
  if check_ngrok; then
    NGROK_URL=$(get_ngrok_url)
    log "ngrok started (PID ${NGROK_PID}) - ${NGROK_URL}"
    return 0
  fi
  log "ngrok failed to start"
  return 1
}

# ═══════════════════════ MAIN ═══════════════════════
SERVER_OK=false
NGROK_OK=false
RESTART_NEEDED=false

# Check server
if check_server; then
  SERVER_OK=true
  log "✓ Server OK"
else
  log "✗ Server not responding"
  RESTART_NEEDED=true
fi

# Check ngrok
if check_ngrok; then
  NGROK_URL=$(get_ngrok_url)
  if [ -n "$NGROK_URL" ]; then
    NGROK_OK=true
    log "✓ ngrok OK - ${NGROK_URL}"
  else
    log "✗ ngrok running but no tunnel URL"
    NGROK_OK=false
  fi
else
  log "✗ ngrok not running"
  RESTART_NEEDED=true
fi

# If both OK, done
if $SERVER_OK && $NGROK_OK; then
  echo "服务器状态正常"
  exit 0
fi

# Need restart — retry up to MAX_RETRY times
log "=== Restart needed, max ${MAX_RETRY} attempts ==="

for attempt in $(seq 1 $MAX_RETRY); do
  log "--- Attempt ${attempt}/${MAX_RETRY} ---"

  # Kill existing processes
  if ! $SERVER_OK; then
    pkill -f "node.*server.js" 2>/dev/null || true
    sleep 1
    if start_server; then
      SERVER_OK=true
    fi
  fi

  if ! $NGROK_OK; then
    pkill -f "ngrok http" 2>/dev/null || true
    sleep 1
    if start_ngrok; then
      NGROK_OK=true
    fi
  fi

  # Re-check both
  if ! $SERVER_OK && check_server; then
    SERVER_OK=true
    log "✓ Server recovered on re-check"
  fi
  if ! $NGROK_OK && check_ngrok; then
    NGROK_OK=true
    log "✓ ngrok recovered on re-check"
  fi

  if $SERVER_OK && $NGROK_OK; then
    NGROK_URL=$(get_ngrok_url)
    echo "已重启服务器，目前状态正常"
    exit 0
  fi
done

# All retries exhausted
FAIL_REASON=""
if ! $SERVER_OK; then
  FAIL_REASON="${FAIL_REASON}Server failed to start after ${MAX_RETRY} attempts."
fi
if ! $NGROK_OK; then
  FAIL_REASON="${FAIL_REASON} ngrok failed to start after ${MAX_RETRY} attempts."
fi
log "FAILED: ${FAIL_REASON}"
echo "服务器出现问题，建议进行检查"
exit 1
