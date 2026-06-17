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
PORT=3000
NODE_ENV=production
MEMORY_ENABLED=false
TERMINAL_ENABLED=false
CONTROL_ENABLED=false
MCP_ENABLED=false
FILE_ACCESS_ENABLED=false
```

Do not put `OPENAI_API_KEY` in frontend code. The current build does not include login authentication; use it only on trusted networks, an internal network, behind reverse-proxy authentication, or on the local machine.

## Windows Server Start

```powershell
npm install
npm run build
npm start
```

Open `http://127.0.0.1:3000`; the app loads directly into the chat interface.

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
