#!/bin/bash

set -e

cd "$(dirname "$0")/.."
source ./scripts/use-node-abi127.sh
exec "$AI_CHAT_NODE_BIN" "$@"
