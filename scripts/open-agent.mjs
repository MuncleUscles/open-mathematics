#!/usr/bin/env node
// Trusted helper: contributor files are data, and signatures remain local.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';import {recoverMessageAddress,isAddress} from 'viem';
import {loadOpenProblem,validateOpenClaim,requireOpenConfiguration,verifyOpenCheckout,verifyPinnedTools,parseProblemJSON,decodeOpenSubmission,openSubmissionBlobs,sha256,readProblemFile,validateOpenArtifactBytes,readOpenRecordInheritance} from '../src/open-research.mjs';
import {digest,message} from '../src/security.mjs';import {GitHub} from '../src/github.mjs';
import {fetchGitHubIdentity} from '../src/github-identity.mjs';
import {readEvidenceFile} from '../github/evidence-file.mjs';
import {clientFor,read,finalized,retry} from '../github/runtime.mjs';
import {normalize} from '../src/studio.mjs';
import {loadLocalSigner,publicEnvelope} from './problem-agent.mjs';import {contributorPath} from './agent.mjs';
import {createStudioClient} from '../src/studio-client.mjs';
import {resolveOpenDependencies,writeOpenDependencyManifest,openVerifierFailure} from '../github/open-verify.mjs';
import {resolveContributorGitHubToken,createLocalWallet,localWalletAddress} from './contributor-local.mjs';
import {sendResearchRequest} from './research-request.mjs';
export const toolRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function claimFor(problem,{pr,head,base,recordPath,recordBytes,wallet,now=Date.now()}){
 const d=problem.deployment,claim={version:4,domain:d.origin,chainId:d.chainId,problem:d.problem,repository:d.repository,pr,head,base,branch:d.branch,contract:d.contract,policy:problem.policyHash,submission_path:recordPath,submission_hash:sha256(recordBytes),wallet,nonce:randomBytes(16).toString('hex'),expires:now+540000,protocol_commit:problem.descriptor.protocol.commit};
 validateOpenClaim(claim,problem,{now});return claim;
}
export function submissionTemplate(slug,wallet,{kind='formal',problem='p-vs-np'}={}){
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)||!isAddress(wallet)||/^0x0{40}$/i.test(wallet)||!['formal','research-note'].includes(kind))throw Error('Use a slug, public wallet, and formal or research-note evidence kind');
 return {schema_version:3,problem,kind:kind==='formal'?'lemma':'research-note',title:'REPLACE: Describe your contribution',claim:'REPLACE: State exactly what your artifact establishes and why it matters.',novelty:'REPLACE: Explain the incremental work compared with accepted contributions and known literature.',prior_art:[],research_direction:'REPLACE: Choose and explain your own research direction',provenance:{mode:'discovery',sources:[],discovery_basis:'REPLACE: Document your actual prior-art search and its limits; use formalization or integration for known results.'},evidence:{kind,artifact_path:`research/${kind==='formal'?'artifacts':'notes'}/${slug}.${kind==='formal'?'json':'md'}`,reproduce:`Run the trusted open-agent check research/submissions/${slug}.json${kind==='formal'?' --lean':''}.`},dependencies:[],attribution:{wallet,contributions:'REPLACE: Identify the specific work you performed and any assistance.'},limitations:'REPLACE: Identify what is unproved, untested or outside this contribution. State how the result relates to the full research problem.'};
}
export function formalBundleTemplate({policyVersion=6}={}){
 if(policyVersion===5)return {version:1,definitions:[],statement:'REPLACE: Your precise Lean proposition',proof:'by\n  REPLACE',dependencies:[]};
 if(policyVersion!==6)throw Error('Unsupported formal policy version');
 return {version:2,imports:['Mathlib.Data.Int.Basic','Mathlib.Tactic.Ring'],source:'namespace Contribution\n\n-- Textbook identity: an example of the format, not a new research result.\ntheorem result (x y : Int) :\n    (x + y) ^ 2 = x ^ 2 + 2 * x * y + y ^ 2 := by\n  ring\n\nend Contribution\n',theorem:'Contribution.result',dependencies:[]};
}
export function formalReuseReference(evidence){
 if(evidence?.evidence_kind!=='formal')return null;
 if(typeof evidence.proof!=='string'||sha256(evidence.proof)!==evidence.bundle_hash)throw Error('Exact formal bundle bytes required for reuse');
 const bundle=JSON.parse(validateOpenArtifactBytes(Buffer.from(evidence.proof),'formal'));
 const namespace=`B_${evidence.bundle_hash}`,theorem=`${namespace}.${bundle.version===2?bundle.theorem:'result'}`;
 return {version:bundle.version,namespace,theorem,reference:`_root_.${theorem}`};
}
export function localCheckResult(result,{lean=false}={}){
 const expected=lean?{result:'pass',mode:'isolated',verified:true,production_verified:true,verification:'verified'}:{result:'syntax-pass',mode:'syntax-only',verified:false,production_verified:false,verification:'syntax-only'};
 if(!result||typeof result!=='object'||Array.isArray(result)||Object.entries(expected).some(([key,value])=>result[key]!==value))throw Error('Local checker mode/result mismatch; no verification claim accepted');
 return {...result,local_check:true,assessment:lean?'Isolated proof check of these local files. The worker must independently check the exact signed PR; this is not a merit decision or an award.':'Format and dependency-manifest check only. Lean has not parsed, typechecked or proved this source. Run check with --lean for isolated proof verification.'};
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
 return index.entries.find(e=>e?.pr===number&&typeof e.contract==='string'&&e.contract.toLowerCase()===deployment.contract.toLowerCase()&&e.chainId===deployment.chainId&&e.repository===deployment.repository);
}
export function createOpenNativeReader(problem,{createClient=clientFor}={}){
 let client,ready;
 const initialize=async()=>{
  client=createClient();
  if(Number(await client.getChainId())!==problem.deployment.chainId)throw Error('Wrong chain');
  await requireOpenConfiguration(problem,(method,args)=>read(client,problem.deployment.contract,method,args));
 };
 return async(method,args)=>{
  await (ready??=initialize());
  const result=await retry(async()=>{
   try{return {value:await client.readContract({address:problem.deployment.contract,functionName:method,args,transactionHashVariant:'latest-final'})};}
   catch(error){if(isUnknownContribution(error))return {absent:error};throw error;}
  });
  // Absence is a completed view result; repeated reads waste the shared RPC quota.
  if(result.absent)throw result.absent;
  return normalize(result.value);
 };
}
export function isUnknownContribution(error){
 for(let depth=0;error&&typeof error==='object'&&depth<8;depth++,error=error.cause){
  const receipt=error.data?.receipt;
  // Exact GenVM UserError result, not a substring of an arbitrary RPC failure.
  if(receipt?.execution_result==='ERROR'&&receipt.result==='AXVua25vd24gY29udHJpYnV0aW9u')return true;
 }
 return false;
}
export async function readOpenContributionStatus({index,number,problem,native,readReport}){
 const d=problem.deployment;
 let entry=currentOpenStatus(index,number,d);
 if(!entry&&d.predecessor)entry=currentOpenStatus(index,number,{...d,contract:d.predecessor.address});
 if(!entry)return null;
 if(typeof entry.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(entry.id))throw Error('Indexed contribution ID required');
 let record;
 try{record=await native('get',[entry.id]);}
 catch(error){
  if(!isUnknownContribution(error)||!readReport)throw error;
  const file=`reports/${entry.id}.json`;
  if(entry.report!==file)throw Error('Indexed report path differs from contribution identity');
  const report=await readReport(file);
  if(!report||report.id!==entry.id||report.pr!==number||report.repository!==entry.repository||report.chainId!==entry.chainId||
     report.contract?.toLowerCase()!==entry.contract.toLowerCase()||report.head!==entry.head||
     !['verifying','registration-pending','invalid','rejected','submitted','provisional','challenged','approved','credited','expired'].includes(report.status))
   throw Error('Worker report differs from indexed contribution scope');
  return {archived:entry,worker:{status:report.status,error:report.error??report.registrationRejection?.reason??null,updatedAt:report.updatedAt},
   report:`https://github.com/${d.repository}/blob/evidence/${file}`,run:entry.run,
   native:null,nativeState:'not-registered-at-read',contract:d.contract,sourceContract:entry.contract,
   next:'The finalized contract read found no registered contribution at this time. The worker report explains processing or verification failures; it is not a native merit decision and does not establish points. A transaction may still be pending. Keep the original signed comment in place and follow the worker in Actions. Temporary service failures resume automatically.'};
 }
 const inheritance=await readOpenRecordInheritance(record,entry.id,problem,id=>native('get_inheritance',[id]));
 if(Number(record.evidence.pr)!==number||record.evidence.contract.toLowerCase()!==entry.contract.toLowerCase())throw Error('Indexed outcome differs from native contribution identity');
 return {archived:entry,native:record,contract:d.contract,sourceContract:record.evidence.contract,inheritance,next:'Native state is authoritative. Archived evidence may lag an active worker. needsResume means unfinished work, not a request to restart a running Actions job; check the linked run first. Historical evidence keeps its original contract; failed consensus is preserved, not rerolled.'};
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
   const inheritance=await readOpenRecordInheritance(r,id,problem,id=>native('get_inheritance',[id]));
   let context;try{context=JSON.parse(e.context);}catch{throw Error('Malformed native contribution context: '+id);}
   return {id,status:r.status,title:context.title,scope:{claim:e.claim,formal_statement:e.formal_statement,evidence_kind:e.evidence_kind,verification:e.verification,research_direction:e.research_direction},bundle_hash:e.bundle_hash,points:{author_credited:r.credited_points,award_budget:r.award_budget??null,reserve:r.impact_reserve??'0',reserve_settled:r.reserve_settled===true},eligible_dependency:r.status==='credited'&&e.evidence_kind==='formal'&&e.verification==='verified',...(inheritance.inherited?{inheritance}:{})};
  }));items.push(...batch);
 }
 return {problem:d.problem,repository:d.repository,chainId:d.chainId,contract:d.contract,protocolCommit:problem.descriptor.protocol.commit,offset,limit,total,next_offset:next,items,next:next===null?null:`pnp list ${next} ${limit}`,reuse:'Use pnp show ID for the full native record. Only credited formal results can be imported.'};
}
export async function run(argv=process.argv.slice(2)){
 let sent;
 try{
  const args=[...argv],flag=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;const v=args[i+1];if(!v||v.startsWith('--'))throw Error(name+' needs a path');args.splice(i,2);if(args.includes(name))throw Error('Repeated '+name);return v;};
  const directory=flag('--problem',process.env.OPEN_MATH_PROBLEM_DIR),worktree=fs.realpathSync(flag('--worktree',process.cwd()));
  const verifierRoot=fs.realpathSync(process.env.OPEN_MATH_VERIFIER_DIR||toolRoot);
  const [command,...rest]=args,out=x=>console.log(JSON.stringify(x,null,2)),workFile=file=>contributorPath(worktree,file);
  if(!command||command==='help'){out({usage:'pnp COMMAND [--problem /trusted/problem] [--worktree /contribution]',commands:{submit:'submit COMMENT_ID [--send] — preview or send a contributor Studio transaction with GenLayerJS.',retry:'retry COMMENT_ID FAILED_REVIEW_HASH [--send] — request another review of this finalized undetermined transaction.',wallet:'wallet create|address ABSOLUTE_KEY_FILE — local owner-only key setup; prints only the public address.',inspect:'Read the open objective, evidence rules and deployment.',list:'list [OFFSET] [LIMIT] — discover native contribution IDs, scope and points; defaults: 0 20, maximum 50 per page.',init:'init SLUG PUBLIC_WALLET [formal|research-note] — create a v2 Lean/Mathlib example or note; replace it with your research.',format:'format RECORD_OR_BUNDLE — normalize JSON before obtaining its hash or signing.',check:'check RECORD [--lean] — format only by default; --lean runs isolated pinned proof verification.',show:'show CONTRIBUTION_ID — exact native record, bundle and fully qualified theorem reference for reuse.',prepare:'prepare PR RECORD PUBLIC_WALLET — export the exact message for an external wallet.',sign:'sign PR RECORD — use CONTRIBUTOR_KEY_FILE and output only the public claim.',envelope:'envelope PREPARED_FILE SIGNATURE_FILE — validate an external signature.',status:'status PR — read archive plus finalized native state.',challenge:'challenge ID FILE [--impact] [--send] — preview or send substantive evidence.'},guide:'docs/FULL-LEAN.md in this trusted protocol checkout',keys:'Keep private keys outside repositories. Never send them to the platform.'});return;}
  if(command==='format'){const f=workFile(rest[0]),maximum=rest[0]?.startsWith('research/artifacts/')?32768:16000,bytes=readProblemFile(worktree,rest[0],maximum),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),normalized=JSON.stringify(JSON.parse(text),null,2)+'\n';if(Buffer.byteLength(normalized)>maximum)throw Error(`Formatted JSON exceeds ${maximum} UTF-8 bytes`);fs.writeFileSync(f,normalized);out({formatted:rest[0]});return;}
  if(command==='wallet'){
   if(rest.length!==2||!['create','address'].includes(rest[0]))throw Error('Usage: wallet create|address /absolute/private/key-file');
   // The caller may launch from HOME, which is not itself a repository.
   // walletPath also checks every destination ancestor for an actual .git.
   const roots=[toolRoot,verifierRoot,...(directory?[fs.realpathSync(directory)]:[])];
   out((rest[0]==='create'?createLocalWallet:localWalletAddress)(rest[1],{roots}));return;
  }
  if(!directory)throw Error('Set OPEN_MATH_PROBLEM_DIR to the trusted main-branch configuration checkout.');
  const problem=loadOpenProblem(directory),d=problem.deployment;
  verifyOpenCheckout(problem,verifierRoot);
  if(verifierRoot!==toolRoot||command==='submit'||command==='retry'){
   const release=parseProblemJSON(readProblemFile(problem.root,'.open-math/wallet-intake.json'));
   verifyPinnedTools(toolRoot,release.clientCommit);
  }
  const signerRoots=[toolRoot,verifierRoot,problem.root,worktree];
  if(command==='submit'||command==='retry')return await sendResearchRequest(args,{problem,signerRoots});
  const gh=new GitHub({repository:d.repository}),native=createOpenNativeReader(problem);
  if(['prepare','sign','status'].includes(command))gh.token=resolveContributorGitHubToken();
  function decode(bytes,wallet){const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return decodeOpenSubmission(bytes,{wallet:wallet||parsed.attribution?.wallet,problem});}
  if(command==='inspect')out({admission:'open',objective:problem.policy.objective,admissionLimits:(await native('get_problem',[])).admission_limits,contract:d.contract,policy:problem.policyHash,protocolCommit:problem.descriptor.protocol.commit,toolchain:problem.policy.toolchain,allowedAxioms:problem.policy.allowed_axioms,evidence:['formal: contributor-defined statement and definitions, checked by isolated Lean; see docs/FULL-LEAN.md for pinned Mathlib and v2 source bundles','research-note: reviewed arguments; no formal-proof badge'],rewards:'Nontransferable native initial and later-impact points; no guaranteed award.',next:'Run list to discover earlier work; choose a question, then init SLUG PUBLIC_WALLET. No curator or task enrollment exists.'});
  else if(command==='list'){
   if(rest.length>2)throw Error('Usage: list [OFFSET] [LIMIT]');
   const numeric=rest.map(x=>/^(0|[1-9][0-9]*)$/.test(x)?Number(x):NaN);
   out(await listOpenContributions({native,problem,offset:numeric[0]??0,limit:numeric[1]??20}));
  }else if(command==='init'){
   const [slug,wallet,kind='formal']=rest,s=submissionTemplate(slug,wallet,{kind,problem:d.problem}),record=`research/submissions/${slug}.json`;
   for(const f of [record,s.evidence.artifact_path]){if(fs.existsSync(workFile(f)))throw Error('Refusing to overwrite '+f);fs.mkdirSync(path.dirname(workFile(f)),{recursive:true});}
   fs.writeFileSync(workFile(record),JSON.stringify(s,null,2)+'\n',{flag:'wx'});
   fs.writeFileSync(workFile(s.evidence.artifact_path),kind==='formal'?JSON.stringify(formalBundleTemplate({policyVersion:problem.policy.version}),null,2)+'\n':'# Research note\n\nREPLACE: Provide a substantive, supported argument. Distinguish conjectures from established results.\n',{flag:'wx'});
   out({record,artifact:s.evidence.artifact_path,...(kind==='formal'&&problem.policy.version===6?{example:'The starter is a standard textbook identity, not a novel result or a claim to points.'}:{}),next:'Replace all guidance with your work; disclose prior art and limits. Known mathematics needs formalization/integration provenance and actual sources. Run format, then check; add --lean for isolated proof verification.'});
  }else if(command==='check'){
   const s=decode(readProblemFile(worktree,rest[0],16000)),artifactBytes=readProblemFile(worktree,s.evidence.artifact_path,s.evidence.kind==='formal'?32768:12000),artifactText=validateOpenArtifactBytes(artifactBytes,s.evidence.kind);
   if(s.dependencies.length)gh.token=resolveContributorGitHubToken();
   const resolved=await resolveOpenDependencies({problem,submission:s,artifactText,github:gh,readRecord:id=>native('get',[id]),readInheritance:id=>native('get_inheritance',[id])});
   if(s.evidence.kind==='research-note'){out({record:'valid',evidence:'research-note',formalVerification:false,next:'GenLayer still needs to review whether the argument is supported and useful.'});return;}
   const temp=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-local-'));
   try{
    const artifact=path.join(temp,'candidate.json');fs.writeFileSync(artifact,artifactBytes,{mode:0o600,flag:'wx'});
    const manifest=writeOpenDependencyManifest(temp,resolved);
    const run=spawnSync('python3',['-B',path.join(verifierRoot,'scripts/verify_open.py'),'--bundle',artifact,'--dependencies',manifest,'--policy',path.join(problem.root,problem.descriptor.policy.path),'--policy-hash',problem.policyHash,'--repository',d.repository,'--head','1'.repeat(40),'--base','2'.repeat(40),'--protocol-commit',problem.descriptor.protocol.commit,...(rest.includes('--lean')?[]:['--syntax-only'])],{cwd:verifierRoot,encoding:'utf8',timeout:problem.policy.version===6?1260000:120000,maxBuffer:150000,env:{PATH:process.env.PATH,TRUSTED_LEAN_IMAGE:process.env.TRUSTED_LEAN_IMAGE}});
    if(run.status!==0)throw Error(openVerifierFailure(run));out(localCheckResult(JSON.parse(run.stdout),{lean:rest.includes('--lean')}));
   }finally{fs.rmSync(temp,{recursive:true,force:true});}
  }else if(command==='show'){
   const r=await native('get',[rest[0]]),inheritance=await readOpenRecordInheritance(r,rest[0],problem,id=>native('get_inheritance',[id])),reuse=formalReuseReference(r.evidence);out({record:r,inheritance,namespace:reuse?.namespace??null,reuse,next:'Only credited formal artifacts can be imported. Use the exact fully qualified reference; put its ID and bundle_hash in the bundle, and the same ID with actual use and importance in the record.'});
  }else if(command==='prepare'||command==='sign'){
   await native('get_config',[]);
   const number=Number(rest[0]),recordPath=rest[1],account=command==='sign'?loadLocalSigner(process.env.CONTRIBUTOR_KEY_FILE,signerRoots):null,wallet=account?.address||rest[2];
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
   const index=await readEvidenceFile(gh,'index.json'),status=await readOpenContributionStatus({index:index?.data??{entries:[]},number,problem,native,readReport:async file=>(await readEvidenceFile(gh,file))?.data});
   if(!status){out({pr:number,status:'No indexed outcome',next:'Check the wallet transaction and follow the worker in Actions. The worker picks up finalized requests automatically. Keep the original signed comment in place.'});return;}
   out(status);
  }else if(command==='challenge'){
   const [id,file]=rest,isImpact=rest.includes('--impact'),evidence=fs.readFileSync(path.isAbsolute(file)?file:workFile(file),'utf8'),state=await native(isImpact?'get_impact':'get',[id]),method=isImpact?'challenge_impact':'challenge';
   if(evidence.trim().length<20||evidence.length>4000||state.status!=='provisional'||Date.now()>=Number(state.deadline)*1000||Number(state.round)>=2)throw Error('Substantive evidence and an open challenge window required');
   if(!rest.includes('--send'))out({contract:d.contract,method,args:[id,evidence],deadline:state.deadline,next:'Repeat with --send and your local signer after reviewing.'});
   else{const a=loadLocalSigner(process.env.CONTRIBUTOR_KEY_FILE,signerRoots),client=createStudioClient({account:a});sent={contract:d.contract,wallet:a.address,method};const hash=await client.writeContract({address:d.contract,functionName:method,args:[id,evidence],leaderOnly:false});sent.hash=hash;console.error(JSON.stringify({status:'broadcast',...sent}));await finalized(client,hash,{address:d.contract,method,args:[id,evidence],sender:a.address});out({status:'challenge finalized',hash});}
  }else throw Error('Unknown command; run help');
 }catch(error){console.error(JSON.stringify({error:error.message,...(sent?{transaction:sent,next:'Inspect this transaction before retrying; it may already be broadcast.'}:{})}));process.exitCode=1;}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1]))await run();
