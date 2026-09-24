// Review-only diagnostics. No production source changes. Run after npm run build.
// Checks intentionally document current defects; they are not regression tests.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as E from '../../../engine/dist/index.js';
import { RoomManager } from '../../../server/dist/room-manager.js';
import { GameController } from '../../../server/dist/game-controller.js';
import { getPlayerView } from '../../../server/dist/state-filter.js';

const findings = [];
const players = (stacks) => stacks.map((chips, i) => ({id:`p${i}`,name:`P${i}`,seatIndex:i,chips,holeCards:[],bet:0,totalBet:0,folded:false,allIn:false,sittingOut:false}));
const config = (variant=E.GameVariant.NLH) => ({variant,bettingStructure:E.BettingStructure.NoLimit,maxPlayers:6,smallBlind:1,bigBlind:2,ante:0,bringIn:1,smallBet:2,bigBet:4,startingChips:100});
const make = (variant=E.GameVariant.NLH,stacks=[100,100],extra={}) => E.createGame(variant,players(stacks),0,{...config(variant),...extra});
function check(name, expected, fn) {
  try { findings.push({name,expected,observed:fn()}); console.log(`Checked ${name}`); }
  catch (e) { findings.push({name,harnessError:e.stack}); process.exitCode=1; }
}
function passive(game, max=100) {
  for(let i=0;i<max;i++) {
    const s=game.getState();
    if(s.phase==='complete') return;
    const p=s.players[s.activePlayerIndex];
    if(s.phase.startsWith('draw-')) game.discard(p.id,[]);
    else { const a=game.getAvailableActions(); game.act(p.id,a.canCheck?E.ActionType.Check:E.ActionType.Call); }
  }
  throw Error('Passive playout exceeded bound');
}
const controllers=[];
function room(mode=E.GameMode.SpecificGame,n=2) {
  const manager=new RoomManager();
  const code=manager.createRoom('s0','P0',{gameMode:mode,variant:E.GameVariant.NLH,smallBlind:1,bigBlind:2,smallBet:2,bigBet:4,startingChips:100});
  for(let i=1;i<n;i++) manager.joinRoom(`s${i}`,`P${i}`,code);
  for(let i=0;i<n;i++) manager.sitDown(`s${i}`,50);
  const state=manager.getRoom(code), events=[];
  const callbacks=Object.fromEntries(['sendHandState','sendHandComplete','sendDcChoose','broadcastCountdown','sendError','broadcastRoomState'].map(k=>[k,(...args)=>events.push({type:k,args:structuredClone(args)})]));
  const controller=new GameController(state,callbacks); state.gameController=controller; controllers.push(controller);
  return {manager,state,controller,events};
}

