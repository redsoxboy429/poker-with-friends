# Learnings Log

Append-only log of session learnings. Reviewed during /weekly-review.

## 2026-03-23 — Engine architecture + UI polish session

**Project:** Mixed Game Poker
**Duration:** Deep session (continued from prior, multi-hour)

- Built: BaseFlopGame extracted from NLH/PLO (mirrors BaseStudGame from Razz). BaseStudGame also built this session (prior context). Manual bet input added alongside slider for NL/PL games. Fold visibility fixed: folded players' cards vanish, fold-wins don't expose hands, showdown never reveals folded players.
- Built: getWinners() API on BaseGame, getHandDescription() public API, getPartialHandDescription() overrides per variant. Win display shows "Bob wins 250 with Full House, Kings full of Tens". Live hand ranking shown for human player.
- Hard: Fold/showdown visibility was a multi-pass fix. Initial logic was correct (player.folded check, isRealShowdown flag) but wasn't taking effect — turned out the showdown path was unconditionally setting dealtCardCount for ALL players including folded ones, overriding the card-hiding logic. Needed belt-and-suspenders: hide cards in PlayerSeat when folded, set dealtCardCount=0 for folded players at showdown, AND set dealtCardCount=0 for everyone on fold-wins.
- Hard: Josh runs built files via `npx serve dist`, not vite dev server. Changes require explicit rebuild (`npx vite build`). `vite` command not available directly on his Windows PATH — needs `npx vite build`.
- Learned: When multiple React state values must coordinate for a visual change (showdown, isRealShowdown, gameState, dealtCardCounts), any one of them can sabotage the others. The dealtCardCount override was the hidden culprit — it force-revealed cards even when showCards was false, because opacity was still 1.
- Decided: Three-tier inheritance for engine: BaseGame → BaseFlopGame (HE/Omaha family) → concrete variant, and BaseGame → BaseStudGame (stud family) → concrete variant. Adding a new flop variant is ~30 lines, new stud variant ~25 lines.
- Decided: Bet input UX: slider + text input inline with Bet/Raise button. Text input clamps to max immediately on type, enforces min on blur. Enter key blocked — must click button.
- Taste: Josh wants total pot won (not net profit) in win display. Aligned to standard poker table conventions.
- Taste: Folded players should have cards fully vanish (not just gray out). Clean, unambiguous.
- Next: Remove console.log debug statement. Update poker/CLAUDE.md with new architecture (BaseFlopGame, BaseStudGame, client UI status). Continue Phase 2 — remaining 8-game variants (Limit HE, Omaha Hi-Lo, Stud, Stud Hi-Lo, 2-7 SD).

## 2026-03-24 — Variant expansion session (LHE, Stud, hi-lo split)

**Project:** Mixed Game Poker
**Duration:** Focused session

