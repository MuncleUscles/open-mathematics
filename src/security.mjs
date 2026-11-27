import {createHash, randomBytes} from 'node:crypto';
import {recoverMessageAddress} from 'viem';
import {canonical,message,validateClaim} from './claim-format.mjs';
export {canonical,message,validateClaim};
export const digest=x=>createHash('sha256').update(typeof x==='string'||x instanceof Uint8Array?x:canonical(x)).digest('hex');
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
  const signer=await recoverMessageAddress({message:`Open Mathematics proof attestation v${policy.checker==='open-mathematics-v2'?2:1}\n${canonical(envelope.evidence)}`,signature:envelope.signature});
  if(signer.toLowerCase()!==verifier.toLowerCase())throw Error('Unknown proof verifier');
  verifyEvidence(envelope.evidence,policy);return digest(envelope.evidence);
}
export function enrolledProofBlob({pr,tree,baseTree,head}){
  const proofPath='research/proofs/renaming.proof';
  if(head.parents?.length!==1||head.parents[0].sha!==pr.base.sha)throw Error('Pilot requires one proof commit directly on the current base');
  if(tree.truncated||baseTree.truncated||!Array.isArray(tree.tree)||!Array.isArray(baseTree.tree))throw Error('Complete immutable tree required');
  const old=new Map(baseTree.tree.filter(e=>e.type!=='tree').map(e=>[e.path,e]));
  const current=new Map(tree.tree.filter(e=>e.type!=='tree').map(e=>[e.path,e]));
  const changed=[...new Set([...old.keys(),...current.keys()])].filter(p=>old.get(p)?.sha!==current.get(p)?.sha||old.get(p)?.mode!==current.get(p)?.mode||old.get(p)?.type!==current.get(p)?.type);
  if(changed.length!==1||changed[0]!==proofPath)throw Error('Only the enrolled proof may change between the exact commits');
  const entry=tree.tree.find(e=>e.path===proofPath);
  if(!entry||entry.mode!=='100644'||entry.type!=='blob'||!/^[a-f0-9]{40}$/.test(entry.sha))throw Error('Plain immutable proof blob required; symlinks are forbidden');
  return entry.sha;
}

export function enrolledSubmissionBlobs({claim,tree,baseTree,head,proofPaths}){
 if(!Array.isArray(proofPaths)||proofPaths.includes(claim.submission_path)||proofPaths.some(p=>!/^research\/proofs\/[a-z0-9][a-z0-9_-]{0,63}\.proof$/.test(p)))throw Error('Disjoint enrolled proof and submission paths required');
 if(head.parents?.length!==1||head.parents[0].sha!==claim.base)throw Error('Use one submission commit directly on the signed canonical base');
 if(tree.truncated||baseTree.truncated||!Array.isArray(tree.tree)||!Array.isArray(baseTree.tree))throw Error('Complete immutable tree required');
 const old=new Map(baseTree.tree.filter(e=>e.type!=='tree').map(e=>[e.path,e]));
 const current=new Map(tree.tree.filter(e=>e.type!=='tree').map(e=>[e.path,e]));
 const changed=[...new Set([...old.keys(),...current.keys()])].filter(p=>old.get(p)?.sha!==current.get(p)?.sha||old.get(p)?.mode!==current.get(p)?.mode||old.get(p)?.type!==current.get(p)?.type);
 const proofPath=changed.find(p=>proofPaths.includes(p));
 if(changed.length!==2||!proofPath||!changed.includes(claim.submission_path)||old.has(claim.submission_path))throw Error('Change exactly one enrolled proof and add one new submission record');
 const blob=p=>{const e=current.get(p);if(!e||e.mode!=='100644'||e.type!=='blob'||!/^[a-f0-9]{40}$/.test(e.sha))throw Error('Plain immutable files required; symlinks are forbidden');return e.sha;};
 return {proofPath,proofSha:blob(proofPath),submissionSha:blob(claim.submission_path)};
}
