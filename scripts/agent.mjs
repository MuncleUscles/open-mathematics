#!/usr/bin/env node
// Contributor-facing helper. Keys stay in the local signer; only signatures leave it.
import {sourceURL as validateSourceURL} from '../github/provenance-source.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {privateKeyToAccount} from 'viem/accounts';import {recoverMessageAddress,isAddress} from 'viem';
import {GitHub} from '../src/github.mjs';import {decodeSubmission,validateProvenance} from '../src/submission.mjs';
import {digest,message,validateClaim,enrolledSubmissionBlobs} from '../src/security.mjs';import {clientFor as studioClientFor,read,finalized} from '../github/runtime.mjs';
import {rpcRateLimit} from '../src/rpc-errors.mjs';
export const toolRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function contributorPath(worktree,file){
 if(typeof file!=='string'||!file||path.isAbsolute(file)||file.split(/[\\/]/).includes('..'))throw Error('Use a relative path inside the contributor worktree');
 const root=fs.realpathSync(worktree),target=path.resolve(root,file),inside=p=>p===root||p.startsWith(root+path.sep);
 if(!inside(target))throw Error('Path escapes contributor worktree');
 let ancestor=target;while(!fs.lstatSync(ancestor,{throwIfNoEntry:false})){const parent=path.dirname(ancestor);if(parent===ancestor)throw Error('Worktree path unavailable');ancestor=parent;}
 if(!inside(fs.realpathSync(ancestor)))throw Error('Symlink escapes contributor worktree');
 return target;
}
export async function run(argv=process.argv.slice(2),{clientFor=studioClientFor}={}){
let nativeTransaction;
try{
 const flags=[...argv];let worktree=process.cwd();
 const at=flags.indexOf('--worktree');if(at!==-1){if(!flags[at+1]||flags[at+1].startsWith('--'))throw Error('--worktree requires a directory');worktree=flags[at+1];flags.splice(at,2);if(flags.includes('--worktree'))throw Error('Only one --worktree is allowed');}
 worktree=fs.realpathSync(worktree);if(!fs.statSync(worktree).isDirectory())throw Error('Contributor worktree must be a directory');
 const workFile=file=>contributorPath(worktree,file),trusted=file=>path.join(toolRoot,file);
 const evidenceFile=file=>typeof file==='string'&&path.isAbsolute(file)?file:workFile(file);
const deployment=JSON.parse(fs.readFileSync(trusted('public/deployment.json'),'utf8')),policy=JSON.parse(fs.readFileSync(trusted('lean/policy.json'),'utf8'));
const gh=new GitHub({repository:deployment.repository,token:process.env.GITHUB_TOKEN});
const [command,...args]=flags;
const out=x=>console.log(JSON.stringify(x,null,2));
async function sendNative(sender,method,args){
 const address=deployment.contract;
 nativeTransaction={contract:address,chainId:deployment.chainId,method,wallet:sender.account.address};
 const hash=await sender.writeContract({address,functionName:method,args,leaderOnly:false});
 if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Studio did not return a valid native transaction hash');
 nativeTransaction.hash=hash;
 console.error(JSON.stringify({event:'native-transaction',status:'broadcast',...nativeTransaction}));
 await finalized(sender,hash,{address,method,args});
 nativeTransaction.finalized=true;
 return hash;
}
const blob=async sha=>{const b=await gh.request(`/git/blobs/${sha}`);if(b.sha!==sha||b.encoding!=='base64'||b.size>12000)throw Error('Invalid proof blob');return Buffer.from(b.content,'base64');};
async function goals(){const c=clientFor(),ids=await read(c,deployment.contract,'list_contributions',[]),records=await Promise.all(ids.map(id=>read(c,deployment.contract,'get',[id])));return Object.entries(policy.goals).map(([id,g])=>({id,...g,status:records.some(r=>['approved','credited'].includes(r.status)&&r.evidence.statement_hash===g.statement_hash)?'closed':'open',creditedDependency:records.find(r=>r.status==='credited'&&r.evidence.statement_hash===policy.goals.renaming.statement_hash)?.evidence.id||null}));}
 if(!command||command==='help'){
  out({start:'Read AGENTS.md. Run this helper from its trusted protocol checkout; --worktree DIR selects contributor files (defaults to your current directory).',toolRoot,worktree,commands:{authors:'Read native external-author IDs, verified identities and unclaimed points.',affiliations:'Read current wallet affiliations and their history.',affiliation:'affiliation SIDE [--send] — preview/change your own native affiliation; points and merit are unaffected.', 'case-report':'case-report KIND TARGET FILE [--send] — report specific provenance evidence or claim your external-author identity from your own wallet.', 'case-withdraw':'case-withdraw ID REASON_FILE [--send] — release your unadmitted case slot; preserves the report history.', 'case-status':'case-status ID — show the native case, history and exact identity challenge if applicable.', 'case-challenge':'case-challenge ID FILE [--send] — challenge a provisional attribution/identity/solution case.',goals:'Query finalized contract state for available enrolled goals.',init:'init GOAL SLUG WALLET — create a required record to fill in.',format:'format research/submissions/SLUG.json — normalize before committing.',check:'check RECORD [--lean] — validate record and proof; --lean requires TRUSTED_LEAN_IMAGE and Docker.',sign:'sign PR RECORD — verify immutable GitHub blobs and emit a public signed comment. Requires local CONTRIBUTOR_KEY_FILE, no local PR checkout.',prepare:'prepare PR RECORD PUBLIC_WALLET — emit the exact claim and message for an external signer.',envelope:'envelope CLAIM_FILE SIGNATURE_FILE — verify signature and format the public comment; public input files may be outside the worktree.',challenge:'challenge ID EVIDENCE_FILE [--impact] [--send] — preview or submit a challenge with a local signer.',status:'status PR — print latest public outcome, reason, initial/later points and recovery action.'},canonicalBranch:deployment.branch,repository:deployment.repository,keyRule:'Never put a private key in chat, GitHub, a PR, the manifest, or a command-line argument.'});
 }else if(command==='goals')out({deployment:Object.fromEntries(['contract','repository','branch','chainId','policy','windowSeconds'].map(k=>[k,deployment[k]])),goals:await goals()});
 else if(command==='init'){
  const [goal,slug,wallet]=args;if(!Object.hasOwn(policy.goals,goal)||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug||''))throw Error('Use an enrolled goal and lowercase slug');
  if(!isAddress(wallet)||/^0x0{40}$/i.test(wallet))throw Error('Use your nonzero public wallet address');
  const file=`research/submissions/${slug}.json`,s=JSON.parse(fs.readFileSync(trusted('research/SUBMISSION_TEMPLATE.json'),'utf8'));
  s.evidence.goal=goal;s.evidence.proof_path=policy.goals[goal].path;s.attribution.wallet=wallet;
  if(policy.goals[goal].dependency){const g=(await goals()).find(g=>g.id===goal);if(!g.creditedDependency)throw Error('No settled dependency');s.dependencies=[{id:g.creditedDependency,use:'Describe the exact use in your proof, rather than only citing it.',importance:'Explain why this earlier result matters, and how easily it could be replaced.'}];}
  const target=workFile(file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(workFile(file),JSON.stringify(s,null,2)+'\n',{flag:'wx'});
  out({record:file,proof:s.evidence.proof_path,next:'Fill the record with actual content, write the proof expression, then run check. Do not submit template prose.'});
 }else if(command==='format'){
  const file=args[0];if(!/^research\/submissions\/[a-z0-9-]+\.json$/.test(file||''))throw Error('Submission path required');
  const target=workFile(file),text=fs.readFileSync(target,'utf8');if(Buffer.byteLength(text)>12000)throw Error('Record too large');fs.writeFileSync(target,JSON.stringify(JSON.parse(text),null,2)+'\n');out({formatted:file,next:'Review the result, validate, then commit.'});
 }else if(command==='check'){
  const file=args[0],bytes=fs.readFileSync(workFile(file)),s=decodeSubmission(bytes,{wallet:JSON.parse(bytes).attribution?.wallet,goals:policy.goals});
  const goal=policy.goals[s.evidence.goal],dir=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-preflight-'));
  try{
   let dep=null,artifact=null;
   if(goal.dependency){if(s.dependencies.length!==1)throw Error('Exactly one settled dependency required');const r=await read(clientFor(),deployment.contract,'get',[s.dependencies[0].id]);if(r.status!=='credited'||r.evidence.statement_hash!==policy.goals.renaming.statement_hash)throw Error('Wrong settled dependency');const t=await gh.request(`/git/trees/${r.merge_commit}?recursive=1`),e=t.tree.find(e=>e.path===policy.goals.renaming.path);if(t.truncated||e?.mode!=='100644'||e.type!=='blob')throw Error('Invalid dependency tree');dep=path.join(dir,'dependency.proof');fs.writeFileSync(dep,await blob(e.sha));artifact=r.evidence.artifact_hash;}else if(s.dependencies.length)throw Error('This goal has no dependencies');
   const script='import sys;from pathlib import Path;sys.path.insert(0,"lean");from check import assemble;assemble(Path(sys.argv[1]).read_text(),sys.argv[2],Path(sys.argv[3]).read_text() if sys.argv[3] else None)';
   const proofFile=workFile(s.evidence.proof_path);
   execFileSync('python3',['-c',script,proofFile,s.evidence.goal,dep||''],{cwd:toolRoot,stdio:['ignore','pipe','pipe']});
   if(args.includes('--lean')){const v=[trusted('scripts/verify_lean.py'),proofFile,'--goal',s.evidence.goal];if(dep)v.push('--dependency-file',dep,'--dependency-artifact',artifact);const r=spawnSync('python3',v,{cwd:toolRoot,encoding:'utf8',timeout:60000});if(r.status!==0)throw Error(r.stderr);out({record:'valid',lean:JSON.parse(r.stdout),next:'Commit exactly the proof and record in one commit on current research. Open PR, then sign.'});}
   else out({record:'valid',proofGrammar:'valid',lean:'NOT RUN — use --lean with the pinned Docker verifier. CI always independently verifies.',next:'Run isolated Lean, then commit exactly the proof and record in one commit on current research.'});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }else if(command==='sign'||command==='prepare'){
  const [prNumber,recordPath,requestedWallet]=args;if(command==='sign'&&!process.env.CONTRIBUTOR_KEY_FILE)throw Error('Set CONTRIBUTOR_KEY_FILE to a local private file. Do not paste a key.');
  if(!/^research\/submissions\/[a-z0-9][a-z0-9-]{0,63}\.json$/.test(recordPath||''))throw Error('Use the committed research/submissions/SLUG.json path');
  const account=command==='sign'?privateKeyToAccount(fs.readFileSync(process.env.CONTRIBUTOR_KEY_FILE,'utf8').trim()):null,wallet=account?.address||requestedWallet;
  if(!isAddress(wallet))throw Error('A public wallet address is required');const pr=await gh.pr(Number(prNumber));
  if(pr.state!=='open'||pr.base.ref!==deployment.branch||pr.base.sha!==await gh.branchHead(deployment.branch))throw Error('Rebase PR on current canonical branch first');
  const [tree,baseTree,head]=await Promise.all([gh.request(`/git/trees/${pr.head.sha}?recursive=1`),gh.request(`/git/trees/${pr.base.sha}?recursive=1`),gh.commit(pr.head.sha)]);
  const changed=enrolledSubmissionBlobs({claim:{base:pr.base.sha,submission_path:recordPath},tree,baseTree,head,proofPaths:Object.values(policy.goals).map(g=>g.path)});
  const bytes=await blob(changed.submissionSha),s=decodeSubmission(bytes,{wallet,goals:policy.goals});
  const claim={version:2,domain:deployment.origin,chainId:deployment.chainId,problem:'p-vs-np',repository:deployment.repository,pr:Number(prNumber),head:pr.head.sha,base:pr.base.sha,branch:deployment.branch,contract:deployment.contract,policy:deployment.policy,submission_path:recordPath,submission_hash:digest(bytes),wallet,nonce:randomBytes(16).toString('hex'),expires:Date.now()+540000};
  validateClaim(claim,{...deployment,domain:deployment.origin});
  if(changed.proofPath!==s.evidence.proof_path)throw Error('Committed record mismatch');
  if(command==='prepare'){out({claim,message:message(claim),expiresAt:new Date(claim.expires).toISOString(),next:'Sign the decoded message string using EIP-191 personal_sign (not JSON or a transaction); save the hex signature as plain text. Run envelope CLAIM_FILE SIGNATURE_FILE and post its output as the PR author before expiresAt.'});return;}
  const envelope={claim,signature:await account.signMessage({message:message(claim)})};
  process.stdout.write(`Open-Mathematics-Claim: ${digest(claim)}\n\`\`\`json\n${JSON.stringify(envelope,null,2)}\n\`\`\`\n`);
 }else if(command==='envelope'){
  const input=JSON.parse(fs.readFileSync(args[0],'utf8')),claim=input.claim||input,signature=fs.readFileSync(args[1],'utf8').trim();
  validateClaim(claim,{...deployment,domain:deployment.origin});
  if((await recoverMessageAddress({message:message(claim),signature})).toLowerCase()!==claim.wallet.toLowerCase())throw Error('Signature does not match the claim wallet');
  const envelope={claim,signature};process.stdout.write(`Open-Mathematics-Claim: ${digest(claim)}\n\`\`\`json\n${JSON.stringify(envelope,null,2)}\n\`\`\`\n`);
 }else if(command==='challenge'){
  const [id,file]=args,evidence=fs.readFileSync(evidenceFile(file),'utf8');if(evidence.trim().length<20||evidence.length>4000)throw Error('Challenge needs 20–4,000 characters of substantive evidence');
  const impact=args.includes('--impact'),method=impact?'challenge_impact':'challenge',c=clientFor();
  const state=await read(c,deployment.contract,impact?'get_impact':'get',[id]);
  if(state.status!=='provisional'||Date.now()>=Number(state.deadline)*1000||state.round>=2)throw Error('Challenge window closed or budget exhausted');
  if(!args.includes('--send'))out({contract:deployment.contract,method,args:[id,evidence],deadline:state.deadline,next:'Review the evidence, then repeat with --send and a local CONTRIBUTOR_KEY_FILE. No transaction sent.'});
  else{if(!process.env.CONTRIBUTOR_KEY_FILE)throw Error('Local wallet signer required');const sender=clientFor(fs.readFileSync(process.env.CONTRIBUTOR_KEY_FILE,'utf8').trim());const hash=await sendNative(sender,method,[id,evidence]);out({status:'challenge recorded',hash,next:'Settlement is blocked. The queue will request a fresh review; native consensus appeals are separate.'});}
 }else if(command==='affiliation'||command==='case-report'||command==='case-challenge'||command==='case-withdraw'){
  if(deployment.protocolVersion!==3)throw Error('This deployment does not yet expose native sides/provenance');
  let method,callArgs;
  if(command==='affiliation'){
   if(!['p-equals-np','p-not-equals-np','shared'].includes(args[0]))throw Error('Choose p-equals-np, p-not-equals-np or shared');
   method='set_affiliation';callArgs=[args[0]];
  }else if(command==='case-report'){
   const [kind,target,file]=args;if(!['attribution','authorship','external-solution'].includes(kind))throw Error('Unknown provenance case kind');
   const bytes=fs.readFileSync(evidenceFile(file));if(bytes.byteLength>12000)throw Error('Case evidence is too large');
   const payload=JSON.parse(bytes);if(Object.keys(payload).sort().join(',')!=='claim,component,sources'||typeof payload.claim!=='string'||payload.claim.length<40||payload.claim.length>3000||typeof payload.component!=='string'||payload.component.length<1||payload.component.length>300)throw Error('Case needs a specific claim, component and actual sources');
   validateProvenance({mode:'integration',sources:payload.sources,discovery_basis:''});
   for(const source of payload.sources){const url=validateSourceURL(source.reference);if(/\.pdf$/i.test(url.pathname))throw Error('PDF sources are unsupported; use a direct stable UTF-8 text source.');}
   const reader=clientFor();
   if(kind==='attribution'){const record=await read(reader,deployment.contract,'get',[target]);if(record.status!=='credited')throw Error('Attribution target must be a settled credited contribution');}
   else if(kind==='authorship'){const author=(await read(reader,deployment.contract,'get_external_authors',[])).find(a=>a.id===target);if(!author)throw Error('Unknown author; run authors for exact IDs and registered sources');if(author.claimed_wallet)throw Error('This author identity is already bound');if(!payload.sources.some(s=>author.sources.includes(s.reference)))throw Error('Cite the exact registered author source; a different page cannot prove this identity');}
   else{const problem=await read(reader,deployment.contract,'get_problem',[]);if(target!==problem.id||problem.status==='resolved')throw Error('Unknown or already resolved problem');}
   if(process.env.CONTRIBUTOR_KEY_FILE){const wallet=privateKeyToAccount(fs.readFileSync(process.env.CONTRIBUTOR_KEY_FILE,'utf8').trim()).address;const capacity=await read(reader,deployment.contract,'get_case_capacity',[wallet]);if(Number(capacity.available)<1)throw Error('Four cases are already open for this wallet; withdraw an unadmitted case or wait for settlement');}
   method='report_case';callArgs=[kind,target,JSON.stringify(payload)];
  }else if(command==='case-withdraw'){
   const [id,file]=args,reason=fs.readFileSync(evidenceFile(file),'utf8');if(reason.length<10||reason.length>1000)throw Error('Withdrawal reason needs 10–1000 characters');
   const state=await read(clientFor(),deployment.contract,'get_case',[id]);if(state.status!=='submitted')throw Error('Only an unadmitted submitted case can be withdrawn');
   if(process.env.CONTRIBUTOR_KEY_FILE&&privateKeyToAccount(fs.readFileSync(process.env.CONTRIBUTOR_KEY_FILE,'utf8').trim()).address.toLowerCase()!==state.reporter.toLowerCase())throw Error('Only the original reporter may withdraw this case');
   method='withdraw_case';callArgs=[id,reason];
  }else{
   const [id,file]=args,evidence=fs.readFileSync(evidenceFile(file),'utf8');if(evidence.length<30||evidence.length>4000)throw Error('Case challenge needs 30–4000 characters');
   const state=await read(clientFor(),deployment.contract,'get_case',[id]);if(state.status!=='provisional'||Date.now()>=Number(state.deadline)*1000||Number(state.round)>=2)throw Error('Case challenge window closed');
   method='challenge_case';callArgs=[id,evidence];
  }
  if(!args.includes('--send'))out({contract:deployment.contract,method,args:callArgs,next:'Review this preview. Repeat with --send and your local CONTRIBUTOR_KEY_FILE to sign. No transaction sent.'});
  else{
   if(!process.env.CONTRIBUTOR_KEY_FILE)throw Error('Local wallet signer required');
   const sender=clientFor(fs.readFileSync(process.env.CONTRIBUTOR_KEY_FILE,'utf8').trim()),wallet=sender.account.address;
   const hash=await sendNative(sender,method,callArgs);
   if(method==='report_case'){
    const ids=await read(sender,deployment.contract,'list_cases',[]),cases=await Promise.all(ids.map(id=>read(sender,deployment.contract,'get_case',[id])));
    const matches=cases.filter(c=>c.reporter.toLowerCase()===wallet.toLowerCase()&&c.kind===callArgs[0]&&c.target===callArgs[1]&&digest(c.payload)===digest(JSON.parse(callArgs[2])));
    out({hash,cases:matches.map(c=>({id:c.id,status:c.status,identity_challenge:c.identity_challenge,identity_expiry:c.identity_expiry})),next:'Reports do not establish priority or resolve a problem. A trusted verifier must admit documentary evidence; independent review and a challenge window precede any correction. Publish the exact challenge on the same registered author-controlled source. Identity verification and settlement must finish within the 24-hour native expiry.'});
   }else out({hash,status:'finalized',next:method==='set_affiliation'?'Your affiliation changed; submission directions and earned credit remain historical.':method==='withdraw_case'?'Your unadmitted case was withdrawn; its audit history remains and the slot is available.':'The case is challenged and cannot settle until reviewed again.'});
  }
 }else if(command==='authors'||command==='affiliations'){
  if(deployment.protocolVersion!==3)throw Error('Native provenance is unavailable in this deployment');
  out(await read(clientFor(),deployment.contract,command==='authors'?'get_external_authors':'get_affiliations',[]));
 }else if(command==='case-status'){
  if(deployment.protocolVersion!==3)throw Error('Native provenance is unavailable in this deployment');
  out(await read(clientFor(),deployment.contract,'get_case',[args[0]]));
 }else if(command==='status'){
  const pr=Number(args[0]);if(!Number.isSafeInteger(pr)||pr<1)throw Error('PR number required');
  const index=await fetch(`https://raw.githubusercontent.com/${deployment.repository}/evidence/index.json`,{signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw Error('Evidence feed unavailable');return r.json();});
  const entry=index.entries.find(e=>e.pr===pr);if(!entry)out({pr,status:'no indexed outcome yet',next:'If you already posted the signed comment as the PR author before its nine-minute expiry, wait for the worker or 15-minute recovery sweep; do not repeatedly resubmit. Otherwise post a fresh claim using the same GitHub account that opened the PR. A different bot account cannot claim for the author.'});
  else{const report=await fetch(`https://raw.githubusercontent.com/${deployment.repository}/evidence/${entry.report}`).then(r=>r.json());
   const registrationRejection=report.status==='rejected'?report.registrationRejection:null;
   const result={id:entry.id,status:report.status,historicalInitialPoints:report.record?.credited_points||'0',impact:report.impact||null,reason:registrationRejection?.reason??report.record?.verdict?.reason,archivedError:report.error,run:report.run,commentId:report.commentId,readSource:'Archived public report',resume:'Do not resubmit a credited contribution. Repository operators use impact.yml for an unresolved later-impact review; known failed consensus is preserved, not rerolled. Pending claims on the active deployment can resume through research.yml.'};
   if(registrationRejection){
    result.registrationRejection=registrationRejection;result.contract=report.contract;
    result.resume='This registration transaction finalized with an execution error. Inspect the recorded receipt for this completed attempt.';
   }else try{const c=clientFor(),record=await read(c,deployment.contract,'get',[entry.id]);result.status=record.status;result.reason=record.verdict?.reason;result.impact=await read(c,deployment.contract,'get_impact',[entry.id]);result.walletPoints=await read(c,deployment.contract,'get_points',[record.evidence.wallet]);if(deployment.protocolVersion>=3)result.provenance=await read(c,deployment.contract,'get_provenance',[entry.id]);result.readSource='Fresh finalized active contract';result.contract=deployment.contract;}catch{result.nativeRead='Unavailable or record not registered in the active contract; consult archived verification evidence.';}
   out(result);
  }
 }else throw Error('Unknown command; run help');
}catch(e){
 const rateLimit=rpcRateLimit(e);
 let failure;
 if(!nativeTransaction){
  failure={...(argv.includes('--send')?{status:'before-broadcast'}:{}),error:rateLimit?'Studio RPC rate limit reached.':e.message,next:rateLimit?'Run the command again after the limit resets.':'Correct the reported error or run node scripts/agent.mjs help.'};
 }else{
  const {finalized:confirmed,...details}=nativeTransaction;
  if(confirmed)failure={status:'result-unavailable',error:'The native transaction finalized, but the follow-up result could not be loaded.',...details,next:'Inspect the finalized receipt and current contract state using the reported hash.'};
  else if(details.hash)failure={status:'finality-unverified',error:'Successful finality could not be verified for the broadcast transaction.',...details,next:'Inspect the receipt and current contract state using the reported hash before retrying.'};
  else failure={status:'broadcast-unknown',error:'Studio did not return a native transaction hash. The transaction may have been broadcast.',...details,next:'Inspect transaction history for this wallet and current contract state to determine the outcome before retrying.'};
 }
 if(rateLimit){
  const {retryAfterSeconds,limit}=rateLimit;
  failure.rateLimit={retryAfterSeconds,limit};
  const wait=retryAfterSeconds===undefined?'Wait for the Studio rate-limit window to reset.':`Wait at least ${retryAfterSeconds} seconds for the Studio rate-limit window to reset.`;
  failure.next=`${wait} ${failure.next}`;
 }
 console.error(JSON.stringify(failure));process.exitCode=1;
}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