check('R01: repeated action after completion pays the pot twice','Completed hands reject all betting actions.',()=>{
  const g=make();g.start();passive(g);
  const before=g.getState().players.reduce((n,p)=>n+p.chips,0);
  const s=g.getState();g.act(s.players[s.activePlayerIndex].id,E.ActionType.Check);
  const after=g.getState().players.reduce((n,p)=>n+p.chips,0);
  assert(after>before); return {before,after};
});
check('R02: fold winner cards transmitted to opponent','Fold wins do not expose the winner hole cards.',()=>{
  const g=make();g.start();const s=g.getState();const folder=s.players[s.activePlayerIndex].id;
  g.act(folder,E.ActionType.Fold); const v=getPlayerView(g.getState(),folder);
  const winner=v.players.find(p=>!p.folded); assert(winner.holeCards.every(Boolean));
  return {winner:winner.id,opponentReceivedHoleCards:winner.holeCards};
});
check('R03: all-in Drawmaha skips drawing','Both players retain their required draw decision.',()=>{
  const g=make(E.GameVariant.DrawmahaHigh,[4,4]);g.start();
  let s=g.getState();g.act(s.players[s.activePlayerIndex].id,E.ActionType.Raise,4);
  s=g.getState();g.act(s.players[s.activePlayerIndex].id,E.ActionType.Call);
  s=g.getState();assert.equal(s.phase,'complete');
  return {phase:s.phase,drawActions:s.actionHistory.filter(a=>['discard','stand-pat'].includes(a.type)).length,pots:s.pots};
});
check('R04: draw deck exhaustion','Legal full-table draws recycle eligible discards without losing cards.',()=>{
  const g=make(E.GameVariant.TwoSevenTD,[100,100,100,100,100,100]);g.start();
  while(!g.getState().phase.startsWith('draw-')) {const s=g.getState(),a=g.getAvailableActions();g.act(s.players[s.activePlayerIndex].id,a.canCheck?E.ActionType.Check:E.ActionType.Call);}
  let error;
  for(let i=0;i<6;i++){try{const s=g.getState();g.discard(s.players[s.activePlayerIndex].id,[0,1,2,3,4]);}catch(e){error=e.message;break;}}
  assert.equal(error,'Deck exhausted — no cards remaining');return {error,cardCounts:g.getState().players.map(p=>p.holeCards.length)};
});
check('R05: duplicate discard indices create a six-card hand','Discard indices must be unique integers and card count must remain five.',()=>{
  const g=make(E.GameVariant.TwoSevenSD);g.start();
  while(!g.getState().phase.startsWith('draw-')) {const s=g.getState(),a=g.getAvailableActions();g.act(s.players[s.activePlayerIndex].id,a.canCheck?E.ActionType.Check:E.ActionType.Call);}
  const s=g.getState(),id=s.players[s.activePlayerIndex].id;g.discard(id,[4,4]);
  const count=g.getState().players.find(p=>p.id===id).holeCards.length;assert.equal(count,6);return {count};
});
check('R06: 2-7 wheel misclassified','Unsuited A2345 is ace-high, not a straight in deuce-to-seven.',()=>{
  const result=E.evaluate5Card27Low(['Ac','2d','3h','4s','5c'].map(E.parseCard));
  assert(result.description.includes('straight'));return result;
});
check('R07: A-5 pairs/categories misranked','Any one-pair A-5 low beats quads.',()=>{
  const quads=E.evaluate5CardLow(['Ac','Ad','Ah','As','2c'].map(E.parseCard));
  const pair=E.evaluate5CardLow(['2h','2d','3h','4s','Kc'].map(E.parseCard));
  assert(quads.value<pair.value);return {quads:quads.value,pair:pair.value,incorrectWinner:'quad aces'};
});
check('R08: Stud exposed pair loses first action to ace-high','Pair of deuces acts before unpaired AK in Stud.',()=>{
  const g=make(E.GameVariant.Stud);g.start();g.upCards.set('p0',['2c','2d'].map(E.parseCard));g.upCards.set('p1',['Ac','Kd'].map(E.parseCard));g.setFirstActorForStreet();
  assert.equal(g.getState().activePlayerIndex,1);return {firstActor:g.getState().activePlayerIndex};
});
check('R09: Razz showing hand orders by lowest rather than highest card','Exposed 23 acts before AK in Razz.',()=>{
  const g=make(E.GameVariant.Razz);g.start();g.upCards.set('p0',['Ac','Kd'].map(E.parseCard));g.upCards.set('p1',['2c','3d'].map(E.parseCard));g.setFirstActorForStreet();
  assert.equal(g.getState().activePlayerIndex,0);return {firstActor:g.getState().activePlayerIndex};
});
check('R10: Stud chooses an all-in player to act','All-in players receive cards but are skipped for betting.',()=>{
  const g=make(E.GameVariant.Stud,[100,100,100]);g.start();g.state.players[0].allIn=true;g.upCards.set('p0',['Ac','Kd'].map(E.parseCard));g.upCards.set('p1',['2c','3d'].map(E.parseCard));g.upCards.set('p2',['4c','5d'].map(E.parseCard));g.setFirstActorForStreet();
  assert(g.getState().players[g.getState().activePlayerIndex].allIn);return {firstActor:g.getState().activePlayerIndex};
});
check('R11: short all-in reopens NL betting','An incomplete raise does not reopen betting for a player who already acted.',()=>{
  const g=make(E.GameVariant.NLH,[100,15,100]);g.start();g.act('p0',E.ActionType.Raise,10);g.act('p1',E.ActionType.Raise,15);g.act('p2',E.ActionType.Call);
  const a=g.getAvailableActions();assert(a.canRaise);return {active:g.getState().players[g.getState().activePlayerIndex].id,canRaise:a.canRaise};
});
check('R12: NaN accepted as a raise','Non-finite and non-number amounts are rejected before mutation.',()=>{
  const g=make();g.start();const s=g.getState();g.act(s.players[s.activePlayerIndex].id,E.ActionType.Raise,NaN);
  assert(g.getState().players.some(p=>Number.isNaN(p.chips)));return {chipsCorrupted:true};
});
check('R13: fractional-chip splitting changes total','Pot splitting conserves chips exactly; invalid denominations are rejected.',()=>{
  const g=make(E.GameVariant.PLOHiLo,[100,100],{smallBlind:0.25,bigBlind:0.5});
  const halves=g.splitPotHalves(1.1);assert.notEqual(halves[0]+halves[1],1.1);return {pot:1.1,halves,total:halves[0]+halves[1]};
});
check('R14: host can replace a live hand','startHand is rejected while the current hand is active.',()=>{
  const r=room();r.controller.startHand();const first=r.controller.getState().id;r.controller.startHand();const second=r.controller.getState().id;
  assert.notEqual(first,second);return {first,second,replaced:true};
});
check('R15: non-chooser can select a DC game','Only the designated chooser can pick, once per choice window.',()=>{
  const r=room(E.GameMode.DealersChoice);r.controller.startHand();r.controller.handleVariantPick('p1',E.GameVariant.NLH);
  assert(r.controller.getState());return {designatedChooser:'p0',acceptedPicker:'p1',phase:r.controller.getState().phase};
});
check('R16: DC breaks when seats are not contiguous','Choice uses stable player identity rather than indexing occupied seats as physical seats.',()=>{
  const r=room(E.GameMode.DealersChoice,3);r.state.players.get('s0').sittingOut=true;r.controller.startHand();
  const errors=r.events.filter(e=>e.type==='sendError');assert(errors.some(e=>e.args[1]==='No variant selected'));return {activeSeats:[1,2],errors};
});
check('R17: disconnected player stalls later action','Leaving off-turn cannot leave the hand waiting for a departed player.',()=>{
  const r=room(E.GameMode.SpecificGame,3);r.controller.startHand();r.manager.leaveRoom('s1');r.controller.handleAction('s0',E.ActionType.Call);
  const s=r.controller.getState(),actor=s.players[s.activePlayerIndex];assert.equal(actor.id,'p1');assert(!r.state.players.has('s1'));return {actor:actor.id,hasRoomPlayer:false};
});
check('R18: queued target stack can erase winnings','A queued add-on preserves won chips and has explicit top-up semantics.',()=>{
  const r=room();r.state.players.get('s0').chips=200;r.state.players.get('s0').queuedAddOn=150;r.controller.startHand();
  const p=r.controller.getState().players.find(p=>p.id==='p0');assert.equal(p.chips+p.bet,150);return {settledStackBefore:200,queuedTarget:150,stackAtNextDeal:p.chips+p.bet};
});
check('R19: zero-stack players are dealt in','A busted player waits to rebuy and cannot stall forced-bet handling.',()=>{
  const r=room();r.state.players.get('s0').chips=0;r.state.players.get('s1').chips=0;r.controller.startHand();
  const s=r.controller.getState();assert.notEqual(s.phase,'complete');assert(s.players.every(p=>p.allIn));return {phase:s.phase,allPlayersAllIn:true,actor:s.activePlayerIndex};
});
check('R20: room destruction leaves controller alive','Destroying a room also destroys its game and timers.',()=>{
  const r=room();r.controller.startHand();r.manager.destroyRoom(r.state.code);assert(r.controller.getState());return {roomGone:!r.manager.getRoom(r.state.code),controllerStillHasGame:true};
});
check('R21: reconnect can be claimed using only display name','A rejoin requires a private player/session token.',()=>{
  const r=room();r.manager.handleDisconnect('s1');const result=r.manager.joinRoom('stranger','P1',r.state.code);assert.equal(result.playerId,'p1');return {claimedPlayer:result.playerId,credentialRequired:false};
});
for(const controller of controllers) controller.destroy();
// Grace timers created by RoomManager are cleaned up through its test-visible API.
writeFileSync(new URL('./reproductions.json',import.meta.url),JSON.stringify(findings,null,2)+'\n');
for(const finding of findings) console.log(`${finding.harnessError?'HARNESS ERROR':'REPRODUCED'} ${finding.name}${finding.harnessError?'\n'+finding.harnessError:''}`);

