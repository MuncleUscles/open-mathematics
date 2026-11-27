export const DOMAIN='pnp.fun/forecast/v1';
export const MIN_SAMPLE=5;
export const SCORE_POLICY='time-weighted-brier-v1';
export const canonical=value=>JSON.stringify(sort(value));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export const bytes=text=>new TextEncoder().encode(text);
export const hex=value=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('');
export const digest=async value=>hex(await crypto.subtle.digest('SHA-256',bytes(typeof value==='string'?value:canonical(value))));
export function need(ok,message){if(!ok)throw Error(message);}
export function validateQuestion(q){
 need(q&&q.version===1&&/^[a-z0-9-]{3,80}$/.test(q.id),'Invalid question');
 for(const k of ['text','topic','criteria','inconclusivePolicy','verificationPolicy'])need(typeof q[k]==='string'&&q[k].length>0,'Missing '+k);
 const t=['opensAt','closesAt','checkpointAt','resolutionDeadline'].map(k=>Date.parse(q[k]));
 need(t.every(Number.isFinite)&&t.every((v,i)=>i===0||v>t[i-1]),'Question times must be ordered');
 need(q.scoring===SCORE_POLICY&&q.minimumCoverage===0.5&&q.minimumSample===MIN_SAMPLE,'Unknown scoring policy');
 need(['credited-formal-count','impact-points'].includes(q.predicate?.kind)&&Number.isSafeInteger(q.predicate.threshold)&&q.predicate.threshold>0,'Invalid predicate');
 need(q.evidenceSources?.length>0&&q.source?.contract&&q.source.chainId===61999&&/^[a-f0-9]{64}$/.test(q.source.policyHash),'Invalid source');
 return q;
}
export function validateForecast(f,q,now){
 need(f&&Object.keys(f).sort().join(',')==='domain,nonce,previous,probability,questionHash,questionId,reason,revision','Invalid forecast fields');
 need(f.domain===DOMAIN&&f.questionId===q.id,'Wrong forecast domain or question');
 need(Number.isInteger(f.probability)&&f.probability>=0&&f.probability<=100,'Choose a whole percentage from 0 to 100');
 need(typeof f.reason==='string'&&f.reason.length<=1000,'Reason must be at most 1,000 characters');
 need(Number.isSafeInteger(f.revision)&&f.revision>0&&f.revision<=10000,'Invalid revision');
 need(/^[a-f0-9]{64}$/.test(f.questionHash)&&/^[a-f0-9]{32}$/.test(f.nonce),'Invalid commitment');
 need(f.revision===1?f.previous===null:/^[a-f0-9]{64}$/.test(f.previous),'Invalid previous receipt');
 need(now>=Date.parse(q.opensAt)&&now<Date.parse(q.closesAt),'This question is not open');
 return f;
}
export function aggregate(rows,q,now){
 const latest=new Map();for(const r of rows){const t=Date.parse(r.acceptedAt);if(t<Date.parse(q.opensAt)||t>=Date.parse(q.closesAt)||t>now)continue;const prior=latest.get(r.participant);if(!prior||r.revision>prior.revision)latest.set(r.participant,r);}
 const ps=[...latest.values()].map(r=>r.probability).sort((a,b)=>a-b),n=ps.length;
 return {count:n,probability:n<q.minimumSample?null:n%2?ps[(n-1)/2]:(ps[n/2-1]+ps[n/2])/2,method:'Median of each browser identity’s latest accepted forecast; all submissions since opening.'};
}
export function scoreHistory(q,rows,outcome){
 need(outcome===0||outcome===1,'Only resolved binary outcomes are scored');
 const start=Date.parse(q.opensAt),end=Date.parse(q.closesAt),span=end-start;
 const rs=rows.filter(r=>Date.parse(r.acceptedAt)>=start&&Date.parse(r.acceptedAt)<end).sort((a,b)=>Date.parse(a.acceptedAt)-Date.parse(b.acceptedAt)||a.revision-b.revision);
 if(!rs.length)return null;
 let cursor=start,p=.5,loss=0;for(const r of rs){const t=Date.parse(r.acceptedAt);loss+=(t-cursor)*(p-outcome)**2;cursor=t;p=r.probability/100;}loss+=(end-cursor)*(p-outcome)**2;
 const coverage=(end-Date.parse(rs[0].acceptedAt))/span;
 return {loss:loss/span,coverage,eligible:coverage>=q.minimumCoverage};
}
export function leaderboard(questions,rows,resolutions){
 const people=new Map();for(const q of questions){const resolution=resolutions.find(r=>r.questionId===q.id);if(resolution?.status!=='resolved')continue;
  for(const participant of new Set(rows.filter(r=>r.questionId===q.id).map(r=>r.participant))){const s=scoreHistory(q,rows.filter(r=>r.questionId===q.id&&r.participant===participant),resolution.outcome);if(!s?.eligible)continue;const p=people.get(participant)||{participant,resolved:0,totalLoss:0};p.resolved++;p.totalLoss+=s.loss;people.set(participant,p);}}
 return [...people.values()].map(p=>({participant:p.participant,resolved:p.resolved,brier:p.totalLoss/p.resolved})).sort((a,b)=>a.brier-b.brier||b.resolved-a.resolved||a.participant.localeCompare(b.participant));
}
export function resolveCheckpoint(q,evidence){
 need(evidence.complete===true&&evidence.source.contract===q.source.contract&&evidence.source.chainId===q.source.chainId&&evidence.source.policyHash===q.source.policyHash,'Incomplete or mismatched native evidence');
 const start=Date.parse(evidence.startedAt),end=Date.parse(evidence.completedAt);
 need(start>=Date.parse(q.checkpointAt)&&end<=Date.parse(q.resolutionDeadline)&&end>=start,'Outside checkpoint interval');
 need(evidence.before.state_revision===evidence.after.state_revision,'Native state changed during capture');
 need(evidence.records.length===Number(evidence.before.research_records)&&new Set(evidence.records.map(r=>r.evidence.id)).size===evidence.records.length,'Incomplete registry');
 const value=q.predicate.kind==='credited-formal-count'?evidence.records.filter(r=>r.status==='credited'&&r.evidence.evidence_kind==='formal'&&r.evidence.verification==='verified').length:Number(evidence.after.total_impact_points);
 need(Number.isFinite(value)&&value>=0,'Invalid native metric');
 return {questionId:q.id,status:'resolved',outcome:value>=q.predicate.threshold?1:0,value,method:'Deterministic finalized native ledger checkpoint',finalGenLayerDecision:{contract:q.source.contract,variant:'latest-final',stateRevision:evidence.after.state_revision}};
}