- Built: LHE (Limit Hold'em) — trivially extends BaseFlopGame with FixedLimit betting. ~45 lines.
- Built: StudGame (7-Card Stud High) — extends BaseStudGame, lowest door card brings in, highest showing hand acts first, bestHighHand eval. ~65 lines.
- Built: Hi-lo showdown split in BaseGame — `evaluateLowHand()` optional override + `isHiLoGame()` flag. When enabled, `resolveShowdown()` auto-splits each pot 50/50 between best high and best qualifying low. No qualifying low = high scoops. Odd chip to high. Zero duplicated logic across hi-lo variants.
- Built: StudHiLoGame — extends BaseStudGame + hi-lo hooks. ~80 lines.
- Built: PLO8Game (Omaha Hi-Lo) — extends BaseFlopGame + hi-lo hooks, uses bestPLOHighHand + bestPLOEightOrBetterLow. ~65 lines.
- Built: Updated engine-wrapper with VARIANT_NAMES, PLAYABLE_VARIANTS (in 8-game rotation order), all 7 game configs and constructors.
- Built: UI variant selector now shows all 7 games (LHE, O8, Razz, Stud, Stud8, NLH, PLO).
- Decided: Hi-lo as a shared showdown option in BaseGame rather than per-variant — Josh suggested this and it was the right call. Clean separation: variants only define hand evaluation, BaseGame handles all pot splitting.
- Decided: Game mode design for future: 8-game = fixed rotation order, dealer's choice = button picks game for one orbit + 1 hand. Not implemented yet, just planned.
- Learned: BaseGame.act() takes (playerId, actionType, amount?) not an action object. Test helper needed to match this signature.
- Learned: Evaluator hand descriptions use patterns like "Four Aces" not "Four of a Kind, Aces" — test assertions needed to match actual output format.
- Tests: 247 passing (30 new). Chip conservation verified for all hi-lo variants over 20+ hands each.
- Next: 2-7 Single Draw (needs BaseDrawGame), 8-game rotation mode, dealer's choice mode, then multiplayer.

## 2026-03-25 — Bug fixes for 9 new variants

**Project:** poker
**Duration:** deep session (continued from compacted context)

- Built: Fixed Archie as proper hi-lo split (pair-of-9s high qualifier + 8-or-better low qualifier), fixed Badugi/Badeucy/Badacey/10-30 hand strength displays, fixed Drawmaha turn card dealing bug (Drawing1→BettingTurn not detected as street change), fixed quartered pot display (separate win lines per side), added PL Drawmaha to engine config, increased auto-deal to 12s. 377 tests passing.
- Hard: Drawmaha turn card bug was subtle — `isStreetChange` required both phases in `BETTING_PHASES` set, but draw phases aren't betting phases. Had to add draw phases to the transition detection.
- Hard: Archie qualifier took 3 iterations to get right. First pass was wrong lowball qualifier, second was single-pot with high qualifier only, third (correct) is hi-lo split with dual qualifiers. Josh had to correct the game rules twice.
- Learned: Archie is a hi-lo split game — HIGH side needs pair of 9s+ (standard poker), LOW side needs 8-or-better (A-5 lowball). Scoop requires qualifying both (e.g., flush + low). Neither qualifying = chop. This is NOT a single-pot lowball game with a qualifier.
- Learned: Badugi `getHandDescription` fails silently because base class checks `holeCards.length < 5` but Badugi only has 4 cards. Any game with non-standard card counts needs to override `getHandDescription`.
- Taste: For split-pot hand displays, show "no qualifier" cleanly — don't list the hand if it doesn't qualify for that side. Keep it simple.
- Next: PL Drawmaha UI still broken — shows in dealer's choice but not as single game selection, and single game shows limit but not PL. Display issue, not rules. Also need to test 10-30 live. Then ready for live testing.

## 2026-03-25 — PL Double Draw, Engine Refactors, Side Pots

**Project:** Mixed Game Poker
**Duration:** Deep session (massive — multiple hours)

- Built: 8 Limit Drawmaha variants (4 PL + 4 Limit), 5 PL Double Draw games (Badugi/Badeucy/Badacey/Archie/10-30), Limit Omaha High. Total variants: 29. 3-step game selector (Category → Structure → Game). All-in runout animation with street-by-street pauses. Side pot labels (Main/Side). Showdown hand descriptions for all players. Pot/All-In max buttons. Various UI fixes (slider, button sizing, pot font consistency).
- Hard: Side pot logic went through 4 iterations. collectBets was creating phantom side pots when players folded — folding should NOT create side pots, only all-ins. Also introduced a critical eligibility-narrowing bug when trying to merge pots with subset eligible sets. Had to revert and rethink.
- Surprising: The PLO8 wrong-winner bug was caused by collectBets narrowing pot eligibility on fold, not by hand evaluation. All hand eval logic was verified correct by audit bots.
- Learned: Side pots exist ONLY when someone is all-in for less. Folding = dead money in existing pot, not a new pot. Pots should only split at all-in bet levels. mergePotsForShowdown needed for cross-round pots with same active contenders.
- Decided: Architecture refactor — resolveQualifiedHiLoPot in BaseGame eliminates ~200 lines of duplicated code from Archie/10-30. Template method pattern for showdown. hasHighQualifier() hook for dual qualifiers. Drawmaha keeps its own override.
- Decided: Two "caps" are different: buy-in cap (300 BB table max) vs per-hand cap (80 BB for NL/PL in mixed games). Min buy-in raised to 50 BB.
- Decided: Badeucy/Badacey win display shows "BADUGI" / "LOW" columns, not "HIGH" / "LOW".
- Taste: Josh wants audit bots run proactively and frequently. Don't test the UI yourself — Josh tests, Claude audits code. Always ask clarification on poker rules rather than assume.
- Next: Test all new PL DD variants + Limit Omaha High + 3-step selector. Open items: busted blind logic, confirm buyout flow, sit-out functionality. Push to GitHub.

## 2026-03-27 — Phase 3 multiplayer client buildout

**Project:** Mixed Game Poker
**Duration:** Deep session

- Built: Component extraction from App.tsx (CardDisplay, PlayerSeat, ActionPanel, BetChip, PotDisplay, WinDisplay, GameLog → components/), horizontal chip stacking with 0.50 denomination, SocketProvider context pattern, LobbyPage with 3-step variant picker + limit fields, MultiplayerTable consuming shared socket, react-router routing (/, /room/:code, /practice)
- Hard: Chip positioning — went through 3 iterations (vertical overlap with pot → too far down behind cards → horizontal layout solved it). Socket sharing across routes — useSocket as standalone hook created new connections per page; had to refactor to React Context provider pattern
- Learned: Socket.io connections MUST be shared via Context when using react-router, not per-component hooks — each useSocket() call creates a separate connection that doesn't share state across route changes
- Learned: Vite HMR can cause spurious React hook-order errors when refactoring hooks to contexts; a full dev server restart clears the stale module cache
- Decided: Default game mode is Dealer's Choice (not Specific Game) — matches how Josh's group actually plays
- Decided: Player names persisted to localStorage — no accounts, just convenience for a friends game
- Taste: Josh prefers horizontal chip spread over vertical stacking. Pink chip for 0.50 denomination between white (1) and blue (0.25)
- Next: Start Game button doesn't work yet (server-side start-hand handler needs debugging). Join Room tab needs buy-in field. Both create and join flows should let player choose buy-in amount in lobby before sitting down. Then deploy to Railway/Vercel for real multi-device testing

## 2026-03-30 — Pot display bug fix + roadmap planning

**Project:** Mixed Game Poker
**Duration:** Medium session

- Built: Fixed two pot display bugs — (1) fold-win showing "Pot: 0 / You win 0" because collectBets returned single-eligible pots to player stack before totalWon was calculated, (2) all-in runout pots disappearing because engine cleared state.pots after resolveShowdown. Final fix: engine keeps pots in state after showdown (display-only, chips already distributed), pots reset naturally on next startHand(). Test helpers updated to exclude display pots from chip conservation checks.
- Hard: Went through 3 failed approaches on the all-in pot bug before landing on the right one. First tried client-side pot reconstruction from winners data (lost side pot structure). Then tried client-side ref snapshots before act() (still lost pots from final collectBets). Final correct approach: just keep pots in engine + fix test helpers. Simplest solution was the last one tried.
- Decided: Abstract Factory pattern NOT needed for the poker engine. Current Template Method + inheritance hierarchy is the correct pattern — no separable component families to mix/match.
- Decided: Multiplayer flow mirrors PokerNow: host creates room → gets link/code → players join with name+code → buy-in happens AT the table (not lobby) → host starts game.
- Decided: Feature roadmap split into Tier 1 (pre-launch) and Tier 2 (post-launch) in ROADMAP.md. No for MVP: run it twice, spectator, straddle, timer, sound, rabbit hunting, hand replay.
- Taste: Don't test visuals yourself — only Josh tests visuals. Always read existing code, memory, and context thoroughly before making changes. Added to both vault/working-protocols.md and poker/CLAUDE.md.
- Housekeeping: Moved all completed phase checklists from CLAUDE.md to ROADMAP.md (completed milestones section). CLAUDE.md cut from 276 → ~120 lines.
- Next: Session 2 remaining items (Start Game handler, buy-in at table), then Session 3 pre-launch features + deploy.
