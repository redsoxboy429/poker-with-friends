// Local-only socket boundary diagnostics. The child server is isolated and stopped.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {io} from '../../../node_modules/socket.io-client/build/esm/index.js';

const child=spawn(process.execPath,['server/dist/index.js'],{cwd:new URL('../../../',import.meta.url),env:{...process.env,PORT:'43179',NODE_ENV:'development'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const event=(socket,name)=>Promise.race([once(socket,name).then(([d])=>d),pause(3000).then(()=>{throw Error('Timeout '+name);})]);
const clients=[];const results=[];
try{
  for(let i=0;i<100&&!output.includes('Poker server listening');i++)await pause(50);
  assert(output.includes('Poker server listening'));
  for(let i=0;i<2;i++){const socket=io('http://localhost:43179',{transports:['websocket'],reconnection:false});clients.push(socket);await event(socket,'connect');}
  const [host,peer]=clients;
  const created=event(host,'room-created');host.emit('create-room',{playerName:'Host',settings:{gameMode:'specific',variant:'nlh',smallBlind:1,bigBlind:2,smallBet:2,bigBet:4,startingChips:100}});const {roomCode}=await created;
  const joined=event(peer,'room-joined');peer.emit('join-room',{roomCode,playerName:'Peer'});await joined;
  let state=event(host,'room-state');host.emit('sit-down',{buyInBB:50});await state;
  state=event(peer,'room-state');peer.emit('sit-down',{buyInBB:50});await state;
  const dealt=event(host,'hand-state');host.emit('start-hand');await dealt;
  const stale=event(host,'hand-state');host.emit('join-room',{roomCode,playerName:'Host'}); // Connected duplicate name: should reject; retain original seat.
  // Avoid awaiting stale: this request intentionally does not deliver a hand state.
  stale.catch(()=>{});
  // A malformed payload is an untrusted boundary input, never a browser action.
  const exit=Promise.race([once(child,'exit').then(([code,signal])=>({code,signal})),pause(2000).then(()=>null)]);
  peer.emit('action',null);
  const stopped=await exit;assert(stopped&&stopped.code!==0);
  results.push({name:'S01: null action payload crashes the server process',exit:stopped,error:output.split('\n').filter(l=>/TypeError|Cannot destructure/.test(l))});
  writeFileSync(new URL('./socket-reproductions.json',import.meta.url),JSON.stringify(results,null,2)+'\n');console.log('REPRODUCED '+results[0].name);
}finally{for(const socket of clients)socket.disconnect();if(child.exitCode===null)child.kill();}
