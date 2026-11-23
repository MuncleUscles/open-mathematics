import {createHash} from 'node:crypto';

const API='https://api.github.com';
const MAX_FILE_BYTES=256*1024;
const MAX_RESPONSE_BYTES=512*1024;
const MAX_FILES=300;
const MAX_REQUESTS=16;
const SHA=/^[a-f0-9]{40}$/;
const REPOSITORY=/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/;
const need=(condition,message)=>{if(!condition)throw Error('GitHub provenance: '+message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>Number.isSafeInteger(value)&&value>0;
const sha=value=>typeof value==='string'&&SHA.test(value)&&value!=='0'.repeat(40);
const hash=(algorithm,bytes)=>createHash(algorithm).update(bytes).digest('hex');
const canonical=value=>JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])));

function safePath(value){
 return typeof value==='string'&&value.length<=300&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value)&&
  value.split('/').every(part=>part!=='.'&&part!=='..');
}
function text(value,min,max){
 return typeof value==='string'&&value.isWellFormed()&&[...value.trim()].length>=min&&[...value].length<=max&&!value.includes('\0');
}
function containsIdentifier(excerpt,identifier){
 // This binds a documentary token, not Lean syntax or theorem semantics.
 const part=/[\p{L}\p{N}\p{M}_'.«»]/u;
 for(let at=excerpt.indexOf(identifier);at>=0;at=excerpt.indexOf(identifier,at+1)){
  const before=[...excerpt.slice(0,at)].at(-1),after=[...excerpt.slice(at+identifier.length)][0];
  if((before===undefined||!part.test(before))&&(after===undefined||!part.test(after)))return true;
 }
 return false;
}
function abortable(promise,signal){
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(Error('GitHub provenance: retrieval deadline exceeded'));
  if(signal.aborted){abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}

// fetchImpl is trusted transport injection, never supplied by source documents.
// Every request is constructed here; API links and download URLs are not followed.
async function jsonRequest(url,{fetchImpl,headers,signal,requests}){
 need(url.startsWith(API+'/repos/'),'fixed GitHub API endpoint required');
 need(requests.length<MAX_REQUESTS,'request limit exceeded');
 let response;
 try{response=await abortable(fetchImpl(url,{method:'GET',headers,redirect:'error',signal}),signal);}
 catch{need(false,signal.aborted?'retrieval deadline exceeded':'GitHub request failed');}
 need(response?.url===url&&!response.redirected,'redirected or foreign response URL');
 need(response.status===200,'complete HTTP 200 response required');
 const contentType=response.headers?.get('content-type')||'';
 need(/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;\s*charset=(?:utf-8|us-ascii))?$/i.test(contentType),'JSON content type required');
 const encoding=response.headers.get('content-encoding');
 need(!encoding||encoding.toLowerCase()==='identity','compressed response unsupported');
 const length=response.headers.get('content-length');
 need(length===null||(/^\d+$/.test(length)&&Number.isSafeInteger(Number(length))&&Number(length)<=MAX_RESPONSE_BYTES),'invalid or oversized response length');
 need(!response.headers.get('transfer-encoding')||length===null,'ambiguous response length');
 need(typeof response.body?.getReader==='function','streaming response body required');
 const reader=response.body.getReader(),chunks=[];
 let size=0,complete=false;
 try{
  while(true){
   const part=await abortable(reader.read(),signal);
   if(part.done){complete=true;break;}
   need(part.value instanceof Uint8Array,'byte response required');
   size+=part.value.byteLength;
   need(size<=MAX_RESPONSE_BYTES,'response exceeds byte limit');
   chunks.push(Buffer.from(part.value));
  }
 }catch(error){
  if(error.message?.startsWith('GitHub provenance:'))throw error;
  throw Error('GitHub provenance: truncated response body');
 }finally{
  if(!complete)Promise.resolve(reader.cancel()).catch(()=>{});
  reader.releaseLock();
 }
 need(length===null||size===Number(length),'truncated response length');
 const bytes=Buffer.concat(chunks,size);
 let result;
 try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}
 catch{throw Error('GitHub provenance: valid UTF-8 JSON required');}
 requests.push({url,bytes:size,content_sha256:hash('sha256',bytes)});
 return result;
}

function fileMetadata(value,path){
 need(object(value)&&value.type==='file'&&value.path===path&&sha(value.sha)&&
  id(value.size)&&value.size<=MAX_FILE_BYTES&&!value.submodule_git_url,'bounded regular file metadata required');
 return value;
}

