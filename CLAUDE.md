# Mixed Game Poker — CLAUDE.md

## Working Rules

**Before making ANY code changes:**
1. Thoroughly review all relevant existing code, memory files, learnings.md, and this CLAUDE.md. Do not assume current state from conversation context alone — always verify by reading the actual files.
2. Check the vault (`vault/josh-profile.md`, `vault/build-philosophy.md`, `vault/working-protocols.md`) at session start.

**Testing rules:**
- Do NOT test visuals yourself. Only Josh tests visuals. Claude reviews code, runs automated tests, and audits logic.
- The release gate is `npm run check` (client typecheck + lint, engine/server/client tests, builds, socket smoke test). Josh's machine runs hot: keep test workers capped (the test scripts use 2 forks) and run single test files while iterating instead of repeating the full suite.
- Always ask Josh for clarification on poker rules rather than assume.

## What This Is
A social mixed-game poker platform for Josh and friends. Supports multiple poker variants (8-game rotation and beyond), with cryptographically secure RNG and real-time multiplayer. **Play money only — no real money, no payment processing, ever.**

## Architecture

Project structure and engine inheritance: `docs/ARCHITECTURE.md`. Adding a new variant: ~20-30 lines (constructor + evaluateHand override + factory switch line).

### Design Principles
- **Engine is pure logic.** No side effects, no I/O, no UI coupling. Fully testable.
- **CSPRNG for all randomness.** Shuffle uses Web Crypto (`crypto.getRandomValues`) only.
- **Variants share a common interface.** Template Method pattern — BaseGame handles game loop + showdown, subclasses define evaluation.
- **State machine model.** WAITING → DEALING → BETTING → SHOWDOWN → COMPLETE.
- **Pots preserved after showdown** for display (chips already awarded to winners). Reset on next startHand().

### Tech Stack
- TypeScript (strict mode), Node.js, Vitest (testing)
- React + Vite + Tailwind (client), Socket.io (multiplayer), Express (server)
- No external dependencies for core engine (crypto is built-in)

## Variants: 10 selectable (10-game mix), 29 in the engine

Selectable in the app and accepted by the server: the WSOP 10-game mix — LHE, O8, Razz, Stud, Stud8, NLH, PLO, 2-7 Triple Draw, NL 2-7 Single Draw, Badugi (limit triple draw). Modes: HORSE, 8-Game, 9-Game, 10-Game, Dealer's Choice, Specific Game. The rest stay in the engine, unselectable. Full list of engine variants:

**Flop:** NLH, LHE, PLO, O8 (Limit), PLO8, Limit Omaha High
**Stud:** Razz, 7-Card Stud, Stud Hi-Lo
**Draw:** 2-7 NL Single Draw, 2-7 Limit Triple Draw, Badugi, Badeucy, Badacey, Archie, 10-30 Draw
**Drawmaha:** 4 PL + 4 Limit (High, 2-7, A-5, 49)
**PL Double Draw:** Badugi, Badeucy, Badacey, Archie, 10-30

## Testing Tools (added 2026-09-27)
- **Local production run:** `npm run build`, then `node scripts/serve-prod.mjs` (port 3001, phones via the PC's LAN IP). The workspace launch config has a `poker` entry for the preview panel. It writes the hand log (below).
- **Watch bots** (lobby): bot tables for side pots, hi/lo & quartering, caps, draw games and the 10-game soak (`server/src/bots.ts`). The spectator sees every card; humans can't sit.
- **Hand log:** one JSON line per finished hand in `logs/hands-YYYY-MM-DD.jsonl` (production or `HAND_LOG_DIR`; gitignored).
- **Scripts:** `scripts/bot-soak.mjs [hands]` (headless bot run to `logs/soak/`), `scripts/verify-hand-log.mjs [path]` (independent checks: conservation, payouts, side-pot eligibility, caps, $0.25 chips, duplicate cards), `scripts/hand-report.mjs <out.html> [path]` (filterable hand history), `scripts/record-bots.mjs <scenario> <seconds>` (captioned WebM via headless Edge to `recordings/`, gitignored; needs the local server running), `scripts/record-preactions.mjs` (the browser plays a seat against two socket-driven opponents and checks pre-actions and "Draw N" with PASS/FAIL captions; videos + `preactions-notes.md` to `recordings/`).

## Current Status

**Ten-game build (9-game + Badugi) — built and audited on branch `codex/nine-game-stabilization`; Josh's first device test done 2026-09-23, fixes and Badugi/10-Game added 2026-09-26, pre-actions added 2026-09-28, awaiting round 2** (`docs/TEST-SESSION.md`, "Round 2" section). Branch pushed to GitHub 2026-09-28; `main` not merged, so nothing is deployed.

- **Deploy is on hold (Josh, 2026-09-28).** The Railway app is gone: the old URL returns "Application not found" (likely the free trial lapsed). To go live: Josh upgrades to Hobby ($5/mo, usage fits the included credit) or re-creates the project from the GitHub repo and generates a domain; then fast-forward `main` to the branch and push. Railway auto-deploys `main` from the Dockerfile; no env vars needed. Open question before launch: hide "Watch bots" in production?
- **Acting before your turn** (client-only, `client/src/pre-action.ts`, `components/PreActionPanel.tsx`): checkbox-style pre-actions while others act. Limit: Fold · Call X · Call Any · Raise vs X · Raise Any; big-bet: Fold · Call X · Call Any (Check/Fold · Check · Check/Call Any when nothing to call). Call X / Check / Raise vs X drop if the amount to call changes; pre-actions reset each street; Check/Fold never folds when checking is free; Raise Any calls when capped; stud bring-in is never auto-played. Draw games: discards can be picked any time before your draw, and an opt-in "Draw N" / "Stand Pat" tick sends them when the draw comes (tapping a card un-ticks it). No auto-draw without the tick (Josh). Verified by client tests C05–C10 and the recorded run (11/11).

- Rules: `docs/NINE-GAME-RULES.md` (signed off by Josh; tests are written from it, not from the code).
- Progress and known limits: `reviews/2026-09-23/CLAUDE-CHECKPOINT.md`. Codex's original review: `reviews/2026-09-17/`.
- Josh's test script: `docs/TEST-SESSION.md`. Next: security test (hacker-bot session, own session), round 2, equity calculator; merge `main` only when Josh says go.

See `ROADMAP.md` for the longer roadmap and older milestones.

## Key Rules to Get Right
- **PLO must-use-2 rule:** Player MUST use exactly 2 of their 4 hole cards.
- **Razz bring-in:** Highest door card brings in. Aces are low (good), so king is the worst.
- **Side pots:** Only created by all-ins, NEVER by folds. Folding = dead money in existing pot.
- **Odd chip rule:** In split pots, odd chip goes to high hand.

## What's NOT in Scope (Ever)
- Real money / payment processing
- Rake
- Anti-collusion / bot detection (friends only)
