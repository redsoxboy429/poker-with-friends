# Nine-game build — Claude checkpoint (2026-09-23, build complete)

Branch `codex/nine-game-stabilization`. **Nothing pushed or deployed.** Spec: `docs/NINE-GAME-RULES.md` (signed off). Test script for Josh: `docs/TEST-SESSION.md`.

## Status: ready for Josh's multi-device test

`npm run check` passes. It runs the client typecheck and lint, the engine, server and client tests, both builds, and the socket smoke test.

| Check | Codex baseline (9/17) | Now |
|---|---|---|
| Engine tests | 430 | 463 |
| Server tests | 47 | 68 |
| Client scenarios | 5 | 5 |
| Client typecheck | 167 errors | 0 |
| Client lint | 8 errors | 0 errors (3 practice-mode warnings) |

## What was done

- **Engine rules**, fixed from two audits against the spec:
  - Stud: bring-in or complete; skip players all-in from the ante; first-to-act ties go to the player closest to the button's left; the open-pair big-bet option on 4th.
  - Limit: the blinds count toward the preflop cap; the half-bet short all-in rule.
  - Chips: fixed $0.25 unit and exact pot splits.
  - Uncalled bets are returned and recorded, not counted as winnings.
  - An ante short-stack is only eligible for the antes they matched.
  - A short all-in big blind no longer forces a decision on the lone opponent.
  - `forfeit()` lets a player who left fold even when checking is free.
- **Rotation:** `TableRotation` tracks by physical seat. The button resets at the start of each game segment. Dealer's choice runs one orbit plus one hand, and handles a chooser leaving. 8-Game now uses 2-7 Triple Draw.
- **Server:**
  - Settings validation.
  - Reconnect by token only; a stale token is refused.
  - Disconnects: the table waits only on the disconnected player's turn, then checks or folds, stands pat on a draw, or posts the bring-in. Still disconnected at the next deal: sat out.
  - Leave or kick mid-hand takes effect after the hand settles.
  - The ledger lives on the server; top-ups go "to" an amount.
  - A new occupant of a reused seat can never see the previous occupant's cards.
  - Dealer's choice passes on when the chooser leaves, sits out or times out.
- **Client:**
  - Stores the reconnect token and rejoins automatically, with one socket per client.
  - Buy-ins in dollars, including for someone arriving mid-game.
  - The server ledger in the Tracker.
  - Bring-in / complete and open-pair buttons.
  - Uncalled bets shown as returned; "(away)" labels on disconnected players.
- **Tooling:**
  - `npm run check` gate.
  - `npm run dev` without `concurrently`.
  - Tests capped at 2 workers to limit CPU heat.

## Known limits (not blockers)

- Practice mode (`/practice`) still has its own animation code. It is outside the gate.
- Leave and Kick buttons exist only between hands and in the lobby. The server supports mid-hand leave, but the UI doesn't expose it.
- Rooms live in memory, so a server restart loses the session (Josh: acceptable for the first test).
- No visual or browser testing was done. That's Josh's session.

## Next

1. Josh runs `docs/TEST-SESSION.md` locally (`npm run dev`) and reports issues by step number.
2. After fixes, push the branch and merge to `main` to deploy on Railway. Both need Josh's approval.
3. Update the project `CLAUDE.md` and ROADMAP through the audit gate.
