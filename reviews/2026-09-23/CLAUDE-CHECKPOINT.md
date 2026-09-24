# Nine-game build — Claude checkpoint (2026-09-23)

Branch `codex/nine-game-stabilization`. Nothing pushed or deployed. Spec: `docs/NINE-GAME-RULES.md` (signed off).

## Done

- **Phase 0:** Node 22.23.2 installed with winget for the current user. Repo-local git identity set. Codex baseline committed (`f6a5098`).
- **Phase 1:** rules spec signed off and committed (`515a9b6`).
- **Phase 2:** two audit agents checked the engine against the spec.
  - Evaluators: clean.
  - Betting and showdown: 11 defects. All fixed in this commit, except that client display of uncalled returns is still pending (see Remaining, client item 4).
- **Engine changes:**
  - 8-game now uses 2-7 Triple Draw; 9-game = 8-game + 2-7 Single Draw.
  - New `TableRotation` (`engine/src/table-rotation.ts`) tracks the button and dealer's choice by physical seat, and resets the button at the start of each game.
  - Stud bring-in:
    - the bring-in player chooses to bring in or complete (`pendingBringIn`, `betOptions`)
    - players all-in from the ante are skipped
  - Stud first to act: ties go to the tied player closest to the left of the button.
  - Stud high: an open pair on 4th street allows the big bet (`openPairFourth`, `bigBetInForce`, `raiseOptions`).
  - Limit:
    - the blinds count toward the preflop cap
    - an all-in raise under half a bet doesn't reopen the betting or use a cap slot (`fullRaise`)
  - Chips:
    - `CHIP_UNIT` is a fixed $0.25
    - pot splits are exact
    - the engine rejects non-quarter amounts
  - Uncalled bets are returned and recorded in `uncalledReturns`. A fold win now reports only the called pot.
  - Pots with a single eligible player (dead money) stay as pots and are awarded at the end of the hand.
- **Engine tests:**
  - 460 passing: 445 existing and updated, plus 15 new in `tests/spec-rules.test.ts`.
  - Stud tests now use `tests/helpers.ts` `startStud()`.
  - The stress-test playout loop now throws instead of spinning when no legal action exists.
- **Server rewrite (compiles; tests NOT updated yet):**
  - `settings.ts` validates stakes: $0.25 multiples; host-editable ante/bring-in defaulting to ¼ of the small bet; buy-in min/max in dollars.
  - `room-manager.ts`:
    - reconnect uses a token; a name can't reclaim a seat
    - disconnected players keep their seat
    - leaving or being kicked mid-hand takes effect after the hand settles
    - server-side ledger
    - top-up works as "top up TO X", never lowering a stack
  - `game-controller.ts`:
    - uses `TableRotation`
    - waits 60s only on the disconnected player's turn, then check/fold, or stand pat on a draw
    - disconnected players are sat out at the next deal
    - reconnect sends a full snapshot
    - dealer's-choice chooser grace timer
  - `index.ts` is wired to all of the above, with a new `removed` event.

## Remaining, in order

1. **Server tests:** update `server/tests/*` for the new APIs:
   - `sitDown` takes dollars
   - `joinRoom(…, token)`
   - `handleVariantPick` checks the physical seat
   - no reclaim by name
   - `topUp` replaces the queued-increment approach
   
   Add tests for:
   - turn grace
   - off-turn disconnect
   - leave during a hand
   - top-up to a target
   - the ledger
   - button reset across segments
   - rebuilding the socket smoke test
2. **Client:**
   - `useSocket` stores the token per room and auto-rejoins on reconnect
   - `sit-down` sends dollars
   - render the server ledger (replace `ledgerRef`)
   - ActionPanel: `betOptions`/`raiseOptions` buttons (bring-in vs complete, open pair)
   - lobby fields for ante, bring-in and the buy-in range
   - show uncalled returns separately in the win display
   - handle the `removed` event
   - client typecheck (167 errors) and lint (8) cleanup
3. **Verification:** re-run the audit agents on the final diff, then a single `npm run check` gate, then a guided multi-device test script for Josh.
4. **Docs:** update the project `CLAUDE.md` and ROADMAP through the audit gate.

## Notes

- **CPU load:** vitest runs one worker per core. To limit heat, run the engine tests with `npx vitest run --pool=forks --poolOptions.forks.maxForks=2` (or `--no-file-parallelism`). Don't run the full suite repeatedly.
- **Node PATH:** Node is at `%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.22_*\node-v22.23.2-win-x64`. A shell opened before the install needs a restart to pick it up.
