# AI Chat

> [!IMPORTANT]
> **服务器专用版本：`server/aichatupdated-20260628`**
> 此分支仅用于 Azure 上的 `aichat.dkz12345.com` 生产服务。桌面本地版本请继续使用 `main`；部署时必须保留服务器现有的 `.env`、`providers.json` 和 `data/`。

A self-hosted AI chat web app with streaming responses, Markdown and code rendering, persistent chat history, optional web search, and a responsive production UI. This branch contains no Mac control, Finder, terminal, ngrok, or local embedding runtime.

## Features

- AI chat with SSE streaming, stop generation, continue generation, regenerate, message copy, and code-block copy.
- Conversation history with create, switch, rename, and delete support.
- Context management with token-budget trimming and older-message summarization.
- Optional web search through Tavily, disabled by default.
- Light, dark, and system themes plus account settings.
- Responsive UI for desktop and mobile browsers.

## Tech Stack

- Node.js + Express
- SQLite + better-sqlite3
- Plain HTML/CSS/JavaScript
- OpenAI-compatible chat providers

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
npm test
npm run build
npm run smoke:startup
npm run smoke:provider
npm run smoke:security-latency
```

## Configuration

- Keep private secrets out of the repository. Store them in `~/.ai-chat/secrets.env`.
- Use `.env.example` for public, non-secret configuration examples.
- Chat model providers are configured in `providers.json`.
- API keys should be referenced through environment-variable placeholders.
- This production branch has a fixed `server-chat-only` mode; no mode flag is required.

## Security Notes

- `data/`, logs, databases, backup files, build artifacts, and local secret files are ignored by Git.
- Legacy control and Finder endpoints return a fixed 403 response; their implementations are not shipped.
- Use a strong `JWT_SECRET` in production. Do not use development defaults.
- Registration is closed unless `REGISTRATION_MODE` is `invite` (with `REGISTRATION_INVITE_CODES`) or `open`.
- Each user has a daily message quota, a concurrent-stream cap, and a chat-count cap; admins are exempt from the quota and chat cap.
- Changing the password or using "sign out of all devices" revokes every previously issued token.

## License

MIT

---

## 服务器部署 (Server Chat-Only)

`server/aichatupdated-20260628` 分支是专为服务器部署制作的精简版本：只保留 AI 聊天功能。本地 Mac 控制、终端、文件管理、ngrok 运维和本地记忆实现已从此分支移除，而非仅通过环境变量隐藏。

### 功能差异

| 功能 | 本地版 (main) | 服务器版 (server/aichatupdated-20260628) |
|------|:---:|:---:|
| AI 对话 | ✅ | ✅ |
| 记忆库 | ✅ | ❌ (接口与自动检索均关闭) |
| 打字练习 | ✅ | ❌ |
| Mac 远程控制 | ✅ | ❌ |
| 远程终端 | ✅ | ❌ |
| 文件管理 | ✅ | ❌ |

### 环境变量

```bash
# 必需
JWT_SECRET=<your-strong-random-string>
OPENROUTER_API_KEY=<your-openrouter-api-key>
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
DEFAULT_CHAT_MODEL=openrouter/free

# 注册（默认 closed；invite 需要邀请码，多个用逗号分隔）
REGISTRATION_MODE=invite
REGISTRATION_INVITE_CODES=<random-code>

# 可选
PORT=3200
NODE_ENV=production
HOST=127.0.0.1
JSON_BODY_LIMIT=256kb
TRUST_PROXY=loopback
CHAT_DAILY_MESSAGE_LIMIT=200      # 每人每天消息数，0 为不限，管理员不受限
CHAT_MAX_CONCURRENT_STREAMS=2     # 每人同时生成中的回答数
MAX_CHATS_PER_USER=500            # 每人会话数上限，管理员不受限

