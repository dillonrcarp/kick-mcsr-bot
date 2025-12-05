# Kick MCSR Bot

## Overview
TypeScript rewrite of the Kick MCSR bot that uses modern ES modules, async/await, and a clean folder structure. The bot connects to Kick chat over WebSocket, listens for commands, and responds with data from the MCSR Ranked API. It automatically manages multi-channel enrollment when moderators add/remove the bot.

## Requirements
- Node.js 18+
- npm (for dependency management)
- A `.env` file containing:
  - `KICK_TOKEN`: Bot account token (URL encoded Bearer token).
  - `KICK_CHANNEL`: Default channel to join.
  - `KICK_BOT_USERNAME`: Bot username (used for self-filtering and `!join` restrictions).
  - `MCSR_API_BASE`: Optional override for the MCSR Ranked API.
  - `KICK_PUSHER_CLUSTER`, `KICK_PUSHER_KEY`, `KICK_PUSHER_HOST`: Optional Kick/Pusher overrides.
  - `KICK_XSRF_TOKEN`, `KICK_SESSION_COOKIE`, `KICK_EXTRA_COOKIES`, `KICK_COOKIE_HEADER`: Optional cookies for authenticated requests.

## Installation & Running
1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the TypeScript sources:
   ```bash
   npm run build
   ```
3. Start the bot:
   ```bash
   npm start
   ```
4. For iterative development you can run the TypeScript entry point directly:
   ```bash
   npm run dev
   ```

The bot persists channel enrollment and linked accounts inside the `data/` directory. Mount or back up this directory if you deploy inside containers.

## Docker
Build and run inside Docker on Linux-friendly Node images:
```bash
docker build -t kick-mcsr-bot .
docker run --env-file .env -v "$(pwd)/data:/app/data" kick-mcsr-bot
```
Mounting `./data` keeps channel/linked-account data between container restarts.

## Folder structure
```
kick-mcsr-bot/
├── src/
│   ├── bot/
│   │   └── kickBot.ts
│   ├── commands/
│   │   └── index.ts
│   ├── config/
│   │   └── env.ts
│   ├── persistence/
│   │   ├── channelRegistry.ts
│   │   └── linkedAccounts.ts
│   └── services/
│       ├── chatClient.ts
│       ├── kickChannelManager.ts
│       └── mcsrApi.ts
├── data/
│   ├── channels.json
│   └── linkedAccounts.json
├── Dockerfile
├── .dockerignore
├── README.md
├── ROADMAP.md
├── package.json
└── tsconfig.json
```

See `ROADMAP.md` for the long-term feature plan.
