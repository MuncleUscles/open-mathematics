#!/usr/bin/env node
// Contributor wallet ownership stays local. All writes are previewed unless --send.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadOpenProblem,verifyOpenCheckout,parseProblemJSON} from '../src/open-research.mjs';
import {digest,canonical} from '../src/security.mjs';
import {loadLocalSigner} from './problem-agent.mjs';
import {read,saveJSON,clean} from '../github/runtime.mjs';
import {journaledTransaction} from '../github/journaled-transaction.mjs';
import {requireOpenNative} from '../github/open-verify.mjs';
import {withStudioBatchPacing} from '../github/batch-studio-client.mjs';
import {createStudioClient} from '../src/studio-client.mjs';
import {localWalletAddress} from './contributor-local.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function federationRequest(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Public federation request object required');
 const allowed={request_attribution:3,challenge_attribution:2,request_author_claim:3};
 if(Object.keys(value).sort().join(',')!=='args,method'||!Object.hasOwn(allowed,value.method)||!Array.isArray(value.args)||value.args.length!==allowed[value.method])throw Error('Use request_attribution, challenge_attribution, or request_author_claim with exact arguments');
 if(value.method==='request_author_claim'){
  const [subject,nonce,expiry]=value.args;
  if(!/^github:[1-9][0-9]{0,15}$/.test(subject)||!/^[a-f0-9]{64}$/.test(nonce)||!Number.isSafeInteger(expiry)||expiry<=0)throw Error('Author claim requires github:ID, 32-byte hex nonce and UNIX expiry seconds');
 }else{
  const target=value.args[0],evidence=value.args[value.args.length-1];
  if(typeof target!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(target)||typeof evidence!=='string'||Buffer.byteLength(evidence)>8192)throw Error('Bounded target and documentary evidence required');
  if(value.method==='request_attribution'&&(!Number.isSafeInteger(value.args[1])||value.args[1]<0))throw Error('Exact current attribution revision required');
 }
 return value;
}
export async function run(argv=process.argv.slice(2)){
 const [directory,requestFile,journalPath,...flags]=argv;
 if(!directory||!requestFile||!journalPath||flags.length>1||flags.some(x=>x!=='--send'))throw Error('Usage: federation-agent.mjs TRUSTED_PROBLEM PUBLIC_REQUEST.json JOURNAL.json [--send]');
 const problem=loadOpenProblem(directory);verifyOpenCheckout(problem,root);
 const stat=fs.lstatSync(requestFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('Bounded regular request JSON required');
 const request=federationRequest(parseProblemJSON(fs.readFileSync(requestFile))),d=problem.deployment;
 if(!flags.includes('--send')){console.log(JSON.stringify({request,contract:d.contract,chainId:d.chainId,send:false,keys:'Set CONTRIBUTOR_KEY_FILE to your own local wallet file outside repositories. Never post it.'},null,2));return;}
 const roots=[root,problem.root];
 localWalletAddress(process.env.CONTRIBUTOR_KEY_FILE,{roots});
 const signer=loadLocalSigner(process.env.CONTRIBUTOR_KEY_FILE,roots),client=withStudioBatchPacing(createStudioClient({account:signer}));
 await requireOpenNative(problem,client);
 const intent={request,contract:d.contract,policy:problem.policyHash,chainId:d.chainId,sender:signer.address};
 const journal=fs.existsSync(journalPath)?JSON.parse(fs.readFileSync(journalPath,'utf8')):{version:1,intent,transactions:{}};
 if(journal.version!==1||canonical(journal.intent)!==canonical(intent))throw Error('Use the original exact request and journal when resuming');
 const save=async()=>saveJSON(journalPath,journal);
 let id,view;
 if(request.method==='request_attribution'){
  const [target,revision,encoded]=request.args,e=JSON.parse(encoded);
  e.sources.sort((a,b)=>a.id.localeCompare(b.id));
  if(!Object.hasOwn(journal.transactions,'request')){
   const record=await read(client,d.contract,'get',[target]);
   if(record.status!=='credited'||record.reserve_settled!==true)throw Error('Target reserve must settle before requesting attribution');
   const current=await read(client,d.contract,'get_attribution',[target]);
   if(Number(current.revision)!==revision)throw Error('Attribution revision changed; review the current allocation before signing');
  }
  if(journal.expectedId)id=journal.expectedId;
  else id='attribution-'+digest({target,revision,sources:e.sources}).slice(0,32);
  view='get_attribution_case';
 }else if(request.method==='request_author_claim'){
  const [author,nonce,expiry]=request.args;
  id='author-claim-'+digest({chain_id:d.chainId,contract:d.contract.toLowerCase(),policy:problem.policyHash,author,wallet:signer.address.toLowerCase(),nonce,expiry}).slice(0,32);view='get_author_claim';
 }else{id=request.args[0];view='get_attribution_case';}
 journal.expectedId=id;await save();
 const result=await journaledTransaction({client,address:d.contract,sender:signer.address,method:request.method,args:request.args,transactions:journal.transactions,stage:'request',save});
 const record=await read(client,d.contract,view,[id]);journal.result={id,hash:result.hash,record};await save();
 console.log(JSON.stringify(clean(journal.result),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(error=>{console.error(String(error.message));process.exitCode=1;});
