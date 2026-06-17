#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  echo "Create .env from .env.example and set APP_ACCESS_TOKEN plus OPENAI_API_KEY before production use."
fi

npm run build
npm start
