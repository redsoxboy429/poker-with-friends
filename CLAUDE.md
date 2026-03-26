# Mixed Game Poker — CLAUDE.md

## What This Is
A social mixed-game poker platform for Josh and friends. Supports multiple poker variants (8-game rotation and beyond), with cryptographically secure RNG and real-time multiplayer. **Play money only — no real money, no payment processing, ever.**

## Architecture

### Project Structure
```
poker/
├── CLAUDE.md          # This file — project hub
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
│   │       ├── nlh.ts         # No-Limit Hold'em (extends BaseFlopGame)
│   │       ├── plo.ts         # Pot-Limit Omaha (extends BaseFlopGame)
│   │       ├── razz.ts        # Razz (extends BaseStudGame)
│   │       ├── 27sd.ts        # 2-7 NL Single Draw (extends BaseDrawGame)
│   │       └── 27td.ts        # 2-7 Limit Triple Draw (extends BaseDrawGame)
│   ├── tests/         # 399 tests
│   └── package.json
├── client/            # React table UI (Pokernow-style, single-player + bots)
│   ├── src/
│   │   ├── App.tsx            # Main UI: table, player seats, card animations, action panel
│   │   └── engine-wrapper.ts  # Factory, bot AI, table config helpers
│   └── dist/          # Built output (serve with `npx serve dist`)
└── server/            # (Future) WebSocket server for multiplayer
```

### Engine Inheritance
```
BaseGame (abstract — game loop, betting, showdown w/ hi-lo split support, getWinners API)
├── BaseFlopGame (abstract — blinds, community cards, flop/turn/river)
│   ├── NLHGame — 2 hole cards, no-limit, bestHighHand
│   ├── LHEGame — 2 hole cards, fixed-limit, bestHighHand
│   ├── PLOGame — 4 hole cards, pot-limit, bestPLOHighHand
│   ├── O8Game — 4 hole cards, fixed-limit, hi-lo split (standard Omaha Hi-Lo)
│   └── PLO8Game — 4 hole cards, pot-limit, hi-lo split (PLO Hi-Lo)
├── BaseStudGame (abstract — antes, bring-in, up/down cards, 3rd–7th street)
│   ├── RazzGame — highest door card brings in, lowest board acts, A-5 low
│   ├── StudGame — lowest door card brings in, highest board acts, bestHighHand
│   └── StudHiLoGame — lowest door card brings in, highest board acts, hi-lo split
├── BaseDrawmahaGame (abstract — 5 hole cards, community board, single draw, 50/50 split)
│   ├── DrawmahaHighGame — draw=5-card high, omaha=PLO high (PL or limit)
│   ├── Drawmaha27Game — draw=2-7 low, omaha=PLO high
│   ├── DrawmahaA5Game — draw=A-5 low, omaha=PLO high
│   └── Drawmaha49Game — draw=closest to 49 pips, omaha=PLO high
└── BaseDrawGame (abstract — blinds, multi-round drawing, discard/replace)
    ├── TwoSevenSDGame — 2-7 NL Single Draw (1 draw, no-limit)
    ├── TwoSevenTDGame — 2-7 Limit Triple Draw (3 draws, fixed-limit)
    ├── BadugiGame — 4-card triple draw, ace-low badugi (4 cards, not 5)
    ├── BadeucyGame — 5-card triple draw, hi-lo: deuce-low badugi + 2-7 lowball
    ├── BadaceyGame — 5-card triple draw, hi-lo: ace-low badugi + A-5 lowball
    ├── ArchieGame — 5-card triple draw, hi-lo: pair-of-9s+ high qualifier + 8-or-better A-5 low
    └── TenThirtyGame — 5-card triple draw, pip split: high ≥30 / low ≤10
```
Adding a new flop variant: ~30 lines (constructor, getHoleCardCount, evaluateHand).
Adding a new stud variant: ~25 lines (getBringInPlayerIndex, setFirstActorForStreet, evaluateHand).
Adding a new draw variant: ~20 lines (constructor specifying maxDraws, evaluateHand).
Hi-lo variants: override `evaluateLowHand()` + `isHiLoGame()` — BaseGame handles all split pot logic.

### Design Principles
- **Engine is pure logic.** No side effects, no I/O, no UI coupling. Takes state in, returns state out. Fully testable.
- **CSPRNG for all randomness.** Uses Node.js `crypto.randomBytes()` for shuffle. No Math.random().
- **Variants share a common interface.** Each game implements the same base class, making rotation trivial.
- **State machine model.** Game state transitions are explicit: WAITING → DEALING → BETTING → SHOWDOWN → COMPLETE.

