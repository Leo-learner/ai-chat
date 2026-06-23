#!/bin/bash

AI_CHAT_REQUIRED_NODE_ABI=127

node_candidates=(
  "${AI_CHAT_NODE_BIN:-}"
  "$HOME/.nvm/versions/node/v22.22.2/bin/node"
  "$HOME/.local/bin/node"
  "$(command -v node 2>/dev/null || true)"
  "/opt/homebrew/bin/node"
  "/usr/local/bin/node"
)

AI_CHAT_NODE_BIN=""
for candidate in "${node_candidates[@]}"; do
  [ -n "$candidate" ] || continue
  [ -x "$candidate" ] || continue
  if [ "$("$candidate" -p 'process.versions.modules' 2>/dev/null)" = "$AI_CHAT_REQUIRED_NODE_ABI" ]; then
    AI_CHAT_NODE_BIN="$candidate"
    break
  fi
done

if [ -z "$AI_CHAT_NODE_BIN" ]; then
  echo "Node.js ABI ${AI_CHAT_REQUIRED_NODE_ABI} is required, but no compatible runtime was found." >&2
  return 1 2>/dev/null || exit 1
fi

AI_CHAT_NODE_DIR="$(dirname "$AI_CHAT_NODE_BIN")"
AI_CHAT_NPM_BIN="$AI_CHAT_NODE_DIR/npm"
if [ ! -x "$AI_CHAT_NPM_BIN" ]; then
  echo "npm was not found beside the selected Node.js runtime: $AI_CHAT_NODE_DIR" >&2
  return 1 2>/dev/null || exit 1
fi

export AI_CHAT_NODE_BIN AI_CHAT_NODE_DIR AI_CHAT_NPM_BIN
export PATH="$AI_CHAT_NODE_DIR:$PATH"
