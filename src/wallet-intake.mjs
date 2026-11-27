import fs from 'node:fs';
import {isAddress} from 'viem';
import {parseProblemJSON,readProblemFile,sha256,stableJSON} from './open-research.mjs';
import {validateNativeDeploymentReceipt} from './deployment-receipt.mjs';
import {digest} from './security.mjs';
import {confirmedUndetermined} from '../github/review-transaction.mjs';
import {clientFor,read} from '../github/runtime.mjs';

export function intakeConfig(problem){
 const d=problem.deployment;
 return {version:"wallet-intake-v1",problem:d.problem,repository:d.repository,ledger:d.contract,policy:problem.policyHash};
}

export function walletRequest(candidate,previous=''){
 return {method:previous?'request_retry':'submit',args:[digest(candidate.claim),candidate.claim.pr,candidate.commentId,...(previous?[previous]:[])]};
}

export function walletIntake(problem,client=clientFor()){
 const d=parseProblemJSON(readProblemFile(problem.root,'.open-math/wallet-intake.json'));
 const config=intakeConfig(problem);
 const codeHash=sha256(fs.readFileSync(new URL('../contracts/wallet_intake.py',import.meta.url)));
 if(d.chainId!==61999||!isAddress(d.contract)||!isAddress(d.deployer)||!/^0x[a-f0-9]{64}$/.test(d.deploymentTx)||
    d.codeHash!==codeHash||stableJSON(d.config)!==stableJSON(config))throw Error('Wallet intake deployment does not match the reviewed track');
 let ready;
 async function verify(){
  if(Number(await client.getChainId())!==61999)throw Error('Stable Studio chain 61999 required');
  const receipt=await client.getTransaction({hash:d.deploymentTx});
  validateNativeDeploymentReceipt(receipt,{hash:d.deploymentTx,sender:d.deployer,codeHash,config});
  const address=receipt.data?.contract_address||receipt.to_address;
  if(address.toLowerCase()!==d.contract.toLowerCase()||stableJSON(await read(client,d.contract,'get_config',[]))!==stableJSON(config))
   throw Error('Native wallet intake address or configuration mismatch');
 }
 return {contract:d.contract,async has(candidate,prior=''){
  await (ready??=verify());
  const args=[candidate.claim.wallet,digest(candidate.claim),candidate.claim.pr,candidate.commentId,prior];
  const exists=await read(client,d.contract,'has_request',args);
  if(typeof exists!=='boolean')throw Error('Invalid finalized intake response');
  return exists;
 },async canRetry(candidate,hash,round){
  await (ready??=verify());
  const receipt=await client.getTransaction({hash});
  return confirmedUndetermined(receipt,{hash,address:config.ledger,sender:problem.deployment.executor,args:[candidate.id,round]});
 }};
}