### Tech Stack
- TypeScript (strict mode)
- Node.js (runtime)
- Vitest (testing)
- No external dependencies for core engine (crypto is built-in)

## Variant Support

### Implemented — 19 variants
1. **No-Limit Hold'em (NLH)** — 2 hole cards, 5 community, no-limit betting
2. **Pot-Limit Omaha (PLO)** — 4 hole cards, must use exactly 2, pot-limit betting
3. **Razz** — 7-card stud, ace-to-five low, limit betting, bring-in
4. **Limit Hold'em (LHE)** — 2 hole cards, fixed-limit (small bet preflop/flop, big bet turn/river)
5. **Omaha Hi-Lo / O8 (Limit)** — 4 hole cards, fixed-limit, 8-or-better hi-lo split (traditional format)
6. **PLO Hi-Lo / PLO8 (Pot-Limit)** — 4 hole cards, pot-limit, 8-or-better hi-lo split
7. **7-Card Stud** — standard high hand stud, lowest door card brings in
8. **7-Card Stud Hi-Lo** — stud with 8-or-better hi-lo split
9. **2-7 NL Single Draw** — 5 cards, 1 draw, no-limit, deuce-to-seven lowball
10. **2-7 Limit Triple Draw** — 5 cards, 3 draws, fixed-limit, deuce-to-seven lowball
11. **Badugi** — 4-card triple draw, ace-low, best rainbow hand wins (4-card > 3-card > 2-card > 1-card)
12. **Badeucy** — 5-card triple draw, hi-lo split: deuce-low badugi (high) + 2-7 lowball (low)
13. **Badacey** — 5-card triple draw, hi-lo split: ace-low badugi (high) + A-5 lowball (low)
14. **Archie** — 5-card triple draw, hi-lo split: pair-of-9s+ high qualifier + 8-or-better A-5 low qualifier. Custom resolveShowdown with 4-way logic (both/high-only/low-only/neither).
15. **10-30 Draw** — 5-card triple draw, pip split: high ≥30 pips / low ≤10 pips. Face cards=0, A=1, 2-10=face value.
16. **PL Drawmaha High** — 5 hole cards, community board, single draw. 50/50 split: 5-card high draw + PLO-style omaha (2+3).
17. **PL Drawmaha 2-7** — draw side = 2-7 lowball, omaha side = PLO high
18. **PL Drawmaha A-5** — draw side = A-5 lowball, omaha side = PLO high
19. **PL Drawmaha 49** — draw side = closest to 49 pips, omaha side = PLO high

## Betting Structures
- **No-Limit:** Min raise = previous raise size, max = entire stack
- **Pot-Limit:** Max raise = pot size (including call amount)
- **Fixed Limit:** Bets/raises in fixed increments, small bet (streets 1-2), big bet (streets 3+), cap at 4 bets per street

## Hand Rankings
- **High:** Royal flush → high card (standard)
- **Ace-to-Five Low (Razz):** A-2-3-4-5 is best, straights/flushes don't count against you, aces always low
- **8-or-Better Low (Archie, O8, Stud8):** Must qualify with 8-high or better low, no pairs
- **Deuce-to-Seven Low (2-7 SD/TD):** Aces HIGH (bad), straights/flushes count against you. Best hand: 2-3-4-5-7

## Current Status
**Phase 1 — Game Engine: COMPLETE (2026-03-23)**
- [x] Core types and card/deck module (CSPRNG shuffle, rejection sampling)
- [x] Hand evaluator (high hands, A-5 low, PLO exact-2, 8-or-better low, 2-7 low)
- [x] Betting module (no-limit, pot-limit, fixed-limit with caps)
- [x] NLH, PLO, Razz game logic — all working with base class extraction
- [x] Public APIs: getWinners(), getHandDescription(), getPartialHandDescription()

**Phase 1.5 — Single-Player UI: WORKING (2026-03-23)**
- [x] Pokernow-style React table (Vite + Tailwind)
- [x] Card dealing animations (peeling community cards, left-of-button hole card deal)
- [x] Action pacing (bot delays, street transition delays, showdown delay)
- [x] Bet slider + manual text input for NL/PL (clamped, enter-key blocked)
- [x] Live hand ranking display for human player
- [x] Win display with hand description ("Bob wins 250 with Full House")
- [x] Fold visibility: folded cards vanish, fold-wins don't expose hands
- [x] Stud card visibility (up/down cards, door cards shown)

