// Diagnostic proposal only: never imported by a worker, signer or migration tool.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {rpcRateLimit} from '../../src/rpc-errors.mjs';
import {boundedJSON,decodeRaw,encodedArgs} from './typed-values.mjs';

const REPO=fileURLToPath(new URL('../../',import.meta.url));
const address=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{40}$/.test(x);
const hash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(x);
const digest=x=>createHash('sha256').update(x).digest('hex');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const need=(ok,message)=>{if(!ok)fail('INVALID_RESPONSE',message);};
const field=(map,key)=>map instanceof Map?map.get(key):undefined;
const terminalCases=new Set(['settled','withdrawn','expired']);
const activeCases=new Set(['submitted','verified','provisional','challenged']);
const statuses=['UNINITIALIZED','PENDING','PROPOSING','COMMITTING','REVEALING','ACCEPTED','UNDETERMINED','FINALIZED','CANCELED','APPEAL_REVEALING','APPEAL_COMMITTING','READY_TO_FINALIZE','VALIDATORS_TIMEOUT','LEADER_TIMEOUT'];
export const DEFAULT_LIMITS=Object.freeze({maxCalls:200,maxDurationMs:180000,callTimeoutMs:8000,maxResponseBytes:2097152,maxTotalBytes:16777216,maxStoredBytes:8388608,maxDecodedNodes:400000,maxOutputBytes:16777216,maxCases:1000,maxWallets:2000,maxHistoryRows:1000,maxDepth:32,maxNodes:100000,maxItems:10000});
function limitsFor(options={}){const limits={...DEFAULT_LIMITS};for(const [key,value]of Object.entries(options)){need(Object.hasOwn(limits,key)&&Number.isSafeInteger(value)&&value>0&&value<=DEFAULT_LIMITS[key],'Unknown or enlarged capture limit');limits[key]=value;}return limits;}
function strings(value,maximum,label){need(Array.isArray(value)&&value.length<=maximum&&value.every(id)&&new Set(value).size===value.length,'Invalid '+label);return value;}
function nativeInteger(value,label){need(typeof value==='bigint',label+' must retain its native integer type');return value;}
function amount(value,label){need(typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value),label+' must retain its native decimal-string type');return BigInt(value);}
function errorCode(error){for(let i=0;i<8&&error;i++,error=error.cause)if(typeof error.code==='number')return error.code;return null;}
function historyRows(value,limits,contract){
 need(Array.isArray(value)&&value.length<=limits.maxHistoryRows,'History must be a bounded array; completeness is unknown');
 const seen=new Set();
 return value.map(row=>{
  need(row&&typeof row==='object'&&!Array.isArray(row)&&typeof row.hash==='string'&&/^0x[0-9a-fA-F]{64}$/.test(row.hash),'Malformed history transaction');
  const tx=row.hash.toLowerCase();need(!seen.has(tx),'Duplicate history transaction');seen.add(tx);
  const from=row.from_address??row.sender,to=row.to_address??row.recipient;
  need(address(from)&&(to===null||to===undefined||address(to)),'Malformed history addresses');
  const statusInputs=[row.status_name,row.statusName,row.status].filter(x=>x!==undefined&&x!==null);
  need(statusInputs.length>0,'History transaction status is missing');
  const names=statusInputs.map(s=>typeof s==='number'||typeof s==='string'&&/^\d+$/.test(s)?statuses[Number(s)]||'UNKNOWN':s==='ACTIVATED'?'PENDING':typeof s==='string'?s:'UNKNOWN');
  need(names.every(s=>s===names[0]),'Conflicting history transaction statuses');
  const status=names[0],related=from.toLowerCase()===contract.toLowerCase()||to?.toLowerCase()===contract.toLowerCase()||row.data?.contract_address?.toLowerCase()===contract.toLowerCase();
  return {hash:tx,status,finalized:status==='FINALIZED',related:!!related};
 });
}
function safeError(error){const throttle=rpcRateLimit(error);if(throttle)return {code:'THROTTLED',message:'Provider throttled the capture; no retry or resume was attempted.',throttle};if(typeof error.code==='string')return {code:error.code,message:error.message};return {code:'RPC_OR_CAPTURE_ERROR',message:'A read failed; the capture stopped without retry.',rpcCode:errorCode(error)};}

