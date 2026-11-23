#!/usr/bin/env node
// Additive native account index: deployment never changes the adjudicator.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadOpenProblem,openNativeConfiguration,sha256,stableJSON} from '../src/open-research.mjs';
import {openMigrationHash} from '../src/open-snapshot.mjs';
import {validateGitHubAccountsConfig,validateGitHubAccountsDeployment} from '../src/github-accounts.mjs';
import {requireOpenNative} from '../github/open-verify.mjs';
import {read,finalized,saveJSON} from '../github/runtime.mjs';
import {loadLocalSigner} from './problem-agent.mjs';
import {createStudioClient,studioEnvelopeFailure} from '../src/studio-client.mjs';
import {validateNativeDeploymentReceipt} from '../src/deployment-receipt.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export {validateNativeDeploymentReceipt as validateGitHubAccountsDeploymentReceipt} from '../src/deployment-receipt.mjs';
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
 validateNativeDeploymentReceipt(receipt,{hash:journal.hash,sender:account.address,codeHash:intent.codeHash,config});
 const deployment={version:1,chainId:61999,contract:receipt.data?.contract_address||receipt.to_address,codeHash:intent.codeHash,
  sourceContract:config.source_contract,sourceCodeHash:problem.deployment.codeHash,sourceConfigHash:config.source_config_hash,
  problem:config.problem,repository:config.repository,policyHash:config.policy,implementationCommit};
 validateGitHubAccountsDeployment(deployment,problem);
 validateGitHubAccountsConfig(await read(client,deployment.contract,'get_config',[]),deployment);
 journal.receipt=receipt;journal.deployment=deployment;journal.status='finalized';saveJSON(journalFile,journal);
 console.log(JSON.stringify({status:journal.status,hash:journal.hash,deployment},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(error=>{console.error(String(error.message));process.exitCode=1;});
