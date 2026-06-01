# AI Chat

一个自托管 AI 对话网站，包含流式聊天、Markdown/代码块渲染、会话历史、记忆库、本地 embedding、可选联网搜索，以及管理员专用的控制台和文件管理能力。

## 功能概览

- AI 对话：支持 SSE 流式输出、停止生成、继续生成、重新回答、消息复制和代码块一键复制。
- 会话历史：支持新建、切换、重命名和删除会话。
- 记忆库：使用本地 Ollama embedding 做记忆检索，不把 embedding 数据交给聊天模型供应商。
- 上下文管理：按 token 预算裁剪历史、摘要旧消息并注入相关记忆。
- 可选联网搜索：通过 Tavily 搜索结果增强回答，默认关闭。
- 管理员功能：控制台、终端和 Finder 文件管理均由后端权限保护。
- 多端适配：普通浏览器、Android WebView 模式和 macOS WebView 客户端模式使用隔离样式。

## 技术栈

- Node.js + Express
- SQLite + better-sqlite3
- 原生 HTML/CSS/JavaScript
- OpenAI-compatible chat provider
- Ollama 本地 embedding

## 快速开始

```bash
npm install
cp .env.example .env
mkdir -p ~/.ai-chat
```

在 `~/.ai-chat/secrets.env` 中写入私密配置：

```bash
JWT_SECRET=replace-with-a-long-random-string
DEEPSEEK_API_KEY=sk-your-key
```

根据需要调整 `.env` 中的非敏感配置，然后启动：

```bash
npm start
```

开发模式会直接使用源码文件，避免旧构建产物遮住改动：

```bash
npm run dev
```

## 常用脚本

```bash
npm run check
npm run build
npm run smoke:startup
npm run smoke:auth
```

## 配置说明

- 敏感配置不要写进仓库，放在 `~/.ai-chat/secrets.env`。
- `.env.example` 只保存可公开的示例配置。
- 聊天模型配置在 `providers.json`，API key 使用环境变量占位符。
- 本地记忆 embedding 默认使用 Ollama：`nomic-embed-text:latest`。

## 安全说明

- `data/`、日志、数据库、备份文件、构建产物和本地密钥默认不进入 Git。
- 控制台、终端和 Finder 接口必须通过后端管理员权限校验，不能只依赖前端隐藏。
- 生产环境请使用足够强的 `JWT_SECRET`，不要使用默认开发密钥。

## License

MIT
