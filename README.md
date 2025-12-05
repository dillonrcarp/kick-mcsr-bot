# kick-mcsr-bot

Kick chat bot with pluggable commands for MCSR Ranked stats.

## Setup

1. Copy `.env.example` to `.env` and fill in your Kick token, username, and channel.
   - To handle multiple channels, set `KICK_CHANNELS` to entries like `channel1:12345,channel2:67890`.
   - Set `LOG_CHAT_EVENTS=1` if you want to log every incoming chat message (defaults to off).
2. Install deps with `npm install`.
3. Build with `npm run build`.
4. Run with `npm start`.

## Commands

Commands use the `+` prefix (they also respond to `!` for legacy compatibility).

| Command | Aliases | Description |
| --- | --- | --- |
| `+ping` | — | Simple connectivity test. |
| `+elo <player>` | `+stats` | Elo, rank, win/loss stats, PB, averages. |
| `+winrate <player>` | `+wr` | Lifetime wins/losses, win rate, FFR. |
| `+average <player>` | `+avg` | Average completion time, PB, and finishes. |
| `+race <player>` | `+wrace`, `+weeklyrace` | Weekly Ranked Race status. |
| `+lastmatch <player>` | `+lm`, `+recent` | Most recent ranked match summary. |
| `+record <p1> <p2>` | `+vs`, `+headtohead` | Head-to-head match record. |
| `+mcsrhelp [command]` | `+mcsrcommands`, `+mcsr` | Lists all available MCSR commands. |

Use `+mcsrhelp` to see the latest command roster and descriptions pulled directly from the registry. Custom commands can be added by creating a module under `src/bot/commands` and registering it inside `KickBot`.  
