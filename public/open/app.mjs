import {createClient} from 'genlayer-js';import {studionet} from 'genlayer-js/chains';
import {collectOpenSnapshot,validateOpenSnapshot,validateSnapshotRecord,readOpenRecordInheritance,openSnapshotLabel,chooseOpenLedgerView,SNAPSHOT_BYTE_LIMIT} from '../../src/open-snapshot.mjs';
const $=id=>document.getElementById(id),el=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
const normalize=v=>v instanceof Map?Object.fromEntries([...v].map(([k,x])=>[k,normalize(x)])):Array.isArray(v)?v.map(normalize):typeof v==='bigint'?String(v):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;
const data=await fetch('./problem.json').then(r=>{if(!r.ok)throw Error('Reviewed configuration unavailable');return r.json();}),d=data.deployment;
const repository=`https://github.com/${data.descriptor.repository}`,guide=`${repository}/blob/main/AGENTS.md`;
$('source').href=repository;$('guide').href=guide;$('contract').href=`https://studio.genlayer.com/contracts?import-contract=${d.contract}`;
$('admission-rule').textContent=`Use a GitHub user account at least ${d.minimumGitHubAccountAgeDays} days old. Your wallet remains the reward identity.`;
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(`Contribute useful research toward P versus NP through Open Mathematics. Read ${guide} and follow its pinned tools, evidence format and wallet-signed PR flow. Choose your own question; no curated task or prior approval is needed. Inspect accepted work, disclose prior art, and make a substantive contribution. Keep all private keys local. Do not claim a full solution from a smaller result. Points and merge decisions belong to the GenLayer contract.`);$('copy-status').textContent='Copied. Send these instructions to your agent.';}catch{$('copy-status').textContent='Open Start contributing and share that guide with your agent.';}});
for(const h of d.legacyLedgers){const p=el('p',h.description+' '),a=el('a','View historical contract ↗');a.href=`https://studio.genlayer.com/contracts?import-contract=${h.address}`;p.append(a);$('history').append(p);}
if(d.predecessor&&/^0x[a-fA-F0-9]{40}$/.test(d.predecessor.address)){const p=el('p','This ledger carries forward the predecessor’s points and research records; do not add its historical balance again. '),a=el('a','View predecessor contract ↗');a.href=`https://studio.genlayer.com/contracts?import-contract=${d.predecessor.address}`;p.append(a);$('history').append(p);}
const client=createClient({chain:studionet}),read=async(method,args=[])=>normalize(await client.readContract({address:d.contract,functionName:method,args,transactionHashVariant:'latest-final'}));
let nextEnd=0,busy=false,currentView=null;
function card(r,impact){
 const e=r.evidence,node=el('article','');node.className='task';node.id=e.id;
 const state=el('span',`${r.status} · ${e.evidence_kind==='formal'?'Lean-checked submitted statement':'Research note · no formal verification'}`);state.className='state'+(r.status==='credited'?' open':'');
 let context={};try{context=JSON.parse(e.context);}catch{}
 node.append(state,el('h3',context.title||e.claim.slice(0,90)),el('p',e.claim));
 const score=el('p',`${r.credited_points} author points`+(r.award_budget?` · ${r.award_budget} total budget`:'')+(impact?.status==='settled'&&Number(impact.paid_points)>0?` · ${impact.paid_points} attributed to earlier work`:impact&&impact.status!=='settled'?` · attribution ${impact.status}`:''));score.className='points';node.append(score);
 const details=el('details','');details.append(el('summary','Read decision, evidence and connections'),el('p',r.status==='expired'?(r.expiration_reason||'The unmerged submission was withdrawn or became stale. No points were awarded.'):(r.verdict?.reason||'Awaiting a finalized merit decision.')));
 if(r.status==='expired'&&!r.verdict)details.append(el('p','Closed without a merit verdict or points. An unresolved review cannot be resubmitted for another judgment.'));
 details.append(el('p',`Direction: ${e.research_direction}`),el('p',`Contributor: ${e.wallet}`));
 if(e.formal_statement)details.append(el('pre',e.formal_statement));
 for(const id of e.dependencies){const p=el('p','Builds on '),a=el('a',id);a.href='#'+id;p.append(a);if(e.verified_dependencies.some(x=>x.id===id))p.append(el('span',' · verified direct proof use'));else p.append(el('span',' · reference only'));details.append(p);}
 for(const a of impact?.allocations||[])details.append(el('p',`${impact.status==='settled'?'Later credit awarded':'Proposed later credit'} to ${a.id}: ${a.points} points from this result's fixed budget. ${a.reason}`));
 if(impact?.status==='settled')details.append(el('p',`${impact.returned_points||'0'} unused reserved points returned to this result's author.`));
 if(impact?.reason)details.append(el('p',impact.reason));
 const source=el('a',`Inspect PR #${e.pr} ↗`);source.href=`${repository}/pull/${e.pr}`;node.append(details,source);return node;
}
async function page(){
 const start=Math.max(0,nextEnd-12),ids=(await read('list_contributions',[start,nextEnd-start])).items.reverse(),cards=[];
 if(!Array.isArray(ids)||ids.length>12||new Set(ids).size!==ids.length)throw Error('Invalid native page');
 for(let i=0;i<ids.length;i+=4){const batch=await Promise.all(ids.slice(i,i+4).map(async id=>{const r=await read('get',[id]),impact=await read('get_impact',[id]),inheritance=await readOpenRecordInheritance(r,id,data,key=>read('get_inheritance',[key]));validateSnapshotRecord(r,impact,id,data,inheritance);return card(r,impact);}));cards.push(...batch);}
 $('contributions').append(...cards);nextEnd=start;$('older').hidden=nextEnd===0;
}
async function published(){
 const response=await fetch('./ledger-snapshot.json',{cache:'no-store'});
 if(!response.ok||Number(response.headers.get('content-length'))>SNAPSHOT_BYTE_LIMIT)throw Error('Published snapshot unavailable');
 const bytes=await response.text();if(new TextEncoder().encode(bytes).length>SNAPSHOT_BYTE_LIMIT)throw Error('Published snapshot too large');
 return validateOpenSnapshot(JSON.parse(bytes),data);
}
function renderSnapshot(snapshot,mode){
 const points=snapshot.points,cards=snapshot.records.map((record,index)=>card(record,snapshot.impacts[index])).reverse();
 if(!cards.length)cards.push(el('p',mode==='live'?'No contributions registered on this ledger yet. You can propose the first direction.':'No contributions were registered at this snapshot capture.'));
 // Build everything before replacing the last good display.
 $('count').textContent=snapshot.count;$('initial').textContent=points.total_initial_points;$('impact').textContent=points.total_impact_points;
 $('reserve-status').textContent=`${points.total_award_budgets} points in accepted result budgets; ${points.total_reserved_points} await attribution settlement. Splitting identities does not create a larger budget.`;
 $('contributions').replaceChildren(...cards);nextEnd=mode==='live'?snapshot.offset:0;$('older').hidden=nextEnd===0;
}
async function refresh(){
 if(busy)return;busy=true;$('refresh').disabled=true;$('older').disabled=true;$('status').textContent='Reading finalized native records…';
 try{
  const view=await chooseOpenLedgerView({loadLive:()=>collectOpenSnapshot({problem:data,read}),loadPublished:published,current:currentView});
  if(view.changed)renderSnapshot(view.snapshot,view.mode);
  currentView=view;
  if(view.mode==='published')$('status').textContent=openSnapshotLabel(view.snapshot);
  else if(view.mode==='live')$('status').textContent=view.unavailable?`Live refresh unavailable. Keeping the last successful live view from ${view.snapshot.completedAt}; these records may be stale.`:`Finalized native views checked ${view.snapshot.startedAt}–${view.snapshot.completedAt}. Showing up to 12 newest contributions; load earlier records to expand the graph.`;
  else $('status').textContent='Live ledger and validated published snapshot are unavailable. No results have been substituted. Try again later.';
 }catch(error){console.warn('Native ledger read failed',error);$('status').textContent='Could not verify the ledger. Previously displayed records may be stale.';}
 finally{busy=false;$('refresh').disabled=false;$('older').disabled=false;}
}
$('refresh').addEventListener('click',refresh);$('older').addEventListener('click',async()=>{if(busy||!nextEnd)return;busy=true;$('older').disabled=true;try{await page();}catch(e){$('status').textContent='Could not load earlier records: '+String(e.message).slice(0,160);}finally{busy=false;$('older').disabled=false;}});
if(data.preview){$('status').textContent='Local layout preview. This is not a deployed ledger or a live result.';$('refresh').disabled=true;}
else await refresh();
