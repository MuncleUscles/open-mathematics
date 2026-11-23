import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {abi,createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {CalldataAddress} from 'genlayer-js/types';
import {captureNative,boundedReadFetch,writeCapture} from '../capture-native.mjs';
import {decodeRaw,boundedJSON} from '../typed-values.mjs';
const raw=value=>'0x'+Buffer.from(abi.calldata.encode(value)).toString('hex');
const sha=value=>createHash('sha256').update(value).digest('hex');
const contract='0x'+'1'.repeat(40),wallet='0x'+'2'.repeat(40),reporter='0x'+'3'.repeat(40);
const sourceBytes=Buffer.from('reviewed source'),policyBytes=Buffer.from('reviewed policy');
const deployment={protocolVersion:3,chainId:61999,contract,codeHash:sha(sourceBytes),policy:sha(policyBytes)};
const tx=(n,status='FINALIZED')=>({hash:'0x'+n.toString(16).padStart(64,'0'),from_address:wallet,to_address:contract,status});
function fixture({caseCount=0,history=[tx(1)],historyAfter=history,changeIndexes=false,capacityMismatch=false,changeWalletPoints=false,changeCases=false,sourceError=null,source=sourceBytes.toString('base64')}={}){
 const pointReads=new Map();const calls=[],ids=Array.from({length:caseCount},(_,i)=>'case-'+i),pages=[];let historyPass=0,indexPass=0,casePass=0;
 const client={
  async request(request){calls.push(request);if(request.method==='eth_chainId')return '0x'+(61999).toString(16);if(request.method==='sim_getTransactionsForAddress'){assert.deepEqual(request.params,[contract]);return historyPass++?historyAfter:history;}if(request.method==='gen_getContractCode'){if(sourceError)throw sourceError;return source;}throw Error('Unexpected RPC');},
  async readContract(request){calls.push(request);assert.equal(request.address,contract);assert.equal(request.rawReturn,true);assert.equal(request.jsonSafeReturn,false);assert.equal(request.transactionHashVariant,'latest-final');const {functionName:name,args}=request;let value;
   if(name==='list_contributions')value=indexPass++&&changeIndexes?['proof-one','proof-two']:['proof-one'];
   else if(name==='list_case_page'){assert.equal(typeof args[0],'bigint');assert.equal(args[1],100n);pages.push(Number(args[0]));if(args[0]===0n)casePass++;const indexed=casePass>1&&changeCases?[...ids,'case-new']:ids;value=indexed.slice(Number(args[0]),Number(args[0]+args[1]));}
   else if(name==='get_affiliations')value=[{wallet,side:'shared',changed_at:'1',history:[]}];
   else if(name==='get_external_authors')value=[];
   else if(name==='get_problem')value={id:'p-vs-np',status:'open',external_solutions:[]};
   else if(name==='list_review_cases')value=ids.slice(-100);
   else if(name==='get')value={evidence:{id:args[0],wallet},status:'credited',arbitraryNative:9007199254740993n,arbitraryString:'9007199254740993'};
   else if(name==='get_provenance')value={contribution:args[0],sources:[],mode:'discovery'};
   else if(name==='get_impact')value={downstream:args[0],status:'not-requested'};
   else if(name==='get_case')value={id:args[0],reporter,status:args[0]==='case-0'?'verified':'settled',kind:'attribution',payload:{},history:[]};
   else if(name==='get_points'){const reads=pointReads.get(args[0])||0;pointReads.set(args[0],reads+1);value={points:args[0]===wallet?(changeWalletPoints&&reads?'301':'300'):'0',impact_points:'0',total_awarded:changeWalletPoints&&reads?'301':'300',total_impact_points:'0'};}
   else if(name==='get_case_capacity'){const active=args[0]===reporter&&caseCount?1n:0n;value={active:capacityMismatch?active+1n:active,maximum:4n,available:4n-active};}
   else throw Error('Unexpected view '+name);
   return raw(value);
  }
 };return {client,calls,pages,run:extra=>captureNative({client,deployment,sourceBytes,policyBytes,...extra})};
}

test('preserves every ABI type without integer/string or object/tag collisions',()=>{
 const address=new CalldataAddress(Buffer.from('ab'.repeat(20),'hex'));
 const value=new Map([['1',1n],['01','1'],['large',9007199254740993n],['largeText','9007199254740993'],['bytes',new Uint8Array([0,255])],['address',address],['__proto__',new Map([['int','1']])],['list',[null,false,true,-2n]]]);
 const d=decodeRaw(raw(value));assert.equal(d.value.get('large'),9007199254740993n);assert.equal(d.value.get('largeText'),'9007199254740993');assert.deepEqual(d.tagged[1].find(x=>x[0]==='1'),['1',['int','1']]);assert.deepEqual(d.tagged[1].find(x=>x[0]==='01'),['01',['string','1']]);assert.deepEqual(d.tagged[1].find(x=>x[0]==='address'),['address',['address','ab'.repeat(20)]]);assert.equal(raw(d.value),d.rawABI);assert.doesNotThrow(()=>JSON.stringify(d.tagged));
});
test('ABI refuses trailing bytes, noncanonical integers, duplicate keys, invalid UTF-8 and depth',()=>{
 assert.throws(()=>decodeRaw(raw(1n)+'00'),/Trailing/);assert.throws(()=>decodeRaw('0x8900'),/round-trip/);assert.throws(()=>decodeRaw('0x16016100016100'),/Duplicate/);assert.throws(()=>decodeRaw('0x0cff'),/encoded data|encoding/i);let x=0n;for(let i=0;i<40;i++)x=[x];assert.throws(()=>decodeRaw(raw(x)),/budget/);assert.throws(()=>boundedJSON({n:9007199254740992}),/Unsafe/);
});
test('103 cases enumerate through the empty page twice and retain native values',async()=>{
 const f=fixture({caseCount:103}),out=await f.run();assert.equal(out.status,'captured',JSON.stringify(out.error));assert.deepEqual(f.pages,[0,100,103,0,100,103]);assert.equal(out.views.cases.length,103);assert.equal(out.views.caseIndexBefore.endedWithEmptyPage,true);assert.equal(out.observations.indexesEqual,true);assert.equal(out.observations.historyEqual,true);assert.equal(out.observations.accounting.observedConservation,true);assert.deepEqual(out.observations.activeCountMismatches,[]);assert.equal(out.observations.inFlightCases.length,1);assert.equal(out.observations.admissionOrder.complete,false);assert.equal(out.observations.admissionOrder.observedTail.length,100);assert.deepEqual([out.migrationReady,out.atomic,out.completeHistory],[false,false,false]);const record=out.reads[out.views.records[0].record];assert.equal(decodeRaw(record.rawABI).value.get('arbitraryNative'),9007199254740993n);assert.equal(out.views.wallets.find(x=>x.wallet===reporter).derivedActive,'1');
});
test('changed indexes/history and nonfinal transactions remain explicit, never ready',async()=>{
 const out=await fixture({changeIndexes:true,historyAfter:[tx(1),tx(2,'ACCEPTED'),tx(3,'UNDETERMINED')]}).run();assert.equal(out.status,'captured');assert.equal(out.observations.indexesEqual,false);assert.equal(out.observations.historyEqual,false);assert.equal(out.observations.historyAfter.filter(x=>!x.finalized).length,2);assert.equal(out.migrationReady,false);assert.equal(out.completeHistory,false);
});
test('second case index and per-wallet point reads expose intervening changes',async()=>{const out=await fixture({caseCount:1,changeCases:true,changeWalletPoints:true}).run();assert.equal(out.status,'captured');assert.equal(out.observations.indexesEqual,false);assert.equal(out.observations.walletPointsEqual,false);assert.deepEqual(out.observations.changedWalletPoints,[wallet,reporter]);assert.equal(out.views.wallets.every(x=>Number.isSafeInteger(x.pointsAfter)),true);assert.equal(out.atomic,false);});
test('capacity discrepancies are recorded without promoting capture',async()=>{const out=await fixture({caseCount:1,capacityMismatch:true}).run();assert.equal(out.status,'captured');assert.equal(out.observations.activeCountMismatches.length,2);assert.equal(out.migrationReady,false);});
test('unsupported source check is unavailable; mismatch and malformed history stop before views',async()=>{
 const unavailable=await fixture({sourceError:{code:-32601}}).run({checkSource:true});assert.equal(unavailable.status,'captured');assert.equal(unavailable.sourceCheck.status,'unavailable');
 const mismatch=fixture({source:Buffer.from('different').toString('base64')}),out=await mismatch.run({checkSource:true});assert.equal(out.status,'failed');assert.equal(out.error.code,'SOURCE_HASH_MISMATCH');assert.equal(mismatch.calls.some(x=>x.functionName),false);
 const malformed=fixture({history:{transactions:[]}}),bad=await malformed.run();assert.equal(bad.status,'failed');assert.equal(malformed.calls.some(x=>x.functionName),false);
 const local=fixture(),badLocal=await local.run({sourceBytes:Buffer.from('changed')});assert.equal(badLocal.status,'failed');assert.equal(local.calls.length,0);
});
test('matching optional source check binds bytes without claiming state atomicity',async()=>{const out=await fixture().run({checkSource:true});assert.equal(out.sourceCheck.status,'hash-matched');assert.equal(out.sourceCheck.sha256,deployment.codeHash);assert.equal(out.atomic,false);});
test('throttling stops immediately without retry even during optional source check',async()=>{
 const f=fixture({sourceError:{code:-32029,data:{retry_after_seconds:70,limit:500}}}),out=await f.run({checkSource:true});assert.equal(out.status,'failed');assert.equal(out.error.code,'THROTTLED');assert.equal(f.calls.filter(x=>x.method==='gen_getContractCode').length,1);assert.equal(f.calls.some(x=>x.functionName),false);assert.equal(out.error.throttle.retryAfterSeconds,70);
});
test('call, per-response, aggregate storage and case budgets fail explicitly',async()=>{
 for(const [limits,code] of [[{maxCalls:2},'CALL_BUDGET'],[{maxResponseBytes:6},'RESPONSE_BUDGET'],[{maxTotalBytes:200},'BYTE_BUDGET'],[{maxStoredBytes:100},'STORAGE_BUDGET'],[{maxCases:1},'CASE_BUDGET'],[{maxDecodedNodes:1},'NODE_BUDGET']]){const f=fixture({caseCount:2}),out=await f.run({limits});assert.equal(out.status,'failed');assert.equal(out.error.code,code,JSON.stringify({limits,error:out.error}));assert.equal(out.migrationReady,false);}
});
const endpoint='https://read-only.invalid/rpc';
const envelope=(method='eth_chainId',params=[])=>({jsonrpc:'2.0',id:10,method,params});
const init=request=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
const response=(result,id=10)=>new Response(JSON.stringify({jsonrpc:'2.0',id,result}),{headers:{'content-type':'application/json'}});
test('transport permits only exact no-auth same-contract read requests',async()=>{
 let calls=0;const read=boundedReadFetch({endpoint,contract,fetchImpl:async(url,options)=>{calls++;assert.equal(url,endpoint);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrer,undefined);return response('0xf22f');}});
 await read(endpoint,{...init(envelope()),referrer:'https://ignored.invalid'});await read(endpoint,init(envelope('sim_getTransactionsForAddress',[contract])));assert.equal(calls,2);
 for(const req of [envelope('eth_sendRawTransaction',['0x00']),envelope('sim_getTransactionsForAddress',[contract,'all']),envelope('gen_getContractCode',[wallet]),envelope('gen_call',[{type:'write',to:contract}]),{...envelope(),privateKey:'no'}])await assert.rejects(()=>read(endpoint,init(req)));
 await assert.rejects(()=>read(endpoint,{...init(envelope()),headers:{authorization:'Bearer no'}}));assert.equal(calls,2);
});
test('transport rejects oversized streaming bodies, mismatched response IDs and aborts stalled bodies',async()=>{
 const large=boundedReadFetch({endpoint,contract,limits:{maxResponseBytes:80},fetchImpl:async()=>response('x'.repeat(100))});await assert.rejects(()=>large(endpoint,init(envelope())),/byte budget/);
 const wrong=boundedReadFetch({endpoint,contract,fetchImpl:async()=>response('ok',11)});await assert.rejects(()=>wrong(endpoint,init(envelope())),/envelope mismatch/);
 let aborted=false,canceled=false;const stalled=boundedReadFetch({endpoint,contract,limits:{callTimeoutMs:10},fetchImpl:async(_,options)=>{options.signal.addEventListener('abort',()=>{aborted=true;});return new Response(new ReadableStream({cancel(){canceled=true;}}));}});await assert.rejects(()=>stalled(endpoint,init(envelope())),/timed out/);assert.equal(aborted,true);assert.equal(canceled,true);
});
test('transport forwards only a canonical reserialized JSON envelope',async()=>{let body;const read=boundedReadFetch({endpoint,contract,fetchImpl:async(_,options)=>{body=options.body;return response('ok');}});await read(endpoint,{...init(envelope()),body:'{"jsonrpc":"2.0","id":9,"id":10,"method":"eth_chainId","params":[]}'});assert.equal(body,JSON.stringify(envelope()));});
test('actual pinned SDK rawReturn wire requests pass the guarded fake transport',async()=>{
 const previous=globalThis.fetch,calls=[];try{globalThis.fetch=boundedReadFetch({endpoint:studionet.rpcUrls.default.http[0],contract,fetchImpl:async(_,options)=>{const request=JSON.parse(options.body);calls.push(request);return response(raw(new Map([['integer',1n],['string','1']])).slice(2),request.id);}});const client=createClient({chain:studionet});const observed=await client.readContract({address:contract,functionName:'get_case_capacity',args:[wallet],rawReturn:true,jsonSafeReturn:false,transactionHashVariant:'latest-final'});assert.equal(decodeRaw(observed).value.get('integer'),1n);assert.equal(calls.length,1);assert.equal(calls[0].params[0].from,'0x'+'0'.repeat(40));}finally{globalThis.fetch=previous;}
});
test('actual SDK errors retain unsupported-source and throttle semantics without retries',async()=>{
 const previous=globalThis.fetch;try{
  for(const code of [-32601,-32029]){let requests=0;const f=fixture();globalThis.fetch=boundedReadFetch({endpoint:studionet.rpcUrls.default.http[0],contract,fetchImpl:async(_,options)=>{requests++;const req=JSON.parse(options.body);if(req.method==='gen_getContractCode')return new Response(JSON.stringify({jsonrpc:'2.0',id:req.id,error:{code,message:'fixture',data:{retry_after_seconds:2}}}));return response(req.method==='eth_chainId'?'0x'+(61999).toString(16):[],req.id);}});const sdk=createClient({chain:studionet}),out=await f.run({client:{request:sdk.request,readContract:f.client.readContract},checkSource:true});if(code===-32601){assert.equal(out.status,'captured');assert.equal(out.sourceCheck.status,'unavailable');assert.equal(requests,4);}else{assert.equal(out.status,'failed');assert.equal(out.error.code,'THROTTLED');assert.equal(requests,3);assert.equal(f.calls.length,0);}}
 }finally{globalThis.fetch=previous;}
});
test('outputs are unique, compact, bounded diagnostics under .data; symlinks refused',async()=>{
 const repository=fs.mkdtempSync(path.join(os.tmpdir(),'native-capture-test-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'native-capture-outside-'));try{const out=await fixture().run(),a=writeCapture(repository,out),b=writeCapture(repository,out);assert.notEqual(a,b);assert.equal(path.dirname(a),path.join(fs.realpathSync(repository),'.data/v3-native-captures'));assert.equal(JSON.parse(fs.readFileSync(a)).migrationReady,false);assert.equal(fs.statSync(a).mode&0o777,0o600);assert.throws(()=>writeCapture(repository,{...out,migrationReady:true}));assert.throws(()=>writeCapture(repository,{...out,limits:{...out.limits,maxOutputBytes:10}}),/budget/);fs.rmSync(path.join(repository,'.data'),{recursive:true});fs.symlinkSync(outside,path.join(repository,'.data'));assert.throws(()=>writeCapture(repository,out),/symlinks/);assert.deepEqual(fs.readdirSync(outside),[]);}finally{fs.rmSync(repository,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});
