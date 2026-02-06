# kick-mcsr-bot

Kick chat bot with pluggable commands for MCSR Ranked stats.

## Setup

1. Copy `.env.example` to `.env` and fill in your Kick token, username, and channel.
   - To handle multiple channels, set `KICK_CHANNELS` to entries like `channel1:12345,channel2:67890`.
   - Set `LOG_CHAT_EVENTS=1` if you want to log every incoming chat message (defaults to off).
2. Install deps with `npm install`.
3. Build with `npm run build`.
4. Run with `npm start`.

## Running in Docker

1. Build the image: `docker build -t kick-mcsr-bot .`
2. Run the bot, passing your `.env` file and mounting `data/` so link/channel state persists between restarts:
   ```bash
   docker run --env-file .env -v $(pwd)/data:/app/data kick-mcsr-bot
   ```
   - If you run into permissions errors writing to the mounted `data/` directory, ensure the host folder is writable or run with `-u $(id -u):$(id -g)` so the container uses your host user.
3. Use `-d` to run detached or override `node dist/index.js` with alternative commands if necessary.

### Health, heartbeats, and restarts

- The bot logs a heartbeat every ~45s that includes connection state, stale status, and last message time. Look for `[HEARTBEAT]` lines in `docker compose logs -f`.
- A health snapshot is written to `data/health.json`. It is ignored by git but is mounted to the host so Docker HEALTHCHECK can read it.
- The Docker image defines `HEALTHCHECK` using `node dist/health/healthcheck.js`; `docker compose` will surface unhealthy status and restart the container (`restart: unless-stopped` in `docker-compose.yml`).
- You can manually check health inside the container: `docker exec kickmcsr node dist/health/healthcheck.js`.

## Commands

Commands use the `+` prefix.
Legacy note: `!` still works as a compatibility fallback.

| Command | Aliases | Description |
| --- | --- | --- |
| `+ping` | — | Simple latency test. |
| `+ding` | — | Responds with `dong!`. |
| `+elo <player>` | `+stats` | Elo, rank, win/loss stats, PB, averages. |
| `+winrate <player>` | `+wr` | Lifetime wins/losses, win rate, FFR%. |
| `+average <player>` | `+avg` | Average completion time, PB, and finishes. |
| `+lastmatch <player>` | `+lm`, `+recent` | Most recent ranked match summary. |
| `+record <p1> <p2>` | `+vs`, `+headtohead` | Head-to-head match record. |
| `+mcsrtoday <player>` | `+today`, `+td` | Ranked stats from the last 12 hours. |
| `+mcsrwr` | — | #1 record leaderboard entry with PB, avg, Elo/rank. |
| `+predict <p1> <p2>` | `+win` | Predict likely winner using recent ranked matches. |
| `+link <mcName>` | — | Link your Kick username to a Minecraft username. |
| `+unlink` | — | Remove your own linked Minecraft username. |
| `+mcsrhelp [command]` | `+mcsrcommands`, `+mcsr` | Lists all available MCSR commands. |

Other bot controls:
- `+join` (from the home channel) — ask the bot to join your channel.
- `+leave` (from the home channel) — disconnect the bot from a channel.

Use `+mcsrhelp` to see the in-chat command summary. Custom commands can be added by creating a module under `src/bot/commands` and registering it inside `KickBot`.  
