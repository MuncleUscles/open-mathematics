import test from 'node:test';
import assert from 'node:assert/strict';
import {abi} from 'genlayer-js';
import {privateKeyToAccount} from 'viem/accounts';
import {prepareWalletSubmission} from '../public/open/wallet-submission.mjs';
import tracks from '../public/open/wallet-tracks.json' with {type:'json'};
import {canonical,message,digest} from '../src/security.mjs';
import {walletRequest} from '../src/wallet-intake.mjs';
import {cliSubmission} from '../scripts/research-request.mjs';
test('official CLI preview only offers calls with the exact native argument types',()=>{
 const address=tracks['p-vs-np'].intake,hash='ab'.repeat(32);
 assert.equal(cliSubmission(address,{method:'submit',args:[hash,9,50]}),`genlayer write ${address} submit --args ${hash} 9 50`);
 for(const digest of ['3'.repeat(64),'0000001e'+'0'.repeat(56)]){
  assert.equal(cliSubmission(address,{method:'submit',args:[digest,9,50]}),null);
 }
 assert.equal(cliSubmission(address,{method:'request_retry',args:[hash,9,50,'0x'+hash]}),null);
});
const wallet=privateKeyToAccount('0x'+'31'.repeat(32));
for(const [track,binding] of Object.entries(tracks)){
 test(track+' browser and agent use identical track, sender and typed request arguments',async()=>{
  const repository='MuncleUscles/'+track,commentId=232,when=new Date().toISOString(),pr=17,
   claim={version:4,chainId:61999,repository,problem:track,contract:binding.ledger,policy:binding.policy,domain:'https://muncleuscles.github.io',
    submission_path:'research/submissions/proof.json',submission_hash:'a'.repeat(64),nonce:'1'.repeat(32),pr,branch:'research',head:'a'.repeat(40),base:'b'.repeat(40),wallet:wallet.address,expires:Date.parse(when)+60000,protocol_commit:'1'.repeat(40)};
  const signature=await wallet.signMessage({message:message(claim)});
  const comment={id:commentId,user:{id:9},created_at:when,updated_at:when,issue_url:'https://api.github.com/repos/'+repository+'/issues/17',
   body:'Open-Mathematics-Claim: '+digest(claim)+'\n```json\n'+canonical({claim,signature})+'\n```'};
  const pull={user:{id:9},head:{sha:claim.head},base:{ref:'research',sha:claim.base,repo:{full_name:repository}},state:'open',merged:false};
  const readGitHub=async path=>path.includes('issues')?comment:path.includes('pulls')?pull:{repository,protocol:{commit:claim.protocol_commit}};
  const client={readContract:async({address,functionName,args,transactionHashVariant})=>{
   assert.equal(address,binding.intake);assert.equal(transactionHashVariant,'latest-final');
   if(functionName==='get_config')return {version:'wallet-intake-v1',ledger:binding.ledger,policy:binding.policy,repository,problem:track};
   assert.deepEqual(args,[wallet.address,digest(claim),pr,commentId,'']);return false;
  }};
  const url='https://github.com/'+repository+'/pull/17#issuecomment-232';
  const result=await prepareWalletSubmission(url,'',{readGitHub,client});
  assert.deepEqual({method:result.method,args:result.args},walletRequest({claim,commentId}));
  assert.equal(result.wallet,wallet.address);assert.equal(result.address,binding.intake);
  const id='pr-'+pr+'-'+claim.head.slice(0,12)+'-'+digest(claim).slice(0,12),prior='0x'+'88'.repeat(32);
  const report={id,commentId,commentCreatedAt:when,contract:binding.ledger,chainId:61999,repository,pr,
   head:claim.head,base:claim.base,claim:{claim,signature},transactions:{'adjudicate-r0':{hash:prior}}};
  const executor='0x'+'e3'.repeat(20);
  const record={status:'submitted',round:0,adjudication_started_round:0,adjudication_finished_round:-1};
  const calldata=round=>({calldata:{raw:[...abi.calldata.encode({method:'adjudicate',args:[id,round]})]}});
  const receipt={hash:prior,to_address:binding.ledger,from_address:executor,leader_only:false,status:7,statusName:'FINALIZED',
   lifecycle:{state:'finalized',outcome:'undetermined'},result:2,result_name:'MAJORITY_DISAGREE',data:calldata(0)};
  const retryDeps={readGitHub:async path=>path.includes('reports/')?report:readGitHub(path),client:{
   getTransaction:async()=>receipt,
   readContract:async query=>{
    if(query.address===binding.ledger)return query.functionName==='get_config'?{executor}:record;
    if(query.functionName==='get_config')return client.readContract(query);
    assert.deepEqual(query.args,[wallet.address,digest(claim),pr,commentId,prior]);return false;
   }}};
  const retry=await prepareWalletSubmission(url,prior,retryDeps);
  assert.deepEqual({method:retry.method,args:retry.args},walletRequest({claim,commentId},prior));
  for(const change of [{statusName:'ACCEPTED'},{from_address:wallet.address},{data:calldata('0')},
                       {result:6},{hash:'0x'+'77'.repeat(32)}]){
   const original={...receipt};Object.assign(receipt,change);
   await assert.rejects(prepareWalletSubmission(url,prior,retryDeps),/eligible for a retry/);
   Object.assign(receipt,original);
  }
  record.adjudication_finished_round=0;
  await assert.rejects(prepareWalletSubmission(url,prior,retryDeps),/eligible for a retry/);
  pull.head.sha='e'.repeat(40);
  await assert.rejects(prepareWalletSubmission(url,'',{readGitHub,client}),/current PR/);
 });
}
