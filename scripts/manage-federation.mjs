#!/usr/bin/env node
// Operator entry point. Reuses the exact-call journals and native receipt checks.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createAccount} from 'genlayer-js';
import {digest,canonical} from '../src/security.mjs';
import {loadOpenProblem,verifyOpenCheckout,parseProblemJSON} from '../src/open-research.mjs';
import {requireOpenNative} from '../github/open-verify.mjs';
import {clientFor,read,clean,saveJSON} from '../github/runtime.mjs';
import {journaledTransaction} from '../github/journaled-transaction.mjs';
import {withStudioBatchPacing} from '../github/batch-studio-client.mjs';
import {collectGithubProvenance} from '../github/github-provenance.mjs';
import {processAttribution,authorClaimPreflight} from '../github/federation-worker.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
// Public upstream reads must not inherit the workflow's own-repository token.
export const collectPublicSource=input=>collectGithubProvenance(input);
export async function run(argv=process.argv.slice(2),{loadJournal,saveJournal,output=value=>console.log(JSON.stringify(clean(value),null,2))}={}){
 const [command,directory,selection,journalDir,...flags]=argv;
 if(!['register','attribution','reconcile-impact','verify-author','settle-author'].includes(command)||!directory||!selection||!journalDir||flags.length>1||flags.some(x=>x!=='--send'))throw Error('Usage: manage-federation.mjs register|attribution|reconcile-impact|verify-author|settle-author TRUSTED_PROBLEM REQUEST_FILE_OR_ID JOURNAL_DIRECTORY [--send]');
 const problem=loadOpenProblem(directory),d=problem.deployment;
 verifyOpenCheckout(problem,root);
 let input=selection;
 if(['register','verify-author'].includes(command)){
  const stat=fs.lstatSync(selection);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('Bounded regular JSON request file required');
  input=parseProblemJSON(fs.readFileSync(selection));
 }
 const intent={command,input,contract:d.contract,policy:problem.policyHash,chainId:d.chainId,protocolCommit:problem.descriptor.protocol.commit};
 if(!flags.includes('--send')){output({intent,send:false,trust:'Verifier admits bounded documentary evidence; native consensus alone allocates the fixed award.'});return;}
 fs.mkdirSync(journalDir,{recursive:true,mode:0o700});
 const journalPath=path.join(journalDir,digest(intent)+'.json');
 const prior=loadJournal?await loadJournal(path.basename(journalPath)):fs.existsSync(journalPath)?JSON.parse(fs.readFileSync(journalPath,'utf8')):null;
 const journal=prior||{version:1,intent,transactions:{}};
 if(journal.version!==1||canonical(journal.intent)!==canonical(intent)||!journal.transactions)throw Error('Federation journal binding mismatch');
 const save=async()=>{
  const value={...journal,updatedAt:new Date().toISOString()};
  if(saveJournal)await saveJournal(path.basename(journalPath),value);
  else saveJSON(journalPath,value);
 };
 const keys={verifier:process.env.VERIFIER_SIGNING_KEY,executor:process.env.EXECUTOR_SIGNING_KEY},clients={};
 const reader=withStudioBatchPacing(clientFor());await requireOpenNative(problem,reader);
 const native=(method,args=[])=>read(reader,d.contract,method,args);
 async function tx(role,stage,method,args,recoverOnly=false){
  if(!keys[role]||createAccount(keys[role]).address.toLowerCase()!==d[role].toLowerCase())throw Error('Correct dedicated '+role+' key required');
  const client=clients[role]??=withStudioBatchPacing(clientFor(keys[role]));
  return journaledTransaction({client,address:d.contract,sender:d[role],method,args,independent:['review_attribution','verify_author_claim','settle_author_claim'].includes(method),recoverOnly,transactions:journal.transactions,stage,save});
 }
 const collect=collectPublicSource;
 let result;
 try{
  if(command==='register'){
   const source=await collect(input);journal.source=source;await save();
   await tx('verifier','register','register_external_result',[JSON.stringify(source.evidence)]);
   const id='external-'+digest(Object.fromEntries(['repository_id','commit','path','theorem'].map(k=>[k,source.evidence[k]]))).slice(0,32);
   result=await native('get_external_result',[id]);
   if(result.source_hash!==source.source_hash)throw Error('Registered source readback mismatch');
  }else if(command==='attribution')result=await processAttribution({id:selection,read:native,tx,collect,save:async(key,value)=>{journal[key]=value;await save();}});
  else if(command==='reconcile-impact'){
   const proposal=await native('get_impact_route_proposal',[selection]);
   const args=[selection,Number(proposal.round),Number(proposal.routing_revision),proposal.route_commitments_hash];
   await tx('executor',`reconcile-${digest(args)}`,'reconcile_impact_routes',args);
   result=await native('get_impact',[selection]);
  }else if(command==='verify-author'){
   if(!input||Object.keys(input).sort().join(',')!=='claim,comment_id,external_result'||typeof input.claim!=='string'||typeof input.external_result!=='string'||!Number.isSafeInteger(input.comment_id)||input.comment_id<=0)throw Error('Exact claim, external_result and comment_id required');
   const claim=await native('get_author_claim',[input.claim]);
   const preflight=authorClaimPreflight(claim,{operation:'verify',windowSeconds:d.windowSeconds,hasIntent:Object.hasOwn(journal.transactions,'verify-author')});
   await tx('executor','verify-author','verify_author_claim',[input.claim,input.external_result,input.comment_id],preflight.recoverOnly);
   result=await native('get_author_claim',[input.claim]);
  }else{
   const claim=await native('get_author_claim',[selection]);
   const preflight=authorClaimPreflight(claim,{operation:'settle',windowSeconds:d.windowSeconds,hasIntent:Object.hasOwn(journal.transactions,'settle-author')});
   if(preflight.wait){
    result={status:'challenge-window',claim,resumeAfter:preflight.resumeAfter};
   }else{
    await tx('executor','settle-author','settle_author_claim',[selection],preflight.recoverOnly);
    result=await native('get_author_claim',[selection]);
   }
  }
  journal.result=result;await save();output({journal:path.basename(journalPath),result});return result;
 }catch(error){
  let message=String(error.message);for(const secret of [...Object.values(keys),process.env.GITHUB_TOKEN].filter(Boolean))message=message.split(secret).join('[redacted]');
  journal.error=message.slice(0,2000);await save();throw Error(message);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(error=>{
 let message=String(error.message);for(const secret of [process.env.VERIFIER_SIGNING_KEY,process.env.EXECUTOR_SIGNING_KEY,process.env.GITHUB_TOKEN].filter(Boolean))message=message.split(secret).join('[redacted]');console.error(message);process.exitCode=1;
});