/** Every success is only a bounded observation. Raw ABI/tagged reads are evidence,
 * not JSON-normalized migration state. A failed capture is explicitly partial. */
export async function captureNative({client,deployment,sourceBytes,policyBytes,checkSource=false,limits:options={},now=Date.now}){
 const limits=limitsFor(options),start=now(),iso=()=>new Date(now()).toISOString();
 const output={version:1,scope:'Read-only v3 diagnostic; not an importer, state cutoff or authorization',migrationReady:false,atomic:false,completeHistory:false,status:'collecting',startedAt:iso(),limits,identity:null,reads:[],rpc:[],views:{records:[],cases:[],wallets:[]},observations:{},limitations:[
  'Latest-final selects a finalized view for each read, not one atomic block for all reads.',
  'Studio history has no SDK pagination or completeness witness; omissions, lag and internal-call coverage remain unknown.',
  'History is SDK-parsed JSON, not original HTTP bytes; unsafe integer values are refused, but arbitrary JSON lexical precision is not preserved.',
  'Stable history/index observations do not establish quiescence, authentication or a migration cutoff.',
  'list_review_cases exposes only the last 100 admissions; complete historical admission order remains unproven.',
  'Wallet closure is derived from exposed records/registries; inaccessible storage indexes and unnamed recipients are not proven complete.',
  'No operator freeze, receipt lineage, canonical GitHub merge verification, importer or post-import equivalence check is performed.',
 ],stats:{calls:0,responseBytes:0,storedBytes:0,decodedNodes:0}};
 async function call(method,operation){
  if(output.stats.calls>=limits.maxCalls)fail('CALL_BUDGET','Capture call budget exhausted');
  const remaining=limits.maxDurationMs-(now()-start);if(remaining<=0)fail('TIME_BUDGET','Capture time budget exhausted');
  output.stats.calls++;const startedAt=iso();let timer;
  const value=await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Read timed out; capture stopped'),{code:'READ_TIMEOUT'})),Math.min(remaining,limits.callTimeoutMs));})]).finally(()=>clearTimeout(timer));
  if(now()-start>limits.maxDurationMs)fail('TIME_BUDGET','Capture time budget exhausted');
  let rawJSON;try{rawJSON=boundedJSON(value,{...limits,maxBytes:limits.maxResponseBytes});}catch{fail('RESPONSE_BUDGET','Response shape or byte budget exceeded');}
  output.stats.responseBytes+=Buffer.byteLength(rawJSON);if(output.stats.responseBytes>limits.maxTotalBytes)fail('BYTE_BUDGET','Capture aggregate byte budget exhausted');
  return {value,rawJSON,startedAt,finishedAt:iso(),method};
 }
 async function store(collection,entry){
  let serialized;try{serialized=boundedJSON(entry,{...limits,maxDepth:limits.maxDepth*4,maxNodes:limits.maxNodes*5,maxBytes:limits.maxResponseBytes});}catch{fail('STORAGE_BUDGET','Tagged evidence storage budget exceeded');}
  output.stats.storedBytes+=Buffer.byteLength(serialized);if(output.stats.storedBytes>limits.maxStoredBytes)fail('STORAGE_BUDGET','Aggregate evidence storage budget exhausted');collection.push(entry);
 }
 async function rpc(method,params){const r=await call(method,()=>client.request({method,params}));await store(output.rpc,{method,params,parsedJSON:r.rawJSON,sha256:digest(r.rawJSON),startedAt:r.startedAt,finishedAt:r.finishedAt});return r.value;}
 async function view(method,args=[]){
  const encoded=encodedArgs(args,{...limits,maxBytes:limits.maxResponseBytes});
  const r=await call(method,()=>client.readContract({address:deployment.contract,functionName:method,args:encoded.value,rawReturn:true,jsonSafeReturn:false,transactionHashVariant:'latest-final'}));
  let decoded;try{decoded=decodeRaw(r.value,{...limits,maxBytes:limits.maxResponseBytes});}catch{fail('INVALID_ABI','Native response failed bounded ABI decoding or byte round-trip');}
  output.stats.decodedNodes+=decoded.nodes;if(output.stats.decodedNodes>limits.maxDecodedNodes)fail('NODE_BUDGET','Aggregate decoded-node budget exhausted');
  const index=output.reads.length;await store(output.reads,{method,args:encoded.tagged,rawArguments:encoded.rawABI,rawABI:decoded.rawABI,tagged:decoded.tagged,startedAt:r.startedAt,finishedAt:r.finishedAt});
  return {value:decoded.value,index,rawABI:decoded.rawABI};
 }
 async function pages(){const ids=[],reads=[];for(;;){const page=await view('list_case_page',[BigInt(ids.length),100n]);reads.push(page.index);const values=strings(page.value,100,'case page');if(!values.length)return {ids,reads,endedWithEmptyPage:true};if(ids.length+values.length>limits.maxCases)fail('CASE_BUDGET','Case enumeration limit exceeded');for(const value of values){need(!ids.includes(value),'Duplicate ID across case pages');ids.push(value);}}}
 try{
  need(deployment?.protocolVersion===3&&deployment.chainId===61999&&address(deployment.contract)&&hash(deployment.codeHash)&&hash(deployment.policy),'Exact reviewed Studio v3 deployment is required');
  need(sourceBytes instanceof Uint8Array&&policyBytes instanceof Uint8Array&&digest(sourceBytes)===deployment.codeHash&&digest(policyBytes)===deployment.policy,'Local source or policy does not match deployment');
  output.identity=Object.fromEntries(['protocolVersion','chainId','contract','codeHash','policy'].map(k=>[k,deployment[k]]));
  const chain=await rpc('eth_chainId',[]);need(typeof chain==='string'&&/^0x[0-9a-f]+$/i.test(chain)&&BigInt(chain)===BigInt(deployment.chainId),'RPC chain ID differs from local deployment');
  const beforeHistory=await rpc('sim_getTransactionsForAddress',[deployment.contract]);
  output.observations.historyBefore=historyRows(beforeHistory,limits,deployment.contract);
  output.sourceCheck={status:'not-requested',localHash:deployment.codeHash};
  if(checkSource){
   let code;
   try{code=await rpc('gen_getContractCode',[deployment.contract]);}
   catch(error){if(errorCode(error)!==-32601||rpcRateLimit(error))throw error;output.sourceCheck={status:'unavailable',reason:'Provider reports gen_getContractCode unsupported',rpcCode:-32601};}
   if(code!==undefined){
    need(typeof code==='string'&&code.length>0,'Malformed source-code response');
    const bytes=Buffer.from(code,'base64');need(bytes.toString('base64')===code,'Source-code response is not canonical base64');
    try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('INVALID_SOURCE','Source code is not UTF-8');}
    if(digest(bytes)!==deployment.codeHash)fail('SOURCE_HASH_MISMATCH','RPC source bytes do not match the reviewed deployment');
    output.sourceCheck={status:'hash-matched',sha256:digest(bytes),bytes:bytes.length,meaning:'Observed source bytes only; no atomic state binding'};
   }else if(output.sourceCheck.status!=='unavailable')fail('INVALID_SOURCE','Source-code response is missing');
  }
  const idsBefore=await view('list_contributions'),ids=strings(idsBefore.value,100,'contribution index'),casesBefore=await pages();
  const affiliations=await view('get_affiliations'),authors=await view('get_external_authors'),problem=await view('get_problem'),admissionTail=await view('list_review_cases');
  need(Array.isArray(affiliations.value)&&affiliations.value.length<=500&&Array.isArray(authors.value)&&authors.value.length<=1024&&problem.value instanceof Map,'Malformed native registries');strings(admissionTail.value,100,'admission tail');
  Object.assign(output.views,{contributionIndexBefore:idsBefore.index,caseIndexBefore:casesBefore,affiliations:affiliations.index,authors:authors.index,problem:problem.index,admissionTail:admissionTail.index});
  const wallets=new Set(),active=new Map(),records=[],cases=[],impacts=[];
  const addWallet=wallet=>{need(address(wallet),'Malformed exposed wallet');wallets.add(wallet.toLowerCase());if(wallets.size>limits.maxWallets)fail('WALLET_BUDGET','Wallet closure exceeds bound');};
  for(const id of ids){
   const record=await view('get',[id]),provenance=await view('get_provenance',[id]),impact=await view('get_impact',[id]);
   need(field(field(record.value,'evidence'),'id')===id&&field(provenance.value,'contribution')===id&&field(impact.value,'downstream')===id,'Contribution view identity mismatch');
   addWallet(field(field(record.value,'evidence'),'wallet'));records.push({id,value:record.value});impacts.push({id,value:impact.value});
   output.views.records.push({id,record:record.index,provenance:provenance.index,impact:impact.index});
  }
  const authorIds=new Set();let unclaimed=0n;
  for(const author of authors.value){const key=field(author,'id');need(id(key)&&!authorIds.has(key),'Malformed or duplicate author ID');authorIds.add(key);const wallet=field(author,'claimed_wallet');if(wallet!==null)addWallet(wallet);unclaimed+=amount(field(author,'unclaimed_points'),'External unclaimed points');const history=field(author,'claim_history');need(Array.isArray(history)&&history.length<=100,'Malformed author claim history');for(const claim of history)addWallet(field(claim,'wallet'));}
  for(const a of affiliations.value)addWallet(field(a,'wallet'));
  for(const id of casesBefore.ids){
   const c=await view('get_case',[id]);need(field(c.value,'id')===id,'Case identity mismatch');const reporter=field(c.value,'reporter'),status=field(c.value,'status');addWallet(reporter);
   need(activeCases.has(status)||terminalCases.has(status),'Unknown case status');if(activeCases.has(status))active.set(reporter.toLowerCase(),(active.get(reporter.toLowerCase())||0n)+1n);
   cases.push({id,value:c.value});output.views.cases.push({id,view:c.index});
  }
  const mismatches=[],totals=new Set(),impactTotals=new Set();let walletPoints=0n,walletImpact=0n;
  for(const wallet of [...wallets].sort()){
   const points=await view('get_points',[wallet]),capacity=await view('get_case_capacity',[wallet]);
   const observed=nativeInteger(field(capacity.value,'active'),'Active-case count'),maximum=nativeInteger(field(capacity.value,'maximum'),'Case maximum'),available=nativeInteger(field(capacity.value,'available'),'Case availability'),derived=active.get(wallet)||0n;
   if(observed!==derived||maximum!==4n||available!==maximum-observed||observed<0n||observed>maximum)mismatches.push({wallet,derived:derived.toString(),observed:observed.toString(),maximum:maximum.toString(),available:available.toString()});
   walletPoints+=amount(field(points.value,'points'),'Wallet points');walletImpact+=amount(field(points.value,'impact_points'),'Wallet impact points');totals.add(amount(field(points.value,'total_awarded'),'Total points').toString());impactTotals.add(amount(field(points.value,'total_impact_points'),'Total impact points').toString());
   output.views.wallets.push({wallet,points:points.index,capacity:capacity.index,derivedActive:derived.toString()});
  }
  const idsAfter=await view('list_contributions'),afterIds=strings(idsAfter.value,100,'contribution index'),casesAfter=await pages();
  const afterAffiliations=await view('get_affiliations'),afterAuthors=await view('get_external_authors'),afterProblem=await view('get_problem'),afterTail=await view('list_review_cases');
  need(Array.isArray(afterAffiliations.value)&&afterAffiliations.value.length<=500&&Array.isArray(afterAuthors.value)&&afterAuthors.value.length<=1024&&afterProblem.value instanceof Map,'Malformed repeated native registries');strings(afterTail.value,100,'repeated admission tail');
  Object.assign(output.views,{contributionIndexAfter:idsAfter.index,caseIndexAfter:casesAfter,affiliationsAfter:afterAffiliations.index,authorsAfter:afterAuthors.index,problemAfter:afterProblem.index,admissionTailAfter:afterTail.index});
  const changedWalletPoints=[];
  for(const entry of output.views.wallets){const after=await view('get_points',[entry.wallet]);entry.pointsAfter=after.index;for(const key of ['points','impact_points','total_awarded','total_impact_points'])amount(field(after.value,key),'Repeated '+key);if(output.reads[entry.points].rawABI!==after.rawABI)changedWalletPoints.push(entry.wallet);}
  const afterHistory=await rpc('sim_getTransactionsForAddress',[deployment.contract]);output.observations.historyAfter=historyRows(afterHistory,limits,deployment.contract);
  Object.assign(output.observations,{
   indexesEqual:JSON.stringify(ids)===JSON.stringify(afterIds)&&JSON.stringify(casesBefore.ids)===JSON.stringify(casesAfter.ids),
   registryViewsEqual:affiliations.rawABI===afterAffiliations.rawABI&&authors.rawABI===afterAuthors.rawABI&&problem.rawABI===afterProblem.rawABI&&admissionTail.rawABI===afterTail.rawABI,
   historyEqual:boundedJSON(beforeHistory,{...limits,maxBytes:limits.maxResponseBytes})===boundedJSON(afterHistory,{...limits,maxBytes:limits.maxResponseBytes}),
   activeCountMismatches:mismatches,walletPointsEqual:changedWalletPoints.length===0,changedWalletPoints,
   inFlightCases:cases.filter(c=>activeCases.has(field(c.value,'status'))).map(c=>({id:c.id,status:field(c.value,'status')})),
   inFlightContributions:records.filter(r=>!['credited','rejected','expired'].includes(field(r.value,'status'))).map(r=>({id:r.id,status:field(r.value,'status')})),
   inFlightImpacts:impacts.filter(r=>!['settled','not-requested'].includes(field(r.value,'status'))).map(r=>({id:r.id,status:field(r.value,'status')})),
   admissionOrder:{complete:false,observedTail:admissionTail.value,reason:'Only latest100 admissions exposed; neither creation order nor timestamps prove full admission order'},
   accounting:{walletPoints:walletPoints.toString(),externalUnclaimed:unclaimed.toString(),walletImpact:walletImpact.toString(),reportedTotals:[...totals],reportedImpactTotals:[...impactTotals],observedConservation:wallets.size>0&&totals.size===1&&impactTotals.size===1&&totals.has((walletPoints+unclaimed).toString())&&impactTotals.has(walletImpact.toString()),completeWalletIndex:false},
  });
  output.status='captured';
 }catch(error){output.status='failed';output.error=safeError(error);}
 output.finishedAt=iso();output.stats.elapsedMs=now()-start;return output;
}

