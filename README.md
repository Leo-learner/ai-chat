# AI Chat

> [!IMPORTANT]
> **服务器专用版本：`server/aichatupdated-20260628`**
> 此分支仅用于 Azure 上的 `aichat.dkz12345.com` 生产服务。桌面本地版本请继续使用 `main`；部署时必须保留服务器现有的 `.env`、`providers.json` 和 `data/`。

A self-hosted AI chat web app with streaming responses, Markdown and code rendering, chat history, local memory retrieval, optional web search, and admin-only desktop control and file management tools.

## Features

- AI chat with SSE streaming, stop generation, continue generation, regenerate, message copy, and code-block copy.
- Conversation history with create, switch, rename, and delete support.
- Local memory library powered by Ollama embeddings, so memory retrieval can stay on your machine.
- Context management with token-budget trimming, older-message summarization, and relevant memory injection.
- Optional web search through Tavily, disabled by default.
- Admin-only tools for remote control, terminal access, and Finder-style file management.
- Responsive UI modes for desktop browsers, mobile browsers, Android WebView, and a macOS WebView client.

## Tech Stack

- Node.js + Express
- SQLite + better-sqlite3
- Plain HTML/CSS/JavaScript
- OpenAI-compatible chat providers
- Ollama for local embeddings

## Quick Start

```bash
npm install
cp .env.example .env
mkdir -p ~/.ai-chat
```

Create `~/.ai-chat/secrets.env` for private secrets:

```bash
JWT_SECRET=replace-with-a-long-random-string
DEEPSEEK_API_KEY=sk-your-key
```

Adjust non-secret settings in `.env` as needed, then start the server:

```bash
npm start
```

For development, run the source files directly so old build artifacts do not hide your changes:

```bash
npm run dev
```

## Scripts

```bash
npm run check
npm run build
npm run smoke:startup
npm run smoke:auth
```

## Configuration

- Keep private secrets out of the repository. Store them in `~/.ai-chat/secrets.env`.
- Use `.env.example` for public, non-secret configuration examples.
- Chat model providers are configured in `providers.json`.
- API keys should be referenced through environment-variable placeholders.
- Local memory embeddings use Ollama by default with `nomic-embed-text:latest`.

## Security Notes

- `data/`, logs, databases, backup files, build artifacts, and local secret files are ignored by Git.
- Control, terminal, and Finder routes must be protected by backend admin checks. Frontend hiding is not a security boundary.
- Use a strong `JWT_SECRET` in production. Do not use development defaults.

## License

MIT

---

## 服务器部署 (Server Chat-Only)

`server/aichatupdated-20260628` 分支是专为服务器部署制作的精简版本：只保留 AI 聊天功能，禁用本地 Mac 控制、终端、文件管理等。

### 功能差异

| 功能 | 本地版 (main) | 服务器版 (deploy/server-chat-only) |
|------|:---:|:---:|
| AI 对话 | ✅ | ✅ |
| 记忆库 | ✅ | ❌ (预留 API，未来迁移云端 embedding) |
| 打字练习 | ✅ | ❌ |
| Mac 远程控制 | ✅ | ❌ |
| 远程终端 | ✅ | ❌ |
| 文件管理 | ✅ | ❌ |

### 环境变量

```bash
# 必需
APP_MODE=server-chat-only
JWT_SECRET=<your-strong-random-string>
OPENROUTER_API_KEY=<your-openrouter-api-key>
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
DEFAULT_CHAT_MODEL=openrouter/free

# 可选
PORT=3200
NODE_ENV=production
HOST=127.0.0.1

# 数据路径
DB_PATH=/opt/apps/ai-chat/data/chat.db
```

> ⚠️ 不要将 `.env` 文件提交到 Git。API Key 只在服务端环境变量中配置。

### 服务器部署 (systemd + Nginx)

```bash
# 1. 克隆仓库
sudo mkdir -p /opt/apps
sudo chown -R $USER:$USER /opt/apps
git clone https://github.com/Leo-learner/ai-chat.git /opt/apps/ai-chat
cd /opt/apps/ai-chat
git checkout server/aichatupdated-20260628

# 2. 安装依赖
npm install
npm run build

# 3. 创建 .env
cat > .env << 'EOF'
APP_MODE=server-chat-only
NODE_ENV=production
HOST=127.0.0.1
PORT=3200
JWT_SECRET=<random-string>
OPENROUTER_API_KEY=<your-key>
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
DEFAULT_CHAT_MODEL=openrouter/free
ADMIN_USERNAME=<your-username>
DB_PATH=/opt/apps/ai-chat/data/chat.db
EOF
chmod 600 .env

# 4. systemd 服务
sudo tee /etc/systemd/system/ai-chat.service << 'SVC'
[Unit]
Description=AI Chat Server Chat-Only Service
After=network.target
[Service]
Type=simple
User=leo
Group=leo
WorkingDirectory=/opt/apps/ai-chat
EnvironmentFile=/opt/apps/ai-chat/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
SVC

sudo systemctl daemon-reload
sudo systemctl enable ai-chat
sudo systemctl start ai-chat

# 5. Nginx 反向代理 (aichat.dkz12345.com)
sudo tee /etc/nginx/sites-available/aichat.dkz12345.com << 'NGX'
server {
    listen 80;
    server_name aichat.dkz12345.com;
    client_max_body_size 50M;
    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGX

sudo ln -sf /etc/nginx/sites-available/aichat.dkz12345.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. HTTPS
sudo certbot --nginx -d aichat.dkz12345.com
```

### 数据迁移

从本地迁移用户数据到服务器：

```bash
# 本地：检查数据大小
ls -lh data/chat.db data/chat.db-wal

# 服务器：先备份
cp /opt/apps/ai-chat/data/chat.db /opt/apps/ai-chat/data/chat.db.bak.$(date +%Y%m%d)

# 本地：复制到服务器
scp data/chat.db leo@20.48.14.96:/opt/apps/ai-chat/data/chat.db

# 服务器：重启服务
sudo systemctl restart ai-chat
```

### 安全注意事项

- 使用强随机 `JWT_SECRET`（`openssl rand -hex 32`）
- `.env` 文件权限必须为 `600`
- API Key 不通过前端传输，所有模型调用走后端代理
- systemd 服务启用 `NoNewPrivileges=true`、`PrivateTmp=true`
