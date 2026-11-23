#!/usr/bin/env node
// Trusted helper: contributor files are data, and signatures remain local.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';import {recoverMessageAddress,isAddress} from 'viem';
import {loadOpenProblem,validateOpenClaim,requireOpenConfiguration,verifyOpenCheckout,decodeOpenSubmission,openSubmissionBlobs,sha256,readProblemFile,validateOpenArtifactBytes} from '../src/open-research.mjs';
import {digest,message} from '../src/security.mjs';import {GitHub} from '../src/github.mjs';
import {fetchGitHubIdentity} from '../src/github-identity.mjs';
import {readEvidenceFile} from '../github/evidence-file.mjs';
import {clientFor,read,finalized} from '../github/runtime.mjs';
import {loadLocalSigner,publicEnvelope} from './problem-agent.mjs';import {contributorPath} from './agent.mjs';
import {createStudioClient} from '../src/studio-client.mjs';
import {resolveOpenDependencies,writeOpenDependencyManifest,openVerifierFailure} from '../github/open-verify.mjs';
export const toolRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function claimFor(problem,{pr,head,base,recordPath,recordBytes,wallet,now=Date.now()}){
 const d=problem.deployment,claim={version:4,domain:d.origin,chainId:d.chainId,problem:d.problem,repository:d.repository,pr,head,base,branch:d.branch,contract:d.contract,policy:problem.policyHash,submission_path:recordPath,submission_hash:sha256(recordBytes),wallet,nonce:randomBytes(16).toString('hex'),expires:now+540000,protocol_commit:problem.descriptor.protocol.commit};
 validateOpenClaim(claim,problem,{now});return claim;
}
export function submissionTemplate(slug,wallet,{kind='formal',problem='p-vs-np'}={}){
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)||!isAddress(wallet)||/^0x0{40}$/i.test(wallet)||!['formal','research-note'].includes(kind))throw Error('Use a slug, public wallet, and formal or research-note evidence kind');
 return {schema_version:3,problem,kind:kind==='formal'?'lemma':'research-note',title:'REPLACE: Describe your contribution',claim:'REPLACE: State exactly what your artifact establishes and why it matters.',novelty:'REPLACE: Explain the incremental work compared with accepted contributions and known literature.',prior_art:[],research_direction:'REPLACE: Choose and explain your own research direction',provenance:{mode:'discovery',sources:[],discovery_basis:'REPLACE: Document your actual prior-art search and its limits; use formalization or integration for known results.'},evidence:{kind,artifact_path:`research/${kind==='formal'?'artifacts':'notes'}/${slug}.${kind==='formal'?'json':'md'}`,reproduce:`Run the trusted open-agent check research/submissions/${slug}.json${kind==='formal'?' --lean':''}.`},dependencies:[],attribution:{wallet,contributions:'REPLACE: Identify the specific work you performed and any assistance.'},limitations:'REPLACE: Identify what is unproved, untested or outside this contribution. Do not claim this solves P versus NP.'};
}
export async function prepareOpenContribution({problem,github,number,recordPath,wallet}){
 const d=problem.deployment,pr=await github.pr(number);
 if(pr.state!=='open'||pr.merged||pr.base.ref!==d.branch||pr.base.repo.full_name!==d.repository||await github.branchHead(d.branch)!==pr.base.sha)throw Error('Open PR on current canonical research base required');
 const [head,base]=await Promise.all([github.commit(pr.head.sha),github.commit(pr.base.sha)]);
 if(head.sha!==pr.head.sha||base.sha!==pr.base.sha||![head.tree?.sha,base.tree?.sha].every(h=>/^[a-f0-9]{40}$/.test(h||'')))throw Error('Immutable head/base commit binding required');
 const [tree,baseTree]=await Promise.all([github.request(`/git/trees/${head.tree.sha}?recursive=1`),github.request(`/git/trees/${base.tree.sha}?recursive=1`)]);
 if(tree.sha!==head.tree.sha||baseTree.sha!==base.tree.sha||tree.truncated!==false||baseTree.truncated!==false)throw Error('Complete immutable tree binding required');
 const files=openSubmissionBlobs({claim:{base:pr.base.sha,submission_path:recordPath},tree,baseTree,head});
 const blob=async(sha,max)=>{
  const b=await github.request(`/git/blobs/${sha}`),encodedLimit=Math.ceil(max/3)*4;
  if(b.sha!==sha||b.encoding!=='base64'||typeof b.content!=='string'||b.content.length>encodedLimit+Math.ceil(encodedLimit/30)+4||!Number.isSafeInteger(b.size)||b.size<1||b.size>max)throw Error(`Bounded immutable Git blob required (maximum ${max} bytes)`);
  const bytes=Buffer.from(b.content,'base64'),actual=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if(bytes.length!==b.size||actual!==sha)throw Error('Immutable blob hash mismatch');return bytes;
 };
 const [recordBytes,artifactBytes]=await Promise.all([blob(files.submissionSha,16000),blob(files.artifactSha,files.artifactPath.endsWith('.md')?12000:32768)]);
 const submission=decodeOpenSubmission(recordBytes,{wallet,problem});
 if(submission.evidence.artifact_path!==files.artifactPath)throw Error('Record differs from exact changed artifact');
 validateOpenArtifactBytes(artifactBytes,submission.evidence.kind);
 return {pr,recordBytes,artifactBytes,submission};
}
export function currentOpenStatus(index,number,deployment){
 if(!index||!Array.isArray(index.entries))throw Error('Malformed evidence index');
 return index.entries.find(e=>e.pr===number&&typeof e.contract==='string'&&e.contract.toLowerCase()===deployment.contract.toLowerCase()&&e.chainId===deployment.chainId&&e.repository===deployment.repository);
}
export async function listOpenContributions({native,problem,offset=0,limit=20}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Usage: list [OFFSET >= 0] [LIMIT 1..50]; defaults: 0 20');
 const d=problem.deployment,page=await native('list_contributions',[offset,limit]),integer=x=>Number.isSafeInteger(x)&&x>=0?x:typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)&&Number.isSafeInteger(Number(x))?Number(x):null;
 const total=integer(page?.total),next=page?.next_offset===null?null:integer(page?.next_offset);
 const end=total===null?null:Math.min(total,offset+limit);
 if(total===null||(page?.next_offset!==null&&next===null)||!Array.isArray(page?.items)||page.items.length!==Math.max(0,end-offset)||new Set(page.items).size!==page.items.length||page.items.some(id=>typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(id))||next!==(end<total?end:null))throw Error('Malformed bounded native contribution page');
 const items=[];
 for(let start=0;start<page.items.length;start+=4){
  const batch=await Promise.all(page.items.slice(start,start+4).map(async id=>{
   const r=await native('get',[id]),e=r?.evidence;
   if(e?.id!==id||e.problem!==d.problem||e.repository!==d.repository||e.branch!==d.branch||typeof e.contract!=='string'||e.contract.toLowerCase()!==d.contract.toLowerCase())throw Error('Native contribution scope mismatch: '+id);
   let context;try{context=JSON.parse(e.context);}catch{throw Error('Malformed native contribution context: '+id);}
   return {id,status:r.status,title:context.title,scope:{claim:e.claim,formal_statement:e.formal_statement,evidence_kind:e.evidence_kind,verification:e.verification,research_direction:e.research_direction},bundle_hash:e.bundle_hash,points:{author_credited:r.credited_points,award_budget:r.award_budget??null,reserve:r.impact_reserve??'0',reserve_settled:r.reserve_settled===true},eligible_dependency:r.status==='credited'&&e.evidence_kind==='formal'};
  }));items.push(...batch);
 }
 return {problem:d.problem,repository:d.repository,chainId:d.chainId,contract:d.contract,protocolCommit:problem.descriptor.protocol.commit,offset,limit,total,next_offset:next,items,next:next===null?null:`om list ${next} ${limit}`,reuse:'Use om show ID for the full native record. Only credited formal results can be imported.'};
}
export async function run(argv=process.argv.slice(2)){
 let sent;
 try{
  const args=[...argv],flag=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;const v=args[i+1];if(!v||v.startsWith('--'))throw Error(name+' needs a path');args.splice(i,2);if(args.includes(name))throw Error('Repeated '+name);return v;};
  const directory=flag('--problem',process.env.OPEN_MATH_PROBLEM_DIR),worktree=fs.realpathSync(flag('--worktree',process.cwd()));
  const [command,...rest]=args,out=x=>console.log(JSON.stringify(x,null,2)),workFile=file=>contributorPath(worktree,file);
  if(!command||command==='help'){out({usage:'node /trusted/protocol/scripts/open-agent.mjs --problem /trusted/problem [--worktree /contribution] COMMAND',commands:{inspect:'Read the open objective, evidence rules and deployment.',list:'list [OFFSET] [LIMIT] — discover native contribution IDs, scope and points; defaults: 0 20, maximum 50 per page.',init:'init SLUG PUBLIC_WALLET [formal|research-note] — create your own submission; no task approval.',format:'format RECORD — normalize JSON.',check:'check RECORD [--lean] — schema and syntax only, or isolated Lean with --lean.',show:'show CONTRIBUTION_ID — exact finalized record, bundle and namespace for reuse.',prepare:'prepare PR RECORD PUBLIC_WALLET — export the exact message for an external wallet.',sign:'sign PR RECORD — use CONTRIBUTOR_KEY_FILE and output only the public claim.',envelope:'envelope PREPARED_FILE SIGNATURE_FILE — validate an external signature.',status:'status PR — read archive plus finalized native state.',challenge:'challenge ID FILE [--impact] [--send] — preview or send substantive evidence.'},keys:'Keep private keys outside repositories. Never send them to the platform.'});return;}
  if(command==='format'){const f=workFile(rest[0]),maximum=rest[0]?.startsWith('research/artifacts/')?32768:16000,bytes=readProblemFile(worktree,rest[0],maximum),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),normalized=JSON.stringify(JSON.parse(text),null,2)+'\n';if(Buffer.byteLength(normalized)>maximum)throw Error(`Formatted JSON exceeds ${maximum} UTF-8 bytes`);fs.writeFileSync(f,normalized);out({formatted:rest[0]});return;}
  if(!directory)throw Error('Set OPEN_MATH_PROBLEM_DIR to the trusted main-branch configuration checkout.');
  const problem=loadOpenProblem(directory),d=problem.deployment;verifyOpenCheckout(problem,toolRoot);
  const gh=new GitHub({repository:d.repository,token:process.env.GITHUB_TOKEN}),reader=clientFor(),native=(m,a)=>read(reader,d.contract,m,a);
  if(await reader.getChainId()!==d.chainId)throw Error('Wrong chain');await requireOpenConfiguration(problem,native);
  function decode(bytes,wallet){const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return decodeOpenSubmission(bytes,{wallet:wallet||parsed.attribution?.wallet,problem});}
  if(command==='inspect')out({admission:'open',objective:problem.policy.objective,admissionLimits:(await native('get_problem',[])).admission_limits,contract:d.contract,policy:problem.policyHash,protocolCommit:problem.descriptor.protocol.commit,evidence:['formal: contributor-defined statement and definitions, checked by isolated Lean','research-note: reviewed arguments; no formal-proof badge'],rewards:'Nontransferable native initial and later-impact points; no guaranteed award.',next:'Run list to discover earlier work; choose a question, then init SLUG PUBLIC_WALLET. No curator or task enrollment exists.'});
  else if(command==='list'){
   if(rest.length>2)throw Error('Usage: list [OFFSET] [LIMIT]');
   const numeric=rest.map(x=>/^(0|[1-9][0-9]*)$/.test(x)?Number(x):NaN);
   out(await listOpenContributions({native,problem,offset:numeric[0]??0,limit:numeric[1]??20}));
  }else if(command==='init'){
   const [slug,wallet,kind='formal']=rest,s=submissionTemplate(slug,wallet,{kind,problem:d.problem}),record=`research/submissions/${slug}.json`;
   for(const f of [record,s.evidence.artifact_path]){if(fs.existsSync(workFile(f)))throw Error('Refusing to overwrite '+f);fs.mkdirSync(path.dirname(workFile(f)),{recursive:true});}
   fs.writeFileSync(workFile(record),JSON.stringify(s,null,2)+'\n',{flag:'wx'});
   fs.writeFileSync(workFile(s.evidence.artifact_path),kind==='formal'?JSON.stringify({version:1,definitions:[],statement:'REPLACE: Your precise Lean proposition',proof:'by\n  REPLACE',dependencies:[]},null,2)+'\n':'# Research note\n\nREPLACE: Provide a substantive, supported argument. Distinguish conjectures from established results.\n',{flag:'wx'});
   out({record,artifact:s.evidence.artifact_path,next:'Replace all guidance with your work; disclose prior art and limits. Run format and check.'});
  }else if(command==='check'){
   const s=decode(readProblemFile(worktree,rest[0],16000)),artifactBytes=readProblemFile(worktree,s.evidence.artifact_path,s.evidence.kind==='formal'?32768:12000),artifactText=validateOpenArtifactBytes(artifactBytes,s.evidence.kind);
   const resolved=await resolveOpenDependencies({problem,submission:s,artifactText,github:gh,readRecord:id=>native('get',[id])});
   if(s.evidence.kind==='research-note'){out({record:'valid',evidence:'research-note',formalVerification:false,next:'GenLayer still needs to review whether the argument is supported and useful.'});return;}
   const temp=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-local-'));
   try{
    const artifact=path.join(temp,'candidate.json');fs.writeFileSync(artifact,artifactBytes,{mode:0o600,flag:'wx'});
    const manifest=writeOpenDependencyManifest(temp,resolved);
    const run=spawnSync('python3',['-B',path.join(toolRoot,'scripts/verify_open.py'),'--bundle',artifact,'--dependencies',manifest,'--policy',path.join(problem.root,problem.descriptor.policy.path),'--policy-hash',problem.policyHash,'--repository',d.repository,'--head','1'.repeat(40),'--base','2'.repeat(40),'--protocol-commit',problem.descriptor.protocol.commit,...(rest.includes('--lean')?[]:['--syntax-only'])],{cwd:toolRoot,encoding:'utf8',timeout:120000,maxBuffer:150000,env:{PATH:process.env.PATH,TRUSTED_LEAN_IMAGE:process.env.TRUSTED_LEAN_IMAGE}});
    if(run.status!==0)throw Error(openVerifierFailure(run));out(JSON.parse(run.stdout));
   }finally{fs.rmSync(temp,{recursive:true,force:true});}
  }else if(command==='show'){
   const r=await native('get',[rest[0]]);out({record:r,namespace:r.evidence.evidence_kind==='formal'?`B_${r.evidence.bundle_hash}`:null,next:'Only credited formal artifacts can be imported. Put the exact ID and bundle_hash in the bundle and explain actual use in the record.'});
  }else if(command==='prepare'||command==='sign'){
   const number=Number(rest[0]),recordPath=rest[1],account=command==='sign'?loadLocalSigner(process.env.CONTRIBUTOR_KEY_FILE,[toolRoot,problem.root,worktree]):null,wallet=account?.address||rest[2];
   if(!Number.isSafeInteger(number)||number<1||!isAddress(wallet||''))throw Error('PR number, record path and public wallet required');
   const {pr,recordBytes}=await prepareOpenContribution({problem,github:gh,number,recordPath,wallet});
   await fetchGitHubIdentity({github:gh,authorId:pr.user.id,login:pr.user.login,at:Date.now(),minimumAgeDays:d.minimumGitHubAccountAgeDays});
   const claim=claimFor(problem,{pr:number,head:pr.head.sha,base:pr.base.sha,recordPath,recordBytes,wallet});
   if(account)process.stdout.write(publicEnvelope(claim,await account.signMessage({message:message(claim)})));
   else out({claim,message:message(claim),expiresAt:new Date(claim.expires).toISOString(),next:'Sign this decoded message with EIP-191 personal_sign; format via envelope and post as the original PR author before expiry.'});
  }else if(command==='envelope'){
   const prepared=JSON.parse(fs.readFileSync(rest[0],'utf8')),claim=prepared.claim||prepared,signature=fs.readFileSync(rest[1],'utf8').trim();validateOpenClaim(claim,problem);
   if((await recoverMessageAddress({message:message(claim),signature})).toLowerCase()!==claim.wallet.toLowerCase())throw Error('Wrong signature');process.stdout.write(publicEnvelope(claim,signature));
  }else if(command==='status'){
   const number=Number(rest[0]);if(!Number.isSafeInteger(number)||number<1)throw Error('PR number required');
   const index=await readEvidenceFile(gh,'index.json'),entry=currentOpenStatus(index?.data??{entries:[]},number,d);
   if(!entry){out({pr:number,status:'No indexed outcome',next:'Check Actions or ask the operator to resume the original signed comment. Do not edit or repost it.'});return;}
   let current=null;try{current=await native('get',[entry.id]);}catch{}
   out({archived:entry,native:current,contract:d.contract,next:'Native state is authoritative. Failed consensus is preserved, not rerolled.'});
  }else if(command==='challenge'){
   const [id,file]=rest,isImpact=rest.includes('--impact'),evidence=fs.readFileSync(path.isAbsolute(file)?file:workFile(file),'utf8'),state=await native(isImpact?'get_impact':'get',[id]),method=isImpact?'challenge_impact':'challenge';
   if(evidence.trim().length<20||evidence.length>4000||state.status!=='provisional'||Date.now()>=Number(state.deadline)*1000||Number(state.round)>=2)throw Error('Substantive evidence and an open challenge window required');
   if(!rest.includes('--send'))out({contract:d.contract,method,args:[id,evidence],deadline:state.deadline,next:'Repeat with --send and your local signer after reviewing.'});
   else{const a=loadLocalSigner(process.env.CONTRIBUTOR_KEY_FILE,[toolRoot,problem.root,worktree]),client=createStudioClient({account:a});sent={contract:d.contract,wallet:a.address,method};const hash=await client.writeContract({address:d.contract,functionName:method,args:[id,evidence],leaderOnly:false});sent.hash=hash;console.error(JSON.stringify({status:'broadcast',...sent}));await finalized(client,hash,{address:d.contract,method,args:[id,evidence],sender:a.address});out({status:'challenge finalized',hash});}
  }else throw Error('Unknown command; run help');
 }catch(error){console.error(JSON.stringify({error:error.message,...(sent?{transaction:sent,next:'Inspect this transaction before retrying; it may already be broadcast.'}:{})}));process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
