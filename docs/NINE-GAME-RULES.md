# Nine-Game Rules Spec

The reference for the nine-game build. Tests are written from this document, not from the current code. Where the two disagree, this document wins once Josh signs it off.

Status: **SIGNED OFF by Josh 2026-09-23.** Items marked **[DECIDE]** need an answer. Items marked **[CONFIRMED]** were settled by Josh on the date shown. Everything else is a standard rule proposed as the default.

Sources for standard rules: PokerStars game rules (2-7, Stud, Razz), Robert's Rules of Poker, and the WSOP Nine Game Mix definition.

---

## 1. The nine games

| # | Game | Family | Betting | Hi/Lo |
|---|---|---|---|---|
| 1 | Limit Hold'em (LHE) | Flop | Fixed limit | High |
| 2 | Omaha Hi-Lo 8-or-better (O8) | Flop | Fixed limit | Split |
| 3 | Razz | Stud | Fixed limit | A-5 low |
| 4 | Seven Card Stud | Stud | Fixed limit | High |
| 5 | Seven Card Stud Hi-Lo 8-or-better (Stud8) | Stud | Fixed limit | Split |
| 6 | No-Limit Hold'em (NLH) | Flop | No limit | High |
| 7 | Pot-Limit Omaha (PLO) | Flop | Pot limit | High |
| 8 | Limit 2-7 Triple Draw (2-7 TD) | Draw | Fixed limit | 2-7 low |
| 9 | No-Limit 2-7 Single Draw (2-7 SD) | Draw | No limit | 2-7 low |

**Modes** [CONFIRMED 2026-09-23]
- **HORSE:** games 1–5.
- **8-Game:** HORSE + NLH + PLO + **2-7 Triple Draw** (the WSOP standard). The code currently uses 2-7 Single Draw here, and that gets fixed.
- **9-Game:** 8-Game + 2-7 Single Draw.
- **Dealer's Choice:** chooser picks from these nine only.
- **Specific Game:** any one of the nine.

The other 20 variants stay in the engine but can't be selected in the app or on the server.

Rotation modes play **8 hands per game** [CONFIRMED 2026-09-23].

