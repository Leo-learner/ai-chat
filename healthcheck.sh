#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PORT="${PORT:-3000}"

status="$(curl -s -o /tmp/ai-chat-cloud-lite-health.json -w "%{http_code}" \
  "http://127.0.0.1:${PORT}/api/health" || true)"

if [ "$status" = "200" ]; then
  echo "ai-chat-cloud-lite healthy on port ${PORT}"
  cat /tmp/ai-chat-cloud-lite-health.json
  echo
  exit 0
fi

echo "ai-chat-cloud-lite health check failed with HTTP ${status}"
cat /tmp/ai-chat-cloud-lite-health.json 2>/dev/null || true
echo
exit 1
