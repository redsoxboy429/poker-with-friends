# Poker with Friends — review and pre-testing plan

Prepared for Josh Campbell · September 17, 2026 · Reviewed by Codex

Baseline: `main`, commit `c00e8b1` (`Fix hand-transition animation race: BB/opponents briefly show 0 cards`).

## Recommendation

**Fix hand lifecycle, chip accounting, privacy, and the identified rules defects before another broad multi-device testing session.** Keep the existing engine/server/client architecture. Replace the overlapping multiplayer presentation effects with one explicit hand presentation sequence, supported by server lifecycle guards. Changing a few timeouts will not address the underlying failures.

The intended product is a six-seat, play-chip dealer’s-choice ring game: people can join, buy in, top up, sit out, reconnect, and leave; the selected game follows agreed poker rules; all-ins retain required decisions and then run out slowly; the result remains readable before the next hand starts. No payments or rake are involved.

The review reproduced **26 diagnostic cases**: 21 engine/server cases, four nonvisual React cases, and one isolated Socket.io process failure. These are separate scenarios, not 26 necessarily independent fixes. Existing tests pass, but several failures sit outside their coverage, and some tests encode an incorrect poker rule.

## What was checked

| Check | Result |
|---|---|
| Git checkout | Local `main` tracks `origin/main`; production source unchanged |
| Runtime | Installed official Node **22.23.2**, npm **10.9.8**, SHA-256 verified |
| Runtime location | `%LOCALAPPDATA%\Programs\PokerNode\node-v22.23.2-win-x64`; added to user PATH for new terminals |
| Production build | Engine, client, server all pass on Node 22 |
| Existing tests | **417 engine + 39 server = 456 passing** |
| Client lint | **11 errors, 5 warnings** |
| Client TypeScript check | **171 diagnostics**, including incompatible compiler settings for imported engine code, unused declarations, and filtered-player type mismatches |
| New review diagnostics | All 26 reproduced the stated current behavior |
| Visual testing | Not performed; reserved for Josh under existing project guidance |
| Production/Railway | Not changed or exercised; socket tests used an isolated local process |

The build’s success does not mean the client typechecks: its build script runs Vite without TypeScript validation. Vite also reports browser externalization of the legacy `crypto` fallback; the current browser path uses Web Crypto. That warning is not evidence of a shuffle defect.

Scope included game lifecycle, betting/pots, evaluators, game-family implementations and variant wiring, dealer’s-choice sessions, room management, socket boundaries, client reducer/effects/controls, practice-mode integration, tests, and build/deploy configuration. This was a broad source and behavior review, not exhaustive enumeration of every possible hand or a completed production penetration test.

Read project context: `CLAUDE.md`, `learnings.md`, `ROADMAP.md`, README, and recent commit history. Only one tracked `CLAUDE.md` exists in this checkout. Its referenced `vault/` files are absent. The existing context applies to this work; no personal guidance or instruction files were rewritten.

## Why showdown and the next hand break

### 1. The client detects a new hand by phase instead of hand ID

The server sends a final `hand-complete` payload separately from `hand-state`. The reducer stores `finalState`, but keeps the old active `handState`. The table’s new-hand check requires the previous `handState` to have reached `complete` or `showdown`. In the normal completion path it never did.

**Reproduced C01:** fold `p0`, finish the hand, then receive the next hand. More than two seconds later, `p0` still has a displayed card count of zero while the engine has dealt two cards. The recent phase-transition fix therefore misses the normal event sequence.

Action: identify transitions using `handState.id`, reset all per-hand presentation state once, and cancel every callback belonging to the previous hand. Use an explicit sequence/version for same-hand updates. Tests must send actual reducer event sequences, including fold wins and consecutive hands of the same variant.

Source: `client/src/MultiplayerTable.tsx:241–344`, especially `255`; `client/src/useSocket.ts:133–163`.

### 2. Final game state is displayed before the result animation finishes