**Phase 2a — Variant Expansion: COMPLETE (2026-03-24)**
- [x] Limit Hold'em (LHE) — fixed-limit flop game
- [x] 7-Card Stud High — lowest door card brings in, highest board acts first
- [x] Hi-lo showdown split in BaseGame — shared by all hi-lo variants, `evaluateLowHand()` + `isHiLoGame()` hook
- [x] 7-Card Stud Hi-Lo — 8-or-better, split pot
- [x] Omaha Hi-Lo (PLO8) — 8-or-better, must-use-2 rule for both high and low
- [x] UI variant selector updated (7 games selectable)
- [x] 247 tests passing (30 new for LHE, Stud, hi-lo variants)
- [x] Chip conservation verified for all hi-lo variants

**Phase 2b — Draw Games + UI Overhaul: COMPLETE (2026-03-24)**
- [x] BaseDrawGame base class (multi-round draw, discard/replace, phase transitions)
- [x] 2-7 NL Single Draw (1 draw, no-limit, best27LowHand inverted)
- [x] 2-7 Limit Triple Draw (3 draws, fixed-limit, small bet early/big bet late)
- [x] Discard UI: click-to-select cards, Draw X / Stand Pat buttons, bot auto-discard
- [x] Setup flow reordered: big-bet blinds + limit stakes → buy-in (in BB) → players → game → deal
- [x] Game selector moved into setup panel (two-step category→variant)
- [x] Deal button fixed: players now created with correct starting chips from stakes config
- [x] Casino chip pot display: collected pot vs current street bets separation
- [x] 271 tests passing (24 new for draw games)

**Next: Phase 2c — Game Modes + Caps (offline, testable with bots)**

Chunk 1 — Rotation Engine: COMPLETE (2026-03-24)
- [x] `GameSession` class in `engine/src/session.ts`: manages variant rotation across hands
- [x] Game modes: HORSE, 8-game, 9-game, Dealer's Choice, Specific Game
- [x] HORSE rotation: LHE → O8 → Razz → Stud → Stud8 (5 games × 8 hands each, loops)
- [x] 8-game rotation: HORSE + NLH, PLO, 27SD (8 games × 8 hands)
- [x] 9-game rotation: 8-game + 27TD (9 games × 8 hands)
- [x] Dealer's choice: chooser picks any of the 10 variants, plays N+1 hands (chooser gets two buttons). Player join/leave mid-orbit: orbit recalculated, choice passes to left of chooser.
- [x] Specific game: single variant forever (existing behavior)
- [x] UI: game mode selector in setup panel, rotation progress in header ("8-Game · NLH (3/8)"), DC picker overlay
- [x] 32 new tests for GameSession (303 total)

Chunk 2 — Bet Caps + Player Economy + Auto-Deal: COMPLETE (2026-03-24)
- [x] `capBB` field on TableConfig — engine caps player chips in BaseGame constructor
- [x] Cap rules: NLH/PLO/PLO8 = 80 BB, 27SD = 30 BB. Limit games + 27TD = no cap.
- [x] Chips-behind tracking: excess chips stored in `chipsBehindRef`, restored after hand ends
- [x] `session.getCapBB()` wired into `buildTableConfig` in `dealNewHand`
- [x] 5 new engine-level cap enforcement tests (296 total at that point)
- [x] Auto-deal countdown: 12-second timer after hand ends, shows "Next hand in 12… 11…"
- [x] Pause/Resume button during countdown, "Deal Now" to skip timer
- [x] Player economy: Add-on button (tops up to initial buyin cap), Buy-out button (cashes out, sits player out)
- [x] Player Tracker popup: shows total buy-ins, buy-outs, current stack, and net P&L per player
- [x] Ledger tracking via `ledgerRef` — persists across hands, clears on reset

Chunk 3 — Setup Flow Redesign (already mostly done):
- [x] Game mode selector as first step (5 buttons)
- [x] Specific Game → existing category/variant picker
- [x] Dynamic variant label during gameplay shows current game + rotation progress
- [ ] Game owner concept (stub for offline — first player is always owner)

**Phase 2d — New Variants (20 games): COMPLETE (2026-03-25)**
- [x] Badugi, Badeucy, Badacey, Archie, 10-30 Draw (limit triple draw)
- [x] BaseDrawmahaGame + 8 Drawmaha variants (4 PL + 4 Limit: High, 2-7, A-5, 49)
- [x] 5 PL Double Draw variants (Badugi, Badeucy, Badacey, Archie, 10-30) — maxDraws=2, pot-limit
- [x] Limit Omaha High — fixed-limit, must-use-2, same eval as PLO
- [x] Archie/10-30: resolveQualifiedHiLoPot in BaseGame (4-branch: both/high-only/low-only/neither)
- [x] hasHighQualifier() hook eliminates ~200 lines of duplicated showdown code
- [x] Template method for showdown: single pot loop dispatches to correct resolution method
- [x] 3-step game selector: Category → Betting Structure → Game (auto-skip single-structure categories)
- [x] Side pot fix: collectBets only creates side pots at all-in levels, not folds
- [x] mergePotsForShowdown: collapses pots with identical active contenders
- [x] All-in runout: street-by-street animation with longer pauses
- [x] Showdown hand descriptions visible for all non-folded players
- [x] Pot/All-In max buttons, slider step by small blind, consistent pot font
- [x] Badeucy/Badacey: "BADUGI" / "LOW" column labels (not "HIGH" / "LOW")
- [x] 399 tests passing across 16 test files (25 new, 3 deleted, 2 fixed)
- [x] **Total: 29 playable variants**

