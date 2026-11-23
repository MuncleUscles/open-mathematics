#!/usr/bin/env node
// Read-only operator preparation. The successor independently reads and checks
// this predecessor state in its constructor; these files cannot import points.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createStudioClient} from '../src/studio-client.mjs';
import {read} from '../github/runtime.mjs';
import {loadOpenProblem,openNativeConfiguration,assertOpenConfiguration,openMigrationHash,sha256,readOpenRecordInheritance} from '../src/open-research.mjs';

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

// Policy upgrades are explicit review plans, never inferred from a changed file.
export async function capturePolicyPredecessor({problem,view}){
 const config=await view('get_config',[]);
 assertOpenConfiguration(config,openNativeConfiguration(problem));
 need(Number(config.predecessor?.version)!==2,'later policy migrations require cumulative semantic fence support');
 const count=Number(await view('count_contributions',[]));
 need(Number.isSafeInteger(count)&&count>=1&&count<=16,'one to sixteen source contributions required');
 const page=await view('list_contributions',[0,16]);
 need(Number(page.total)===count&&page.next_offset===null&&Array.isArray(page.items)&&page.items.length===count&&new Set(page.items).size===count,'complete unique predecessor page required');
 const records=[],impacts=[],inheritances=[];
 for(const id of page.items){
  need(typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(id),'invalid source record ID');
  const r=await view('get',[id]),i=await view('get_impact',[id]),origin=await view('get_inheritance',[id]);
  await readOpenRecordInheritance(r,id,problem,async()=>origin);
  need(i?.downstream===id,'source impact binding mismatch');
  need(['credited','rejected','expired'].includes(r.status)&&Number(r.round)===0&&r.challenges?.length===0&&r.challenge_reviews?.length===0&&Number(r.adjudication_started_round)===0,'unsupported source history');
  if(r.status==='credited')need(r.reserve_settled===true&&r.credited_points===r.award_budget&&r.reserve_returned===r.impact_reserve&&(i.status==='settled'&&i.allocations?.length===0&&i.paid_points==='0'||r.impact_reserve==='0'&&i.status==='not-requested'),'source credit must be settled without upstream allocations');
  else need(r.credited_points==='0'&&i.status==='not-requested'&&(r.status==='expired'?r.verdict===null&&Number(r.adjudication_finished_round)===-1: r.verdict?.accept===false&&Number(r.adjudication_finished_round)===0),'unsupported unresolved source state');
  records.push(r);impacts.push(i);inheritances.push(origin);
 }
 const balances=[];
 for(const wallet of [...new Set(records.map(r=>r.evidence.wallet.toLowerCase()))].sort())balances.push({wallet,value:await view('get_points',[wallet])});
 need(Number(await view('count_contributions',[]))===count,'source count changed during capture');
 return {config,records,impacts,inheritances,balances};
}

export async function preparePolicySuccessor({problem,view,newPolicy,semanticFences,creditedOrder,sourceCode}){
 need(typeof newPolicy==='string'&&/^[a-f0-9]{64}$/.test(newPolicy)&&newPolicy!==problem.policyHash,'explicit new policy hash required');
 // The descriptor binds the reviewed address to these source bytes. Activation
 // must also verify the original deployment receipt; native has no code view.
 need(sourceCode instanceof Uint8Array&&sha256(sourceCode)===problem.deployment.codeHash,'reviewed source code bytes must match the deployment pin');
 const snapshot=await capturePolicyPredecessor({problem,view}),hash=predecessorHash(snapshot);
 need(predecessorHash(await capturePolicyPredecessor({problem,view}))===hash,'source changed between complete reads; no configuration produced');
 const formal=snapshot.records.filter(r=>r.evidence.evidence_kind==='formal').map(r=>r.evidence.id),credited=snapshot.records.filter(r=>r.status==='credited').map(r=>r.evidence.id);
 need(Array.isArray(semanticFences)&&semanticFences.length===formal.length&&semanticFences.every(a=>a&&Object.keys(a).length===2&&formal.includes(a.id)&&/^[a-f0-9]{64}$/.test(a.statement_hash))&&new Set(semanticFences.map(a=>a.id)).size===formal.length&&new Set(semanticFences.map(a=>a.statement_hash)).size===formal.length,'complete independently checked semantic fences required');
 need(Array.isArray(creditedOrder)&&creditedOrder.length===credited.length&&new Set(creditedOrder).size===credited.length&&creditedOrder.every(id=>credited.includes(id)),'explicit reviewed credit order required');
 const predecessor={version:2,address:problem.deployment.contract,snapshot_hash:hash,source_policy:problem.policyHash,source_config_hash:predecessorHash(snapshot.config),source_code_hash:problem.deployment.codeHash,
  records:snapshot.records.map((r,index)=>({id:r.evidence.id,record_hash:predecessorHash(r),impact_hash:predecessorHash(snapshot.impacts[index]),inheritance_hash:predecessorHash(snapshot.inheritances[index]),origin_contract:r.evidence.contract,origin_policy:r.evidence.policy})),credited_order:creditedOrder,semantic_fences:semanticFences};
 return {snapshot,config:{...openNativeConfiguration(problem),policy:newPolicy,predecessor},manifest:{version:2,predecessor:problem.deployment.contract,snapshotHash:hash,sourceCodeHash:problem.deployment.codeHash,sourceProtocolCommit:problem.descriptor.protocol.commit,sourceConfigHash:predecessor.source_config_hash,recordIds:snapshot.records.map(r=>r.evidence.id),carriedPoints:snapshot.balances[0].value.total_awarded,newRewards:'0',readOnly:true,sourceCodeVerification:'Reviewed bytes match descriptor; original deployment receipt must independently bind address and source.'}};
}

async function main(){
 const [directory,destination,...extra]=process.argv.slice(2);
 if(!directory||!destination||(extra.length!==0&&(extra.length!==2||extra[0]!=='--policy-upgrade')))throw Error('Usage: prepare-open-successor.mjs TRUSTED_PROBLEM NEW_OUTPUT_DIRECTORY [--policy-upgrade REVIEWED_PLAN_JSON]');
 need(!fs.existsSync(destination),'output directory already exists; preserve the previous capture');
 const problem=loadOpenProblem(directory),client=createStudioClient();
 need(Number(await client.getChainId())===problem.deployment.chainId,'wrong native chain');
 const view=(method,args)=>read(client,problem.deployment.contract,method,args);
 const plan=extra.length?JSON.parse(fs.readFileSync(extra[1],'utf8')):null;
 const result=plan?await preparePolicySuccessor({problem,view,newPolicy:plan.newPolicy,semanticFences:plan.semanticFences,creditedOrder:plan.creditedOrder,sourceCode:fs.readFileSync(plan.sourceCodePath)}):await prepareSuccessor({problem,view});
 fs.mkdirSync(destination,{recursive:false});
 for(const [name,value] of Object.entries(result))fs.writeFileSync(path.join(destination,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(result.manifest,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
