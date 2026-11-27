// Build-cost optimization only. This never authorizes evidence, registration,
// merge or points; the worker independently verifies the entire signed PR.
import {createHash} from 'node:crypto';
import {recoverMessageAddress} from 'viem';
import {canonical,message} from '../src/security.mjs';
import {validateOpenClaim,decodeOpenSubmission,sha256} from '../src/open-research.mjs';

const RECORD_LIMIT=16000;
const RESPONSE_LIMIT=32768;
const ENCODED_LIMIT=Math.ceil(RECORD_LIMIT/3)*4;

/** Uncertain input always retains the existing Lean-image build path. */
export async function openBuildPlan({github,problem,candidate}={}){
 try{
  const claim=candidate?.claim,envelope=candidate?.envelope;
  if(!claim||!envelope||canonical(envelope.claim)!==canonical(claim)||
   typeof envelope.signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(envelope.signature)||
   github?.repository!==problem?.deployment?.repository)return {needs_lean:true};
  const created=Date.parse(candidate.createdAt);
  if(!Number.isFinite(created))return {needs_lean:true};
  validateOpenClaim(claim,problem,{now:created});
  if((await recoverMessageAddress({message:message(claim),signature:envelope.signature})).toLowerCase()!==claim.wallet.toLowerCase())
   return {needs_lean:true};
  const blob=await github.request(`/contents/${claim.submission_path}?ref=${claim.head}`,{maxResponseBytes:RESPONSE_LIMIT});
  if(blob?.type!=='file'||blob.path!==claim.submission_path||Object.hasOwn(blob,'target')||Object.hasOwn(blob,'submodule_git_url')||
   typeof blob.sha!=='string'||!/^[a-f0-9]{40}$/.test(blob.sha)||
   !Number.isSafeInteger(blob.size)||blob.size<1||blob.size>RECORD_LIMIT||blob.encoding!=='base64'||
   typeof blob.content!=='string'||blob.content.length>ENCODED_LIMIT+Math.ceil(ENCODED_LIMIT/30)+4)
   return {needs_lean:true};
  const encoded=blob.content.replace(/[\r\n]/g,'');
  if(encoded.length!==Math.ceil(blob.size/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))return {needs_lean:true};
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length!==blob.size||bytes.toString('base64')!==encoded||
   createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')!==blob.sha||
   sha256(bytes)!==claim.submission_hash)return {needs_lean:true};
  const record=decodeOpenSubmission(bytes,{wallet:claim.wallet,problem});
  const slug=claim.submission_path.slice('research/submissions/'.length,-'.json'.length);
  return {needs_lean:record.evidence.kind!=='research-note'||record.evidence.artifact_path!==`research/notes/${slug}.md`};
 }catch{return {needs_lean:true};}
}
