# AI Chat Cloud Lite

Cloud-lite AI chat for a Windows Server cloud desktop. This version keeps the core chat experience, model selection, basic conversation history, settings, and the optional Stilltype typing practice page.

Disabled by design:

- Long-term memory and automatic memory writes
- Browser-triggered terminal or command execution
- Computer/device control
- File manager and arbitrary local file read/write
- MCP local file access

## Environment

Copy `.env.example` to `.env` and set:

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
DEFAULT_MODEL=gpt-4o-mini
APP_ACCESS_TOKEN=
PORT=3000
NODE_ENV=production
```

`APP_ACCESS_TOKEN` is required for every API request. Do not put `OPENAI_API_KEY` in frontend code.

## Windows Server Start

```powershell
npm install
npm run build
npm start
```

Open `http://127.0.0.1:3000` and enter `APP_ACCESS_TOKEN`.

## PM2

```powershell
npm install -g pm2
pm2 start server.js --name ai-chat-cloud-lite
pm2 save
```

Stop:

```powershell
pm2 stop ai-chat-cloud-lite
```

Rollback: stop this service and restore the previous project directory or Git branch.
