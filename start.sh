#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
source ./scripts/use-node-abi127.sh

if [ ! -d node_modules ]; then
  "$AI_CHAT_NPM_BIN" install
fi

"$AI_CHAT_NODE_BIN" scripts/build-frontend.js
exec "$AI_CHAT_NODE_BIN" server.js
