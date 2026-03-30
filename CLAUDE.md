# Mixed Game Poker — CLAUDE.md

## Working Rules

**Before making ANY code changes:**
1. Thoroughly review all relevant existing code, memory files, learnings.md, and this CLAUDE.md. Do not assume current state from conversation context alone — always verify by reading the actual files.
2. Check the vault (`vault/josh-profile.md`, `vault/build-philosophy.md`, `vault/working-protocols.md`) at session start.

**Testing rules:**
- Do NOT test visuals yourself. Only Josh tests visuals. Claude reviews code, runs automated tests (`npm test --workspace=engine`), and audits logic.
- Always ask Josh for clarification on poker rules rather than assume.

## What This Is
A social mixed-game poker platform for Josh and friends. Supports multiple poker variants (8-game rotation and beyond), with cryptographically secure RNG and real-time multiplayer. **Play money only — no real money, no payment processing, ever.**

## Architecture

### Project Structure
```
poker/
├── CLAUDE.md          # This file — project hub
├── ROADMAP.md         # Roadmap + completed milestones (moved from here)
├── learnings.md       # Session learnings log
├── engine/            # Pure game logic (no UI, no networking)
│   ├── src/
│   │   ├── types.ts       # Core types (Card, Hand, Player, GameState)
│   │   ├── deck.ts        # Card/deck module with CSPRNG shuffle
│   │   ├── evaluator.ts   # Hand evaluation (high, low, hi-lo)
│   │   ├── betting.ts     # Betting logic (limit, pot-limit, no-limit)
│   │   └── games/         # Per-variant game logic
│   │       ├── base.ts        # Abstract BaseGame (game loop, betting, showdown)
│   │       ├── flop-base.ts   # BaseFlopGame (blinds, community cards, flop/turn/river)
│   │       ├── stud-base.ts   # BaseStudGame (antes, bring-in, up/down cards, 3rd-7th)
│   │       ├── draw-base.ts   # BaseDrawGame (blinds, multi-round draw, discard/replace)
│   │       └── [variant].ts   # 29 concrete game classes
│   ├── tests/         # 399 tests across 16 files
│   └── package.json
├── client/            # React table UI (Pokernow-style)
│   ├── src/
│   │   ├── App.tsx            # Local practice mode (bots)
│   │   ├── MultiplayerTable.tsx # Multiplayer mode (socket-driven)
│   │   ├── LobbyPage.tsx      # Create/Join/Practice lobby
│   │   ├── components/        # Shared: CardDisplay, PlayerSeat, ActionPanel, etc.
│   │   ├── SocketProvider.tsx  # Socket.io context (shared across routes)
│   │   └── engine-wrapper.ts  # Factory, bot AI, table config helpers
│   └── package.json
└── server/            # WebSocket server for multiplayer
    ├── src/
    │   ├── index.ts           # Express + Socket.io entry point
    │   ├── room-manager.ts    # Room create/join/leave, 4-char codes
    │   └── game-controller.ts # Engine wrapper, action validation, state broadcast
    ├── tests/         # 21 tests (state filter + room manager)
    └── package.json
```

### Engine Inheritance
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

### Design Principles
- **Engine is pure logic.** No side effects, no I/O, no UI coupling. Fully testable.
- **CSPRNG for all randomness.** Uses Node.js `crypto.randomBytes()` for shuffle.
- **Variants share a common interface.** Template Method pattern — BaseGame handles game loop + showdown, subclasses define evaluation.
- **State machine model.** WAITING → DEALING → BETTING → SHOWDOWN → COMPLETE.
- **Pots preserved after showdown** for display (chips already awarded to winners). Reset on next startHand().

### Tech Stack
- TypeScript (strict mode), Node.js, Vitest (testing)
- React + Vite + Tailwind (client), Socket.io (multiplayer), Express (server)
- No external dependencies for core engine (crypto is built-in)

## 29 Playable Variants

**Flop:** NLH, LHE, PLO, O8 (Limit), PLO8, Limit Omaha High
**Stud:** Razz, 7-Card Stud, Stud Hi-Lo
**Draw:** 2-7 NL Single Draw, 2-7 Limit Triple Draw, Badugi, Badeucy, Badacey, Archie, 10-30 Draw
**Drawmaha:** 4 PL + 4 Limit (High, 2-7, A-5, 49)
**PL Double Draw:** Badugi, Badeucy, Badacey, Archie, 10-30

## Current Status

**Phase 3 — WebSocket Multiplayer (IN PROGRESS)**

Session 2 remaining work:
- [ ] Start Game button handler (server-side debugging)
- [ ] Buy-in at the table (not lobby — players see stakes, then Sit Down with chosen amount)
- [ ] Room lobby polish (shareable link, host controls)

See `ROADMAP.md` for full roadmap (Sessions 3-4, Tier 2 polish) and all completed milestones.

## Key Rules to Get Right
- **PLO must-use-2 rule:** Player MUST use exactly 2 of their 4 hole cards.
- **Razz bring-in:** Highest door card brings in. Aces are low (good), so king is the worst.
- **Side pots:** Only created by all-ins, NEVER by folds. Folding = dead money in existing pot.
- **Odd chip rule:** In split pots, odd chip goes to high hand.

## What's NOT in Scope (Ever)
- Real money / payment processing
- Rake
- Anti-collusion / bot detection (friends only)
