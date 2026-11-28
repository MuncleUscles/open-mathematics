import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {DOMAIN,canonical,bytes,hex,digest,validateQuestion,aggregate,scoreHistory,leaderboard,resolveCheckpoint} from '../forecasting/core.mjs';
import {createWorker} from '../forecasting/worker.mjs';
import {captureNative} from '../forecasting/native.mjs';
const registry=JSON.parse(fs.readFileSync(new URL('../forecasting/questions.json',import.meta.url))),q=registry[0],start=Date.parse(q.opensAt),end=Date.parse(q.closesAt);
function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(fs.readFileSync(new URL('../forecasting/drizzle/0000_modern_scarlet_witch.sql',import.meta.url),'utf8'));
 return {sql,prepare(text){
  return {bind(...args){
   const statement=sql.prepare(text);
   return {
    async first(){return statement.get(...args)||null;},
    async all(){return {results:statement.all(...args)};},
    async run(){const result=statement.run(...args);return {meta:{changes:result.changes}};}
   };
  }};
 }};
}
async function signer(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']),j=await crypto.subtle.exportKey('jwk',pair.publicKey),publicKey={kty:j.kty,crv:j.crv,x:j.x,y:j.y},participant=await digest(publicKey);return {participant,async sign(overrides={}){const forecast={domain:DOMAIN,questionId:q.id,questionHash:await digest(q),probability:70,reason:'A public explanation.',revision:1,previous:null,nonce:hex(crypto.getRandomValues(new Uint8Array(16))),...overrides};return {forecast,publicKey,signature:hex(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,bytes(canonical(forecast))))};}};}
const url='https://pnp-forecast-desk.freshalbum5.chatgpt.site';
function harness(now=start+1000,options={}){const DB=database(),worker=createWorker({clock:()=>now,...options});return {DB,setTime:t=>now=t,async request(path,body,headers={}){const r=await worker.fetch(new Request(url+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),{DB},{});return {status:r.status,body:await r.json(),headers:r.headers};}};}
test('question registry has fixed times, criteria, sources and scoring',()=>{for(const q of registry)assert.equal(validateQuestion(q),q);assert.throws(()=>validateQuestion({...q,closesAt:q.opensAt}));});
test('aggregation needs five identities, uses latest revisions, excludes late calls',()=>{const rows=Array.from({length:5},(_,i)=>({participant:String(i),revision:1,acceptedAt:new Date(start+100).toISOString(),probability:i*20}));assert.equal(aggregate(rows.slice(0,4),q,end).probability,null);assert.equal(aggregate(rows,q,end).probability,40);rows.push({...rows[0],revision:2,probability:100});assert.equal(aggregate(rows,q,end).probability,60);rows.push({participant:'late',revision:1,acceptedAt:q.closesAt,probability:100});assert.equal(aggregate(rows,q,end).count,5);});
test('time weighted Brier never backdates revisions, neutral before first, excludes late rankings',()=>{const middle=start+(end-start)/2,rs=[{probability:20,revision:1,acceptedAt:q.opensAt},{probability:100,revision:2,acceptedAt:new Date(middle).toISOString()}];assert.ok(Math.abs(scoreHistory(q,rs,1).loss-.32)<1e-9);const late=[{probability:100,revision:1,acceptedAt:new Date(end-1).toISOString()}];assert.equal(scoreHistory(q,late,1).eligible,false);assert.ok(scoreHistory(q,late,1).loss>.249);assert.throws(()=>scoreHistory(q,rs,null));assert.deepEqual(leaderboard([q],rs.map(r=>({...r,questionId:q.id,participant:'x'})),[{questionId:q.id,status:'inconclusive'}]),[]);});
test('signed publish, idempotence, persisted history, forged edit, replay and revision race',async()=>{const h=harness(),a=await signer(),b=await signer(),signed=await a.sign(),one=await h.request('/api/forecasts',signed);assert.equal(one.status,201);assert.equal(one.body.participant,a.participant);assert.equal((await h.request('/api/forecasts',signed)).body.receipt,one.body.receipt);assert.equal((await h.request('/api/forecasts',{...signed,forecast:{...signed.forecast,probability:99}})).status,400);assert.equal((await h.request('/api/forecasts',{...signed,publicKey:(await b.sign()).publicKey})).status,400);h.setTime(start+61001);const two=await a.sign({revision:2,previous:one.body.receipt,probability:80});assert.equal((await h.request('/api/forecasts',two)).status,201);assert.equal((await h.request('/api/forecasts',await a.sign({revision:2,previous:one.body.receipt,probability:90}))).status,400);const audit=await h.request('/api/audit?participant='+a.participant);assert.equal(audit.body.records.length,2);assert.deepEqual(audit.body.records.map(r=>r.probability),[70,80]);const desk=await h.request('/api/questions');assert.equal(desk.body.questions[0].aggregate.count,1);assert.equal(desk.body.questions[0].aggregate.probability,null);assert.ok(desk.body.questions[0].trend.length);assert.equal((await h.request('/api/leaderboard')).body.ranks.length,0);});
test('question version, open/close times, percentages, rapid changes and CORS fail closed',async()=>{const h=harness(),a=await signer();for(const invalid of [{probability:101},{probability:-1},{probability:20.5},{questionHash:'0'.repeat(64)},{domain:'another service'}])assert.equal((await h.request('/api/forecasts',await a.sign(invalid))).status,400);h.setTime(start-1);assert.equal((await h.request('/api/forecasts',await a.sign())).status,400);h.setTime(end);assert.equal((await h.request('/api/forecasts',await a.sign())).status,400);h.setTime(start+1000);const one=await h.request('/api/forecasts',await a.sign());assert.equal((await h.request('/api/forecasts',await a.sign({revision:2,previous:one.body.receipt}))).status,400);assert.equal((await h.request('/api/forecasts',await a.sign(),{Origin:'https://evil.example'})).status,403);assert.equal((await h.request('/api/questions',null,{Origin:'https://muncleuscles.github.io'})).headers.get('Access-Control-Allow-Origin'),'https://muncleuscles.github.io');});
test('persisted question commitment rejects a rewritten rule and audit pagination is bounded',async()=>{const h=harness();await h.request('/api/questions');h.DB.sql.prepare('UPDATE questions SET hash = ? WHERE id = ?').run('0'.repeat(64),q.id);assert.equal((await h.request('/api/questions')).status,503);});
const source=q.source;
function evidence(){return {source,startedAt:q.checkpointAt,completedAt:new Date(Date.parse(q.checkpointAt)+1000).toISOString(),before:{state_revision:'2',research_records:2},after:{state_revision:'2',total_impact_points:'4'},records:[1,2].map(i=>({status:'credited',evidence:{id:String(i),evidence_kind:'formal',verification:'verified'}})),complete:true};}
test('resolution requires complete stable finalized evidence inside the precommitted window',()=>{assert.equal(resolveCheckpoint(q,evidence()).outcome,1);const no=evidence();no.records[1].status='rejected';assert.equal(resolveCheckpoint(q,no).outcome,0);assert.equal(resolveCheckpoint(registry[1],evidence()).outcome,1);for(const e of [{...evidence(),complete:false},{...evidence(),source:{...source,contract:'other'}},{...evidence(),records:[]},{...evidence(),completedAt:'2027-01-01T00:00:00.000Z'},{...evidence(),after:{state_revision:'3'}}])assert.throws(()=>resolveCheckpoint(q,e));});
test('missed checkpoint is inconclusive and immutable, never NO',async()=>{const h=harness(Date.parse(q.resolutionDeadline)+1);const tick=await h.request('/api/checkpoint',{});assert.equal(tick.status,200);assert.ok(tick.body.resolutions.every(r=>r.status==='inconclusive'&&!('outcome' in r)));assert.deepEqual((await h.request('/api/leaderboard')).body.ranks,[]);});
test('native capture reads latest-final and refuses partial pages, configuration drift or revision drift',async()=>{const records=[{evidence:{id:'one',contract:source.contract,problem:'p-vs-np',policy:source.policyHash},status:'credited'}];let phase=0;const client={getChainId:async()=>61999,readContract:async options=>{assert.equal(options.transactionHashVariant,'latest-final');return options.functionName==='get_config'?{policy:source.policyHash,problem:'p-vs-np',repository:'MuncleUscles/p-vs-np'}:options.functionName==='get_federation_state'?{state_revision:String(phase),research_records:1}:options.functionName==='list_contributions'?{items:['one'],total:1,next_offset:null}:records[0];}};assert.equal((await captureNative(source,{client})).records.length,1);const bad={...client,readContract:async opts=>opts.functionName==='list_contributions'?{items:[],total:1,next_offset:null}:client.readContract(opts)};await assert.rejects(captureNative(source,{client:bad}),/Incomplete/);phase=0;const drift={...client,readContract:async opts=>{const value=await client.readContract(opts);if(opts.functionName==='get_federation_state')phase++;return value;}};await assert.rejects(captureNative(source,{client:drift}),/changed/);});

test('finalized checkpoint publishes evidence and deterministic rankings, ignoring caller-supplied outcome',async()=>{
 const h=harness(start+1,{capture:async()=>evidence()}),a=await signer();assert.equal((await h.request('/api/forecasts',await a.sign({probability:80}))).status,201);
 h.setTime(Date.parse(q.checkpointAt)+10);const resolved=await h.request('/api/checkpoint',{outcome:0,evidence:'attacker'});assert.equal(resolved.status,200);assert.equal(resolved.body.resolutions[0].outcome,1);assert.equal(resolved.body.resolutions[0].evidence.complete,true);assert.equal(resolved.body.resolutions[0].evidenceHash.length,64);
 const ranks=(await h.request('/api/leaderboard')).body.ranks;assert.equal(ranks.length,1);assert.equal(ranks[0].participant,a.participant);assert.ok(Math.abs(ranks[0].brier-.04)<1e-6);
 h.setTime(Date.parse(q.resolutionDeadline)+1);assert.equal((await h.request('/api/checkpoint',{})).body.resolutions[0].outcome,1);
});

test('each secondary checkpoint reads only the problem bound to its source contract and policy',async()=>{
 const deployments=JSON.parse(fs.readFileSync(new URL('../public/open/wallet-tracks.json',import.meta.url)));
 for(const track of ['yang-mills','post-quantum-signatures']){
  const {ledger,policy}=deployments[track],source={chainId:61999,contract:ledger,policyHash:policy,problem:track};
  let problem=track;
  const client={getChainId:async()=>61999,readContract:async({functionName,address})=>{
   assert.equal(address,ledger);
   if(functionName==='get_config')return {problem:track,repository:'MuncleUscles/'+track,policy};
   if(functionName==='get_federation_state')return {research_records:1,state_revision:'1'};
   if(functionName==='list_contributions')return {total:1,items:['local'],next_offset:null};
   return {evidence:{id:'local',problem,policy,contract:ledger}};
  }};
  assert.equal((await captureNative(source,{client})).records.length,1);
  problem='p-vs-np';
  await assert.rejects(captureNative(source,{client}),/scope mismatch/);
 }
});

test('a missed read on one track leaves its call open for a later checkpoint and settles the other independently',async()=>{
 const [ym,pqc]=registry.slice(2);
 let offline=true;
 const calls=[];
 const h=harness(Date.parse(ym.checkpointAt)+1000,{capture:async source=>{
  calls.push(source.problem);
  if(source.problem===ym.source.problem&&offline)throw Error('unavailable');
  return {...evidence(),source,startedAt:ym.checkpointAt,completedAt:new Date(Date.parse(ym.checkpointAt)+1000).toISOString()};
 }});
 const first=await h.request('/api/checkpoint',{});
 assert.equal(first.status,200);
 assert.deepEqual(first.body.waiting,[ym.id]);
 assert.equal(first.body.resolutions.find(r=>r.questionId===pqc.id).outcome,1);
 offline=false;
 const second=await h.request('/api/checkpoint',{});
 assert.equal(second.body.resolutions.find(r=>r.questionId===ym.id).outcome,0);
 assert.deepEqual(calls,['yang-mills','post-quantum-signatures','yang-mills']);
});
