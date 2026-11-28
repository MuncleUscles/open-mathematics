import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {need} from './core.mjs';
const normalize=v=>v instanceof Map?Object.fromEntries([...v].map(([k,x])=>[k,normalize(x)])):Array.isArray(v)?v.map(normalize):typeof v==='bigint'?String(v):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;
export async function captureNative(source,{client=createClient({chain:studionet}),now=()=>new Date().toISOString()}={}){
 // The first two published definitions predate the problem field.
 const track=source.problem??'p-vs-np';
 const startedAt=now();need(Number(await client.getChainId())===source.chainId,'Wrong chain');
 const read=async(functionName,args=[])=>normalize(await client.readContract({address:source.contract,functionName,args,transactionHashVariant:'latest-final'}));
 const config=await read('get_config');need(config.policy===source.policyHash&&config.problem===track&&config.repository==='MuncleUscles/'+track,'Wrong research policy');
 const before=await read('get_federation_state'),total=Number(before.research_records);need(Number.isSafeInteger(total)&&total>=0&&total<=100,'Checkpoint registry exceeds bounded capacity');
 const page=await read('list_contributions',[0,100]);need(Number(page.total)===total&&page.items.length===total&&page.next_offset===null&&new Set(page.items).size===total,'Incomplete native index');
 const records=[];for(const id of page.items){const r=await read('get',[id]);need(r.evidence?.id===id&&r.evidence.contract?.toLowerCase()===source.contract.toLowerCase()&&r.evidence.problem===track&&r.evidence.policy===source.policyHash,'Native record scope mismatch');records.push(r);}
 const after=await read('get_federation_state');need(before.state_revision===after.state_revision,'Native state changed');
 return {source,startedAt,completedAt:now(),config,before,after,records,complete:true};
}
