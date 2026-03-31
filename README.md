# Mixed Game Poker

Social poker for friends. Play money only — no real money, no rake, no gambling.

Supports 29 poker variants with real-time multiplayer via WebSocket. Built for mixed-game home games (HORSE, 8-game, Dealer's Choice, or pick a specific game).

## Variants

**Flop:** No-Limit Hold'em, Limit Hold'em, Pot-Limit Omaha, Omaha Hi-Lo, PLO Hi-Lo, Limit Omaha High

**Stud:** Razz, 7-Card Stud, Stud Hi-Lo

**Draw:** 2-7 NL Single Draw, 2-7 Limit Triple Draw, Badugi, Badeucy, Badacey, Archie, 10-30 Draw

**Drawmaha:** 4 Pot-Limit + 4 Limit (High, 2-7, A-5, 49)

**PL Double Draw:** Badugi, Badeucy, Badacey, Archie, 10-30

## Tech Stack

- **Engine:** TypeScript, pure game logic (no I/O), CSPRNG shuffle
- **Client:** React + Vite + Tailwind CSS
- **Server:** Express + Socket.io (real-time multiplayer)
- **Monorepo:** npm workspaces (`engine`, `client`, `server`)

## Local Development

```bash
# Install dependencies
npm install

# Run engine + server tests (420 tests)
npm test

# Start dev servers (client on :5173, server on :3001)
npm run dev -w server &
npm run dev -w client
```

## Production Build

```bash
# Build all workspaces (engine → client → server)
npm run build

# Start production server (serves client + WebSocket on one port)
NODE_ENV=production npm start
```

## Deploy to Railway

1. Connect the repo on [Railway](https://railway.app)
2. Set environment variable: `NODE_ENV=production`
3. Railway auto-detects Node, runs `npm run build` then `npm start`
4. The server serves the built client — one URL for everything

## Architecture

```
poker/
├── engine/     # Pure game logic — 29 variants, hand evaluation, betting
├── client/     # React table UI — Pokernow-style, lobby, multiplayer
└── server/     # Express + Socket.io — rooms, game controller, state filter
```

The engine has zero I/O dependencies. The server wraps it with room management and WebSocket broadcasting. The client renders state received from the server — no game logic runs client-side in multiplayer mode.
