#!/usr/bin/env node
// Execute only from the reviewed protocol checkout. Problem files are data.
import fs from 'node:fs';import path from 'node:path';import {randomBytes} from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
import {isAddress,recoverMessageAddress} from 'viem';import {privateKeyToAccount} from 'viem/accounts';
import {loadProblem,validateProblemClaim,requireNativeEnrollment,requireNativeConfiguration,verifyProtocolCheckout,readProblemFile,sha256} from '../src/problem.mjs';
import {decodeSubmission} from '../src/submission.mjs';import {digest,message,enrolledSubmissionBlobs} from '../src/security.mjs';
import {GitHub} from '../src/github.mjs';import {clientFor,read,finalized} from '../github/runtime.mjs';import {contributorPath} from './agent.mjs';
export const toolRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function submissionOptions(problem,goal,wallet){return {wallet,goals:problem.policies.get(goal.policyHash).policy.goals,problem:problem.descriptor.id,policyName:goal.policyName,directions:problem.descriptor.directions};}
export function claimFor(problem,goal,{pr,head,base,recordPath,recordBytes,wallet,now=Date.now()}){
 const d=problem.deployment,c={version:3,domain:d.origin,chainId:d.chainId,problem:d.problem,repository:d.repository,pr,head,base,branch:d.branch,contract:d.contract,policy:goal.policyHash,submission_path:recordPath,submission_hash:sha256(recordBytes),wallet,nonce:randomBytes(16).toString('hex'),expires:now+540000,goal:goal.id,goal_hash:goal.goal_hash,problem_commit:goal.problemCommit,protocol_commit:goal.protocolCommit};validateProblemClaim(c,problem,{now});return c;
}
export function loadLocalSigner(file,roots){
 if(!file)throw Error('Set CONTRIBUTOR_KEY_FILE to a private local file; never paste a key.');
 const real=fs.realpathSync(file),stat=fs.statSync(real);
 if(!stat.isFile()||stat.size>256||roots.map(root=>fs.realpathSync(root)).some(root=>real===root||real.startsWith(root+path.sep)))throw Error('Keep the bounded private key file outside all repositories');
 if((stat.mode&0o077)!==0)throw Error('Private key file must be readable only by its owner (chmod 600)');
 return privateKeyToAccount(fs.readFileSync(real,'utf8').trim());
}
export function publicEnvelope(claim,signature){return `Open-Mathematics-Claim: ${digest(claim)}\n\`\`\`json\n${JSON.stringify({claim,signature},null,2)}\n\`\`\`\n`;}
export async function run(argv=process.argv.slice(2)){
 let sent;
 try{
  const args=[...argv],flag=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;const value=args[i+1];if(!value||value.startsWith('--'))throw Error(name+' requires a directory');args.splice(i,2);if(args.includes(name))throw Error('Repeated '+name);return value;};
  const directory=flag('--problem',process.env.OPEN_MATH_PROBLEM_DIR),worktree=fs.realpathSync(flag('--worktree',process.cwd()));
  const [command,...rest]=args,out=x=>console.log(JSON.stringify(x,null,2));
  if(!command||command==='help'){out({usage:'node /trusted/protocol/scripts/problem-agent.mjs --problem /trusted/problem [--worktree /contribution] COMMAND',commands:{inspect:'Read reviewed local task definitions; does not establish native enrollment.',goals:'Read finalized enrolled task availability.',init:'init GOAL SLUG PUBLIC_WALLET — create the required record for an open goal.',format:'format RECORD — normalize the JSON record.',check:'check RECORD [--lean] — validate the record; --lean runs the isolated pinned verifier.',prepare:'prepare PR RECORD PUBLIC_WALLET — export exact EIP-191 message.',sign:'sign PR RECORD — use CONTRIBUTOR_KEY_FILE and emit a public claim comment.',envelope:'envelope PREPARED_FILE SIGNATURE_FILE — format a verified external signature.',status:'status PR — read recorded outcome and current native decision.',challenge:'challenge ID FILE [--send] — preview or submit a native challenge.'},keyRule:'Private keys stay on the contributor machine. This helper does not post GitHub comments or merge PRs.'});return;}
  if(!directory)throw Error('Use --problem with a reviewed problem checkout, separate from your contribution fork.');
  const problem=loadProblem(directory,{requireDeployment:command!=='inspect'}),d=problem.deployment;
  if(command==='inspect'){out({mode:'local-definitions-only',problem:problem.descriptor.id,goals:[...problem.goals.values()].map(g=>({id:g.id,rewardable:g.rewardable,statement:g.statement,goalHash:g.goal_hash})),next:'Run goals after native deployment and enrollment. A local policy is not an open reward.'});return;}
  const gh=new GitHub({repository:d.repository,token:process.env.GITHUB_TOKEN}),reader=clientFor(),native=(method,args)=>read(reader,d.contract,method,args);
  await requireNativeConfiguration(problem,native);
  const workFile=file=>contributorPath(worktree,file),goalFor=id=>{const g=problem.goals.get(id);if(!g)throw Error('Unknown enrolled goal');return g;};
  async function available(g){verifyProtocolCheckout(problem,toolRoot,{goal:g});const row=await requireNativeEnrollment(problem,g,native);if(!row.rewardable||row.status!=='open')throw Error('Goal is not open for rewards: '+row.status);return row;}
  function decode(bytes,wallet){const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),g=goalFor(parsed.evidence?.goal);return {submission:decodeSubmission(bytes,submissionOptions(problem,g,wallet||parsed.attribution?.wallet)),goal:g};}
  const blob=async sha=>{const b=await gh.request(`/git/blobs/${sha}`);if(b.sha!==sha||b.encoding!=='base64'||b.size>12000)throw Error('Invalid immutable blob');const bytes=Buffer.from(b.content,'base64');if(bytes.length!==b.size)throw Error('Truncated immutable blob');return bytes;};
  if(command==='goals'){
   verifyProtocolCheckout(problem,toolRoot);const rows=[];
   for(const g of problem.goals.values()){const row=await requireNativeEnrollment(problem,g,native);rows.push({id:g.id,status:row.status,rewardable:row.rewardable,statement:g.statement,proof:g.path,goalHash:g.goal_hash});}
   out({contract:d.contract,repository:d.repository,branch:d.branch,points:'Native nontransferable points; merit and amount decided by GenLayer after verification. No guaranteed payment.',historicalLedger:d.legacyLedger||null,goals:rows});
  }else if(command==='init'){
   const [id,slug,wallet]=rest,g=goalFor(id);if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug||'')||!isAddress(wallet)||/^0x0{40}$/i.test(wallet))throw Error('A lowercase slug and nonzero public wallet are required');await available(g);
   const s=JSON.parse(fs.readFileSync(path.join(toolRoot,'research/SUBMISSION_TEMPLATE.json'),'utf8'));
   s.problem=problem.descriptor.id;s.evidence={...s.evidence,policy:g.policyName,goal:id,proof_path:g.path};s.attribution.wallet=wallet;s.provenance.mode='formalization';s.dependencies=[];
   const file=`research/submissions/${slug}.json`,target=workFile(file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(s,null,2)+'\n',{flag:'wx'});
   out({record:file,proof:g.path,statement:g.statement,next:'Fill every required field with actual evidence, including sources. Write the proof expression. Do not change trusted definitions.'});
  }else if(command==='format'){
   const file=rest[0];if(!/^research\/submissions\/[a-z0-9][a-z0-9-]{0,63}\.json$/.test(file||''))throw Error('Submission record path required');const target=workFile(file),bytes=fs.readFileSync(target);if(bytes.length>12000)throw Error('Record too large');fs.writeFileSync(target,JSON.stringify(JSON.parse(bytes),null,2)+'\n');out({formatted:file});
  }else if(command==='check'){
   const {submission:s,goal:g}=decode(readProblemFile(worktree,rest[0],12000));await available(g);
   if(s.dependencies.length)throw Error('This initial task batch does not import credited proof dependencies');readProblemFile(worktree,g.path,12000);
   const policy=problem.policies.get(g.policyHash).entry;
   const checkArgs=[path.join(toolRoot,'scripts/verify_problem.py'),workFile(g.path),'--problem-root',problem.root,'--policy',policy.path,'--policy-hash',g.policyHash,'--goal',g.id,'--problem-commit',g.problemCommit,'--protocol-commit',g.protocolCommit,'--repository',d.repository,'--head','0'.repeat(40),'--base','0'.repeat(40)];
   if(rest.includes('--lean')){const r=spawnSync('python3',checkArgs,{cwd:toolRoot,encoding:'utf8',timeout:65000,maxBuffer:100000,env:{PATH:process.env.PATH,TRUSTED_LEAN_IMAGE:process.env.TRUSTED_LEAN_IMAGE}});if(r.status!==0)throw Error(r.stderr||'Verifier failed');out({record:'valid',lean:JSON.parse(r.stdout),next:'Commit exactly proof + record in one commit on the current research branch. CI verifies independently against real GitHub commits.'});}
   else out({record:'valid',proofBytes:'bounded regular file',lean:'NOT RUN; use --lean with the pinned Docker verifier. CI independently verifies proof syntax and correctness.',next:'Run isolated Lean, then commit exactly proof + record.'});
  }else if(command==='prepare'||command==='sign'){
   const [number,recordPath,requestedWallet]=rest,prNumber=Number(number);if(!Number.isSafeInteger(prNumber)||prNumber<1)throw Error('PR number required');
   const account=command==='sign'?loadLocalSigner(process.env.CONTRIBUTOR_KEY_FILE,[toolRoot,problem.root,worktree]):null,wallet=account?.address||requestedWallet;if(!isAddress(wallet))throw Error('Public wallet required');
   const pr=await gh.pr(prNumber);if(pr.state!=='open'||pr.base.repo.full_name!==d.repository||pr.base.ref!==d.branch||pr.base.sha!==await gh.branchHead(d.branch))throw Error('Rebase an open PR onto the current canonical research branch');
   const [tree,baseTree,head]=await Promise.all([gh.request(`/git/trees/${pr.head.sha}?recursive=1`),gh.request(`/git/trees/${pr.base.sha}?recursive=1`),gh.commit(pr.head.sha)]);
   const entries=enrolledSubmissionBlobs({claim:{base:pr.base.sha,submission_path:recordPath},tree,baseTree,head,proofPaths:[...problem.goals.values()].map(g=>g.path)}),bytes=await blob(entries.submissionSha),{submission:s,goal:g}=decode(bytes,wallet);
   if(s.evidence.proof_path!==entries.proofPath||s.dependencies.length)throw Error('Submitted proof or dependency differs from the enrolled goal');await available(g);
   const claim=claimFor(problem,g,{pr:prNumber,head:pr.head.sha,base:pr.base.sha,recordPath,recordBytes:bytes,wallet});
   if(account)process.stdout.write(publicEnvelope(claim,await account.signMessage({message:message(claim)})));
   else out({claim,message:message(claim),expiresAt:new Date(claim.expires).toISOString(),next:'Sign the decoded message string with EIP-191 personal_sign. Use envelope, then post the public text as an unedited PR-author comment before expiresAt.'});
  }else if(command==='envelope'){
   const prepared=JSON.parse(fs.readFileSync(rest[0],'utf8')),claim=prepared.claim||prepared,signature=fs.readFileSync(rest[1],'utf8').trim(),g=validateProblemClaim(claim,problem);await available(g);
   if((await recoverMessageAddress({message:message(claim),signature})).toLowerCase()!==claim.wallet.toLowerCase())throw Error('Wrong wallet signature');process.stdout.write(publicEnvelope(claim,signature));
  }else if(command==='status'){
   const number=Number(rest[0]);if(!Number.isSafeInteger(number)||number<1)throw Error('PR number required');const index=await gh.request('/contents/index.json?ref=evidence'),entries=JSON.parse(Buffer.from(index.content,'base64')).entries||[],entry=entries.find(e=>e.pr===number);
   if(!entry){out({pr:number,status:'No indexed outcome',next:'Check Actions. Scheduled recovery is best-effort; ask the operator to resume the original signed comment if needed. Do not repost or edit it.'});return;}
   let current;try{current=await native('get',[entry.id]);}catch{current=null;}
   out({archived:entry,native:current,contract:d.contract,readSource:current?'Finalized native record':'Archive only; native unavailable',next:'Do not resubmit a credited or terminally rejected attempt. Known failed consensus is preserved.'});
  }else if(command==='challenge'){
   const [id,file]=rest,evidence=fs.readFileSync(path.isAbsolute(file)?file:workFile(file),'utf8'),state=await native('get',[id]);if(evidence.trim().length<20||evidence.length>4000||state.status!=='provisional'||Date.now()>=Number(state.deadline)*1000||Number(state.round)>=2)throw Error('Valid substantive evidence and an open challenge window are required');
   if(!rest.includes('--send'))out({contract:d.contract,method:'challenge',args:[id,evidence],deadline:state.deadline,next:'Review, then repeat with --send and your local signer.'});
   else{const account=loadLocalSigner(process.env.CONTRIBUTOR_KEY_FILE,[toolRoot,problem.root,worktree]),client=clientFor(fs.readFileSync(fs.realpathSync(process.env.CONTRIBUTOR_KEY_FILE),'utf8').trim());sent={contract:d.contract,wallet:account.address,method:'challenge'};const hash=await client.writeContract({address:d.contract,functionName:'challenge',args:[id,evidence],leaderOnly:false});sent.hash=hash;console.error(JSON.stringify({status:'broadcast',...sent}));await finalized(client,hash,{address:d.contract,method:'challenge',args:[id,evidence]});out({status:'challenge finalized',hash,next:'The worker must request a fresh review before settlement.'});}
  }else throw Error('Unknown command; run help');
 }catch(error){console.error(JSON.stringify({error:error.message,...(sent?{transaction:sent,next:'Inspect receipt/history before any retry; the transaction may already have been broadcast.'}:{})}));process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
