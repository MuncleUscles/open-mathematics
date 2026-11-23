#!/usr/bin/env node
// Additive native account index: deployment never changes the adjudicator.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {abi} from 'genlayer-js';
import {loadOpenProblem,openNativeConfiguration,sha256,stableJSON} from '../src/open-research.mjs';
import {openMigrationHash} from '../src/open-snapshot.mjs';
import {validateGitHubAccountsConfig,validateGitHubAccountsDeployment} from '../src/github-accounts.mjs';
import {requireOpenNative} from '../github/open-verify.mjs';
import {read,finalized,saveJSON} from '../github/runtime.mjs';
import {loadLocalSigner} from './problem-agent.mjs';
import {createStudioClient,studioEnvelopeFailure} from '../src/studio-client.mjs';
import {verifyFinalizedOutcome} from '../src/studio.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function validateGitHubAccountsDeploymentReceipt(receipt,{hash,sender,codeHash,config}){
 verifyFinalizedOutcome(receipt);
 if(typeof receipt.hash!=='string'||receipt.hash.toLowerCase()!==hash.toLowerCase()||
  typeof receipt.from_address!=='string'||receipt.from_address.toLowerCase()!==sender.toLowerCase())
  throw Error('Deployment receipt binding mismatch');
 // A matching constructor view does not prove which program was deployed.
 // The finalized receipt must contain the exact reviewed source and call bytes.
 const encoded=receipt.data?.contract_code;
 if(typeof encoded!=='string'||encoded.length===0||encoded.length>2*1024*1024||
  !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
  throw Error('Canonical deployment source bytes required');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded||sha256(bytes)!==codeHash)throw Error('Deployed source differs from reviewed code');
 const calldata=receipt.data?.calldata,raw=calldata?.raw;
 if(!Array.isArray(raw)||raw.length===0||raw.length>65536||raw.some(value=>!Number.isInteger(value)||value<0||value>255))
  throw Error('Exact constructor calldata bytes required');
 const actual=Buffer.from(raw),expected=Buffer.from(abi.calldata.encode({args:[JSON.stringify(config)]}));
 if(!actual.equals(expected)||
  (Object.hasOwn(calldata,'base64')&&calldata.base64!==actual.toString('base64')))
  throw Error('Deployment constructor differs from reviewed serialization');
 const address=receipt.data?.contract_address;
 if(address!==undefined&&receipt.to_address!==undefined&&
  (typeof address!=='string'||typeof receipt.to_address!=='string'||address.toLowerCase()!==receipt.to_address.toLowerCase()))
  throw Error('Deployment contract address mismatch');
 return receipt;
}
export async function run(argv=process.argv.slice(2)){
 const [command,directory,journalFile,...flags]=argv;
 if(command!=='deploy'||!directory||!journalFile||flags.length>1||flags.some(x=>x!=='--send'))
  throw Error('Usage: manage-github-accounts.mjs deploy TRUSTED_PROBLEM JOURNAL [--send]');
 const problem=loadOpenProblem(directory),source=openNativeConfiguration(problem);
 const config={version:1,source_contract:problem.deployment.contract,source_config_hash:openMigrationHash(source),
  problem:source.problem,repository:source.repository,policy:source.policy};
 execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:root,stdio:'pipe'});
 if(execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim())throw Error('Untracked files in reviewed account implementation');
 const implementationCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const code=fs.readFileSync(path.join(root,'contracts/github_accounts.py'),'utf8');
 const intent={version:1,chainId:61999,implementationCommit,codeHash:sha256(code),config,configJSONHash:sha256(JSON.stringify(config))};
 if(!flags.includes('--send')){console.log(JSON.stringify({action:'deploy',...intent},null,2));return;}
 const account=loadLocalSigner(process.env.OPERATOR_KEY_FILE,[root,problem.root]);
 const client=createStudioClient({account});await requireOpenNative(problem,client);
 const journal=fs.existsSync(journalFile)?JSON.parse(fs.readFileSync(journalFile,'utf8')):{...intent,sender:account.address,status:'prepared'};
 if(stableJSON(Object.fromEntries(Object.keys(intent).map(k=>[k,journal[k]])))!==stableJSON(intent)||journal.sender!==account.address)
  throw Error('Saved deployment intent or signer changed');
 if(journal.hash&&!/^0x[a-fA-F0-9]{64}$/.test(journal.hash))throw Error('Invalid deployment hash');
 if(!journal.hash){
  if(journal.status!=='prepared')throw Error('Prior deployment broadcast outcome unknown; inspect history before reconciliation');
  journal.status='broadcasting';journal.startedAt=new Date().toISOString();saveJSON(journalFile,journal);
  try{journal.hash=await client.deployContract({code,args:[JSON.stringify(config)],leaderOnly:false});}
  catch(error){journal.transportFailure=studioEnvelopeFailure(error);saveJSON(journalFile,journal);throw error;}
  journal.status='broadcast';saveJSON(journalFile,journal);
 }
 const receipt=await finalized(client,journal.hash);
 validateGitHubAccountsDeploymentReceipt(receipt,{hash:journal.hash,sender:account.address,codeHash:intent.codeHash,config});
 const deployment={version:1,chainId:61999,contract:receipt.data?.contract_address||receipt.to_address,codeHash:intent.codeHash,
  sourceContract:config.source_contract,sourceCodeHash:problem.deployment.codeHash,sourceConfigHash:config.source_config_hash,
  problem:config.problem,repository:config.repository,policyHash:config.policy,implementationCommit};
 validateGitHubAccountsDeployment(deployment,problem);
 validateGitHubAccountsConfig(await read(client,deployment.contract,'get_config',[]),deployment);
 journal.receipt=receipt;journal.deployment=deployment;journal.status='finalized';saveJSON(journalFile,journal);
 console.log(JSON.stringify({status:journal.status,hash:journal.hash,deployment},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(error=>{console.error(String(error.message));process.exitCode=1;});
