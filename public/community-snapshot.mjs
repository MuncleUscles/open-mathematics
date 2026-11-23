// A published read model, never transaction, scoring or merge authority.
// Unknown fields are tolerated for forward-compatible display; known fields fail closed.
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const text=(x,max=500,min=1)=>typeof x==='string'&&[...x].length>=min&&[...x].length<=max;
const uint=x=>(typeof x==='number'&&Number.isSafeInteger(x)&&x>=0)||(typeof x==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(x));
const address=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{40}$/.test(x);
const hash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(x);
const authorId=x=>typeof x==='string'&&/^author-[0-9a-f]{32}$/.test(x);
const caseId=x=>typeof x==='string'&&/^case-[0-9a-f]{32}$/.test(x);
const sides=new Set(['p-equals-np','p-not-equals-np','shared']);
const modes=new Set(['discovery','formalization','extension','integration','unclassified-legacy']);
const array=(x,max,predicate)=>Array.isArray(x)&&x.length<=max&&x.every(predicate);
const unique=(items,key)=>new Set(items.map(key)).size===items.length;
const https=x=>{try{const u=new URL(x);return text(x,2048)&&u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const source=x=>object(x)&&https(x.reference)&&text(x.title,300)&&array(x.authors,8,a=>text(a,160))&&x.authors.length>0&&text(x.relationship,1500)&&text(x.priority_evidence,1500);
const allocation=x=>object(x)&&authorId(x.author_id)&&uint(x.points);
const jsonObjects=(x,max)=>array(x,max,object);
const recordId=x=>x?.evidence?.id;
function boundedJSON(value){
 let remaining=200000;
 const walk=(x,depth)=>{
  if(--remaining<0||depth>24)return false;
  if(x===null||typeof x==='boolean')return true;
  if(typeof x==='string')return x.length<=64000;
  if(typeof x==='number')return Number.isFinite(x);
  if(Array.isArray(x))return x.length<=2048&&x.every(v=>walk(v,depth+1));
  return object(x)&&Object.keys(x).length<=200&&Object.entries(x).every(([k,v])=>k.length<=200&&walk(v,depth+1));
 };
 return walk(value,0)&&JSON.stringify(value).length<=8*1024*1024;
}
function affiliation(a){return object(a)&&address(a.wallet)&&sides.has(a.side)&&uint(a.changed_at)&&array(a.history,50,e=>object(e)&&sides.has(e.side)&&uint(e.at));}
function author(a){return object(a)&&authorId(a.id)&&text(a.name,160)&&array(a.sources,4,https)&&a.sources.length>0&&uint(a.unclaimed_points)&&(a.claimed_wallet===null||address(a.claimed_wallet))&&jsonObjects(a.claim_history,100);}
function record(r){return object(r)&&object(r.evidence)&&id(recordId(r))&&address(r.evidence.wallet)&&uint(r.evidence.pr)&&Number.isSafeInteger(Number(r.evidence.pr))&&Number(r.evidence.pr)>0&&array(r.evidence.dependencies,100,id)&&['submitted','provisional','challenged','approved','credited','rejected','expired'].includes(r.status)&&uint(r.credited_points)&&(!r.evidence.research_direction||sides.has(r.evidence.research_direction));}
function provenance(p){return object(p)&&id(p.contribution)&&uint(p.version)&&modes.has(p.mode)&&array(p.sources,4,source)&&uint(p.original_initial_points)&&uint(p.current_initial_points)&&uint(p.revoked_points)&&array(p.external_allocations,32,allocation)&&jsonObjects(p.corrections,100);}
function nativeCase(c){return object(c)&&caseId(c.id)&&['attribution','authorship','external-solution'].includes(c.kind)&&id(c.target)&&address(c.reporter)&&object(c.payload)&&array(c.payload.sources,4,source)&&['submitted','verified','provisional','challenged','settled','expired','withdrawn'].includes(c.status)&&uint(c.round)&&Number(c.round)<=2&&uint(c.deadline)&&jsonObjects(c.history,100)&&(c.verdict===null||object(c.verdict));}
function impact(v){
 if(!object(v)||!id(v.downstream)||!['not-requested','reviewing','provisional','challenged','settled'].includes(v.status))return false;
 if(v.status==='not-requested')return true;
 return uint(v.budget)&&uint(v.round)&&Number(v.round)<=2&&uint(v.deadline)&&uint(v.paid_points)&&jsonObjects(v.eligible,100)&&array(v.allocations,100,a=>object(a)&&id(a.id)&&uint(a.band)&&Number(a.band)<=3&&text(a.reason,4000))&&jsonObjects(v.challenges,2);
}
function points(v){return object(v)&&id(v.problem)&&v.transferable===false&&text(v.mode,200)&&['historical_initial_points','total_historical_initial_awarded','total_awarded','points','initial_points','impact_points','total_impact_points'].every(k=>uint(v[k]));}

/** Accept only bounded native views bound to the active v3 deployment. This
 * validates a historical display bundle, not its publisher or scientific claims. */
export function validatedCommunitySnapshot(snapshot,deployment){
 try{
  if(!object(deployment)||deployment.protocolVersion!==3||!object(snapshot)||snapshot.version!==1||!boundedJSON(snapshot))return null;
  if(!address(deployment.contract)||!address(snapshot.contract)||snapshot.contract.toLowerCase()!==deployment.contract.toLowerCase())return null;
  if(!Number.isSafeInteger(deployment.chainId)||deployment.chainId<=0||snapshot.chainId!==deployment.chainId)return null;
  if(!hash(deployment.codeHash)||!hash(deployment.policy)||snapshot.codeHash!==deployment.codeHash||snapshot.policy!==deployment.policy)return null;
  if(!text(snapshot.collectedAt,64)||!Number.isFinite(Date.parse(snapshot.collectedAt))||Date.parse(snapshot.collectedAt)>Date.now()+60000)return null;
  if(!array(snapshot.affiliations,500,affiliation)||!unique(snapshot.affiliations,a=>a.wallet.toLowerCase()))return null;
  if(!array(snapshot.authors,1024,author)||!unique(snapshot.authors,a=>a.id))return null;
  const p=snapshot.problem;
  if(!object(p)||!id(p.id)||!['open','external-solution-under-review','resolved'].includes(p.status)||!(p.target_statement_hash===null||p.target_statement_hash===''||hash(p.target_statement_hash))||!array(p.external_solutions,100,caseId))return null;
  if(!array(snapshot.records,100,record)||!unique(snapshot.records,recordId))return null;
  const accepted=new Set(snapshot.records.filter(r=>r.status==='credited').map(recordId));
  if(!array(snapshot.provenances,100,e=>object(e)&&accepted.has(e.id)&&provenance(e.value)&&e.value.contribution===e.id)||!unique(snapshot.provenances,e=>e.id)||snapshot.provenances.length!==accepted.size)return null;
  if(!array(snapshot.cases,100,nativeCase)||!unique(snapshot.cases,c=>c.id))return null;
  const records=new Set(snapshot.records.map(recordId));
  if(snapshot.impacts!==undefined&&(!array(snapshot.impacts,100,e=>object(e)&&records.has(e.id)&&impact(e.value)&&e.value.downstream===e.id)||!unique(snapshot.impacts,e=>e.id)))return null;
  if(snapshot.walletBalances!==undefined&&(!array(snapshot.walletBalances,2048,e=>object(e)&&address(e.wallet)&&points(e.value)&&e.value.problem===p.id)||!unique(snapshot.walletBalances,e=>e.wallet.toLowerCase())))return null;
  return snapshot;
 }catch{return null;}
}
