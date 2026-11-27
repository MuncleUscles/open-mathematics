import {mountResearchCommunity} from './research-community.mjs';
import {createNativeReader} from './native-read.mjs';
import {readContributionInspection,contributionInspectionMarkup} from './contribution-inspection.mjs';
import {validatedCommunitySnapshot} from './community-snapshot.mjs';
import {createClient} from 'genlayer-js';import {studionet} from 'genlayer-js/chains';
const repo='MuncleUscles/open-mathematics',root=`https://raw.githubusercontent.com/${repo}/evidence/`;
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize=x=>x instanceof Map?Object.fromEntries([...x].map(([k,v])=>[k,normalize(v)])):Array.isArray(x)?x.map(normalize):typeof x==='bigint'?String(x):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,normalize(v)])):x;
const client=createClient({chain:studionet});
const chainRead=createNativeReader((address,functionName,args)=>client.readContract({address,functionName,args,transactionHashVariant:'latest-final'}).then(normalize));
const el=document.querySelector('#live-research');let latest,refreshing=false;
async function inspect(entry){
 const dialog=document.querySelector('#modal');document.querySelector('#modal-label').textContent='REAL PR · GENLAYER STUDIO';
 const body=document.querySelector('#modal-body');body.innerHTML='<h2>Reading the evidence…</h2>';dialog.showModal();
 try{
  const r=await fetch(entry.local?'live-example.json':root+entry.report).then(r=>{if(!r.ok)throw Error('Evidence unavailable');return r.json();});
  const deployment=await fetch('deployment-metadata.json',{cache:'no-store'}).then(r=>r.json()).catch(()=>null);
  const address=deployment?.contract||latest?.deployment?.contract||r.contract;
  const view=await readContributionInspection({read:chainRead,address,report:r,deployment,loadSnapshot:async()=>{
   const response=await fetch('community-snapshot.json',{cache:'no-store'});if(!response.ok)throw Error('Snapshot unavailable');return response.json();
  }});
  body.innerHTML=contributionInspectionMarkup({view,report:r,address,reportURL:entry.local?'live-example.json':root+entry.report,runURL:entry.run});
 }catch(e){body.textContent=e.message;}
}
async function refresh(){if(refreshing)return;refreshing=true;try{
 const r=await fetch(root+'index.json?refresh='+Math.floor(Date.now()/30000));if(!r.ok)throw Error();latest=await r.json();
 const entries=latest.entries||[];
 const active=await fetch('deployment-metadata.json',{cache:'no-store'}).then(r=>r.json());
 const published=await fetch('community-snapshot.json').then(r=>r.ok?r.json():null).catch(()=>null);
 const snapshot=validatedCommunitySnapshot(published,active);
 if(snapshot){
  for(const e of entries.filter(e=>e.status==='credited')){
   const record=snapshot.records.find(r=>r.evidence.id===e.id);
   const provenance=snapshot.provenances.find(p=>p.id===e.id)?.value;
   const impact=snapshot.impacts?.find(p=>p.id===e.id)?.value;
   if(record?.status==='credited'&&provenance&&impact){e.currentInitial=provenance.current_initial_points;e.impact=impact;e.snapshotAt=snapshot.collectedAt;}
  }
 }
 await Promise.all(entries.filter(e=>e.status==='credited').map(async e=>{
  try{const [impact,provenance]=await Promise.all([chainRead(active.contract,'get_impact',[e.id]),Number(active.protocolVersion)>=3?chainRead(active.contract,'get_provenance',[e.id]):Promise.resolve(null)]);e.impact=impact;e.currentInitial=provenance?.current_initial_points??e.points;e.native=true;}catch{e.native=false;}
 }));

 const laterFor=id=>entries.filter(e=>e.impact?.status==='settled').flatMap(e=>(e.impact.allocations||[]).filter(a=>a.id===id).map(a=>({...a,native:e.native})));
 const laterPoints=id=>laterFor(id).reduce((sum,a)=>sum+a.band*100,0);
 const laterLabel=id=>laterFor(id).every(a=>a.native)?'Finalized impact reads':'Published impact evidence';
 const edges=entries.filter(e=>e.dependencies?.length&&e.status==='credited');
 el.innerHTML=`<div class="section-head"><div><span class="eyebrow-small">REAL GITHUB → LEAN → GENLAYER → POINTS</span><h2>The live research ledger</h2><button class="outline small" data-refresh-ledger>Refresh ledger</button></div><a class="outline" target="_blank" rel="noopener" href="https://github.com/${repo}">Open repository ↗</a></div><p class="muted">Indexed public evidence from actual PRs. Earlier protocol records remain historical evidence; no research side or external authorship is inferred. Select a result to read native state. Current initial allocations and later impact are shown separately when native reads succeed; the evidence view preserves historical awards. Dated published snapshots remain visible during an outage and are not current native reads.</p><div class="panel">${!entries.length?'<p class="community-empty">No indexed contribution outcomes yet. No fixture results are substituted.</p>':''}${entries.map((e,i)=>`<button class="live-result" data-live="${i}"><span><strong>PR #${e.pr} · ${h(e.title)}</strong><small>${h(e.wallet.slice(0,8))}… · ${e.native?'Finalized active contract':e.snapshotAt?'Published snapshot · '+h(e.snapshotAt):'Archived public evidence'}</small></span><span class="badge ${h(e.status)}">${h(e.status)}</span><strong>${h(e.currentInitial??e.points)} initial${laterPoints(e.id)?'<br>+ '+laterPoints(e.id)+' later<small>'+laterLabel(e.id)+'</small>':''}</strong></button>`).join('')}</div>${edges.length?`<div class="panel live-dependencies"><span class="eyebrow-small">VERIFIED DEPENDENCY GRAPH</span><h3>Earlier work, used by the next proof.</h3>${edges.map(e=>e.dependencies.map(id=>{const previous=entries.find(x=>x.id===id);return `<div class="dependency-edge"><span>PR #${previous?.pr||'?'}<br><strong>${h(previous?.title||id)}</strong></span><span aria-label="used by">→</span><span>PR #${e.pr}<br><strong>${h(e.title)}</strong></span></div><p class="fine">Exact credited artifact used in the normalized proof body. ${e.native?'Finalized impact read.':e.snapshotAt?'Published snapshot · '+h(e.snapshotAt)+'.':'Archived earlier impact report.'} Impact review: ${h(e.impact?.status||'not requested')} · ${h(e.impact?.paid_points||'0')} later points settled.</p>`}).join('')).join('')}</div>`:''}`;
 el.querySelector('[data-refresh-ledger]').onclick=refresh;
 el.querySelectorAll('[data-live]').forEach(b=>b.onclick=()=>inspect(entries[Number(b.dataset.live)]));
 }catch{el.innerHTML=`<h2>Public evidence is temporarily unavailable</h2><p>The local scenarios below remain illustrative. <a href="https://github.com/${repo}/tree/evidence">Read the public evidence on GitHub</a>.</p><button class="outline small" data-refresh-ledger>Try again</button>`;el.querySelector('[data-refresh-ledger]').onclick=refresh;}finally{refreshing=false;}}
refresh();setInterval(()=>{if(document.visibilityState==='visible')refresh();},300000);

mountResearchCommunity({chainRead});