/** CLI-only global fetch guard: SDK0.18.9 does not expose fetch injection.
 * Streaming response/time budgets and exact read capability apply before parsing. */
export function boundedReadFetch({fetchImpl,endpoint,contract,limits:options={},now=Date.now}){
 const limits=limitsFor(options),started=now();let calls=0,totalBytes=0;
 return async(input,init={})=>{
  need(String(input)===endpoint&&init.method==='POST','Unexpected capture transport request');
  need(typeof init.body==='string'&&Buffer.byteLength(init.body)<=8192,'Oversized RPC request');
  const request=JSON.parse(init.body);need(request&&request.jsonrpc==='2.0'&&Number.isSafeInteger(request.id)&&Array.isArray(request.params)&&Object.keys(request).sort().join(',')==='id,jsonrpc,method,params','Invalid JSON-RPC envelope');
  const {method,params}=request;
  const allowed=method==='eth_chainId'&&params.length===0||method==='sim_getTransactionsForAddress'&&params.length===1&&params[0]===contract||method==='gen_getContractCode'&&params.length===1&&params[0]===contract||method==='gen_call'&&params.length===1&&params[0]?.type==='read'&&params[0].to===contract&&params[0].from==='0x0000000000000000000000000000000000000000'&&params[0].transaction_hash_variant==='latest-final'&&Object.keys(params[0]).sort().join(',')==='data,from,to,transaction_hash_variant,type'&&typeof params[0].data==='string'&&/^0x(?:[0-9a-fA-F]{2})+$/.test(params[0].data);
  need(allowed,'Write, foreign-address or nonfinal RPC is forbidden');
  const headers=new Headers(init.headers);need([...headers.keys()].every(key=>key.toLowerCase()==='content-type')&&headers.get('content-type')==='application/json','Unexpected authentication or request headers');
  if(++calls>limits.maxCalls)fail('CALL_BUDGET','Transport call budget exhausted');const remaining=limits.maxDurationMs-(now()-started);if(remaining<=0)fail('TIME_BUDGET','Transport time budget exhausted');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(remaining,limits.callTimeoutMs));let reader;
  const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Object.assign(Error('Transport timed out'),{code:'READ_TIMEOUT'})),{once:true}));
  try{
   const response=await Promise.race([fetchImpl(endpoint,{method:'POST',body:JSON.stringify(request),headers,signal:controller.signal,redirect:'error',credentials:'omit'}),aborted]);
   need(response.ok&&response.body,'RPC HTTP response unavailable');
   const advertised=response.headers.get('content-length');if(advertised!==null&&(!/^\d+$/.test(advertised)||Number(advertised)>limits.maxResponseBytes))fail('RESPONSE_BUDGET','RPC response exceeds byte limit');
   reader=response.body.getReader();const chunks=[];let bytes=0;
   for(;;){const next=await Promise.race([reader.read(),aborted]);if(next.done)break;bytes+=next.value.byteLength;totalBytes+=next.value.byteLength;if(bytes>limits.maxResponseBytes||totalBytes>limits.maxTotalBytes)fail('BYTE_BUDGET','RPC streaming byte budget exceeded');chunks.push(Buffer.from(next.value));}
   const data=Buffer.concat(chunks);let envelope;try{envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{fail('INVALID_RESPONSE','RPC response is not UTF-8 JSON');}
   need(envelope&&envelope.jsonrpc==='2.0'&&envelope.id===request.id&&Object.hasOwn(envelope,'result')!==Object.hasOwn(envelope,'error'),'RPC response envelope mismatch');
   return new Response(data,{status:response.status,headers:{'content-type':'application/json'}});
  }finally{clearTimeout(timer);controller.abort();if(reader)reader.cancel().catch(()=>{});}
 };
}

