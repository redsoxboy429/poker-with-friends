# Poker — Roadmap & Completed Milestones

## Current Work — Phase 3: WebSocket Multiplayer

### Session 2 — Client Refactor (IN PROGRESS)
- [x] Extract shared components from App.tsx (CardDisplay, PlayerSeat, ActionPanel, BetChip, PotDisplay, WinDisplay, GameLog → components/)
- [x] Add socket.io-client, SocketProvider context (shared across routes)
- [x] Create MultiplayerTable.tsx (same rendering, actions via socket instead of local engine)
- [x] Lobby UI: Create Room / Join Room / Local Practice, 3-step variant picker, limit fields
- [x] React-router: / (lobby), /room/:code (multiplayer), /practice (bots)
- [x] Dev/prod env config (.env, .env.production for server URL)
- [x] Local practice mode still works at /practice
- [x] Horizontal chip layout with 0.50 denomination (pink), bet positioning fix
- [ ] **Start Game button handler** — server-side start-hand needs debugging
- [ ] **Buy-in at the table** — not in lobby. Players see stakes first, then choose buy-in via Sit Down action
- [ ] Room lobby polish: shareable link, host controls, seat layout

### Session 3 — Deploy + Pre-Launch Features
- [ ] Deploy server to Railway, client to Vercel
- [ ] Test with real devices (phone + laptop on same room)
- [ ] Seat approval (host approves join requests)
- [ ] Rebuy/top-up over sockets (carry demo logic to multiplayer)
- [ ] Sit out / sit back in (handle posting blinds on return)
- [ ] Reconnect handling (browser refresh, wifi drop — recognize returning players)
- [ ] Kick player (host control)
- [ ] Change game between hands without full reset (stacks preserved, ledger maintained)
- [ ] Dealer's Choice chooser flow over sockets
- [ ] Copy link / share button in room lobby
- [ ] Player count display ("3/8 seated, waiting for host")
- [ ] Hand log + simple text chat
- [ ] Busted blind logic (missed blinds handling)

### Session 4 — Security Audit
- [ ] **Privacy hacker bot**: automated agent that joins a room and aggressively attempts to view other players' cards via JS console, DOM inspection, network sniffing, WebSocket message interception, etc. Must confirm that no opponent card data leaks to the client at any point during play (only at showdown).
- [ ] Verify state-filter covers all edge cases (stud up/down transitions, draw card counts, Drawmaha hybrid phases)

## Tier 2 — Post-Launch Polish

Nice-to-haves after friends are playing.

| Feature | Notes |
|---------|-------|
| Run It Twice | Toggle for big-bet flop games only (NLH, PLO, PLO8). Not applicable to limit, stud, or draw games |
| Spectator mode (cards hidden) | Unseated players at the link can see action but NOT hole cards |
| Hand replay | Click past hand to replay it step-by-step |
| Sound effects / notifications | Your-turn alert, especially mobile. New hand sound |
| Confirm buyout flow | Confirmation dialog before cashing out |
| Timer / shot clock | Configurable per-player decision time |
| Straddle | Optional toggle, UTG straddle for big-bet games |
| Rabbit hunting | Show remaining community cards after fold — toggle per game |

## Not In Scope (Ever)

- Real money / payment processing
- Rake
- Anti-collusion / bot detection (friends only)

---

## Completed Milestones

### Phase 1 — Game Engine (2026-03-23)
- Core types and card/deck module (CSPRNG shuffle, rejection sampling)
- Hand evaluator (high hands, A-5 low, PLO exact-2, 8-or-better low, 2-7 low)
- Betting module (no-limit, pot-limit, fixed-limit with caps)
- NLH, PLO, Razz game logic — all working with base class extraction
- Public APIs: getWinners(), getHandDescription(), getPartialHandDescription()

### Phase 1.5 — Single-Player UI (2026-03-23)
- Pokernow-style React table (Vite + Tailwind)
- Card dealing animations (peeling community cards, left-of-button hole card deal)
- Action pacing (bot delays, street transition delays, showdown delay)
- Bet slider + manual text input for NL/PL (clamped, enter-key blocked)
- Live hand ranking display for human player
- Win display with hand description, fold visibility, stud card visibility

### Phase 2a — Variant Expansion (2026-03-24)
- LHE, 7-Card Stud High, 7-Card Stud Hi-Lo, Omaha Hi-Lo (PLO8)
- Hi-lo showdown split in BaseGame — shared by all hi-lo variants
- 247 tests passing, chip conservation verified

### Phase 2b — Draw Games + UI Overhaul (2026-03-24)
- BaseDrawGame base class (multi-round draw, discard/replace, phase transitions)
- 2-7 NL Single Draw, 2-7 Limit Triple Draw
- Discard UI, setup flow redesign, casino chip pot display
- 271 tests passing

### Phase 2c — Game Modes + Caps (2026-03-24)
- GameSession class: HORSE, 8-game, 9-game, Dealer's Choice, Specific Game rotation
- Bet caps (NLH/PLO = 80 BB, 27SD = 30 BB), chips-behind tracking
- Auto-deal countdown, pause/resume, player economy (add-on, buy-out, tracker)
- Ledger tracking via ledgerRef

### Phase 2d — New Variants (2026-03-25)
- Badugi, Badeucy, Badacey, Archie, 10-30 Draw
- BaseDrawmahaGame + 8 Drawmaha variants, 5 PL Double Draw variants, Limit Omaha High
- resolveQualifiedHiLoPot, hasHighQualifier() hook, template method showdown
- 3-step game selector, side pot fixes, all-in runout animation
- **29 playable variants total**, 399 tests passing

### Phase 2e — Draw All-In + Side Pot Fixes (2026-03-26)
- All-in players participate in draw rounds, excess bet return
- collectBets returns uncontested side pots to sole eligible player
- Audited across NL/PL/Limit single, double, and triple draw

### Phase 3 Session 1 — Server Foundation (2026-03-26)
- npm workspaces (engine + client + server)
- Socket.io typed event protocol, getPlayerView() state filter
- Room manager (create/join/leave/reconnect, 4-char codes, host transfer)
- Game controller, Express + Socket.io server, 21 server tests
- Hosting: Railway + Vercel accounts created
