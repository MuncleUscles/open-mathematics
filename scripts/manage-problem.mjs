#!/usr/bin/env node
// Trusted operator tool. Preview by default; retain broadcast intent on failure.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {isAddress} from 'viem';
import {clientFor,read,finalized,saveJSON} from '../github/runtime.mjs';import {journaledTransaction} from '../github/journaled-transaction.mjs';import {GitHub} from '../src/github.mjs';
import {loadProblem,parseProblemJSON,sha256,stableJSON,requireNativeConfiguration,requireNativeEnrollment,verifyProtocolCheckout,verifyProblemSource} from '../src/problem.mjs';
import {loadLocalSigner,toolRoot} from './problem-agent.mjs';
const [command,directory,selection,...flags]=process.argv.slice(2),send=flags.includes('--send');
const output=x=>console.log(JSON.stringify(x,null,2));
if(command==='deploy'){
 // directory is the reviewed constructor config; selection is a durable journal.
 const config=parseProblemJSON(fs.readFileSync(directory)),code=fs.readFileSync(path.join(toolRoot,'contracts/research_v4.py'),'utf8'),codeHash=sha256(code),configJSON=JSON.stringify(config);
 if(config.version!==4||config.branch!=='research'||config.window<300||config.window>604800||!['curator','verifier','executor'].every(k=>isAddress(config[k]))||new Set(['curator','verifier','executor'].map(k=>config[k].toLowerCase())).size!==3)throw Error('Reviewed v4 configuration with distinct roles and at least five-minute window required');
 execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:toolRoot});const protocolCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:toolRoot,encoding:'utf8'}).trim();
 const intent={codeHash,config,protocolCommit};
 if(!send){output({action:'deploy',network:'Studio',...intent,next:'Review the exact source/config. Repeat with --send and OPERATOR_KEY_FILE pointing to the dedicated curator signer.'});}
 else{
  const account=loadLocalSigner(process.env.OPERATOR_KEY_FILE,[toolRoot]);if(account.address.toLowerCase()!==config.curator.toLowerCase())throw Error('Dedicated curator signer required');
  const client=clientFor(fs.readFileSync(process.env.OPERATOR_KEY_FILE,'utf8').trim()),journal=fs.existsSync(selection)?JSON.parse(fs.readFileSync(selection,'utf8')):{...intent,status:'prepared'};
  if(stableJSON({codeHash:journal.codeHash,config:journal.config,protocolCommit:journal.protocolCommit})!==stableJSON(intent))throw Error('Deployment intent changed');
  if(!journal.hash){
   if(journal.status!=='prepared')throw Error('Prior deployment broadcast outcome unknown. Inspect history before reconciliation; do not retry.');
   journal.status='broadcasting';journal.startedAt=new Date().toISOString();saveJSON(selection,journal);
   journal.hash=await client.deployContract({code,args:[configJSON],leaderOnly:false});journal.status='broadcast';saveJSON(selection,journal);
  }
  const receipt=await finalized(client,journal.hash);journal.contract=receipt.data?.contract_address||receipt.to_address;
  if(!isAddress(journal.contract))throw Error('Finalized contract address missing');
  const native=await read(client,journal.contract,'get_config',[]);
  for(const key of ['problem','repository','branch','curator','verifier','executor'])if(String(native[key]).toLowerCase()!==String(config[key]).toLowerCase())throw Error('Deployed configuration mismatch');
  journal.receipt=receipt;journal.status='finalized';saveJSON(selection,journal);output({status:journal.status,contract:journal.contract,hash:journal.hash,codeHash,protocolCommit});
 }
}else if(command==='enroll'){
 const problem=loadProblem(directory),batch=problem.policies.get(selection);if(!batch)throw Error('Select a reviewed policy SHA');
 const goal=problem.goals.get(Object.keys(batch.policy.goals)[0]);verifyProtocolCheckout(problem,toolRoot,{goal});
 const gh=new GitHub({repository:problem.descriptor.repository,token:process.env.GITHUB_TOKEN});await verifyProblemSource(problem,goal,gh);
 const reader=clientFor();await requireNativeConfiguration(problem,(m,a)=>read(reader,problem.deployment.contract,m,a));
 const args=[batch.bytes.toString('utf8'),batch.entry.sourceCommit,batch.entry.protocolCommit],details={contract:problem.deployment.contract,policy:selection,problemCommit:goal.problemCommit,protocolCommit:goal.protocolCommit,goals:Object.entries(batch.policy.goals).map(([id,g])=>({id,rewardable:g.rewardable,statement:g.statement}))};
 if(!send)output({action:'enroll',...details,next:'Review goals, known prior work, exact byte commitments and both commits. Repeat with --send and OPERATOR_KEY_FILE for the curator. Enrollment allocates no points.'});
 else{
  const journalFile=process.env.ENROLLMENT_JOURNAL;if(!journalFile)throw Error('ENROLLMENT_JOURNAL is required for durable recovery');
  const account=loadLocalSigner(process.env.OPERATOR_KEY_FILE,[toolRoot,problem.root]);if(account.address.toLowerCase()!==problem.deployment.curator.toLowerCase())throw Error('Wrong curator signer');
  const client=clientFor(fs.readFileSync(process.env.OPERATOR_KEY_FILE,'utf8').trim()),journal=fs.existsSync(journalFile)?JSON.parse(fs.readFileSync(journalFile,'utf8')):{...details,transactions:{}};
  if(stableJSON({...journal,transactions:undefined})!==stableJSON(details))throw Error('Enrollment journal differs from reviewed intent');
  await journaledTransaction({client,address:problem.deployment.contract,sender:account.address,method:'enroll_policy',args,independent:false,transactions:journal.transactions,stage:'enroll',save:async()=>saveJSON(journalFile,journal)});
  const rows=[];for(const id of Object.keys(batch.policy.goals))rows.push(await requireNativeEnrollment(problem,problem.goals.get(id),(m,a)=>read(client,problem.deployment.contract,m,a)));
  output({status:'enrolled',...details,goals:rows});
 }
}else throw Error('Usage: manage-problem.mjs deploy CONFIG JOURNAL [--send] | enroll PROBLEM_DIR POLICY_SHA [--send]');