`gameState = finalState ?? handState` immediately switches seats to settled chip balances. A separate collection of booleans and timers controls whether boards and winner labels are visible.

**Reproduced C03:** on receipt of a preflop all-in result, a winner already shows the awarded stack before any remaining board card is visible. The countdown also starts immediately on the server, while each client is still presenting the runout. Initial dealing, normal community-card effects, and completion effects can overlap; `isAnimating` is not used to gate controls. Animation timers have no component-unmount cleanup.

Action: separate authoritative settlement from the displayed snapshot. Render board, hole cards, pot, stacks, result text, and controls from one presentation stage. Old callbacks must never modify a newer hand. Start the between-hand countdown after the server-defined presentation/result interval; do not wait indefinitely for every client to acknowledge completion.

Source: `client/src/MultiplayerTable.tsx:149–229,349–459,553,1090+`; `server/src/game-controller.ts:314–374,422`.

### 3. Runout support is community-card-specific

The client decides a runout is needed by comparing community-card counts. Stud has none. Completion immediately sets every non-folded player’s displayed card count to their final count.

**Reproduced C02:** a third-street Stud all-in jumps from three to seven cards, then shows the result after 800 ms. It has no street-by-street Stud runout. Drawmaha also clears its final pots, unlike the shared base class, explaining another route to missing pot displays.

Action: define a per-family sequence. Flop games reveal the remaining board streets; Stud deals the remaining streets around the table, with the agreed visibility policy; draw games continue required discard decisions; Drawmaha continues its draw and then the remaining board. Every family uses the same result and next-hand lifecycle.

Source: `client/src/MultiplayerTable.tsx:358–438`; `engine/src/games/drawmaha-base.ts:411`; `engine/src/games/stud-base.ts:213`.

## Prioritized implementation plan

The order below is deliberate. Each item includes the failure it addresses and a concrete completion gate. P0 blocks any further shared testing. P1 blocks the intended dealer’s-choice test session. P2 can follow a successful session.

### 1. P0 — Make hand commands and settlement safe to repeat

**Confirmed:** after an ordinary completed heads-up hand, another accepted check pays the preserved display pot again. R01 increased total chips from **200 to 204**. `act()` does not reject completed phases, and settlement is not guarded. Similarly, `startHand()` replaces a live hand (R14), and `handleVariantPick()` ignores the supplied player identity (R15). Repeating a pick can deal again.

Implement:

- Explicit server lifecycle: waiting for players, waiting for choice, active hand, presenting result, between hands.
- Reject betting outside betting phases and drawing outside draw phases. Reject `start-hand` during an active hand or unresolved presentation window.
- Give each command a hand ID and action/turn identifier; acknowledge accepted/rejected commands and reject stale or repeated commands.
- Settle each hand exactly once. Keep display pots separate from payable amounts or mark the settlement irreversibly complete.
- Permit one variant selection from the designated chooser in an open choice window only.
- Queue host mode/stakes changes for the next hand. Make stop-game mean stop after this hand, unless a separately designed refund/abort operation is explicitly invoked. Current stop destroys the controller mid-hand while room balances can still reflect starting stacks.

**Done when:** duplicate check/call/start/pick, stale prior-hand messages, and double-clicks cannot change cards, skip a choice, pay twice, or corrupt stacks. Repeated settlement leaves total chips unchanged.

Sources: `engine/src/games/base.ts:161,449`; `server/src/game-controller.ts:90,137,216,314`; `server/src/index.ts:stop-game`.

### 2. P0 — Validate socket payloads and protect player identity/cards

**Confirmed:** sending `action: null` to an isolated local server crashes the process before its handler can catch an error (S01). A numeric `NaN` accepted directly by the engine corrupts chips (R12); the engine must remain safe independently of transport serialization. Duplicate discard indices create six hole cards (R05). Reconnecting with the name of a disconnected player claims that seat without a secret (R21).

