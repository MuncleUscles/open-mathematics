import {readCurrentContribution} from './native-read.mjs';
import {validatedCommunitySnapshot} from './community-snapshot.mjs';
import {escapeHTML as h,provenanceMarkup} from './research-community.mjs';

export function terminalRegistrationRejection(report){
 const rejection=report?.registrationRejection;
 return report?.status==='rejected'&&!report.record&&rejection&&/^0x[0-9a-fA-F]{64}$/.test(rejection.hash)&&typeof rejection.reason==='string'&&rejection.reason.length>0&&rejection.reason.length<=4000
  ?{hash:rejection.hash,reason:rejection.reason,stage:'GenLayer registration'}:null;
}
export function matchingSnapshotContribution(published,deployment,report){
 const snapshot=validatedCommunitySnapshot(published,deployment);
 if(!snapshot)return null;
 const record=snapshot.records.find(r=>r.evidence.id===report.id);
 if(!record)return null;
 const wallet=report.claim?.claim?.wallet||report.record?.evidence?.wallet;
 if((report.head&&record.evidence.head!==report.head)||(wallet&&record.evidence.wallet.toLowerCase()!==wallet.toLowerCase()))return null;
 return {record,provenance:snapshot.provenances.find(p=>p.id===report.id)?.value??null,impact:snapshot.impacts?.find(p=>p.id===report.id)?.value??null,points:snapshot.walletBalances?.find(p=>p.wallet.toLowerCase()===record.evidence.wallet.toLowerCase())?.value??null,source:'snapshot',collectedAt:snapshot.collectedAt};
}
export async function readContributionInspection({read,address,report,deployment,loadSnapshot}){
 const rejection=terminalRegistrationRejection(report);
 if(rejection)return {source:'registration-rejection',rejection,record:null,impact:null,points:null,provenance:null};
 try{
  const withProvenance=deployment?.protocolVersion===3&&deployment.contract.toLowerCase()===address.toLowerCase();
  // A successful primary read never borrows older subviews, even if some fail.
  const result=await readCurrentContribution(read,address,report.id,{withProvenance});
  return {...result,source:'native',unavailable:['impact','points',...(withProvenance?['provenance']:[])].filter(k=>result[k]===null)};
 }catch{
  try{const snapshot=matchingSnapshotContribution(await loadSnapshot(),deployment,report);if(snapshot)return snapshot;}catch{}
  return {record:report.record??null,impact:report.impact??null,points:report.points??null,provenance:report.provenance??null,source:'archive',collectedAt:report.updatedAt||report.completedAt||report.startedAt||null};
 }
}
export function inspectionSourceLabel(view){
 if(view.source==='snapshot')return `Published snapshot · ${view.collectedAt} · historical, not current`;
 if(view.source==='native')return view.unavailable.length?'Finalized contribution record · some subviews unavailable':'Finalized native reads';
 if(view.source==='registration-rejection')return 'Archived failed-execution receipt · no contribution record';
 return `Archived public report${view.collectedAt?' · '+view.collectedAt:''} · historical; native read unavailable`;
}
const receipt=(r,prefix)=>Object.entries(r.transactions||{}).some(([k,v])=>k.startsWith(prefix)&&v.receipt);
const link=(url,label,style='outline')=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password?`<a class="${style}" href="${h(u.href)}" target="_blank" rel="noopener">${h(label)}</a>`:'';}catch{return '';}};
export function contributionInspectionMarkup({view,report:r,address,reportURL,runURL}){
 const {record,impact,points,provenance,rejection}=view,pr=Number(r.pr),validPR=Number.isSafeInteger(pr)&&pr>0;
 const history=view.source==='snapshot'||view.source==='archive';
 const reason=rejection?.reason||record?.verdict?.reason||r.error||'Verification or adjudication is still running.';
 const title=rejection?'Registration rejected':record?.status||r.status||'Status unavailable';
 const pipeline=rejection?'<span class="rejected">Registration rejected</span><span>Merit review not reached</span><span>No merge or points</span>':`<span class="${receipt(r,'adjudicate')?'done':''}">GenLayer merit review</span><span class="${receipt(r,'finalize')?'done':''}">Finality</span><span class="${r.mergeCommit?'done':''}">GitHub merge</span><span class="${record?.status==='credited'?'done':''}">IC points</span>`;
 const source=inspectionSourceLabel(view);
 const provenanceHTML=rejection?'':view.source==='native'&&!provenance?'<section class="provenance-detail"><h3>External provenance</h3><p>Native provenance is unavailable for this read. Older provenance is not substituted.</p></section>':provenanceMarkup(record,provenance,{native:view.source==='native'&&!!provenance,historical:history,readLabel:provenance?(view.source==='snapshot'?`Published provenance snapshot · ${view.collectedAt}`:view.source==='archive'?'Archived provenance · historical':undefined):undefined});
 return `<h2>${h(title)} · PR #${validPR?pr:'unknown'}</h2><p>${h(reason)}</p>${rejection?'<p>The registration transaction finalized with failed execution. No contribution record or merit verdict was created, and this attempt awarded no points.</p>':''}${history?`<p class="fine"><strong>${h(source)}</strong>. These are historical values, not current contract state.</p>`:''}<div class="pipeline"><span class="${r.claim?.signature?'done':''}">Signed claim</span><span class="${r.attestation?'done':''}">Isolated Lean</span>${pipeline}</div><div class="kv"><span>Original initial award for this work</span><span>${rejection?'0 points':record?.credited_points!==undefined?h(record.credited_points)+' points':'Unavailable'}</span><span>${history?'Initial retention in these historical views':'Initial retention after corrections'}</span><span>${rejection?'No award':provenance?.current_initial_points!==undefined?h(provenance.current_initial_points)+' points':'Unavailable'}</span><span>${history?'Wallet’s initial / later points at collection':'Wallet’s initial / later points'}</span><span>${points?h(points.initial_points??points.points)+' / '+h(points.impact_points??'0'):'Unavailable'}</span><span>Read source</span><span>${h(source)}</span>${rejection?`<span>Failed stage</span><span>${h(rejection.stage)}</span><span>Failed transaction</span><code>${h(rejection.hash)}</code>`:''}<span>Contributor wallet</span><span>${h(record?.evidence?.wallet||r.claim?.claim?.wallet||'Unavailable')}</span><span>${rejection?'Submitted head':'Contribution head'}</span><span>${h(r.head||record?.evidence?.head||'Unavailable')}</span><span>Merge commit</span><span>${h(rejection?'Not merged by this attempt':record?.merge_commit||r.mergeCommit||'Not merged')}</span><span>Read contract</span><span>${h(address)}</span></div>${view.source==='native'&&view.unavailable.length?`<p class="fine">Unavailable native subviews: ${h(view.unavailable.join(', '))}. No archived or snapshot values are substituted for them.</p>`:''}${record?.ledger_migration||record?.migration?'<p class="fine">Historical award carried forward once through a verifier-attested frozen snapshot. Ledger versions must not be added together.</p>':''}${impact&&impact.status!=='not-requested'?`<h3>Later impact · ${h(impact.status)}${history?' · historical':''}</h3><p>${h(impact.reason)}</p><p>${h(impact.paid_points??'0')} points settled for earlier authors. Later impact is accounted separately; auditable attribution corrections can change initial retention.</p>${(impact.allocations||[]).map(a=>`<p><strong>${h(Number(a.band)*100)} points → ${h(a.id)}</strong><br>${h(a.reason)}</p>`).join('')}`:!rejection&&!impact?'<p class="fine">Later impact view unavailable.</p>':''}${provenanceHTML}<div class="dialog-actions">${validPR?link(`https://github.com/MuncleUscles/open-mathematics/pull/${pr}`,'Open real PR','primary'):''}${link(reportURL,'Full evidence & receipts')}${link(runURL,'Worker log')}</div><p class="fine">Trusted pilot operators verify and execute. Only GenLayer decides merit for admitted contributions. The pilot has separate five-minute contribution and impact windows. Native points remain nontransferable.</p>`;
}