async function blobBytes(metadata,request){
 const blob=await request('/git/blobs/'+metadata.sha);
 need(object(blob)&&blob.sha===metadata.sha&&blob.size===metadata.size&&blob.encoding==='base64'&&
  typeof blob.content==='string'&&blob.content.length<=Math.ceil(MAX_FILE_BYTES/3)*4+8192,'bounded matching base64 blob required');
 const encoded=blob.content.replace(/[\r\n]/g,'');
 need(encoded.length===Math.ceil(metadata.size/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(encoded),'invalid base64 length or alphabet');
 const bytes=Buffer.from(encoded,'base64');
 need(bytes.length===metadata.size&&bytes.toString('base64')===encoded,'decoded blob size or encoding mismatch');
 need(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')===metadata.sha,'Git blob object hash mismatch');
 let content;
 try{content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
 catch{throw Error('GitHub provenance: UTF-8 source text required');}
 need(!content.includes('\0'),'binary source text unsupported');
 return {blob_sha:metadata.sha,bytes:bytes.length,content_sha256:hash('sha256',bytes),content_base64:encoded,text:content};
}

/**
 * Collect documentary provenance for a file added in a merged GitHub PR.
 * A descendant source must preserve the exact PR-head and merge-commit blob.
 * PR ownership and SPDX metadata do not establish mathematical authorship,
 * discovery, priority, license sufficiency, or formal validity. No CI is trusted.
 */
export async function collectGithubProvenance(input,{fetchImpl=globalThis.fetch,token,timeoutMs=30000}={}){
 need(object(input),'source object required');
 const expected=['repository','pr','commit','path','theorem','statement','origin','attributionBasis'];
 need(Object.keys(input).length===expected.length&&expected.every(key=>Object.hasOwn(input,key)),'exact source fields required; URLs and author overrides are forbidden');
 const {repository,pr,commit,path,theorem,statement,origin,attributionBasis}=input;
 need(typeof repository==='string'&&REPOSITORY.test(repository)&&!['.','..'].includes(repository.split('/')[1]),'safe owner/repository required');
 need(id(pr)&&sha(commit)&&safePath(path),'safe PR number, full commit and path required');
 need(text(theorem,1,300)&&text(statement,10,4000)&&text(attributionBasis,40,3000)&&
  ['discovery','formalization','unknown'].includes(origin),'bounded theorem, statement and qualified attribution required');
 need(typeof fetchImpl==='function'&&Number.isInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=30000,'bounded trusted transport required');
 need(token===undefined||(typeof token==='string'&&token.length<=4096&&/^[\x21-\x7e]+$/.test(token)),'invalid GitHub credential');
 const headers={Accept:'application/vnd.github+json','Accept-Encoding':'identity','X-GitHub-Api-Version':'2022-11-28','User-Agent':'OpenMathematics-GitHubProvenance/1'};
 if(token!==undefined)headers.Authorization='Bearer '+token;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),requests=[];
 const root=API+'/repos/'+repository;
 const request=suffix=>jsonRequest(root+suffix,{fetchImpl,headers,signal:controller.signal,requests});
 try{
  const repo=await request('');
  need(object(repo)&&repo.full_name===repository&&id(repo.id)&&repo.private===false,'exact public repository identity required');
  const pull=await request('/pulls/'+pr);
  need(object(pull)&&pull.number===pr&&id(pull.id)&&pull.base?.repo?.id===repo.id&&pull.base.repo.full_name===repository,'PR repository association mismatch');
  need(pull.merged===true&&pull.state==='closed'&&typeof pull.merged_at==='string'&&Number.isFinite(Date.parse(pull.merged_at))&&
   sha(pull.head?.sha)&&sha(pull.merge_commit_sha),'merged PR with exact head and merge commit required');
  need(id(pull.user?.id)&&typeof pull.user.login==='string'&&pull.user.login.length<=100&&pull.user.type==='User','stable ordinary-user PR submitter identity required');
  need(id(pull.changed_files)&&pull.changed_files<=MAX_FILES,'bounded complete PR file list required');
  const files=[];
  for(let page=1;files.length<pull.changed_files;page++){
   const batch=await request('/pulls/'+pr+'/files?per_page=100&page='+page);
   need(Array.isArray(batch)&&batch.length===Math.min(100,pull.changed_files-files.length),'incomplete or oversized PR file list');
   files.push(...batch);
  }
  need(files.every(file=>object(file)&&typeof file.filename==='string')&&new Set(files.map(file=>file.filename)).size===files.length,'duplicate or malformed PR files');
  const changed=files.find(file=>file.filename===path);
  need(changed&&changed.status==='added'&&sha(changed.sha),'pilot source file must be added in the cited PR');
  const sourceCommit=await request('/git/commits/'+commit);
  need(object(sourceCommit)&&sourceCommit.sha===commit&&sha(sourceCommit.tree?.sha),'exact source commit required');
  const source=fileMetadata(await request('/contents/'+path+'?ref='+commit),path);
  const head=commit===pull.head.sha?source:fileMetadata(await request('/contents/'+path+'?ref='+pull.head.sha),path);
  need(head.sha===changed.sha&&head.sha===source.sha&&head.size===source.size,'PR-head blob does not match source');
  const association={kind:'exact-pr-head',pr_head:pull.head.sha,merge_commit:pull.merge_commit_sha,head_blob:head.sha};
  if(commit!==pull.head.sha){
   if(commit!==pull.merge_commit_sha){
    // GitHub includes an unbounded patch set on page one. Page two retains
    // comparison-level ancestry facts while omitting those unrelated patches.
    const comparison=await request('/compare/'+pull.merge_commit_sha+'...'+commit+'?per_page=1&page=2');
    need(object(comparison)&&comparison.status==='ahead'&&comparison.behind_by===0&&id(comparison.ahead_by)&&
     comparison.base_commit?.sha===pull.merge_commit_sha&&comparison.merge_base_commit?.sha===pull.merge_commit_sha,'source is not a proven descendant of the PR merge');
    association.comparison={base_commit:comparison.base_commit.sha,merge_base_commit:comparison.merge_base_commit.sha,status:comparison.status,ahead_by:comparison.ahead_by,behind_by:comparison.behind_by};
   }
   const merged=commit===pull.merge_commit_sha?source:fileMetadata(await request('/contents/'+path+'?ref='+pull.merge_commit_sha),path);
   need(merged.sha===head.sha&&merged.size===head.size,'merge changed the PR artifact');
   association.kind=commit===pull.merge_commit_sha?'exact-pr-merge':'merge-descendant-unchanged-blob';
   association.merge_blob=merged.sha;
  }
  const sourceBytes=await blobBytes(source,request);
  need(sourceBytes.text.includes(statement),'statement must be an exact contiguous source excerpt');
  need(!/\s/u.test(theorem)&&containsIdentifier(statement,theorem),'theorem identifier must occur exactly in the source excerpt');
  const license=await request('/license?ref='+commit);
  need(object(license)&&safePath(license.path),'commit-pinned license source required');
  fileMetadata(license,license.path);
  const licenseBytes=await blobBytes(license,request);
  const spdx=license.license?.spdx_id??'NOASSERTION';
  need(typeof spdx==='string'&&/^[A-Za-z0-9][A-Za-z0-9.+-]{0,99}$/.test(spdx),'bounded license identifier required');
  const source_url='https://github.com/'+repository+'/blob/'+commit+'/'+path;
  const evidence={repository,repository_id:repo.id,pr,commit,path,blob_sha:sourceBytes.blob_sha,
   content_sha256:sourceBytes.content_sha256,theorem,statement,license:spdx,source_url,
   github_author_id:pull.user.id,origin,attribution_basis:attributionBasis};
  const encoded=canonical(evidence);
  need(Buffer.byteLength(encoded,'utf8')<=16384,'native evidence exceeds byte limit');
  return {evidence,source_hash:hash('sha256',encoded),packet:{
   schema_version:1,retrieved_at:new Date().toISOString(),verification:'not-locally-verified',statement_kind:'exact-source-excerpt',
   repository:{id:repo.id,full_name:repo.full_name,private:repo.private},pull_request:pull,
   association,changed_file:changed,source:{source_url,commit:sourceCommit,path,...sourceBytes},
   license:{source_url:'https://github.com/'+repository+'/blob/'+commit+'/'+license.path,path:license.path,spdx_id:spdx,...licenseBytes},
   attribution_limitations:'github_author_id identifies the PR submitter only. Statement is an exact source excerpt containing the supplied theorem token, not a verified formal statement; origin is a supplied documentary claim. Neither PR ownership nor a license establishes original mathematical authorship, discovery, priority, formal validity, or a wallet. SPDX is GitHub metadata; inspect the preserved license and any additional notices before reuse.',
   requests,
  }};
 }finally{clearTimeout(timer);}
}
