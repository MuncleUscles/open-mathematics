#!/usr/bin/env node
// Read-only operator preparation. The successor independently reads and checks
// this predecessor state in its constructor; these files cannot import points.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createStudioClient} from '../src/studio-client.mjs';
import {read} from '../github/runtime.mjs';
import {loadOpenProblem,openNativeConfiguration,assertOpenConfiguration,openMigrationHash} from '../src/open-research.mjs';

const need=(ok,message)=>{if(!ok)throw Error('Successor preparation: '+message);};
export const predecessorHash=openMigrationHash;

export async function capturePredecessor({problem,view}){
 const config=await view('get_config',[]);
 assertOpenConfiguration(config,openNativeConfiguration(problem));
 need(!Object.hasOwn(config,'predecessor'),'only a first successor is supported');
 const count=Number(await view('count_contributions',[]));
 need(Number.isSafeInteger(count)&&count>=1&&count<=16,'one to sixteen source contributions required');
 const page=await view('list_contributions',[0,count]);
 need(Number(page.total)===count&&page.next_offset===null&&Array.isArray(page.items)&&page.items.length===count&&new Set(page.items).size===count,'complete unique predecessor page required');
 const records=[],impacts=[];
 for(const id of page.items){
  need(typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(id),'invalid source record ID');
  const record=await view('get',[id]);
  need(record?.evidence?.id===id&&record.evidence.contract?.toLowerCase()===problem.deployment.contract.toLowerCase(),'source record binding mismatch');
  records.push(record);
  const impact=await view('get_impact',[id]);
  need(impact?.downstream===id,'source impact binding mismatch');
  impacts.push(impact);
 }
 const wallets=[...new Set(records.map(record=>record.evidence.wallet.toLowerCase()))].sort(),balances=[];
 for(const wallet of wallets){
  need(/^0x[a-f0-9]{40}$/.test(wallet),'invalid source wallet');
  balances.push({wallet,value:await view('get_points',[wallet])});
 }
 need(Number(await view('count_contributions',[]))===count,'source count changed during capture');
 return {config,records,impacts,balances};
}

export async function prepareSuccessor({problem,view}){
 const snapshot=await capturePredecessor({problem,view}),hash=predecessorHash(snapshot);
 need(predecessorHash(await capturePredecessor({problem,view}))===hash,'source changed between complete reads; no configuration produced');
 return {snapshot,config:{...openNativeConfiguration(problem),predecessor:{address:problem.deployment.contract,snapshot_hash:hash}},
  manifest:{version:1,predecessor:problem.deployment.contract,snapshotHash:hash,sourceCodeHash:problem.deployment.codeHash,
   sourceProtocolCommit:problem.descriptor.protocol.commit,recordIds:snapshot.records.map(record=>record.evidence.id),
   carriedPoints:snapshot.balances[0].value.total_awarded,newRewards:'0',readOnly:true}};
}

async function main(){
 const [directory,destination,...extra]=process.argv.slice(2);
 if(!directory||!destination||extra.length)throw Error('Usage: prepare-open-successor.mjs TRUSTED_PROBLEM NEW_OUTPUT_DIRECTORY');
 need(!fs.existsSync(destination),'output directory already exists; preserve the previous capture');
 const problem=loadOpenProblem(directory),client=createStudioClient();
 need(Number(await client.getChainId())===problem.deployment.chainId,'wrong native chain');
 const result=await prepareSuccessor({problem,view:(method,args)=>read(client,problem.deployment.contract,method,args)});
 fs.mkdirSync(destination,{recursive:false});
 for(const [name,value] of Object.entries(result))fs.writeFileSync(path.join(destination,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(result.manifest,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