**Confirmed privacy failure:** after a fold win, the opponent receives the winner’s actual hole cards because `Complete` is treated as a reveal-all showdown (R02). The client hiding those cards provides no privacy. Hand-description payloads also need the same reveal policy.

Implement:

- Runtime schemas before destructuring: names, room codes, supported variants/modes, finite numeric amounts, chip multiples, stake relationships, integer seat indices, unique in-range discard indices.
- Reject unknown variants; the factory currently silently falls back to NLH.
- Per-event error containment, sensible message/rate limits, and transactional validation before mutating a game.
- Stable player IDs and unguessable reconnect tokens, separate from socket IDs, seat numbers, and display names. Do not recycle a departing player’s identity into a new occupant’s live hand.
- A single reveal policy for cards, descriptions, histories, spectators/unseated arrivals, reconnect snapshots, and completion events. Folded hands stay private; fold winners stay private unless explicitly shown. Ordinary contested showdown/muck behavior needs a product decision below.

**Done when:** malformed messages cannot crash the server or change valid state; unauthorized commands fail; same-name newcomers cannot reclaim a seat; forbidden card/description data is absent from payloads, not merely hidden by CSS.

Sources: `server/src/index.ts:action,discard,pick-variant,add-on`; `server/src/state-filter.ts:24–60`; `server/src/room-manager.ts:72–110`; `engine/src/betting.ts:273–318`.

### 3. P1 — Implement one showdown/runout/next-hand presentation sequence

Use the three findings above as the design inputs. Recommended sequence:

`accepted final action → gather/return bets → remaining decisions if any → permitted reveal → paced remaining streets → show result → display awarded stacks → result dwell → countdown/next choice → next deal`

Keep game logic deterministic and free of UI timers. The server owns hand identity, legal transitions, and scheduled presentation deadlines. The client renders those stages with animation. A reconnect receives enough information to resume the current stage without replaying an entire completed hand or resurrecting old timers. A hidden/throttled tab catches up to the current stage.

Proposed initial pacing: retain the existing **180 ms card interval and roughly 2 seconds between all-in streets**; provide a **3-second result dwell**; begin the existing **15-second countdown afterward**. These are tunable product choices, not poker rules. Host Deal Now may skip the between-hand wait after the result, not cut off unresolved play or another client’s scheduled runout.

Do not begin an automatic runout merely because one player is all-in. Two players with chips may still bet a side pot. Do not expose draw hands while discard decisions remain. A river all-in needs a result reveal, not an invented board animation.

**Done when:** fake-clock component tests cover fold win, ordinary showdown, preflop/flop/turn/river all-in, side-pot continuation, Stud streets, draw decisions, Drawmaha, new-hand arrivals, duplicate/out-of-order updates, unmount, reconnect, and throttled-tab catch-up. No cards disappear, reveal twice, change identity during an old timer, or expose final stacks before the result.

### 4. P1 — Correct required draws and deck recycling

**Confirmed:** Drawmaha inherits the base all-in shortcut and reaches completion with **zero draw actions** (R03). Its drawer selection skips all-in players. Six players legally drawing five cards exhaust the deck, and the exception occurs after the hand has already been partially changed (R04).

Implement:

- Preserve every required draw for all-in players in all draw families.
- Skip betting only when no further contested betting is possible; advance to the next required draw or street.
- Add a discard/muck lifecycle and shuffle eligible recycled cards with the existing secure RNG. Specify when current-round discards may be reused and prevent a player receiving their just-discarded card in the same draw under the chosen rule.
- Validate and prepare a replacement deal before committing mutations; failures must not leave a player with too few cards.
- Preserve Drawmaha’s completed pots for presentation, with settlement protected by item 1.

**Done when:** all 29 variants complete ordinary and applicable all-in flows; six-player multi-draw hands can exhaust the stock safely; every live hand has the correct number of cards and no duplicate physical cards.

