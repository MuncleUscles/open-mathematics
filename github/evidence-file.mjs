import {createHash} from 'node:crypto';

export const MAX_EVIDENCE_BYTES=8*1024*1024;
const ENCODED_LIMIT=Math.ceil(MAX_EVIDENCE_BYTES/3)*4;
// Include JSON escaping of GitHub's wrapped base64 and bounded API metadata.
const RESPONSE_LIMIT=ENCODED_LIMIT+Math.ceil(ENCODED_LIMIT/10)+65536;
const SHA=/^[a-f0-9]{40}$/;
const FILE=/^(?:index\.json|reports\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}\.json)$/;
const requireEvidence=(ok,message)=>{if(!ok)throw Error('Malformed evidence file: '+message);};

export async function readEvidenceFile(github,file){
  requireEvidence(typeof file==='string'&&FILE.test(file),'invalid evidence path');
  let metadata;
  try{metadata=await github.request(`/contents/${file}?ref=evidence`,{maxResponseBytes:RESPONSE_LIMIT});}
  catch(error){if(error.message==='GitHub 404')return null;throw error;}
  requireEvidence(metadata?.type==='file'&&metadata.path===file&&SHA.test(metadata.sha||'')&&
    Number.isSafeInteger(metadata.size)&&metadata.size>0&&metadata.size<=MAX_EVIDENCE_BYTES,
    'regular file with exact path, SHA and size (maximum 8 MiB) required');
  let blob=metadata;
  // Contents intentionally omits files over 1 MiB. Fetch the immutable object
  // from the same repository, never a supplied download_url or a moving ref.
  if(metadata.encoding==='none'&&metadata.content===''){
    blob=await github.request(`/git/blobs/${metadata.sha}`,{maxResponseBytes:RESPONSE_LIMIT});
  }
  requireEvidence(blob?.sha===metadata.sha&&blob.size===metadata.size&&blob.encoding==='base64'&&
    typeof blob.content==='string'&&blob.content.length<=ENCODED_LIMIT+Math.ceil(ENCODED_LIMIT/30)+4,
    'bounded base64 blob matching Contents metadata required');
  const encoded=blob.content.replace(/[\r\n]/g,'');
  requireEvidence(encoded.length===Math.ceil(metadata.size/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(encoded),
    'invalid base64 encoding');
  const bytes=Buffer.from(encoded,'base64');
  requireEvidence(bytes.length===metadata.size&&bytes.toString('base64')===encoded,'decoded size or base64 mismatch');
  requireEvidence(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')===metadata.sha,
    'Git blob hash mismatch');
  let data;
  try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}
  catch{throw Error('Malformed evidence file: valid UTF-8 JSON required');}
  requireEvidence(data!==null&&typeof data==='object'&&!Array.isArray(data),'JSON object required');
  return {sha:metadata.sha,data};
}
