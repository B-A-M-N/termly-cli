# Termly Local Server
# Self-hosted replacement for termly.dev — run your own remote terminal relay

## What This Is

Termly CLI's official server (termly.dev) is dead. This is a local replacement
that implements the same WebSocket relay protocol so you can use the Termly
mobile app to control AI coding agents (Claude Code, Aider, etc.) from your
phone over your local network.

## How It Works

```
Termly Mobile App <---wss---> THIS SERVER <---ws---> Termly CLI
     (phone)        LAN:3001            localhost:3001     (your machine)
```

The server is a dumb relay — all terminal data is E2EE (AES-256-GCM) between
the CLI and mobile app. The server never sees your data unencrypted.

## Setup

### 1. Start the server

```bash
cd /home/bamn/termly-local-server
./start.sh
```

It listens on port 3001 by default. Set `TERMLY_LOCAL_PORT` to change it:

```bash
TERMLY_LOCAL_PORT=4000 ./start.sh
```

### 2. Start Termly CLI in local mode

```bash
TERMLY_ENV=local termly start
```

The CLI will:
- Register a pairing code with the local server
- Generate a QR code containing your LAN IP (so your phone can reach the server)
- Wait for the mobile app to connect

### 3. Connect your phone

Open the Termly mobile app, scan the QR code displayed in your terminal.
The app connects to your local server, does a DH key exchange (E2EE),
and you're in.

## Port Conflict

If port 3000 is free, you can revert the CLI to use port 3000 instead:

```bash
cd /home/bamn/termly-cli
# Edit lib/config/environment.js: change PORT back to 3000
cd /home/bamn/termly-local-server
TERMLY_LOCAL_PORT=3000 ./start.sh
```

The Hermes WhatsApp bridge uses port 3000 by default, so 3001 is the
safe default.

## Files

- `server.js` — the relay server (Express + ws)
- `start.sh` — convenience launcher
- `lib/config/environment.js` (in termly-cli) — updated local URL to :3001
- `lib/commands/start.js` (in termly-cli) — LAN IP in QR code
- `lib/commands/batch.js` (in termly-cli) — same LAN IP fix

## Protocol

See `../termly-cli/COMMUNICATION_PROTOCOL.md` for the full wire protocol.
The server implements:

- `POST /api/pairing` — register pairing code + DH public key
- `POST /api/pairing/batch` — batch registration (multi-agent)
- `GET /api/cli/version` — version check (always returns success)
- `GET /api/health` — health check
- `WS /ws/agent?code=XXX` — CLI WebSocket connection
- `WS /ws/agent?sessionId=XXX` — mobile WebSocket connection
- Heartbeat: server → CLI ping every 30s, CLI responds pong
- Message relay: all encrypted messages forwarded opaquely between CLI and mobile