**Button across game segments** [CONFIRMED 2026-09-23]. Each game segment (a rotation game or a dealer's-choice orbit) **starts with the button one seat to the left of where the previous segment started**. The button is **explicitly reset** at the start of each segment, because 8 hands with 5 players would otherwise leave it somewhere else. Within a segment the button moves one occupied seat per hand. Stud hands still advance an invisible button, so it's in the right place when a flop or draw game comes up. In dealer's choice, the segment starts with the button on the chooser.

---

## 2. Stakes and chips

- **Smallest chip is $0.25** [CONFIRMED 2026-09-23]. Every stake, bet, buy-in, top-up and payout is a whole multiple of $0.25. Internally, amounts are integer quarter-units.
- **Stakes are customizable per room** [CONFIRMED 2026-09-23]. The host sets them at room creation, and the server rejects values that aren't multiples of $0.25 or that break the relationships below.

| Setting | Default | Rule |
|---|---|---|
| NL/PL blinds | $0.25 / $0.50 | SB ≤ BB |
| Limit small bet / big bet | $2 / $4 | big bet = 2 × small bet |
| Limit flop/draw blinds | $1 / $2 | SB = ½ small bet, BB = small bet |
| Stud ante | ¼ small bet ($0.50 at 2/4) | ≤ bring-in |
| Stud bring-in | ¼ small bet ($0.50 at 2/4) | < small bet |

Ante and bring-in are **host-editable**. Their defaults follow the limits (¼ of the small bet, rounded to $0.25) [CONFIRMED 2026-09-23].

- **Buy-in is entered in dollars** [CONFIRMED 2026-09-23], using one stack for the whole session. The host can edit the min and max. Defaults are 50–300 × the NL big blind ($25–$150 at .25/.50). Top-ups use the same max.
- **Mixed-game caps** (chips in play for one hand; the rest stays behind and returns after the hand):
  - NLH and PLO: 80 × BB
  - 2-7 SD: 30 × BB
  - These apply in HORSE, 8-Game, 9-Game and DC, not in Specific Game [CONFIRMED 2026-09-23].

---

## 3. Betting rules (all games)

### No limit and pot limit (NLH, PLO, 2-7 SD)
- Minimum bet = BB. Minimum raise = the size of the previous full bet or raise.
- PL maximum = pot after calling.
- **Short all-in:** an all-in that is less than a full raise does **not** reopen betting for players who already acted. Several short all-ins that add up to a full raise do reopen it.
- A lone player facing only all-in opponents may call or fold, but can't bet into a dry side pot.

### Fixed limit (LHE, O8, Stud games, 2-7 TD)
- Small bet on early streets, big bet on later streets:
  - Flop games: small bet preflop and on the flop, big bet on the turn and river.
  - Stud: small bet on 3rd and 4th street, big bet on 5th–7th.
  - 2-7 TD: small bet in the first two rounds, big bet in the last two.
- **Cap:** one bet + 3 raises per round.
- **Heads-up exception:** there's no cap only when the betting round **starts** heads-up [CONFIRMED 2026-09-23]. If a round starts three-way and a fold leaves two, the cap still applies.
- **Short all-in in limit:** an all-in of **half a bet or more** counts as a full raise and reopens betting. Less than half does not (Robert's Rules).
- The blinds count toward the cap as the opening bet preflop.

### Uncalled bets
Returned to the bettor. They are not "won," and the result display must show them separately from a pot win.

---

## 4. Per-family rules

### Flop games (LHE, O8, NLH, PLO)
- Blinds as in section 2. Heads-up: the button posts the SB and acts first preflop.
- **PLO and O8:** exactly 2 hole cards plus exactly 3 board cards.
- **O8 low:** 8-or-better qualifier; aces low; straights and flushes don't count against the low.

### Stud games (Stud, Stud8, Razz)
- Ante, then 2 down + 1 up. 4th–6th up, 7th down.
- **Bring-in:**
  - Stud and Stud8: lowest door card. Ties broken by suit, lowest first: ♣ < ♦ < ♥ < ♠.
  - Razz: highest door card; aces are low, so the king is the worst. Ties: the highest suit (♠) brings in.
  - The bring-in player may post the bring-in or **complete** to the full small bet [CONFIRMED 2026-09-23]. After a bring-in with no completion, the next raise is a completion to the small bet.
  - If the bring-in player is all-in on the ante, the bring-in passes to the next-worst door card.
- **4th street onward, first to act:**
  - Stud and Stud8: best showing hand, with pairs above high cards.
  - Razz: best (lowest) showing low, with pairs counting as bad.
  - Ties: the tied player closest to the left of the button acts first.
  - All-in players are skipped.
- Stud (high only): an **open pair on 4th street** gives every player the option to bet or raise the big bet on that street [CONFIRMED 2026-09-23]. Not applied in Stud8 or Razz.
- **Deck:** six players need at most 42 cards, so the shared river card is never needed at 6-max.

### Draw games (2-7 TD, 2-7 SD)
- Blinds as in section 2. 5 cards each.
- 2-7 TD has 3 draws with 4 betting rounds. 2-7 SD has 1 draw with 2 betting rounds.
- Draw 0–5 cards, going in order from the left of the button. **All-in players still draw.**
- **Deck recycling:** when the stub runs out, earlier discards are shuffled with the secure RNG and dealt. The drawing player's own discards from that draw are never included.

---

## 5. Hand rankings

| Game | Ranking |
|---|---|
| LHE, NLH, PLO, Stud, O8 high, Stud8 high | Standard high. A-2-3-4-5 is a straight (the wheel). |
| Razz, O8 low, Stud8 low | **A-5 low:** aces low; straights and flushes ignored. Best hand A-2-3-4-5. Paired hands are worse than any unpaired hand, and they rank by category (pair < two pair < trips < full house < quads), then by pair rank, then kickers. Razz has no qualifier. O8 and Stud8 need 8-or-better. |
| 2-7 TD, 2-7 SD | **2-7 low:** aces **high only**, straights and flushes **count against you**. Best hand 7-5-4-3-2 unsuited. **A-2-3-4-5 is ace-high, not a straight.** |

- **Split pots (O8, Stud8):** half to the best high, half to the best qualifying low. No qualifying low means high scoops.
- **Odd chips:** the odd $0.25 in a hi/lo split goes to the **high**. Among tied players on the same side, the odd chip goes to the first tied player left of the button.
- Stud has no button, so the fixed button seat stands in for that rule.

---

## 6. Showdown, reveal and runout

- **Privacy:** folded hands and a fold winner's cards are never sent to other players. That covers hole cards and hand descriptions, and it has to hold in the network payload, not just the display.
- **Contested showdown:** every surviving hand is shown automatically [CONFIRMED 2026-09-17, recorded by Codex]. There is no mucking.
- **All-in runout:** starts only when no betting or draw decisions remain. Two players with chips behind keep betting the side pot.
  - Flop: live hands are exposed, then the remaining streets come out about 2 seconds apart.
  - Stud: existing downcards are exposed, then the remaining streets are dealt around the table about 2 seconds apart [CONFIRMED 2026-09-17].
  - Draw: every remaining draw decision is still taken before the result.
- **Sequence:** result shown, then awarded stacks updated, then about 3 seconds of dwell, then a 15-second countdown to the next hand. The host's Deal Now can only skip the countdown.

---

## 7. Table lifecycle

- **Dealer's Choice:** the chooser picks a game, and it plays for one orbit plus one hand, so the chooser gets two buttons. Then the choice passes to the next occupied seat on the left.
  - Button and chooser are tracked by **physical seat**, skipping empty or sitting-out seats.
  - If the chooser leaves mid-orbit, the current game finishes its orbit and the choice then passes to the next occupied seat on their left [CONFIRMED 2026-09-23].
- **Missed blinds:** no penalty. A returning player is dealt in on the next hand without posting [CONFIRMED 2026-09-23]. The button never skips a seat to avoid a blind.
- **Disconnects** [CONFIRMED 2026-09-23]:
  - Only on the disconnected player's turn does the table wait, up to 60 seconds.
  - After that: check if legal, otherwise fold. On a draw, the player stands pat.
  - All-in players keep their eligibility.
  - Off-turn disconnects never stall the hand.
  - Still disconnected at the next hand: sit them out automatically and keep their seat and chips until they return or the host removes them [CONFIRMED 2026-09-23].
- **Reconnect:** uses a token stored in the browser, never the player's name. A reconnecting player gets the full current state: their cards, legal actions, pending choice, and the result or countdown stage.
- **Top-ups** mean "top up **to** $X", never "add $X" [CONFIRMED 2026-09-23]. Between hands the stack becomes `max(stack, X)` right away. If requested mid-hand, it applies after settlement, so winnings are never reduced.
- **Leaving:** chips are settled first. The ledger (buy-ins, top-ups, cash-outs, final stacks) is kept on the server and survives refresh and leaving. It does **not** survive a server restart [CONFIRMED 2026-09-23].
- **Stopping and changing games:** only between hands. The host's Pause stops new deals and choices.

---

## Sign-off

- [x] Josh reviewed this spec and answered every open item (2026-09-23).
