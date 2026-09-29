// Nonvisual React component/effect diagnostics; no browser or screenshot testing.
// Runs against the actual component effects with a deterministic clock.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const ts=require('../../node_modules/typescript');
const assert=require('node:assert/strict');
const testRequire=createRequire(__filename);
const React=testRequire('react'),Renderer=testRequire('react-test-renderer');
const {act}=Renderer;
global.IS_REACT_ACT_ENVIRONMENT=true;
let E,current,clock=0,timerId=0;const timers=new Map(),results=[];
const sentActions=[];const actions=new Proxy({}, {get:(_,k)=>(...a)=>{if(k==='sendAction'||k==='sendDiscard')sentActions.push([k,...a]);}});
const timer=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:clock+ms});return id;};
function load(file,overrides={},append='') {
  const source=fs.readFileSync(path.resolve(__dirname,'../../',file),'utf8')+append;
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText.replaceAll('import.meta.env.VITE_SERVER_URL','undefined');
  const exports={};const context={exports,module:{exports},console,window:{location:{port:'5173',origin:'http://localhost:5173'}},localStorage:{getItem:()=>''},navigator:{},setTimeout:timer,clearTimeout:id=>timers.delete(id),require:id=>{
    if(id in overrides)return overrides[id];
    if(id==='react'||id==='react/jsx-runtime')return testRequire(id);
    if(id.includes('engine-wrapper'))return {...E, PLAYABLE_VARIANTS: E.SELECTABLE_VARIANTS};
    if(id==='@engine/presentation.ts')return E;
    if(id==='react-router-dom')return {useNavigate:()=>()=>{},useParams:()=>({code:'TEST'})};
    if(id==='socket.io-client')return {io:()=>{}};
    throw Error('Unexpected module: '+id);
  }};
  vm.runInNewContext(output,context,{filename:file});return context.module.exports;
}
async function tick(ms){const end=clock+ms;while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;clock=next[1].at;timers.delete(next[0]);await act(()=>next[1].fn());}clock=end;}
function player(chips,i){return {id:`p${i}`,name:`P${i}`,seatIndex:i,chips,holeCards:[],bet:0,totalBet:0,folded:false,allIn:false,sittingOut:false};}
function game(variant=E.GameVariant.NLH,stacks=[100,100],button=0){const g=E.createGame(variant,stacks.map(player),button,{variant,bettingStructure:E.BettingStructure.NoLimit,maxPlayers:6,smallBlind:1,bigBlind:2,ante:0,bringIn:1,smallBet:2,bigBet:4,startingChips:100});g.start();return g;}
function mockComponents(){return Object.fromEntries(['CardDisplay','PlayerSeat','BetChip','CasinoChip','PotDisplay','WinDisplay','ActionPanel','PreActionPanel','GameLog','decomposeChips'].map(name=>[name,name==='decomposeChips'?()=>[]:(props)=>React.createElement(name,props)]));}
(async()=>{
  E=await import('../../engine/dist/index.js');
  const socket=load('client/src/useSocket.ts',{},'\nexports.reviewReducer=socketReducer; exports.reviewInitial=INITIAL_STATE;');
  const constants=load('client/src/constants.ts');
  const pre=load('client/src/pre-action.ts');
  const Table=load('client/src/MultiplayerTable.tsx',{'./useSocket':{useSocket:()=>[current,actions]},'./constants':constants,'./pre-action':pre,'./components':mockComponents()}).default;
  const room={code:'TEST',hostSocketId:'s0',state:'playing',maxSeats:6,settings:{gameMode:'specific',variant:'nlh',smallBlind:1,bigBlind:2},players:[0,1].map(i=>({name:`P${i}`,seatIndex:i,chips:100,connected:true,isHost:i===0,sittingOut:false,seated:true}))};
  const reset=()=>{timers.clear();clock=0;current={...socket.reviewInitial,status:'connected',roomState:room,yourPlayerId:'p0',isHost:true};};
  let renderer;
  const dispatch=async(event)=>{current=socket.reviewReducer(current,event);await act(()=>{if(renderer)renderer.update(React.createElement(Table));else renderer=Renderer.create(React.createElement(Table));});};
  const hand=(g)=>({type:'HAND_STATE',handState:structuredClone(g.getState()),availableActions:g.getAvailableActions(),isYourTurn:false});
  const complete=(g)=>({type:'HAND_COMPLETE',finalState:structuredClone(g.getState()),winners:g.getWinners(),handDescriptions:{},lastAction:g.getState().actionHistory.at(-1)});
  const seats=()=>renderer.root.findAllByType('PlayerSeat').map(n=>({id:n.props.player.id,count:n.props.dealtCardCount,chips:n.props.player.chips,showCards:n.props.showCards}));
  reset();const g=game();await dispatch(hand(g));await tick(2000);g.act('p0',E.ActionType.Fold);await dispatch(complete(g));await tick(250);const before=seats();const next=game(E.GameVariant.NLH,[99,101],1);await dispatch(hand(next));await tick(2500);const after=seats();
  assert.equal(after.find(p=>p.id==='p0').count,2);results.push({name:'C01: next hand deals cards to the previous folder',before,after});await act(()=>renderer.unmount());renderer=null;
  reset();const stud=game(E.GameVariant.Stud,[2,2]);await dispatch(hand(stud));await tick(2000);let guard=0;while(stud.getState().phase!=='complete'&&guard++<20){const s=stud.getState(),a=stud.getAvailableActions();stud.act(s.players[s.activePlayerIndex].id,a.canRaise?E.ActionType.Raise:a.canCall?E.ActionType.Call:a.canBet?E.ActionType.Bet:E.ActionType.Check,a.canRaise?a.maxRaise:a.canBet?a.minBet:undefined);}assert.equal(stud.getState().phase,'complete');await dispatch(complete(stud));const immediate=seats();await tick(800);const settled=seats();assert(immediate.every(p=>p.count===3));assert(settled.every(p=>p.showCards && p.count===3));await tick(1700);assert(seats().every(p=>p.count===4));await tick(10000);assert(seats().every(p=>p.count===7));results.push({name:'C02: Stud reveals existing hands then deals remaining streets slowly',immediate,at800ms:settled});await act(()=>renderer.unmount());renderer=null;
  reset();const nlh=game(E.GameVariant.NLH,[10,10]);await dispatch(hand(nlh));await tick(2000);nlh.act('p0',E.ActionType.Raise,10);nlh.act('p1',E.ActionType.Call);await dispatch(complete(nlh));const early=seats();assert(early.every(p=>p.chips===0));await tick(10000);assert.equal(seats().reduce((sum,p)=>sum+p.chips,0),20);results.push({name:'C03: awards are withheld until the runout finishes',atRunoutStart:early,boardCardsShown:renderer.root.findAll(n=>n.type==='div'&&n.props.style?.opacity===1).length});await act(()=>renderer.unmount());renderer=null;
  reset();current.dcChoosing=true;await act(()=>{renderer=Renderer.create(React.createElement(Table));});assert(renderer.root.findAllByType('button').length>=9);await act(()=>renderer.unmount());renderer=null;
  // C05-C08: pre-actions (acting before your turn) and pre-selected discards
  const J=x=>JSON.parse(JSON.stringify(x));const turn=(g)=>({...hand(g),isYourTurn:g.getState().players[g.getState().activePlayerIndex].id==='p0'});
  const prePanel=()=>renderer.root.findAllByType('PreActionPanel')[0];
  reset();sentActions.length=0;let g5=game(E.GameVariant.NLH,[100,100],1);await dispatch(turn(g5));await tick(2500);
  assert.deepEqual(J(prePanel().props.choices.map(c=>c.kind)),['fold','check','call-any']);
  await act(()=>prePanel().props.onSelect('call-any'));g5.act('p1',E.ActionType.Raise,6);await dispatch(turn(g5));await tick(10);
  assert.deepEqual(sentActions.at(-1),['sendAction',E.ActionType.Call,undefined]);results.push({name:'C05: Call Any fires a call when the turn arrives after a raise',sent:sentActions.at(-1)});await act(()=>renderer.unmount());renderer=null;
  reset();sentActions.length=0;g5=game(E.GameVariant.NLH,[100,100],1);await dispatch(turn(g5));await tick(2500);
  await act(()=>prePanel().props.onSelect('check'));g5.act('p1',E.ActionType.Raise,6);await dispatch(turn(g5));await tick(10);
  assert.equal(sentActions.length,0);assert(renderer.root.findAllByType('ActionPanel').length===1);results.push({name:'C06: Check is dropped when a raise changes the amount; normal panel shown'});await act(()=>renderer.unmount());renderer=null;
  reset();sentActions.length=0;g5=game(E.GameVariant.NLH,[100,100],1);await dispatch(turn(g5));await tick(2500);
  await act(()=>prePanel().props.onSelect('fold'));g5.act('p1',E.ActionType.Call);await dispatch(turn(g5));await tick(10);
  assert.deepEqual(sentActions.at(-1),['sendAction',E.ActionType.Check,undefined]);results.push({name:'C07: Check/Fold checks when checking is free'});await act(()=>renderer.unmount());renderer=null;
  const lim={canFold:true,canCheck:false,canCall:true,callAmount:2,canBet:false,minBet:0,maxBet:0,canRaise:false,minRaise:0,maxRaise:0};
  assert.deepEqual(J(pre.resolvePreAction({kind:'raise-any',toCall:2,round:'r'},lim)),{type:E.ActionType.Call});
  assert.deepEqual(J(pre.resolvePreAction({kind:'raise',toCall:2,round:'r'},{...lim,canRaise:true,minRaise:6,maxRaise:6})),{type:E.ActionType.Raise,amount:6});
  assert.equal(pre.resolvePreAction({kind:'raise',toCall:1,round:'r'},{...lim,canRaise:true,minRaise:6,maxRaise:6}),null);
  assert.equal(pre.resolvePreAction({kind:'call-any',toCall:0,round:'r'},{...lim,canFold:false,canCall:false,canBet:true,betOptions:[1,2]}),null);
  assert.deepEqual(J(pre.preActionChoices(2,4,true).map(c=>c.kind)),['fold','call','call-any','raise','raise-any']);
  assert.deepEqual(J(pre.preActionChoices(2,4,false).map(c=>c.kind)),['fold','call','call-any']);
  results.push({name:'C08: limit Raise / Raise Any (calls when capped); big-bet games offer no raise'});
  reset();sentActions.length=0;const td=E.createGame(E.GameVariant.TwoSevenTD,[100,100].map(player),1,{variant:E.GameVariant.TwoSevenTD,bettingStructure:E.BettingStructure.FixedLimit,maxPlayers:6,smallBlind:1,bigBlind:2,ante:0,bringIn:0,smallBet:2,bigBet:4,startingChips:100});td.start();
  await dispatch(turn(td));await tick(2500);const mySeat=()=>renderer.root.findAllByType('PlayerSeat').find(n=>n.props.player.id==='p0');
  assert.equal(mySeat().props.isDrawing,true);await act(()=>mySeat().props.onCardClick(1));await act(()=>mySeat().props.onCardClick(3));
  const drawToggle=()=>renderer.root.findAllByType('PreActionPanel').find(n=>n.props.choices[0].kind==='draw');
  assert.equal(drawToggle().props.choices[0].label,'Draw 2');await act(()=>drawToggle().props.onSelect('draw'));assert.equal(drawToggle().props.selected,'draw');
  await act(()=>mySeat().props.onCardClick(3));assert.equal(drawToggle().props.selected,null);assert.equal(drawToggle().props.choices[0].label,'Draw 1');
  await act(()=>mySeat().props.onCardClick(3));
  td.act('p1',E.ActionType.Call);td.act('p0',E.ActionType.Check);await dispatch(turn(td));await tick(10);
  assert.equal(td.getState().phase,'draw-1');assert.deepEqual(J([...mySeat().props.selectedDiscardIndices].sort()),[1,3]);assert.equal(sentActions.length,0);
  results.push({name:'C09: discards picked during betting are still selected when the draw starts (no auto-draw); changing cards un-ticks Draw N'});await act(()=>renderer.unmount());renderer=null;
  reset();sentActions.length=0;const td2=E.createGame(E.GameVariant.TwoSevenTD,[100,100].map(player),1,{variant:E.GameVariant.TwoSevenTD,bettingStructure:E.BettingStructure.FixedLimit,maxPlayers:6,smallBlind:1,bigBlind:2,ante:0,bringIn:0,smallBet:2,bigBet:4,startingChips:100});td2.start();
  await dispatch(turn(td2));await tick(2500);await act(()=>mySeat().props.onCardClick(0));await act(()=>mySeat().props.onCardClick(4));await act(()=>drawToggle().props.onSelect('draw'));
  td2.act('p1',E.ActionType.Call);td2.act('p0',E.ActionType.Check);await dispatch(turn(td2));await tick(10);
  assert.deepEqual(J(sentActions.at(-1)),['sendDiscard',[0,4]]);
  results.push({name:'C10: ticked Draw 2 sends the two picked discards when the draw comes'});await act(()=>renderer.unmount());renderer=null;
  const Panel=load('client/src/components/ActionPanel.tsx').ActionPanel;let sent;
  const options={canFold:true,canCheck:false,canCall:true,callAmount:2,canBet:false,minBet:0,maxBet:0,canRaise:true,minRaise:3,maxRaise:3};
  await act(()=>{renderer=Renderer.create(React.createElement(Panel,{actions:options,onAction:(...args)=>sent=args,bettingStructure:E.BettingStructure.NoLimit,minChip:0.25}));});
  const button=renderer.root.findAllByType('button').find(n=>n.children.includes('Raise '));assert(button);await act(()=>button.props.onClick());assert.equal(sent[1],3);results.push({name:'C04: exact all-in raise sends the legal amount',legalRaiseTo:3,sent});await act(()=>renderer.unmount());
  assert.equal(constants.ALL_VARIANTS.slice().sort().join(','), E.SELECTABLE_VARIANTS.slice().sort().join(','));
  assert.equal(timers.size,0);
  for(const r of results)console.log('PASS '+r.name);
  console.log('PASS ten-game selector and unmount timer cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
