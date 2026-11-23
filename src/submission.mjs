import {isAddress} from 'viem';
const fail=m=>{throw Error('Submission record: '+m);};
const object=(x,keys,label)=>{if(!x||typeof x!=='object'||Array.isArray(x))fail(label+' must be an object');if(Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k)))fail(label+' has missing or unknown fields');};
const str=(x,min,max,label)=>{if(typeof x!=='string'||x.trim().length<min||x.length>max)fail(label+' must contain '+min+'–'+max+' characters');};
export const RESEARCH_DIRECTIONS=['p-equals-np','p-not-equals-np','shared'];
export const PROVENANCE_MODES=['discovery','formalization','extension','integration'];
export function validateProvenance(p){
 object(p,['mode','sources','discovery_basis'],'provenance');
 if(!PROVENANCE_MODES.includes(p.mode))fail('invalid provenance mode');
 if(!Array.isArray(p.sources)||p.sources.length>4)fail('provenance sources must list at most four sources');
 str(p.discovery_basis,0,2000,'discovery basis');
 if(['formalization','integration'].includes(p.mode)&&p.sources.length===0)fail('formalization and integration require at least one actual external source');
 if((p.mode==='discovery'||p.sources.length===0)&&p.discovery_basis.trim().length<40)fail('provide an honest discovery basis of at least 40 characters, including search limits');
 const urls=new Set();
 for(const source of p.sources){
  object(source,['reference','title','authors','relationship','priority_evidence'],'provenance source');
  str(source.reference,8,1000,'source reference');let url;
  try{url=new URL(source.reference);}catch{fail('source reference must be an HTTPS URL');}
  if(url.protocol!=='https:'||url.username||url.password||source.reference.trim()!==source.reference||!url.hostname||url.hostname.endsWith('.invalid'))fail('source reference must be an actual HTTPS URL without credentials');
  if(urls.has(url.href))fail('duplicate provenance source');urls.add(url.href);
  str(source.title,3,300,'source title');str(source.relationship,30,1500,'source relationship');str(source.priority_evidence,20,1500,'source priority evidence');
  if(!Array.isArray(source.authors)||source.authors.length<1||source.authors.length>8)fail('each source must identify one to eight authors');
  const authors=new Set();for(const author of source.authors){str(author,1,160,'external author');const normalized=author.trim().normalize('NFKC').toLowerCase();if(authors.has(normalized))fail('duplicate author within a source');authors.add(normalized);}
 }
 // These declarations are evidence for review, not proof of priority, identity,
 // global novelty or ownership. In particular, sources never choose a wallet.
 if(p.discovery_basis.startsWith('REPLACE:')||p.sources.some(s=>[s.title,s.relationship,s.priority_evidence,...s.authors].some(v=>v.startsWith('REPLACE:'))))fail('replace provenance placeholders with actual evidence');
 return p;
}
export function validateSubmission(s,{wallet,goals}){
 object(s,['schema_version','problem','kind','title','claim','novelty','prior_art','research_direction','provenance','evidence','dependencies','attribution','limitations'],'root');
 if(s.schema_version!==2||s.problem!=='p-vs-np')fail('wrong schema or problem');
 if(!RESEARCH_DIRECTIONS.includes(s.research_direction))fail('invalid research direction');
 validateProvenance(s.provenance);
 if(!['lemma','counterexample','algorithm','construction','failed-approach','infrastructure'].includes(s.kind))fail('unknown kind');
 for(const [field,min,max] of [['title',8,160],['claim',40,3000],['novelty',40,2000],['limitations',30,2000]])str(s[field],min,max,field);
 if(!Array.isArray(s.prior_art)||s.prior_art.length>8)fail('prior_art must list at most eight sources');
 for(const p of s.prior_art){object(p,['reference','relationship'],'prior art');str(p.reference,5,500,'reference');str(p.relationship,20,1000,'relationship');}
 object(s.evidence,['policy','goal','proof_path','reproduce'],'evidence');
 if(typeof s.evidence.goal!=='string'||!Object.hasOwn(goals,s.evidence.goal)||typeof s.evidence.proof_path!=='string')fail('invalid goal or proof path');const goal=goals[s.evidence.goal];if(!goal||s.evidence.policy!=='cnf-core-v2'||s.evidence.proof_path!==goal.path)fail('unenrolled evidence policy or statement');str(s.evidence.reproduce,20,1000,'reproduction');
 if(!Array.isArray(s.dependencies)||s.dependencies.length>8)fail('dependencies must list at most eight records');
 const ids=new Set();for(const d of s.dependencies){object(d,['id','use','importance'],'dependency');str(d.id,1,100,'dependency ID');str(d.use,30,1500,'actual mathematical use');str(d.importance,30,1500,'dependency importance');if(ids.has(d.id))fail('duplicate dependency');ids.add(d.id);}
 object(s.attribution,['wallet','contributions'],'attribution');
 if(!isAddress(s.attribution.wallet)||/^0x0{40}$/i.test(s.attribution.wallet)||s.attribution.wallet.toLowerCase()!==wallet.toLowerCase())fail('attribution must match the signing wallet');str(s.attribution.contributions,20,1500,'contributor attribution');
 if(s.title==='A precise descriptive title'||s.claim.startsWith('State the exact mathematical proposition')||s.novelty.startsWith('Explain what this adds'))fail('replace template instructions with the actual contribution');
 return s;
}

export function decodeSubmission(bytes,options){
 if(bytes.byteLength>12000)fail('record exceeds the 12,000-byte limit');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 const record=JSON.parse(text);
 // Requiring normalized JSON detects duplicate keys before consumers can disagree.
 if(text.trimEnd()!==JSON.stringify(record,null,2))fail('format the record with JSON.stringify(record,null,2); duplicate keys are forbidden');
 return validateSubmission(record,options);
}