# 数据路径
DB_PATH=/opt/apps/ai-chat/data/chat.db
```

> ⚠️ 不要将 `.env` 文件提交到 Git。API Key 只在服务端环境变量中配置。

### 服务器部署 (systemd + Nginx)

发布顺序固定为：先在本地完成修改与全部验证，再把确切提交推送到 GitHub，最后只在服务器部署这个已推送提交。禁止直接修改生产代码或部署尚未推送的本地内容。

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
NODE_ENV=production
HOST=127.0.0.1
PORT=3200
JWT_SECRET=<random-string>
OPENROUTER_API_KEY=<your-key>
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
DEFAULT_CHAT_MODEL=openrouter/free
DB_PATH=/opt/apps/ai-chat/data/chat.db
JSON_BODY_LIMIT=256kb
MAX_MESSAGE_CHARS=32000
MAX_SYSTEM_PROMPT_CHARS=16000
MAX_CHAT_TITLE_CHARS=80
MODEL_FIRST_BYTE_TIMEOUT_MS=30000
MODEL_STREAM_IDLE_TIMEOUT_MS=45000
MODEL_TOTAL_TIMEOUT_MS=300000
REGISTRATION_MODE=invite
EOF
echo "REGISTRATION_INVITE_CODES=$(openssl rand -hex 12)" >> .env
chmod 600 .env

# 4. systemd 服务：专用系统账户 + 沙箱（只有 data/ 可写）
sudo useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin aichat
sudo mkdir -p /opt/apps/ai-chat/data
sudo chown -R aichat:aichat /opt/apps/ai-chat/data
sudo chmod 700 /opt/apps/ai-chat/data
sudo cp deploy/systemd/ai-chat.service /etc/systemd/system/ai-chat.service

sudo systemctl daemon-reload
sudo systemctl enable ai-chat
sudo systemctl start ai-chat

# 5. 首次安装先使用 HTTP bootstrap 配置
sudo cp deploy/nginx/aichat.dkz12345.com.bootstrap.conf /etc/nginx/sites-available/aichat.dkz12345.com

sudo ln -sf /etc/nginx/sites-available/aichat.dkz12345.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. HTTPS
sudo certbot --nginx -d aichat.dkz12345.com

# 7. 证书签发后切换到仓库内的最终 HTTPS 配置
sudo cp deploy/nginx/aichat.dkz12345.com.conf /etc/nginx/sites-available/aichat.dkz12345.com
sudo nginx -t && sudo systemctl reload nginx

# 8. 隐藏 nginx 版本号：在 /etc/nginx/nginx.conf 的 http 块中启用
#    server_tokens off;
```

### 数据迁移

从本地迁移用户数据到服务器：

```bash
# 本地：检查数据大小
ls -lh data/chat.db data/chat.db-wal

# 服务器：停服务并备份（data/ 归 aichat 所有，需要 sudo）
sudo systemctl stop ai-chat
sudo cp -a /opt/apps/ai-chat/data /opt/apps/ai-chat-deploy-backups/data.$(date +%Y%m%d-%H%M%S)

# 本地：复制到服务器临时目录
scp data/chat.db leo@20.48.14.96:/tmp/chat.db

# 服务器：放入数据目录并恢复属主后启动
sudo install -o aichat -g aichat -m 600 /tmp/chat.db /opt/apps/ai-chat/data/chat.db
sudo rm -f /opt/apps/ai-chat/data/chat.db-wal /opt/apps/ai-chat/data/chat.db-shm /tmp/chat.db
sudo systemctl start ai-chat
```

### 安全注意事项

- 使用强随机 `JWT_SECRET`（`openssl rand -hex 32`）
- `.env` 文件权限必须为 `600`
- API Key 不通过前端传输，所有模型调用走后端代理
- systemd 服务以专用 `aichat` 账户运行，启用 `ProtectSystem=strict`、`ProtectHome=true` 等沙箱，只有 `data/` 可写（见 `deploy/systemd/ai-chat.service`）
- CSP（不允许内联脚本和内联样式）、HSTS（仅 HTTPS 请求）、frame 限制等响应安全头由应用统一发送，Nginx 不重复添加
- 默认关闭注册；对外开放请使用邀请码模式，并保留每日额度、并发和会话数上限
- 生产环境必须先运行 `npm run build`，且不得设置 `SERVE_DIST=0`
