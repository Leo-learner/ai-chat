#!/bin/bash
set -e

echo ""
echo "  ◆  Mac Controller"
echo ""

# Install Python dependencies
echo "  → Installing Python dependencies..."
pip3 install -r requirements.txt -q

# Check optional tools
if ! command -v brightness &>/dev/null; then
  echo "  ⚠  'brightness' not found — install with: brew install brightness"
fi
if ! command -v blueutil &>/dev/null; then
  echo "  ⚠  'blueutil' not found — install with: brew install blueutil"
fi

echo ""
echo "  → Starting server on port 5050..."
echo "  → Local:   http://localhost:5050"
echo "  → ngrok:   ngrok http 5050"
echo ""

python3 server.py
