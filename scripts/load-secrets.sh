#!/bin/bash
# ═══════════════════════════════════════════════════════
# Load secrets from ~/.ai-chat/secrets.env
# Secrets are stored outside the project to prevent
# accidental commit, backup, or exposure via finder routes
# ═══════════════════════════════════════════════════════

SECRETS_FILE="$HOME/.ai-chat/secrets.env"

if [ -f "$SECRETS_FILE" ]; then
  source <(grep -v '^#' "$SECRETS_FILE" | grep -v '^$' | sed 's/^/export /')
else
  echo "⚠ WARNING: $SECRETS_FILE not found. AI features may not work."
  echo "  Create it with: JWT_SECRET=... and DEEPSEEK_API_KEY=..."
fi
