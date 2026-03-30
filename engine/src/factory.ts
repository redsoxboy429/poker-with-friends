// ============================================================
// Game Factory — canonical createGame for all consumers
// ============================================================
// Single source of truth for mapping GameVariant → game class.
// Used by both client (engine-wrapper) and server (game-controller).

import { BaseGame } from './games/base.js';
import { NLHGame } from './games/nlh.js';
import { PLOGame } from './games/plo.js';
import { LHEGame } from './games/lhe.js';
import { O8Game } from './games/o8.js';
import { PLO8Game } from './games/plo8.js';
import { RazzGame } from './games/razz.js';
import { StudGame } from './games/stud.js';
import { StudHiLoGame } from './games/stud-hilo.js';
import { TwoSevenSDGame } from './games/27sd.js';
import { TwoSevenTDGame } from './games/27td.js';
import { BadugiGame } from './games/badugi.js';
import { BadeucyGame } from './games/badeucy.js';
import { BadaceyGame } from './games/badacey.js';
import { ArchieGame } from './games/archie.js';
import { TenThirtyGame } from './games/ten-thirty.js';
import { DrawmahaHighGame } from './games/drawmaha-high.js';
import { Drawmaha27Game } from './games/drawmaha-27.js';
import { DrawmahaA5Game } from './games/drawmaha-a5.js';
import { Drawmaha49Game } from './games/drawmaha-49.js';
import { PLBadugiDDGame } from './games/pl-badugi-dd.js';
import { PLBadeucyDDGame } from './games/pl-badeucy-dd.js';
import { PLBadaceyDDGame } from './games/pl-badacey-dd.js';
import { PLArchieDDGame } from './games/pl-archie-dd.js';
import { PLTenThirtyDDGame } from './games/pl-ten-thirty-dd.js';
import { LimitOmahaHighGame } from './games/limit-omaha-high.js';
import { GameVariant, type PlayerState, type TableConfig } from './types.js';

/** Create a game instance for the given variant */
export function createGame(
  variant: GameVariant,
  players: PlayerState[],
  buttonIndex: number,
  config: TableConfig,
): BaseGame {
  switch (variant) {
    case GameVariant.NLH: return new NLHGame(config, players, buttonIndex);
    case GameVariant.PLO: return new PLOGame(config, players, buttonIndex);
    case GameVariant.LimitHoldem: return new LHEGame(config, players, buttonIndex);
    case GameVariant.OmahaHiLo: return new O8Game(config, players, buttonIndex);
    case GameVariant.PLOHiLo: return new PLO8Game(config, players, buttonIndex);
    case GameVariant.Razz: return new RazzGame(config, players, buttonIndex);
    case GameVariant.Stud: return new StudGame(config, players, buttonIndex);
    case GameVariant.StudHiLo: return new StudHiLoGame(config, players, buttonIndex);
    case GameVariant.TwoSevenSD: return new TwoSevenSDGame(config, players, buttonIndex);
    case GameVariant.TwoSevenTD: return new TwoSevenTDGame(config, players, buttonIndex);
    case GameVariant.Badugi: return new BadugiGame(config, players, buttonIndex);
    case GameVariant.Badeucy: return new BadeucyGame(config, players, buttonIndex);
    case GameVariant.Badacey: return new BadaceyGame(config, players, buttonIndex);
    case GameVariant.Archie: return new ArchieGame(config, players, buttonIndex);
    case GameVariant.TenThirtyDraw: return new TenThirtyGame(config, players, buttonIndex);
    case GameVariant.DrawmahaHigh:
    case GameVariant.LimitDrawmahaHigh:
      return new DrawmahaHighGame(config, players, buttonIndex);
    case GameVariant.Drawmaha27:
    case GameVariant.LimitDrawmaha27:
      return new Drawmaha27Game(config, players, buttonIndex);
    case GameVariant.DrawmahaA5:
    case GameVariant.LimitDrawmahaA5:
      return new DrawmahaA5Game(config, players, buttonIndex);
    case GameVariant.Drawmaha49:
    case GameVariant.LimitDrawmaha49:
      return new Drawmaha49Game(config, players, buttonIndex);
    case GameVariant.PLBadugiDD: return new PLBadugiDDGame(config, players, buttonIndex);
    case GameVariant.PLBadeucyDD: return new PLBadeucyDDGame(config, players, buttonIndex);
    case GameVariant.PLBadaceyDD: return new PLBadaceyDDGame(config, players, buttonIndex);
    case GameVariant.PLArchieDD: return new PLArchieDDGame(config, players, buttonIndex);
    case GameVariant.PLTenThirtyDD: return new PLTenThirtyDDGame(config, players, buttonIndex);
    case GameVariant.LimitOmahaHigh: return new LimitOmahaHighGame(config, players, buttonIndex);
    default: return new NLHGame(config, players, buttonIndex);
  }
}
