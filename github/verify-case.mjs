// Trusted operator admission. Source retrieval establishes bytes, never priority by itself.
import {retrieveProvenanceSource} from './provenance-source.mjs';
import {digest} from '../src/security.mjs';
const length=value=>[...value].length;
const bounded=(value,min,max)=>typeof value==='string'&&length(value)>=min&&length(value)<=max;
// Match Python str.strip() used by the native author-ID derivation, including
// its whitespace differences from JavaScript trim(). IDs remain URL-specific.
const strippedName=name=>name.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const authorId=(reference,name)=>'author-'+digest(reference+'\n'+strippedName(name)).slice(0,32);
// `authors` must be the complete finalized get_external_authors() view, never
// reporter-supplied identities. An empty array is a valid empty native registry.
export async function verifyCaseDocumentary(c,config,deployment,{retrieve=retrieveProvenanceSource,authors}={}){
 if(!config||config.case_id!==c.id||config.contract.toLowerCase()!==deployment.contract.toLowerCase()||config.chain_id!==deployment.chainId||config.payload_hash!==digest(c.payload)||config.round!==Number(c.round))throw Error('Review admission must bind exact case, deployment, payload and round');
 if(!bounded(config.review_basis,40,3000))throw Error('Explicit documentary/identity review basis required');
 if(!Array.isArray(authors)||authors.length>1024)throw Error('Complete native external-author registry snapshot required');
 const registry=new Map();
 for(const a of authors){
  if(!a||!/^author-[a-f0-9]{32}$/.test(a.id)||registry.has(a.id)||!bounded(a.name,1,160)||!Array.isArray(a.sources)||!a.sources.length||a.sources.some(s=>typeof s!=='string')||(a.verified_subject!=null&&!bounded(a.verified_subject,5,300)))throw Error('Malformed native external-author registry snapshot');
  registry.set(a.id,a);
 }
 if(!Array.isArray(config.sources)||config.sources.length!==c.payload.sources.length)throw Error('Every declared source needs reviewed snapshot metadata');
 const e={sources:[],priority_verified:config.priority_verified,priority_basis:[],identity_subject:config.identity_subject||'',identity_challenge:config.identity_challenge||'',identity_author_id:config.identity_author_id||'',identity_source:config.identity_source||'',authorship_verified:config.authorship_verified,formal_verified:false,statement_hash:'',artifact_hash:'',policy:''};
 if([e.priority_verified,e.authorship_verified].some(x=>typeof x!=='boolean'))throw Error('Reviewed documentary flags must be explicit booleans');
 const refs=new Set(),requiredAuthors=new Set(registry.keys());
 for(const s of config.sources){
  const declared=c.payload.sources.find(x=>x.reference===s.reference);
  if(!declared||refs.has(s.reference)||!/^[a-f0-9]{64}$/.test(s.content_hash||''))throw Error('Exact unique reviewed source hashes required');refs.add(s.reference);
  if(!Array.isArray(s.verified_authors)||s.verified_authors.length!==declared.authors.length||s.verified_authors.some(a=>!a||Object.keys(a).sort().join(',')!=='name,subject'||typeof a.name!=='string'||!bounded(a.subject,5,300))||JSON.stringify(s.verified_authors.map(a=>a.name).sort())!==JSON.stringify([...declared.authors].sort()))throw Error('Verified authors must match the actual named source authors');
  if(!bounded(s.quote,30,1200))throw Error('Reviewed source quote requires 30 to 1200 Unicode characters');
  for(const a of s.verified_authors){
   const id=authorId(s.reference,a.name),existing=registry.get(id);
   if(existing&&(existing.name!==strippedName(a.name)||!existing.sources.includes(s.reference)))throw Error('Native author identity does not match its source and name');
   if(existing?.verified_subject&&existing.verified_subject!==a.subject)throw Error('Verified author conflicts with the native pinned subject');
   requiredAuthors.add(id);
  }
 }
 if(requiredAuthors.size>1024)throw Error('Pilot external author capacity exceeded before attestation');
 for(const s of config.sources){
  const snapshot=await retrieve({reference:s.reference,quote:s.quote});
  if(snapshot.content_hash!==s.content_hash)throw Error('Retrieved source changed from reviewed snapshot');
  if(Object.keys(snapshot).sort().join(',')!=='content_hash,excerpt,reference,retrieved_at'||snapshot.reference!==s.reference||snapshot.excerpt!==s.quote||!bounded(snapshot.excerpt,30,1200))throw Error('Retrieved source reference or exact excerpt mismatch');
  if(!Number.isSafeInteger(snapshot.retrieved_at)||snapshot.retrieved_at<=0||snapshot.retrieved_at>Math.floor(Date.now()/1000))throw Error('Retrieved source timestamp must be an actual nonfuture Unix time');
  e.sources.push({...snapshot,verified_authors:s.verified_authors});
 }
 if(!Array.isArray(config.priority_basis)||config.priority_basis.length>4)throw Error('Explicit bounded priority corroboration required');
 for(const b of config.priority_basis){
  const source=e.sources.find(s=>s.reference===b.reference);
  if(!source||!['publisher-record','independent-archive','independent-citation'].includes(b.kind)||!bounded(b.excerpt,30,1200)||!source.excerpt.includes(b.excerpt))throw Error('Priority basis must be present in one retrieved source with 30 to 1200 Unicode characters; URL or self-reported Git date alone is insufficient');
  e.priority_basis.push({kind:b.kind,reference:source.reference,content_hash:source.content_hash,excerpt:b.excerpt});
 }
 if(e.priority_verified&&!e.priority_basis.length)throw Error('Priority requires actual corroboration');
 if(c.kind==='authorship'){
  const target=registry.get(c.target);
  if(!target||target.claimed_wallet||Number(target.binding_version)!==Number(c.revision)||!target.sources.includes(e.identity_source)||(target.verified_subject&&target.verified_subject!==e.identity_subject)||!bounded(e.identity_subject,5,300)||e.identity_author_id!==c.target||e.identity_challenge!==c.identity_challenge||Date.now()>=Number(c.identity_expiry)*1000||!e.sources.some(s=>s.reference===e.identity_source&&s.verified_authors.some(a=>strippedName(a.name)===target.name&&a.subject===e.identity_subject)))throw Error('Identity admission must bind this native wallet claim to the registered author source');
  // Wallet possession is the native caller. The separate verifier review must
  // establish that the documentary identity belongs to the actual source author.
  if(e.authorship_verified&&!e.sources.some(s=>s.reference===e.identity_source&&s.verified_authors.some(a=>a.subject===e.identity_subject)&&s.excerpt.includes(c.identity_challenge)))throw Error('Exact wallet-bound challenge must be found in the retrieved author-controlled publication');
 }else if(e.authorship_verified||e.identity_subject||e.identity_challenge||e.identity_author_id||e.identity_source)throw Error('Identity evidence cannot nominate a different payout wallet');
 if(config.formal_verified||config.statement_hash||config.artifact_hash||config.policy)throw Error('This pilot has no enrolled full-target verifier; a documentary admission cannot resolve a problem');
 if(length(JSON.stringify(e))>16000)throw Error('Documentary evidence exceeds the native 16000-character attestation limit');
 return e;
}
