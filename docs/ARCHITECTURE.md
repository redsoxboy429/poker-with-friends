# Architecture

Moved from `CLAUDE.md` on 2026-09-27 to keep the hub short. Design principles and tech stack stay in `CLAUDE.md`.

## Project Structure
```
poker-with-friends/
├── CLAUDE.md          # Project hub
├── ROADMAP.md         # Roadmap + completed milestones
├── learnings.md       # Session learnings log
├── engine/            # Pure game logic (no UI, no networking)
│   ├── src/
│   │   ├── types.ts       # Core types (Card, Hand, Player, GameState)
│   │   ├── deck.ts        # Card/deck module with CSPRNG shuffle
│   │   ├── evaluator.ts   # Hand evaluation (high, low, hi-lo)
│   │   ├── betting.ts     # Betting logic (limit, pot-limit, no-limit)
│   │   ├── session.ts     # Game modes, variant lists, cap rules
│   │   ├── table-rotation.ts # Seat-based rotation / dealer's choice / button
│   │   └── games/         # Per-variant game logic
│   │       ├── base.ts        # Abstract BaseGame (game loop, betting, showdown)
│   │       ├── flop-base.ts   # BaseFlopGame (blinds, community cards, flop/turn/river)
│   │       ├── stud-base.ts   # BaseStudGame (antes, bring-in, up/down cards, 3rd-7th)
│   │       ├── draw-base.ts   # BaseDrawGame (blinds, multi-round draw, discard/replace)
│   │       └── [variant].ts   # 29 concrete game classes
│   ├── tests/         # 472 tests (spec-rules.test.ts = rules from docs/NINE-GAME-RULES.md)
│   └── package.json
├── client/            # React table UI (Pokernow-style)
│   ├── src/
│   │   ├── App.tsx            # Local practice mode (bots)
│   │   ├── MultiplayerTable.tsx # Multiplayer mode (socket-driven)
│   │   ├── LobbyPage.tsx      # Create/Join/Practice/Watch-bots lobby
│   │   ├── components/        # Shared: CardDisplay, PlayerSeat, ActionPanel, etc.
│   │   ├── SocketProvider.tsx  # Socket.io context (shared across routes)
│   │   └── engine-wrapper.ts  # Factory, bot AI, table config helpers
│   └── package.json
├── server/            # WebSocket server for multiplayer
│   ├── src/
│   │   ├── index.ts           # Express + Socket.io entry point
│   │   ├── room-manager.ts    # Room create/join/leave, 4-char codes, bot rooms
│   │   ├── game-controller.ts # Engine wrapper, action validation, state broadcast
│   │   ├── state-filter.ts    # Per-viewer card privacy
│   │   ├── settings.ts        # Settings validation (normalizeSettings)
│   │   ├── bots.ts            # Watch-bots scenarios and bot decisions
│   │   └── hand-log.ts        # JSONL hand log
│   ├── tests/         # 81 tests + socket-smoke.mjs (lifecycle, reconnect, ledger, privacy, bots)
│   └── package.json
└── scripts/           # serve-prod, bot-soak, verify-hand-log, hand-report, record-bots
```

## Engine Inheritance
```
BaseGame (abstract — game loop, betting, showdown w/ hi-lo split support, getWinners API)
├── BaseFlopGame (abstract — blinds, community cards, flop/turn/river)
│   ├── NLHGame, LHEGame, PLOGame, O8Game, PLO8Game, LimitOmahaHighGame
├── BaseStudGame (abstract — antes, bring-in, up/down cards, 3rd–7th street)
│   ├── RazzGame, StudGame, StudHiLoGame
├── BaseDrawmahaGame (abstract — 5 hole cards, community board, single draw, 50/50 split)
│   ├── 8 Drawmaha variants (4 PL + 4 Limit: High, 2-7, A-5, 49)
└── BaseDrawGame (abstract — blinds, multi-round drawing, discard/replace)
    ├── TwoSevenSDGame, TwoSevenTDGame, BadugiGame, BadeucyGame, BadaceyGame
    ├── ArchieGame, TenThirtyGame, 5 PL Double Draw variants
```
Adding a new variant: ~20-30 lines (constructor + evaluateHand override + factory switch line).
