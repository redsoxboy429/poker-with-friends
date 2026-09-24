# Nine-game stabilization — implementation checkpoint

Date: September 17, 2026. Branch: `codex/nine-game-stabilization`.

Git checkpoint status: all changes were staged, but the commit failed because this new Git installation has no author name/email configured. Work is saved on disk and staged; there is no checkpoint commit yet. Obtain Josh's preferred commit email before configuring repository-local author identity. Do not invent an email or change global Git settings.

**Status: tested first implementation checkpoint, not approved for a friends game yet.** Changes are local. Nothing has been pushed or deployed. The original review remains useful; this document records what changed and what the next iteration must finish. Stop here to preserve five-hour usage headroom; check fresh usage before resuming.

## Agreed scope

- Start with HORSE plus NLH, PLO, no-limit 2-7 single draw and limit 2-7 triple draw. Dealer's choice can choose among these nine. Exotic implementations remain in the engine but are unavailable in application selectors and rejected by the server's variant selection/settings paths.
- Automatically show every surviving hand at an actual showdown. A fold win does not expose private cards or hand descriptions.
- Stud all-ins: expose existing downcards after decisions end, then slowly deal remaining streets. Preserve draw decisions when players are all-in.
- Stakes: .25/.50 NL/PL; 2/4 limit, with 1/2 flop/draw blinds; Stud .50 ante/.50 bring-in. Existing mixed-game caps retained.
- Host pause matters. A returning player must not silently undo a deliberate host pause.
- Disconnect grace of 60 seconds remains the intended policy; the old implementation has NOT yet been replaced with correct grace/recovery behavior.
- No changes to personal guidance, CLAUDE.md, skills, or durable profiles. Referenced vault files are absent from this checkout. Josh's supplied profile provides working context.

## Implemented and checked

1. **Hand boundaries and commands.** Engine rejects betting outside betting phases, invalid/nonfinite amounts, second starts and repeated settlement. Server refuses to redeal a live hand or a pending choice. Network actions/discards must match both hand ID and action-history count. Stale or duplicate commands are rejected. Malformed object-event payloads are checked before destructuring. Stopping or changing games during a live hand is refused; use pause.
2. **Shared runout timing.** `engine/src/presentation.ts` produces a timing plan used by the multiplayer client and server. Two-second pauses separate streets, cards are spaced 180 ms, results follow an 800 ms pause. Server holds manual and automatic deals until presentation finishes, then starts the 15-second countdown. Stud's four remaining streets take 10.24 seconds with two survivors. Timing is a product default, not a claim to reproduce PokerNow's exact timing.
3. **Showdown presentation.** Engine captures a public pre-award checkpoint (`showdownStart`) containing card counts and chip balances. Multiplayer exposes surviving hands, advances visible card counts street by street, and withholds awarded stacks until results. Folded hands remain hidden. Client cancels presentation timers on replacement/unmount and recognizes a new hand by ID. Actions are hidden during animation. Cards still exist in the final payload before the animation finishes; no further decisions remain, so this is presentation sequencing, not delayed server-side dealing.
4. **Host pause.** Pauses live betting/discard commands, game choice and future deals. Deliberate host pause is distinct from insufficient-player countdown pause. It is preserved through the result/countdown transition. Pause does not freeze an already-running cosmetic runout; it prevents further play/deals. Disconnect handling is still legacy code and is not yet integrated with this pause state.
5. **Nine-game selection and stakes.** All practice/multiplayer selectors are restricted to nine games. Server rejects exotic choices; only the pending chooser may choose, including when physical seats have gaps. Repeat choices cannot redeal. Fixed-limit multiplayer blinds now follow the confirmed small bet. Unknown factory variants throw instead of silently becoming NLH.
6. **Rules fixes.** A2345 is ace-high, not a straight, in 2-7. Ace-to-five low now distinguishes pair/two-pair/trips/full-house/quads and compares the repeated ranks correctly. An existing test that incorrectly ranked trips above a pair was corrected. Stud exposed pairs outrank high cards, Razz compares highest exposed ranks first, and all-in players are skipped as betting actors. NL/PL short all-ins do not reopen a player who already acted unless the cumulative increase reaches a full raise. No dry-side-pot betting is offered against only all-in opponents.
7. **Draws and forced all-ins.** Discards require unique integer indices and are validated before mutation. Replacement cards are obtained before the current player's discards enter the reshuffle pool. Prior discards are recycled when the stub is exhausted. Six players can draw five on all three draws without duplicates or loss of cards. Positive short stacks that become all-in from forced bets advance instead of waiting for impossible actions; zero/nonfinite starting stacks are rejected by the engine.
8. **Accounting and cleanup safeguards.** Queued top-ups store an increment, added to settled chips rather than overwriting winnings. Nonfinite buy-ins/top-ups are rejected. Bust players are excluded from future deals unless a top-up is pending. Destroying a room destroys its controller/timers. Stale client chips-behind data clears on a new snapshot. The exact-size all-in raise button sends the legal amount instead of zero.

## Verification