**Phase 2e — Draw All-In + Side Pot Fixes: COMPLETE (2026-03-26)**
- [x] All-in players now participate in draw rounds (draw ≠ betting — all-in only prevents betting)
- [x] `findNextDrawer()` method includes all-in players in draw rotation (only excludes folded/sittingOut)
- [x] `shouldRunoutOnAllIn()` never skips to showdown when draws remain
- [x] Betting rounds auto-skipped when <2 players can bet, but draws still advance
- [x] Excess bet return: when betting more than only opponent's stack, excess returned immediately (no phantom side pot)
- [x] `collectBets()` returns uncontested side pots to the sole eligible player
- [x] Draw action labels show for all-in players (e.g. "DREW 2" + "ALL IN" side by side)
- [x] Audited across NL/PL/Limit single draw, double draw, and triple draw — all correct
- [x] Drawmaha unaffected (separate class hierarchy)
- [x] Live tested PL Badacey DD, PL 10-30 DD, NL Single Draw, Dealer's Choice
- [x] 399 tests passing

**Phase 3 — WebSocket Multiplayer**

Session 1 — Server Foundation: COMPLETE (2026-03-26)
- [x] npm workspaces (engine + client + server share code)
- [x] Socket.io typed event protocol (client↔server)
- [x] `getPlayerView()` state filter — own cards visible, opponent cards hidden (flop/stud/draw)
- [x] Room manager — create/join/leave/reconnect, 4-char codes, host transfer
- [x] Game controller — engine wrapper, action validation, state broadcasting, auto-deal countdown
- [x] Express + Socket.io server entry point, health check
- [x] 21 server tests passing (state filter + room manager)
- [x] Hosting: Railway ($1/mo, free trial) + Vercel (free). Accounts created.

Session 2 — Client Refactor (NEXT):
- [ ] Extract shared components from App.tsx (Table, PlayerSeat, ActionPanel, DrawPanel, etc.)
- [ ] Add socket.io-client, create socket connection layer
- [ ] Create MultiplayerApp.tsx (same rendering, actions via socket instead of local engine)
- [ ] Lobby UI: Create Room / Join Room / Local Practice landing page
- [ ] Room lobby: room code, shareable link, host controls, seat layout
- [ ] Keep local practice mode working alongside multiplayer
- [ ] Dev/prod env config (.env files for server URL)

Session 3 — Deploy + Polish:
- [ ] Deploy server to Railway, client to Vercel
- [ ] Test with real devices (phone + laptop on same room)
- [ ] Player management: join mid-game, leave gracefully, reconnect
- [ ] Dealer's Choice chooser flow over sockets
- [ ] Host game menu (change game between hands, kick)

Session 4 — Security Audit:
- [ ] **Privacy hacker bot**: automated agent that joins a room and aggressively attempts to view other players' cards via JS console, DOM inspection, network sniffing, WebSocket message interception, etc. Must confirm that no opponent card data leaks to the client at any point during play (only at showdown).
- [ ] Verify state-filter covers all edge cases (stud up/down transitions, draw card counts, Drawmaha hybrid phases)

## Key Rules to Get Right
- **PLO must-use-2 rule:** Player MUST use exactly 2 of their 4 hole cards. This affects hand evaluation — can't just find the best 5 from 9 cards.
- **Razz bring-in:** Highest door card brings in. Aces are low (good), so king is the worst door card.
- **Razz hand eval:** A-2-3-4-5 is the best hand. No straights/flushes in low evaluation. Pairs are bad.
- **Side pots:** When a player is all-in, create side pot(s). Each pot is contested only by eligible players.
- **Odd chip rule:** In split pots, odd chip goes to the player closest to the left of the button (or first alphabetically — pick a rule and be consistent).

## What's NOT in Scope (Ever)
- Real money / payment processing
- Rake
- Anti-collusion / bot detection (it's friends playing)
