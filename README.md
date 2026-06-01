# AI Chat

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