PokerStars explicitly provides all three drawing opportunities and reshuffling when stock is insufficient in [its Triple Draw rules](https://www.pokerstars.com/poker/games/draw/2-7/). Drawmaha timing remains a house-rule confirmation below.

Sources: `engine/src/games/drawmaha-base.ts:125,228–303,411`; `engine/src/games/draw-base.ts:228–280`; `engine/src/deck.ts:deal`.

### 5. P1 — Fix lowball rankings and verify evaluator expectations independently

**Confirmed:** unsuited A-2-3-4-5 is classified as a straight in 2-7 (R06). It should be ace-high, as explicitly listed in [PokerStars’ 2-7 rankings](https://www.pokerstars.com/poker/games/draw/2-7/). The current tests include the same incorrect straight assumption.

**Confirmed:** A-5 uses one penalty for all paired categories and then sorts individual ranks. It can rank quad aces above a one-pair hand (R07). Pair rank and category must take precedence over unrelated kickers. This affects Razz, Badacey, and A-5 Drawmaha; the shared 2-7 evaluator affects its draw/Drawmaha/Badeucy consumers.

Implement independently specified ordering fixtures for no-pair, one-pair, two-pair, trips, full house, and quads, and within-category kickers. Verify high-hand, Omaha exact-two/exact-three, Badugi distinct-suit/distinct-rank, split-pot qualifiers, and variant mappings alongside them. Retain the documented Archie qualifiers; do not infer new rules from a name.

**Done when:** evaluator ordering agrees with an independent rule table, not comments copied from the implementation; representative family and split-pot outcomes pass. Correct contradictory test expectations rather than preserving a green but inaccurate suite.

Sources: `engine/src/evaluator.ts:280–326,494`; `engine/tests/evaluator-edge-cases.test.ts:649–659`.

### 6. P1 — Fix Stud/Razz action order and completion rules

**Confirmed:** Stud acts on unpaired AK before an exposed pair of deuces (R08). Razz acts on AK before 23 (R09). Stud can select an all-in player as the next bettor and stall (R10). The showing-hand score does not account for pair categories, and Razz compares low cards in the wrong order.

Implement correct partial exposed-hand rankings and deterministic ties; choose only players eligible to bet. Preserve all-in players for dealing/showdown. Handle bring-in transfer when the obligated player is all-in from the ante, and add the bring-in player’s option to open for a full small bet. Add Stud-high fourth-street big-bet-on-an-exposed-pair behavior under the selected rules; do not apply that exception indiscriminately to Razz or Stud/8.

These behaviors are grounded in [PokerStars Stud rules](https://www.pokerstars.com/poker/games/stud/) and [Razz rules](https://www.pokerstars.com/poker/games/razz/). They are separate from cosmetic runout pacing.

**Done when:** deterministic deals cover paired boards, ties, all-in leaders, short antes/bring-ins, and legal bet sizes on every street for all three Stud variants. No all-in player is asked to bet. The six-seat limit remains enforced; eight-seat shared-river exhaustion is outside the current product scope.

Sources: `engine/src/games/stud-base.ts:147,299`; `engine/src/games/stud.ts:32`; `engine/src/games/razz.ts:54`; `engine/src/games/stud-hilo.ts:37`.

### 7. P1 — Make betting and chip units exact

**Confirmed:** raise to 10, short all-in to 15, third player calls: the initial raiser is offered another raise despite action not being reopened by a full raise (R11). A pot of 1.10 split using a 0.25 denomination becomes 1.00 (R13). The server accepts amounts without enforcing that denomination. The ActionPanel sends **raise to 0** when the only legal all-in raise has `minRaise === maxRaise` (C04).

Implement:

- Per-player raise rights following full and incomplete raises; handle cumulative short raises under the selected NL/PL rule and the separate fixed-limit completion rule.
- Correct fixed-limit cap accounting, including blind/completion contributions and short all-ins. Existing action-count-based caps do not represent all of these cases.
- Explicit table chip unit and integer internal accounting. Validate stakes, bets, buy-ins and payouts against it. Remove the client’s hardcoded 0.25 where incompatible with table settings.
- Correct forced-bet-only starts: all-in blinds/antes must progress without waiting for an impossible action. Zero-stack players should not be dealt in (R19).
- Separate bet amounts from raise-to totals consistently, including the big blind’s option. Derive the action button value even when no slider is needed; clamp/reset values when hand/turn/max changes, not only minimum changes.
- Verify multi-street side-pot eligibility, unmatched returns, ties, quartering and odd chips. Distinguish an unmatched bet returned from a pot won in the result display.

**Done when:** exact chip conservation holds across every action/settlement and top-up; supported stake combinations remain representable; short stacks can call, raise all-in, draw and reach showdown without deadlock.

Sources: `engine/src/betting.ts:40–135,161,186,273`; `engine/src/games/base.ts:706–760`; `client/src/components/ActionPanel.tsx:34–44,112–132`.

### 8. P1 — Stabilize dealer’s choice, seats, and late entry

**Confirmed:** with the host sitting out and active physical seats 1 and 2, the controller looks for chooser seat 0 and reports “No variant selected” (R16). It confuses an index in the active-player array with a physical seat. Button movement has the same dependency on changing array sizes. Player IDs are derived from reusable seat numbers.

Implement stable player/seat references for the button and chooser; advance through the ordered active seats without skipping or repeating obligations. Count only successfully completed hands toward the rotation. Define how entry/exit affects the existing “one orbit plus one hand” choice. Preserve turn/choice ownership through reconnects. Give mid-game newcomers and sitting-out players a usable buy-in/waiting view; the current sit-down UI is inside the pre-game lobby branch.

**Done when:** DC works with occupied seats such as 0/2/5, chooser departure, host transfer, rebuy, entry between hands, and game-family changes. Joining never inherits the departed occupant’s active hand, cards, or awards.

Sources: `server/src/game-controller.ts:90–133`; `engine/src/session.ts:180–290`; `server/src/room-manager.ts:110`; `client/src/MultiplayerTable.tsx:lobby branch`.

### 9. P1 — Implement reconnect, departure, and pause as explicit policies

**Confirmed:** if an off-turn player leaves, the hand can later wait for that removed player (R17). Disconnect handling only addresses the current actor. Name matching in RoomManager is not a complete reconnect flow: the client’s connect handler only changes status, and a manual mid-hand rejoin is sent `availableActions: null`, with no complete result/choice/countdown restoration. Draw turns need their own timeout behavior.

Implement token-based rejoin on reconnect, one socket per client provider, complete filtered snapshots with legal actions and lifecycle/choice state, and a clear disconnected indicator. Define safe grace-period handling for betting and drawing; already all-in hands retain eligibility. Separate “sit out next hand” from surrendering the current hand. Queue departure/cash-out until committed chips are resolved. Clean up game timers when destroying a room (R20). Track why a countdown paused so another player’s sit-in does not undo a deliberate host pause.

Also show recoverable direct-link errors: a failed join currently sets `directJoinAttempted` and can strand the user on the connecting screen with no relevant error/retry UI.

**Done when:** reconnect on your turn, reconnect during runout/choice, leave off-turn, close a phone tab, host disconnect, and leave during a draw cannot strand the table or duplicate a player.

Sources: `server/src/game-controller.ts:282,457`; `server/src/index.ts:join-room`; `server/src/room-manager.ts:130–225`; `client/src/useSocket.ts:237–253`; `client/src/MultiplayerTable.tsx:560–603`.

### 10. P1 — Make top-ups and session records authoritative

**Confirmed:** a queued target stack of 150 applied after a player finishes with 200 sets them back to 150 (R18). It overwrites the result instead of preserving winnings. The server also considers a completed game object an active hand, so its between-hand top-up branch is not reached as intended.

The tracker is a per-browser ref keyed by name. Other players’ top-ups are not recorded there, refresh loses history, and departing players disappear from the room-based rows. This is not a reliable session ledger even for play chips. Stale `chipsBehind` can persist because an omitted field means “keep old value” in the reducer.

Implement clearly defined add-an-amount versus top-up-to-a-target semantics, applied atomically between hands. Record buy-ins, credited add-ons, cash-outs, and settled balances on the server by stable player ID; acknowledge before updating the client. Retain departed players and expose a session summary/export. Explicitly clear capped-stack metadata when no longer applicable.

For recovery, choose a small persistent session ledger/checkpoint if losing the entire session on a Railway restart is unacceptable. A full hand-replay UI can remain deferred, but completed hand summaries and accounting should survive ordinary refresh/reconnect. Disk persistence on Railway requires an actual persistent volume or database; writing to ephemeral container storage alone does not solve restart recovery.

**Done when:** all clients see the same totals; win/loss plus queued top-up conserves the intended balances; refresh/leave/rejoin cannot reset a participant’s session result.

Sources: `server/src/game-controller.ts:154–156`; `server/src/index.ts:add-on`; `client/src/MultiplayerTable.tsx:112,461–467,536,784`; `client/src/useSocket.ts:144`.

### 11. P1 — Add release checks that exercise the failing paths

Keep the current tests and add independent regression coverage for the findings. Use engine fixtures, fake-clock React lifecycle tests, and real local Socket.io integration tests. Random playout/stress tests should be bounded, replayable, and check chip/card invariants; they are supplementary to deterministic cases.

Make the client typecheck a real build/check step after reconciling its settings with shared engine imports. Resolve the current lint failures without suppressing rules wholesale. Install/declare `concurrently`, or simplify the root development launcher; it is currently referenced but not declared. Verify a clean install → engine build → server/client dev startup and production build using the same Node major as Docker. Avoid unrelated dependency upgrades.

**Done when:** one documented local command runs the meaningful checks; CI executes them before deployment; the 26 reproductions have been converted into appropriate passing regressions (rather than retaining diagnostic assertions that confirm broken behavior).

### 12. P2 — Defer optional polish until the core session is reliable

Sound/your-turn notifications, run-it-twice, spectators as a full feature, hand replay UI, straddles, rabbit hunting, bot sophistication, and broader UI restyling can wait. Slow single-board runout is part of item 3 and is required now. Do not conflate it with run-it-twice, which is a different option documented by [Poker Now](https://www.pokernow.com/blog/what-is-the-run-it-twice-feature).

## Questions to settle before implementation

1. **Initial game menu:** should the first validated test include all 29 variants, or an agreed smaller selection? Recommendation: stabilize the shared families, then enable only variants that pass the full matrix; do not leave broken variants selectable. All 29 remain the eventual target unless you choose otherwise.
2. **Showing and mucking:** at an ordinary contested showdown, should every live hand show automatically, or should losing hands be able to auto-muck? Recommendation: PokerNow-style winner/required-hand reveal with optional showing, and automatic all-in exposure only after no betting or draw decisions remain. Fold winners and folded players remain private. For Stud all-ins, confirm whether to expose existing downcards when action closes and then reveal each remaining street, including seventh.
3. **Dealer’s-choice duration:** retain the documented one orbit plus one hand, giving the chooser two buttons? Recommendation: preserve that existing rule, but anchor it to stable participants/button progression and define entry/exit explicitly. Also confirm the sit-in/missed-blind policy: wait for the blind, post to enter, or a deliberately simpler home-game rule.
4. **Stakes and units:** keep .25/.50 for NL/PL and 2/4 for limit? If so, should limit flop/draw games use 1/2 blinds, while Stud uses .50 ante/.50 bring-in, or are the currently shared .25/.50 blinds intentional? Should the smallest chip always be .25? Preserve the existing 80-BB and 30-BB mixed-game caps unless you want to change them; clarify which configured blind anchors those caps.
5. **Exotic-game reference:** confirm the documented Drawmaha timing: PL draws after the flop is dealt but before flop betting; limit draws after flop betting. A rule sheet/reference for your intended 49 and 10–30 variants would help verify pip valuation and ties. Archie’s already-documented pair-of-nines high/eight-or-better low qualifiers remain the baseline.
6. **Disconnects and recovery:** recommendation is a 60-second reconnect grace, then an agreed automatic check/fold or draw-timeout policy, preserving all-in eligibility. Should the table pause during that grace? Must a session survive a server restart, or is reconnect/refresh recovery plus downloadable session records sufficient for the first test?

There is no single “all poker sites” rule set for mucking, missed blinds, short fixed-limit raises, odd chips, or niche dealer’s-choice variants. Use PokerNow as the interaction reference, documented poker rules for standard variants, and explicit agreed house rules for the remaining choices. Animation timing is a product decision. The sources above do not establish PokerNow’s exact current timing or Stud behavior.

## Gate before Josh’s next multi-device session

Require items 1–11 for the enabled game menu, then provide a short guided test:

| Scenario | Expected experience |
|---|---|
| Fold win → next hand | Private winning hand; pot result; all players receive a fresh deal |
| Ordinary river showdown | Agreed show/muck policy; accurate winner/pot; readable result before countdown |
| NLH/PLO all-in on each street | One slow runout; no remaining betting; no early stack/result spoiler |
| Three-player all-in with a live side pot | Remaining players keep betting; private cards stay private until allowed |
| Stud/Razz all-in | Remaining streets dealt in sequence; agreed downcard visibility; correct action order beforehand |
| Triple draw/Drawmaha all-in | Every required discard choice remains available; no premature winner |
| Deck exhaustion | Legal replacements, no duplicate cards, no exception or missing hand cards |
| DC with empty/sitting-out seats | Correct chooser and button; one accepted choice; correct hand count |
| Bust, top-up, leave and return | No zero-stack deal; correct balances and session ledger on every device |
| Disconnect during turn/choice/runout | Clear status and predictable recovery; no stalled or reset hand |
| Duplicate/delayed commands | Harmless rejection; no extra deal or payout |

## Evidence and handoff

Review-only files are under `reviews/2026-09-17/support/`:

- `reproduce.mjs` and `reproductions.json`: R01–R21. Some fixtures deliberately access compiled protected methods/state to isolate a ranking or lifecycle boundary; those are not all end-to-end socket exploits.
- `client-reproduce.cjs` and `client-reproductions.json`: C01–C04. Executes actual reducer/component code and React effects with mocked transport/shared seat components and a controlled clock. No browser or visual testing. React test renderer is deprecated and is temporary review tooling, not the recommended permanent test stack.
- `socket-reproduce.mjs` and `socket-reproductions.json`: S01. Starts and stops an isolated local server on port 43179; no production traffic.
- `lint.txt` and `typecheck.txt`: full baseline diagnostics.

Reproduction commands after `npm run build`:

```powershell
node reviews/2026-09-17/support/reproduce.mjs
node reviews/2026-09-17/support/client-reproduce.cjs
node reviews/2026-09-17/support/socket-reproduce.mjs
```

The client diagnostic needs the temporary packages already installed under `%TEMP%\poker-review-react`. To recreate them: `npm install --prefix "$env:TEMP\poker-review-react" --no-audit --no-fund --ignore-scripts react@19.2.4 react-test-renderer@19.2.4`.

These scripts intentionally assert that existing bugs reproduce; a successful exit is not a release approval. New source fixes need expected-correctness regression tests. Random deals can change card values/winner names in evidence; the asserted failures are independent of those outcomes.

Next implementation step: agree the rule questions, work on a `codex/` branch, implement lifecycle/input/privacy protections first, then the presentation sequence and family/rules/accounting fixes. Review and approve a push separately under the existing workflow. No fixes, commits, pushes, production deploys, or persistent instruction changes were made during this review.
