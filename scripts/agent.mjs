#!/usr/bin/env node
// Contributor-facing helper. Keys stay in the local signer; only signatures leave it.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';
import {privateKeyToAccount} from 'viem/accounts';import {recoverMessageAddress,isAddress} from 'viem';
import {GitHub} from '../src/github.mjs';import {decodeSubmission} from '../src/submission.mjs';
import {digest,message,validateClaim,enrolledSubmissionBlobs} from '../src/security.mjs';import {clientFor,read,finalized} from '../github/runtime.mjs';
const deployment=JSON.parse(fs.readFileSync('public/deployment.json','utf8')),policy=JSON.parse(fs.readFileSync('lean/policy.json','utf8'));
const gh=new GitHub({repository:deployment.repository,token:process.env.GITHUB_TOKEN});
const [command,...args]=process.argv.slice(2);
const out=x=>console.log(JSON.stringify(x,null,2));
const git=(...a)=>execFileSync('git',a,{maxBuffer:3000000});
const blob=async sha=>{const b=await gh.request(`/git/blobs/${sha}`);if(b.sha!==sha||b.encoding!=='base64'||b.size>12000)throw Error('Invalid proof blob');return Buffer.from(b.content,'base64');};
async function goals(){const c=clientFor(),ids=await read(c,deployment.contract,'list_contributions',[]),records=await Promise.all(ids.map(id=>read(c,deployment.contract,'get',[id])));return Object.entries(policy.goals).map(([id,g])=>({id,...g,status:records.some(r=>['approved','credited'].includes(r.status)&&r.evidence.statement_hash===g.statement_hash)?'closed':'open',creditedDependency:records.find(r=>r.status==='credited'&&r.evidence.statement_hash===policy.goals.renaming.statement_hash)?.evidence.id||null}));}
try{
 if(!command||command==='help'){
  out({start:'Read AGENTS.md. Use a trusted protocol checkout for this helper; keep your research fork separate.',commands:{goals:'Query finalized contract state for available enrolled goals.',init:'init GOAL SLUG WALLET — create a required record to fill in.',format:'format research/submissions/SLUG.json — normalize before committing.',check:'check RECORD [--lean] — validate record and proof; --lean requires TRUSTED_LEAN_IMAGE and Docker.',sign:'sign PR RECORD — verify exact committed PR diff and emit public signed comment. Requires local CONTRIBUTOR_KEY_FILE.',prepare:'prepare PR RECORD PUBLIC_WALLET — emit the exact claim and message for an external signer.',envelope:'envelope CLAIM_FILE SIGNATURE_FILE — verify signature and format the public comment.',challenge:'challenge ID EVIDENCE_FILE [--impact] [--send] — preview or submit a challenge with a local signer.',status:'status PR — print latest public outcome, reason, initial/later points and recovery action.'},canonicalBranch:deployment.branch,repository:deployment.repository,keyRule:'Never put a private key in chat, GitHub, a PR, the manifest, or a command-line argument.'});
 }else if(command==='goals')out({deployment:Object.fromEntries(['contract','repository','branch','chainId','policy','windowSeconds'].map(k=>[k,deployment[k]])),goals:await goals()});
 else if(command==='init'){
  const [goal,slug,wallet]=args;if(!Object.hasOwn(policy.goals,goal)||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug||''))throw Error('Use an enrolled goal and lowercase slug');
  const file=`research/submissions/${slug}.json`,s=JSON.parse(fs.readFileSync('research/SUBMISSION_TEMPLATE.json','utf8'));
  s.evidence.goal=goal;s.evidence.proof_path=policy.goals[goal].path;s.attribution.wallet=wallet;
  if(policy.goals[goal].dependency){const g=(await goals()).find(g=>g.id===goal);if(!g.creditedDependency)throw Error('No settled dependency');s.dependencies=[{id:g.creditedDependency,use:'Describe the exact use in your proof, rather than only citing it.',importance:'Explain why this earlier result matters, and how easily it could be replaced.'}];}
  fs.mkdirSync('research/submissions',{recursive:true});fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n',{flag:'wx'});
  out({record:file,proof:s.evidence.proof_path,next:'Fill the record with actual content, write the proof expression, then run check. Do not submit template prose.'});
 }else if(command==='format'){
  const file=args[0];if(!/^research\/submissions\/[a-z0-9-]+\.json$/.test(file||''))throw Error('Submission path required');
  const text=fs.readFileSync(file,'utf8');if(Buffer.byteLength(text)>12000)throw Error('Record too large');fs.writeFileSync(file,JSON.stringify(JSON.parse(text),null,2)+'\n');out({formatted:file,next:'Review the result, validate, then commit.'});
 }else if(command==='check'){
  const file=args[0],bytes=fs.readFileSync(file),s=decodeSubmission(bytes,{wallet:JSON.parse(bytes).attribution?.wallet,goals:policy.goals});
  const goal=policy.goals[s.evidence.goal],dir=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-preflight-'));
  try{
   let dep=null,artifact=null;
   if(goal.dependency){if(s.dependencies.length!==1)throw Error('Exactly one settled dependency required');const r=await read(clientFor(),deployment.contract,'get',[s.dependencies[0].id]);if(r.status!=='credited'||r.evidence.statement_hash!==policy.goals.renaming.statement_hash)throw Error('Wrong settled dependency');const t=await gh.request(`/git/trees/${r.merge_commit}?recursive=1`),e=t.tree.find(e=>e.path===policy.goals.renaming.path);if(t.truncated||e?.mode!=='100644'||e.type!=='blob')throw Error('Invalid dependency tree');dep=path.join(dir,'dependency.proof');fs.writeFileSync(dep,await blob(e.sha));artifact=r.evidence.artifact_hash;}else if(s.dependencies.length)throw Error('This goal has no dependencies');
   const script='import sys;from pathlib import Path;sys.path.insert(0,"lean");from check import assemble;assemble(Path(sys.argv[1]).read_text(),sys.argv[2],Path(sys.argv[3]).read_text() if sys.argv[3] else None)';
   execFileSync('python3',['-c',script,s.evidence.proof_path,s.evidence.goal,dep||''],{stdio:['ignore','pipe','pipe']});
   if(args.includes('--lean')){const v=['scripts/verify_lean.py',s.evidence.proof_path,'--goal',s.evidence.goal];if(dep)v.push('--dependency-file',dep,'--dependency-artifact',artifact);const r=spawnSync('python3',v,{encoding:'utf8',timeout:60000});if(r.status!==0)throw Error(r.stderr);out({record:'valid',lean:JSON.parse(r.stdout),next:'Commit exactly the proof and record in one commit on current research. Open PR, then sign.'});}
   else out({record:'valid',proofGrammar:'valid',lean:'NOT RUN — use --lean with the pinned Docker verifier. CI always independently verifies.',next:'Run isolated Lean, then commit exactly the proof and record in one commit on current research.'});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }else if(command==='sign'||command==='prepare'){
  const [prNumber,recordPath,requestedWallet]=args;if(command==='sign'&&!process.env.CONTRIBUTOR_KEY_FILE)throw Error('Set CONTRIBUTOR_KEY_FILE to a local private file. Do not paste a key.');
  const account=command==='sign'?privateKeyToAccount(fs.readFileSync(process.env.CONTRIBUTOR_KEY_FILE,'utf8').trim()):null,wallet=account?.address||requestedWallet;
  if(!isAddress(wallet))throw Error('A public wallet address is required');const pr=await gh.pr(Number(prNumber));
  if(pr.state!=='open'||pr.base.ref!==deployment.branch||pr.base.sha!==await gh.branchHead(deployment.branch))throw Error('Rebase PR on current canonical branch first');
  const bytes=git('show',`${pr.head.sha}:${recordPath}`),s=decodeSubmission(bytes,{wallet,goals:policy.goals});
  const claim={version:2,domain:deployment.origin,chainId:deployment.chainId,problem:'p-vs-np',repository:deployment.repository,pr:Number(prNumber),head:pr.head.sha,base:pr.base.sha,branch:deployment.branch,contract:deployment.contract,policy:deployment.policy,submission_path:recordPath,submission_hash:digest(bytes),wallet,nonce:randomBytes(16).toString('hex'),expires:Date.now()+540000};
  validateClaim(claim,{...deployment,domain:deployment.origin});
  const [tree,baseTree,head]=await Promise.all([gh.request(`/git/trees/${claim.head}?recursive=1`),gh.request(`/git/trees/${claim.base}?recursive=1`),gh.commit(claim.head)]);
  const changed=enrolledSubmissionBlobs({claim,tree,baseTree,head,proofPaths:Object.values(policy.goals).map(g=>g.path)});
  if(changed.proofPath!==s.evidence.proof_path||digest(await blob(changed.submissionSha))!==claim.submission_hash)throw Error('Committed record mismatch');
  if(command==='prepare'){out({claim,message:message(claim),next:'Sign message exactly with your wallet; use envelope CLAIM_FILE SIGNATURE_FILE to recover and format the public comment.'});process.exit(0);}
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
  const entry=index.entries.find(e=>e.pr===pr);if(!entry)out({pr,status:'no processed signed claim',next:'Post the emitted public claim comment as the PR author within ten minutes. If posted through an integration bot, operator workflow dispatch may be needed.'});
  else{const report=await fetch(`https://raw.githubusercontent.com/${deployment.repository}/evidence/${entry.report}`).then(r=>r.json());out({id:entry.id,status:report.status,initialPoints:report.record?.credited_points||'0',impact:report.impact||null,reason:report.record?.verdict?.reason,error:report.error,run:report.run,commentId:report.commentId,resume:'Repository operator: dispatch research.yml with this comment_id. Changed head/base requires a new signed claim.'});}
 }else throw Error('Unknown command; run help');
}catch(e){console.error(JSON.stringify({error:e.message,next:'Run node scripts/agent.mjs help. No claim was posted and no private key was transmitted.'}));process.exitCode=1;}
