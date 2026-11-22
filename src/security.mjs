import {createHash, randomBytes} from 'node:crypto';
import {recoverMessageAddress, isAddress} from 'viem';
export const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const digest=x=>createHash('sha256').update(typeof x==='string'?x:canonical(x)).digest('hex');
export const message=c=>`Open Mathematics PR claim v1\n${canonical(c)}`;
export function validateClaim(c,{domain,chainId,now=Date.now()}){
  if(c.version!==1||c.domain!==domain||c.chainId!==chainId||c.problem!=='p-vs-np')throw Error('Wrong signing domain, chain or problem');
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(c.repository)||!Number.isSafeInteger(c.pr)||c.pr<1||!/[0-9a-f]{40}/.test(c.head)||c.head.length!==40||!isAddress(c.wallet))throw Error('Malformed PR identity');
  if(!/^[0-9a-f]{32}$/.test(c.nonce)||!Number.isSafeInteger(c.expires)||c.expires<=now||c.expires>now+600000)throw Error('Expired or invalid challenge');
}
export class Claims {
  constructor({domain,chainId=61999,db}){this.domain=domain;this.chainId=chainId;this.db=db;db.exec('CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, payload TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0)');}
  issue(input){const c={version:1,domain:this.domain,chainId:this.chainId,problem:'p-vs-np',repository:input.repository,pr:input.pr,head:input.head,wallet:input.wallet,nonce:randomBytes(16).toString('hex'),expires:Date.now()+300000};validateClaim(c,this);this.db.prepare('INSERT INTO nonces(nonce,payload) VALUES (?,?)').run(c.nonce,canonical(c));return {claim:c,message:message(c)};}
  async verify(c,signature){validateClaim(c,this);const row=this.db.prepare('SELECT * FROM nonces WHERE nonce=?').get(c.nonce);if(!row||row.used||row.payload!==canonical(c))throw Error('Unknown, changed or replayed nonce');const signer=await recoverMessageAddress({message:message(c),signature});if(signer.toLowerCase()!==c.wallet.toLowerCase())throw Error('Signature does not own wallet');const result=this.db.prepare('UPDATE nonces SET used=1 WHERE nonce=? AND used=0').run(c.nonce);if(result.changes!==1)throw Error('Replayed nonce');return {claim:c,signature,digest:digest(c),signer};}
}
export function verifyEvidence(e,policy){
  for(const field of ['repository','head','base','policy','statement_hash','checker','toolchain'])if(e[field]!==policy[field])throw Error(`Evidence ${field} mismatch`);
  if(e.result!=='pass'||e.mode!=='isolated'||e.sorry!==false||!Array.isArray(e.axioms)||e.axioms.some(a=>!policy.allowedAxioms.includes(a)))throw Error('Untrusted proof result or unauthorized axioms');
  if(!/^[a-f0-9]{64}$/.test(e.artifact_hash)||!Array.isArray(e.theorems)||!e.theorems.includes(policy.theorem))throw Error('Missing theorem or artifact commitment');
  return true;
}
export async function verifyAttestation(envelope,policy,verifier){
  const signer=await recoverMessageAddress({message:`Open Mathematics proof attestation v1\n${canonical(envelope.evidence)}`,signature:envelope.signature});
  if(signer.toLowerCase()!==verifier.toLowerCase())throw Error('Unknown proof verifier');
  verifyEvidence(envelope.evidence,policy);return digest(envelope.evidence);
}
