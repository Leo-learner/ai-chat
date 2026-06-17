#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  echo "Create .env from .env.example and set OPENAI_API_KEY before production use."
fi

npm run build
npm start
