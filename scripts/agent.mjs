#!/usr/bin/env node
// Contributor-facing helper. Keys stay in the local signer; only signatures leave it.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {privateKeyToAccount} from 'viem/accounts';import {recoverMessageAddress,isAddress} from 'viem';
import {GitHub} from '../src/github.mjs';import {decodeSubmission} from '../src/submission.mjs';
import {digest,message,validateClaim,enrolledSubmissionBlobs} from '../src/security.mjs';import {clientFor,read,finalized} from '../github/runtime.mjs';
export const toolRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function contributorPath(worktree,file){
 if(typeof file!=='string'||!file||path.isAbsolute(file)||file.split(/[\\/]/).includes('..'))throw Error('Use a relative path inside the contributor worktree');
 const root=fs.realpathSync(worktree),target=path.resolve(root,file),inside=p=>p===root||p.startsWith(root+path.sep);
 if(!inside(target))throw Error('Path escapes contributor worktree');
 let ancestor=target;while(!fs.lstatSync(ancestor,{throwIfNoEntry:false})){const parent=path.dirname(ancestor);if(parent===ancestor)throw Error('Worktree path unavailable');ancestor=parent;}
 if(!inside(fs.realpathSync(ancestor)))throw Error('Symlink escapes contributor worktree');
 return target;
}
export async function run(argv=process.argv.slice(2)){
try{
 const flags=[...argv];let worktree=process.cwd();
 const at=flags.indexOf('--worktree');if(at!==-1){if(!flags[at+1]||flags[at+1].startsWith('--'))throw Error('--worktree requires a directory');worktree=flags[at+1];flags.splice(at,2);if(flags.includes('--worktree'))throw Error('Only one --worktree is allowed');}
 worktree=fs.realpathSync(worktree);if(!fs.statSync(worktree).isDirectory())throw Error('Contributor worktree must be a directory');
 const workFile=file=>contributorPath(worktree,file),trusted=file=>path.join(toolRoot,file);
const deployment=JSON.parse(fs.readFileSync(trusted('public/deployment.json'),'utf8')),policy=JSON.parse(fs.readFileSync(trusted('lean/policy.json'),'utf8'));
const gh=new GitHub({repository:deployment.repository,token:process.env.GITHUB_TOKEN});
const [command,...args]=flags;
const out=x=>console.log(JSON.stringify(x,null,2));
const blob=async sha=>{const b=await gh.request(`/git/blobs/${sha}`);if(b.sha!==sha||b.encoding!=='base64'||b.size>12000)throw Error('Invalid proof blob');return Buffer.from(b.content,'base64');};
async function goals(){const c=clientFor(),ids=await read(c,deployment.contract,'list_contributions',[]),records=await Promise.all(ids.map(id=>read(c,deployment.contract,'get',[id])));return Object.entries(policy.goals).map(([id,g])=>({id,...g,status:records.some(r=>['approved','credited'].includes(r.status)&&r.evidence.statement_hash===g.statement_hash)?'closed':'open',creditedDependency:records.find(r=>r.status==='credited'&&r.evidence.statement_hash===policy.goals.renaming.statement_hash)?.evidence.id||null}));}
 if(!command||command==='help'){
  out({start:'Read AGENTS.md. Run this helper from its trusted protocol checkout; --worktree DIR selects contributor files (defaults to your current directory).',toolRoot,worktree,commands:{goals:'Query finalized contract state for available enrolled goals.',init:'init GOAL SLUG WALLET — create a required record to fill in.',format:'format research/submissions/SLUG.json — normalize before committing.',check:'check RECORD [--lean] — validate record and proof; --lean requires TRUSTED_LEAN_IMAGE and Docker.',sign:'sign PR RECORD — verify immutable GitHub blobs and emit a public signed comment. Requires local CONTRIBUTOR_KEY_FILE, no local PR checkout.',prepare:'prepare PR RECORD PUBLIC_WALLET — emit the exact claim and message for an external signer.',envelope:'envelope CLAIM_FILE SIGNATURE_FILE — verify signature and format the public comment; public input files may be outside the worktree.',challenge:'challenge ID EVIDENCE_FILE [--impact] [--send] — preview or submit a challenge with a local signer.',status:'status PR — print latest public outcome, reason, initial/later points and recovery action.'},canonicalBranch:deployment.branch,repository:deployment.repository,keyRule:'Never put a private key in chat, GitHub, a PR, the manifest, or a command-line argument.'});
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
  const [id,file]=args,evidence=fs.readFileSync(file,'utf8');if(evidence.trim().length<20||evidence.length>4000)throw Error('Challenge needs 20–4,000 characters of substantive evidence');
  const impact=args.includes('--impact'),method=impact?'challenge_impact':'challenge',c=clientFor();
  const state=await read(c,deployment.contract,impact?'get_impact':'get',[id]);
  if(state.status!=='provisional'||Date.now()>=Number(state.deadline)*1000||state.round>=2)throw Error('Challenge window closed or budget exhausted');
  if(!args.includes('--send'))out({contract:deployment.contract,method,args:[id,evidence],deadline:state.deadline,next:'Review the evidence, then repeat with --send and a local CONTRIBUTOR_KEY_FILE. No transaction sent.'});
  else{if(!process.env.CONTRIBUTOR_KEY_FILE)throw Error('Local wallet signer required');const sender=clientFor(fs.readFileSync(process.env.CONTRIBUTOR_KEY_FILE,'utf8').trim());const hash=await sender.writeContract({address:deployment.contract,functionName:method,args:[id,evidence],leaderOnly:false});await finalized(sender,hash,{address:deployment.contract,method,args:[id,evidence]});out({status:'challenge recorded',hash,next:'Settlement is blocked. The queue will request a fresh review; native consensus appeals are separate.'});}
 }else if(command==='status'){
  const pr=Number(args[0]);if(!Number.isSafeInteger(pr)||pr<1)throw Error('PR number required');
  const index=await fetch(`https://raw.githubusercontent.com/${deployment.repository}/evidence/index.json`,{signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw Error('Evidence feed unavailable');return r.json();});
  const entry=index.entries.find(e=>e.pr===pr);if(!entry)out({pr,status:'no indexed outcome yet',next:'If you already posted the signed comment as the PR author before its nine-minute expiry, wait for the worker or 15-minute recovery sweep; do not repeatedly resubmit. Otherwise post a fresh claim using the same GitHub account that opened the PR. A different bot account cannot claim for the author.'});
  else{const report=await fetch(`https://raw.githubusercontent.com/${deployment.repository}/evidence/${entry.report}`).then(r=>r.json());out({id:entry.id,status:report.status,initialPoints:report.record?.credited_points||'0',impact:report.impact||null,reason:report.record?.verdict?.reason,error:report.error,run:report.run,commentId:report.commentId,resume:'Repository operator: dispatch research.yml with this comment_id. Changed head/base requires a new signed claim.'});}
 }else throw Error('Unknown command; run help');
}catch(e){console.error(JSON.stringify({error:e.message,next:'Run node scripts/agent.mjs help. No claim was posted and no private key was transmitted.'}));process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