- `npm test`: **430 engine tests and 47 server tests pass**, plus nonvisual client regression scenarios for next-hand dealing, paced Stud runout, delayed awards, exact all-in sizing, nine-game chooser rendering and timer cleanup.
- `npm run build`: engine, client production bundle and server pass.
- `npm run test:socket --workspace=server`: isolated local server/two-client smoke test passes. Null payloads for nine object events do not crash the server; stale and duplicate actions are rejected; health endpoint remains responsive. Child server is stopped afterward.
- `git diff --check`: passes.
- **Not clean yet:** client standalone TypeScript reports 167 errors (review baseline 171); lint reports 8 errors/5 warnings (baseline 11/5). Logs: `support/typecheck-checkpoint.txt`, `support/lint-checkpoint.txt`. Client build is Vite bundling, not a successful strict typecheck.
- No browser, screenshot, visual or multi-device testing, per project instructions. Josh tests visuals after the remaining correctness blockers are resolved.
- Client regression harness executes real React effects/reducer with mocked transport/seat components and a deterministic clock. It uses `react-test-renderer`, a deprecated development-only test dependency; useful interim coverage, not a complete UI testing strategy. Build retains the existing crypto-fallback externalization warning. npm reported 16 dependency audit findings during installation; no blanket audit fix was attempted.
- Original `support/*reproduce*` scripts intentionally assert old bugs. Do not use their exit status as the updated release gate; some now fail because their bugs were fixed. New expected-correctness tests live in engine/server/client test directories.

## Remaining work, in order

1. **Disconnect/reconnect lifecycle, before testing with friends.** Current room manager still immediately invokes check/fold on disconnect, removes a seat after 60 seconds, and can strand an off-turn participant. Name-only seat reclaim is still unsafe. Introduce reconnect credentials, automatic rejoin and complete replay (actions, choice, result, countdown/pause). Retain player identity and all-in eligibility through settlement. Resolve leave/kick/timeout without orphaning an actor or reusing a live hand's identity. Integrate disconnect pause with host pause. Clarify the draw-timeout default and grace-period pause behavior before implementing ambiguous rules.
2. **Chip denomination and session ledger.** Pot splitting still derives its unit from blind/ante and rounds arbitrary amounts; integer-unit conservation is not implemented. Need explicit smallest unit, consistent input validation, side-pot/uncalled-bet accounting and a server-owned ledger across joins/leaves/rebuys. Queued add-on delta is fixed, but this is not a complete accounting audit. Validate room settings centrally before changing either room or controller state.
3. **Remaining fixed-limit/Stud rules.** Complete preflop bet-cap counting (blind counts), incomplete fixed-limit raises/reopening, initial bring-in versus full-bet choice, ante-all-in bring-in transfer, and Stud-high exposed fourth-street pair betting option (not Stud8). Test these from referenced standard rules. Existing tests passing is not proof these rules are correct. Review all nine variants' side-pot and tie cases after unit arithmetic is settled.
4. **Rotation with changing participants.** Initial gapped-seat chooser is fixed, but session bookkeeping still relies on compact indices. Stable button/chooser progression, sit-out/return/missed-blind policy, pending chooser departure and mid-session game changes require explicit handling and tests.
5. **Presentation/recovery completeness.** Current client/server share durations but not an absolute timestamp or replayable event timeline; reconnect/late delivery during a runout is not solved. Broaden coverage to every all-in street, six-player Stud, multiway side pots, multiple consecutive showdowns and fast state updates. Practice mode retains its old animation implementation; only its selectable games and shared engine behavior were changed. Port shared presentation to practice or explicitly remove practice from the validation gate.
6. **Build gates and guided acceptance.** Finish meaningful strict-type/lint cleanup, reproducible dev startup (root `dev` still references undeclared `concurrently`), dependency audit triage, then a guided multi-device acceptance matrix for nine games. Do not ask Josh to debug known correctness failures visually.

## Questions still open

- Smallest chip always .25, or allow cents? Confirm before implementing split-pot units and input snapping.
- During the 60-second reconnect grace, pause the whole table or wait only when the disconnected player's turn arrives? For an all-in draw player who times out, recommend automatic stand-pat; for betting, check if legal, otherwise fold, after grace.
- Keep one orbit plus one hand for dealer's choice when participants join/leave? What is the desired sit-in/missed-blind policy?
- Is survival across a server restart needed for the first friends test, or is refresh/reconnect recovery plus a downloadable session record sufficient?

## Resume instructions

1. Check fresh five-hour usage. Start from this branch and inspect git status; do not reclone or overwrite the checkpoint.
2. Read this file and the original `REVIEW-AND-PLAN.md`; inspect relevant source before changes.
3. Use Node 22 installed at `%LOCALAPPDATA%\Programs\PokerNode\node-v22.23.2-win-x64` (prepend to PATH if needed). Dependencies are installed. Windows sandbox prevented Vitest/Vite worker spawning; approved elevated runs passed.
4. Run `npm test`, then build/socket smoke after relevant changes. No production traffic is needed.
5. Begin with disconnect/recovery design and targeted fake-clock/socket tests. Preserve the already-tested runout and privacy behavior. Push/deployment remains a separate approval.
