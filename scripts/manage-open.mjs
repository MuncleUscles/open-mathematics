#!/usr/bin/env node
// Trusted operator tool. Preview by default; retain broadcast intent on failure.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {isAddress} from 'viem';
import {createStudioClient,studioEnvelopeFailure} from '../src/studio-client.mjs';
import {read,finalized,saveJSON} from '../github/runtime.mjs';
import {parseProblemJSON,sha256,stableJSON,validateOpenConstructor,assertOpenConfiguration} from '../src/open-research.mjs';
import {loadLocalSigner,toolRoot} from './problem-agent.mjs';

export function deploymentIntent(code,config,protocolCommit){
 validateOpenConstructor(config);
 if(!/^[a-f0-9]{40}$/.test(protocolCommit)||protocolCommit==='0'.repeat(40))throw Error('Exact protocol commit required');
 return {chainId:61999,codeHash:sha256(code),config,configJSONHash:sha256(JSON.stringify(config)),protocolCommit};
}
export function assertDeploymentJournal(journal,intent,sender){
 const prior=Object.fromEntries(Object.keys(intent).map(key=>[key,journal[key]]));
 if(stableJSON(prior)!==stableJSON(intent)||journal.sender!==sender)throw Error('Deployment intent or signer changed');
 if(journal.hash&&!/^0x[a-fA-F0-9]{64}$/.test(journal.hash))throw Error('Invalid deployment transaction hash');
 if(!journal.hash&&journal.status!=='prepared')throw Error('Prior deployment broadcast outcome unknown. Inspect history before reconciliation; do not retry.');
}
export async function run(argv=process.argv.slice(2)){
 const [command,directory,selection,...flags]=argv,send=flags.includes('--send'),output=x=>console.log(JSON.stringify(x,null,2));
 if(command!=='deploy'||!directory||!selection||flags.some(x=>x!=='--send')||flags.length>1)throw Error('Usage: manage-open.mjs deploy CONFIG JOURNAL [--send]');
 const stat=fs.lstatSync(directory);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw Error('Bounded regular constructor config required');
 const configBytes=fs.readFileSync(directory);if(configBytes.length>32768)throw Error('Constructor config grew beyond byte bound');
 const config=parseProblemJSON(configBytes),code=fs.readFileSync(path.join(toolRoot,'contracts/research_v5.py'),'utf8');
 execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:toolRoot});
 if(execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:toolRoot,encoding:'utf8'}).trim())throw Error('Untracked files in trusted protocol checkout');
 const protocolCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:toolRoot,encoding:'utf8'}).trim(),intent=deploymentIntent(code,config,protocolCommit);
 if(!send){output({action:'deploy',network:'Studio',...intent,next:'Review the exact source/config. Repeat with --send and OPERATOR_KEY_FILE pointing to the dedicated deployment signer.'});return;}
 const account=loadLocalSigner(process.env.OPERATOR_KEY_FILE,[toolRoot]);if([config.verifier,config.executor].some(role=>role.toLowerCase()===account.address.toLowerCase()))throw Error('Use the dedicated deployment signer, separate from service roles');
 const client=createStudioClient({account});if(await client.getChainId()!==intent.chainId)throw Error('Wrong deployment chain');
 const journal=fs.existsSync(selection)?JSON.parse(fs.readFileSync(selection,'utf8')):{...intent,sender:account.address,status:'prepared'};
 assertDeploymentJournal(journal,intent,account.address);
 if(!journal.hash){
  journal.status='broadcasting';journal.startedAt=new Date().toISOString();saveJSON(selection,journal);
  try{journal.hash=await client.deployContract({code,args:[JSON.stringify(config)],leaderOnly:false});}
  catch(error){const transportFailure=studioEnvelopeFailure(error);if(transportFailure){journal.transportFailure=transportFailure;saveJSON(selection,journal);}throw error;}
  journal.status='broadcast';saveJSON(selection,journal);
 }
 const receipt=await finalized(client,journal.hash);
 if(receipt.hash?.toLowerCase()!==journal.hash.toLowerCase()||receipt.from_address?.toLowerCase()!==account.address.toLowerCase())throw Error('Deployment receipt binding mismatch');
 journal.contract=receipt.data?.contract_address||receipt.to_address;
 if(!isAddress(journal.contract)||/^0x0{40}$/i.test(journal.contract))throw Error('Finalized contract address missing');
 assertOpenConfiguration(await read(client,journal.contract,'get_config',[]),config);
 journal.receipt=receipt;journal.status='finalized';saveJSON(selection,journal);output({status:journal.status,contract:journal.contract,hash:journal.hash,codeHash:intent.codeHash,protocolCommit});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
