# Kick MCSR Bot

## Overview
Node.js Kick chat bot scaffold that connects via WebSocket, responds to chat commands, and will pull data from the MCSR Ranked API. Phase 1 is implemented: the bot joins a channel and replies `Pong!` to `!ping`.

## Installation
1. Install Node.js (v18+ recommended).
2. Clone or copy this repository.
3. Run `npm install` inside `kick-mcsr-bot` to install dependencies.
4. Copy `.env.example` to `.env` and fill in your credentials:
   - `KICK_TOKEN`: Bot account token (Bearer token from Kick).
   - `KICK_CHANNEL`: Channel name to join (e.g., `trainwreckstv`).
   - `KICK_BOT_USERNAME`: Your bot's username (used to ignore its own messages).
   - `MCSR_API_BASE`: Base URL for the MCSR Ranked API (not used in Phase 1 yet).
   - `KICK_PUSHER_CLUSTER`: Optional Pusher cluster override (defaults to trying `us3,us2,us1,mt1,eu1,eu2,ap1,sa1` in order).
   - `KICK_PUSHER_KEY`: Optional Pusher app key override (defaults to the known public key).
   - `KICK_PUSHER_HOST`: Optional full Pusher host override (e.g., `wss://ws-us3.pusher.com` or a host seen in browser devtools).
   - `KICK_XSRF_TOKEN`: Value from your browser `XSRF-TOKEN` cookie (decoded).
   - `KICK_SESSION_COOKIE`: Value from your browser `kick_session` cookie (if present).
   - `KICK_EXTRA_COOKIES`: Optional extra cookies to append (raw `k=v; k2=v2` string) if Kick requires more session context.

## Running the bot
- Development: `npm start`
- Debugging in VS Code: use the provided "Run Kick Bot" launch config (loads `.env`).

## What Phase 1 does
- Fetches the channel chatroom ID.
- Connects to the Kick chat WebSocket (Pusher).
- Listens for chat messages and replies `Pong!` when it sees `!ping`.

## Development phases
- See `ROADMAP.md` for the six-phase plan (echo bot, API integration, multi-channel, permissions, subscriber-only, advanced features/stability).

## Folder structure
```
kick-mcsr-bot/
├── src/
│   ├── bot.js
│   ├── commands.js
│   ├── mcsrApi.js
│   └── storage.js
├── .env.example
├── .env
├── README.md
├── ROADMAP.md
├── package.json
└── .vscode/
    ├── launch.json
    └── settings.json
```
