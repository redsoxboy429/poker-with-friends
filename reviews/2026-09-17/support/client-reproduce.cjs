// Nonvisual React component/effect diagnostics; no browser or screenshot testing.
// Prerequisite: temporary react/react-test-renderer 19.2.4 under %TEMP%/poker-review-react.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const ts=require('../../../node_modules/typescript');
const assert=require('node:assert/strict');
const testRequire=createRequire(path.join(process.env.TEMP,'poker-review-react/package.json'));
const React=testRequire('react'),Renderer=testRequire('react-test-renderer');
const {act}=Renderer;
global.IS_REACT_ACT_ENVIRONMENT=true;
let E,current,clock=0,timerId=0;const timers=new Map(),results=[];
const actions=new Proxy({}, {get:()=>()=>{}});
const timer=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:clock+ms});return id;};
function load(file,overrides={},append='') {
  const source=fs.readFileSync(path.resolve(__dirname,'../../../',file),'utf8')+append;
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText.replaceAll('import.meta.env.VITE_SERVER_URL','undefined');
  const exports={};const context={exports,module:{exports},console,window:{location:{port:'5173',origin:'http://localhost:5173'}},localStorage:{getItem:()=>''},navigator:{},setTimeout:timer,clearTimeout:id=>timers.delete(id),require:id=>{
    if(id in overrides)return overrides[id];
    if(id==='react'||id==='react/jsx-runtime')return testRequire(id);
    if(id.includes('engine-wrapper'))return E;
    if(id==='react-router-dom')return {useNavigate:()=>()=>{},useParams:()=>({code:'TEST'})};
    if(id==='socket.io-client')return {io:()=>{}};
    throw Error('Unexpected module: '+id);
  }};
  vm.runInNewContext(output,context,{filename:file});return context.module.exports;
}
async function tick(ms){const end=clock+ms;while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;clock=next[1].at;timers.delete(next[0]);await act(()=>next[1].fn());}clock=end;}
function player(chips,i){return {id:`p${i}`,name:`P${i}`,seatIndex:i,chips,holeCards:[],bet:0,totalBet:0,folded:false,allIn:false,sittingOut:false};}
function game(variant=E.GameVariant.NLH,stacks=[100,100],button=0){const g=E.createGame(variant,stacks.map(player),button,{variant,bettingStructure:E.BettingStructure.NoLimit,maxPlayers:6,smallBlind:1,bigBlind:2,ante:0,bringIn:1,smallBet:2,bigBet:4,startingChips:100});g.start();return g;}
function mockComponents(){return Object.fromEntries(['CardDisplay','PlayerSeat','BetChip','CasinoChip','PotDisplay','WinDisplay','ActionPanel','GameLog','decomposeChips'].map(name=>[name,name==='decomposeChips'?()=>[]:(props)=>React.createElement(name,props)]));}
(async()=>{
  E=await import('../../../engine/dist/index.js');
  const socket=load('client/src/useSocket.ts',{},'\nexports.reviewReducer=socketReducer; exports.reviewInitial=INITIAL_STATE;');
  const constants=load('client/src/constants.ts');
  const Table=load('client/src/MultiplayerTable.tsx',{'./useSocket':{useSocket:()=>[current,actions]},'./constants':constants,'./components':mockComponents()}).default;
  const room={code:'TEST',hostSocketId:'s0',state:'playing',maxSeats:6,settings:{gameMode:'specific',variant:'nlh',smallBlind:1,bigBlind:2},players:[0,1].map(i=>({name:`P${i}`,seatIndex:i,chips:100,connected:true,isHost:i===0,sittingOut:false,seated:true}))};
  const reset=()=>{timers.clear();clock=0;current={...socket.reviewInitial,status:'connected',roomState:room,yourPlayerId:'p0',isHost:true};};
  let renderer;
  const dispatch=async(event)=>{current=socket.reviewReducer(current,event);await act(()=>{if(renderer)renderer.update(React.createElement(Table));else renderer=Renderer.create(React.createElement(Table));});};
  const hand=(g)=>({type:'HAND_STATE',handState:structuredClone(g.getState()),availableActions:g.getAvailableActions(),isYourTurn:false});
  const complete=(g)=>({type:'HAND_COMPLETE',finalState:structuredClone(g.getState()),winners:g.getWinners(),handDescriptions:{},lastAction:g.getState().actionHistory.at(-1)});
  const seats=()=>renderer.root.findAllByType('PlayerSeat').map(n=>({id:n.props.player.id,count:n.props.dealtCardCount,chips:n.props.player.chips,showCards:n.props.showCards}));
  reset();const g=game();await dispatch(hand(g));await tick(2000);g.act('p0',E.ActionType.Fold);await dispatch(complete(g));await tick(250);const before=seats();const next=game(E.GameVariant.NLH,[99,101],1);await dispatch(hand(next));await tick(2500);const after=seats();
  assert.equal(after.find(p=>p.id==='p0').count,0);results.push({name:'C01: next hand leaves previous folder at zero displayed cards',before,after});await act(()=>renderer.unmount());renderer=null;
  reset();const stud=game(E.GameVariant.Stud,[2,2]);await dispatch(hand(stud));await tick(2000);let guard=0;while(stud.getState().phase!=='complete'&&guard++<20){const s=stud.getState(),a=stud.getAvailableActions();stud.act(s.players[s.activePlayerIndex].id,a.canRaise?E.ActionType.Raise:a.canCall?E.ActionType.Call:E.ActionType.Check,a.canRaise?a.maxRaise:undefined);}assert.equal(stud.getState().phase,'complete');await dispatch(complete(stud));const immediate=seats();await tick(800);const settled=seats();assert(immediate.every(p=>p.count===7));assert(settled.every(p=>p.showCards));results.push({name:'C02: Stud runout jumps from three to seven cards with only showdown delay',immediate,at800ms:settled});await act(()=>renderer.unmount());renderer=null;
  reset();const nlh=game(E.GameVariant.NLH,[10,10]);await dispatch(hand(nlh));await tick(2000);nlh.act('p0',E.ActionType.Raise,10);nlh.act('p1',E.ActionType.Call);await dispatch(complete(nlh));const early=seats();assert(early.some(p=>p.chips>=10));results.push({name:'C03: settled stacks are displayed before slow board runout finishes',atRunoutStart:early,boardCardsShown:renderer.root.findAll(n=>n.type==='div'&&n.props.style?.opacity===1).length});await act(()=>renderer.unmount());renderer=null;
  const Panel=load('client/src/components/ActionPanel.tsx').ActionPanel;let sent;
  const options={canFold:true,canCheck:false,canCall:true,callAmount:2,canBet:false,minBet:0,maxBet:0,canRaise:true,minRaise:3,maxRaise:3};
  await act(()=>{renderer=Renderer.create(React.createElement(Panel,{actions:options,onAction:(...args)=>sent=args,bettingStructure:E.BettingStructure.NoLimit,minChip:0.25}));});
  const button=renderer.root.findAllByType('button').find(n=>n.children.includes('Raise '));assert(button);await act(()=>button.props.onClick());assert.equal(sent[1],0);results.push({name:'C04: exact all-in raise button sends zero when minRaise equals maxRaise',legalRaiseTo:3,sent});await act(()=>renderer.unmount());
  fs.writeFileSync(path.join(__dirname,'client-reproductions.json'),JSON.stringify(results,null,2)+'\n');for(const r of results)console.log('REPRODUCED '+r.name);
})().catch(e=>{console.error(e);process.exitCode=1;});
