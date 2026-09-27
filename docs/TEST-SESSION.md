# Ten-Game Test Session — guided script

For Josh's multi-device test. Automated checks (`npm run check`) cover the rules and lifecycle logic. This script covers what only a person can judge: how it looks and feels across real devices.

**Setup:** three devices (e.g. laptop, phone, tablet) as A (host), B and C. In the `poker-with-friends` folder, run `npm.cmd run build`, then `$env:NODE_ENV='production'; npm.cmd start`. Open `http://localhost:3001` on the PC and `http://<PC IPv4>:3001` on phones on the same Wi-Fi. Each player needs a separate browser or device; two tabs in one browser share a seat. Note anything odd with the time and which device.

Rules reference: `docs/NINE-GAME-RULES.md` (the ten-game spec).

## Round 2 (2026-09-26): what changed since the first session

Run this section first. Sections 1–6 below are the full regression script if there's time.

| # | Do | Expect |
|---|---|---|
| R1 | Look at the table during any flop or draw hand | A yellow **D** chip on the felt beside the button seat, as well as the D by the name |
| R2 | Host pauses, then presses **Deal Now** | The hand deals immediately; no resume step needed |
| R3 | Deal 5+ PLO hands in a row, then 5+ O8 hands | No flash of cards before the deal animation, including right after a showdown |
| R4 | Get two players to showdown with the same pair or trips (NLH or Stud) | Winner labels show kickers, e.g. "Three Jacks, K-9 kickers". The bottom-of-screen hand line stays short. |
| R5 | 8-, 9- or 10-Game (or DC) with everyone bought in above $75, playing NLH or PLO | Seats show "**+$X behind**". Center tracker shows "Cap 150BB". 2-7 Single Draw shows "Cap 30BB". A Specific Game of NLH has no cap. |
| R6 | NLH and PLO betting | **33%**, **67%** and **Pot** buttons set the amount (PLO keeps its single Pot button). Amounts are whole $0.25. The chosen amount is accepted when you bet. |
| R7 | Stud all-in on 3rd or 4th street | The remaining streets are dealt starting with the player to the left of the D |
| R8 | Dealer's Choice: finish a hand, then Deal Now (or let the countdown run out) | The table clears. Everyone sees "Waiting for **Name** to choose the game", and the chooser sees the picker. After the pick, the new hand deals normally. |
| R9 | Any mixed mode | The tracker ("Hand x/8 • Game x/10 • Cap …") shows in the center of the table under the game name, as well as top left |
| R10 | HORSE: play through O8 into Razz, Stud, Stud8, then back to LHE | During the stud games the D stays on the same seat. The first LHE hand moves it one seat left. At H→O the D just keeps moving one seat per hand. |
| R11 | **Badugi** as a Specific Game, then in 10-Game and Dealer's Choice | 4 cards each, three draws, limit betting (small bet for two rounds, big bet for two). Discarding works through the usual card-select controls. The hand line reads like "Badugi: 7-4-2-A" (a full badugi) or "3-card: 3-2-A". A four-card hand beats any three-card hand, then the lowest top card wins. |
| R12 | **10-Game** mode from the lobby and from the host Game menu | The rotation is H, O, R, S, E, NLH, PLO, 2-7 TD, 2-7 SD, Badugi (8 hands each), and the tracker shows Game x/10 |

## 1. Room and seats

| # | Do | Expect |
|---|---|---|
| 1.1 | A creates a 9-Game room with the defaults | Lobby shows blinds .25/.50 and limits 2/4. Stud ante and bring-in fields show 0.50/0.50. Buy-in range shows $25–$150. |
| 1.2 | A creates a room with a .10 blind | Rejected with a "multiple of $0.25" message |
| 1.3 | B and C join by link | Each gets a name prompt. After joining, each buys in with the dollar slider. |
| 1.4 | B tries to join again from a second browser using B's name | "Name already taken" |
| 1.5 | B refreshes the page | B lands back in the same seat with the same chips and no name prompt |

## 2. The nine games

Use the host **Game** menu and choose **Specific Game** to play 2–3 hands of each. Watch each item below.

| Game | Check |
|---|---|
| LHE, O8 | Preflop cap: raise, re-raise, re-raise; the fourth bet (8 at 2/4) is the last, so there's no raise button after it. In O8, check the hi/lo split display and that a low needs 8-or-better. |
| Stud | The worst door card gets **Bring in 0.50 / Complete 2** buttons and no check or fold. An **open pair on 4th street** gives the first player **Bet 2 / Bet 4**. |
| Stud8, Razz | Same bring-in buttons. No open-pair choice on 4th. In Razz, the king door brings in. |
| NLH, PLO | Bet slider, pot/all-in buttons, $0.25 steps |
| 2-7 TD | Three draws. An all-in player still gets to draw. |
| 2-7 SD | One draw, no-limit betting |

## 3. Showdown and runout

| # | Do | Expect |
|---|---|---|
| 3.1 | Fold win: B raises, A and C fold | B's cards stay hidden. The result shows the called pot won and a separate line "$X uncalled, returned to B". |
| 3.2 | River showdown | Every surviving hand is shown automatically, with descriptions. The countdown starts after the result. |
| 3.3 | NLH all-in preflop, called | One slow runout (about 2 s per street). Stacks don't update until the result. |
| 3.4 | Stud all-in on 3rd street | Downcards are exposed, then 4th–7th are dealt around the table street by street |
| 3.5 | Three-way: C all-in short, A and B keep betting | A and B can still bet the side pot. Main and side pots are labelled correctly. |

## 4. Dealer's Choice and the button

| # | Do | Expect |
|---|---|---|
| 4.1 | Switch to Dealer's Choice | The player on the button gets the game picker (nine games only). Everyone else sees "waiting for the dealer to choose". |
| 4.2 | Play the orbit | The chooser gets the button twice (one orbit plus one hand). Then the next player to the left chooses. |
| 4.3 | Switch to HORSE and play past 8 hands | After 8 hands the game changes and the button **resets** to one seat left of where the last game started |

## 5. Money

| # | Do | Expect |
|---|---|---|
| 5.1 | Between hands, B tops up to $120 | B's stack becomes $120. Tracker buy-ins go up by the difference. |
| 5.2 | Mid-hand, C tops up to $150, then wins a big pot (over $150) | After the hand, C keeps the bigger stack. The top-up never lowers it. |
| 5.3 | Open the Tracker on all three devices | Identical numbers everywhere. Each net = stack + cashed out − buy-ins. |
| 5.4 | C leaves between hands, then look at the Tracker | C shows as "(left)" with a cash-out amount. The session nets still sum to zero. |

## 6. Disconnects and leaving

| # | Do | Expect |
|---|---|---|
| 6.1 | On B's turn, put B's phone in airplane mode | The table waits for B only. After 60 seconds B checks if possible, otherwise folds. |
| 6.2 | B disconnects when it is **not** B's turn | Play continues without waiting |
| 6.3 | B is still offline when the next hand deals | B is dealt out (sat out). B's seat and chips stay. B's seat shows "(away)". |
| 6.4 | B reconnects | B rejoins automatically and is dealt in from the next hand |
| 6.5 | A pauses, waits, then resumes | While paused, nothing deals and nobody is auto-acted. Resume continues from where it stopped. |

## Reporting

For each problem: the step number, the device, what you saw, and what you expected. Screenshots help.