export function writeCapture(repository,result){
 need(result?.migrationReady===false&&result.atomic===false&&result.completeHistory===false,'Only diagnostic captures may be written');
 const bytes=boundedJSON(result,{maxDepth:128,maxNodes:800000,maxItems:100000,maxBytes:Math.min(result.limits?.maxOutputBytes??DEFAULT_LIMITS.maxOutputBytes,DEFAULT_LIMITS.maxOutputBytes)});
 const root=fs.realpathSync(repository),data=path.join(root,'.data'),directory=path.join(data,'v3-native-captures');
 for(const folder of [data,directory]){if(!fs.existsSync(folder))fs.mkdirSync(folder,{mode:0o700});need(fs.lstatSync(folder).isDirectory()&&!fs.lstatSync(folder).isSymbolicLink()&&fs.realpathSync(folder)===folder,'Capture directory must not follow symlinks');}
 const name=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(12).toString('hex'),target=path.join(directory,name+'.json'),temporary=target+'.tmp';let fd;
 try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,bytes+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temporary,target);fs.unlinkSync(temporary);return target;}
 finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
async function main(){
 const args=process.argv.slice(2);if(args.includes('--help')){console.log('Read-only diagnostic: node proposals/v4/capture-native.mjs [--check-source]. No resume, signer, writes or import output. Network reads occur only when explicitly run.');return;}
 need(args.every(a=>a==='--check-source')&&new Set(args).size===args.length,'Only --check-source is supported');
 const installed=JSON.parse(fs.readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve('genlayer-js')),'../package.json')));need(installed.version==='0.18.9','Pinned genlayer-js0.18.9 required');
 const deployment=JSON.parse(fs.readFileSync(path.join(REPO,'public/deployment.json'))),sourceBytes=fs.readFileSync(path.join(REPO,'contracts/research.py')),policyBytes=fs.readFileSync(path.join(REPO,'lean/policy.json'));
 const originalFetch=globalThis.fetch;
 globalThis.fetch=boundedReadFetch({fetchImpl:originalFetch.bind(globalThis),endpoint:studionet.rpcUrls.default.http[0],contract:deployment.contract});
 let result;try{result=await captureNative({client:createClient({chain:studionet}),deployment,sourceBytes,policyBytes,checkSource:args.includes('--check-source')});}finally{globalThis.fetch=originalFetch;}
 const file=writeCapture(REPO,result);console.log(JSON.stringify({file,status:result.status,migrationReady:false,atomic:false,completeHistory:false,calls:result.stats.calls,error:result.error??null},null,2));if(result.status!=='captured')process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Capture setup failed; no successful capture was produced.');process.exitCode=1;});
