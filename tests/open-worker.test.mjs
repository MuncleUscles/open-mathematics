import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {privateKeyToAccount} from 'viem/accounts';
import {canonical,digest,message} from '../src/security.mjs';
import {FULL_LEAN,validateFullLeanBundle} from '../src/full-lean.mjs';
import {sha256,openMigrationHash} from '../src/open-research.mjs';
import {verifyFinalizedOutcome} from '../src/studio.mjs';
import {readOpenClaimComment,requireClaimAuthor,exactOpenReport,eligibleOpenClaim,selectOpenClaim,readOpenRecoveryClaim} from '../github/open-select.mjs';
import {
 noteResult,openVerifierFailure,readOpenBlobs,requireOpenNative,resolveOpenDependencies,validateOpenResult,
 verifyOpenAttestation,writeOpenDependencyManifest,
} from '../github/open-verify.mjs';
import {blockedOpenConsensus,openEvidenceJSON,requireOpenRecord,expireUnregisteredOpenReport,openClaimFailureOutcome,adjudicateOpenRecord,recoverStaleOpenRegistration,bindOpenRegistration} from '../github/open-worker.mjs';

const commit=x=>x.repeat(40);
const hash=x=>x.repeat(64);
const address=x=>'0x'+commit(x);
const json=value=>JSON.stringify(value,null,2)+'\n';
const contributor=privateKeyToAccount('0x'+'29'.repeat(32));
const verifier=privateKeyToAccount('0x'+'36'.repeat(32));
const AUTHOR=17,COMMENT=81,PR=8,CREATED='2025-11-23T00:00:00Z';
const ACCOUNT_CREATED=Date.parse(CREATED)/1000-30*86400;
const A='pr-1-aaaaaaaaaaaa-111111111111',B='pr-2-bbbbbbbbbbbb-222222222222';
const attestationDomain='Open Mathematics open research attestation v5\n';

function formalBundle(dependencies=[]){
 return {version:1,definitions:[],statement:'∀ n : Nat, n = n',proof:'by\n  intro n\n  rfl',dependencies};
}

function dependency(id){
 return {id,use:'The formal component references the prior credited result directly.',
  importance:'The cited result discharges a matching requirement in this argument.'};
}

async function fixture({note=false,dependencies=[]}={}){
 const policy={
  version:5,problem:'p-vs-np',repository:'Owner/problem',branch:'research',
  objective:'Explore useful work on either side of the P versus NP research problem.',
  toolchain:'lean4:4.19.0',allowed_axioms:['propext','Quot.sound'],admission:'open',
  notes:'Research notes are reviewed arguments and have no kernel proof status.',
 };
 const policyHash=digest(json(policy));
 const deployment={
  protocolVersion:5,problem:policy.problem,repository:policy.repository,branch:policy.branch,chainId:61999,
  contract:address('9'),origin:'https://example.test',verifier:verifier.address,executor:address('2'),
  windowSeconds:300,minimumGitHubAccountAgeDays:30,legacyLedgers:[],policyHash,
 };
 const problem={policy,policyHash,deployment,descriptor:{
  id:policy.problem,repository:policy.repository,branch:'research',configBranch:'main',protocol:{commit:commit('1')},
 }};
 const artifactPath=note?'research/notes/fixture.md':'research/artifacts/fixture.json';
 const submission={
  schema_version:3,problem:policy.problem,kind:note?'research-note':'lemma',title:'Controlled mathematical fixture',
  claim:'Test the exact formal or documentary handling of a result about natural numbers.',
  novelty:'The new fixture tests open admission and introduces no claim of mathematical discovery.',
  prior_art:[],research_direction:'Reusable bounded proof components',
  provenance:{mode:'extension',sources:[],discovery_basis:'A familiar mathematical example, with no priority claim or fresh discovery.'},
  evidence:{kind:note?'research-note':'formal',artifact_path:artifactPath,reproduce:'Run the matching verifier in the pinned environment.'},
  dependencies:dependencies.map(item=>dependency(item.id)),
  attribution:{wallet:contributor.address,contributions:'The test fixture contributor supplied the exact artifact and record.'},
  limitations:'This fixture exercises a narrow component and offers no full problem resolution.',
 };
 const recordBytes=Buffer.from(json(submission));
 const artifactText=note?'# An unverified note\n\nThis argument is open for review.\n':json(formalBundle(dependencies));
 const artifactBytes=Buffer.from(artifactText);
 const claim={
  version:4,domain:deployment.origin,chainId:61999,problem:policy.problem,repository:policy.repository,
  pr:PR,head:commit('8'),base:commit('9'),branch:policy.branch,contract:deployment.contract,policy:policyHash,
  submission_path:'research/submissions/fixture.json',submission_hash:digest(recordBytes),wallet:contributor.address,
  nonce:'7'.repeat(32),expires:Date.parse(CREATED)+300000,protocol_commit:problem.descriptor.protocol.commit,
 };
 const comment=await signedComment(claim);
 const candidate=await readOpenClaimComment({comment,problem,commentId:COMMENT});
 const pr={number:PR,state:'open',merged:false,user:{id:AUTHOR},head:{sha:claim.head},
  base:{ref:claim.branch,sha:claim.base,repo:{full_name:claim.repository}}};
 const {head,base,protocol_commit,repository}=claim;
 const result=note?noteResult(problem,claim,artifactText):{
  result:'pass',mode:'isolated',production_verified:true,verified:true,verification:'verified',
  checker:'open-mathematics-v5',problem:policy.problem,repository,head,base,protocol_commit,policy:policyHash,
  statement_hash:sha256({definitions:[],statement:formalBundle().statement,dependencies}),
  proposition_hash:sha256(formalBundle().statement),formal_statement:formalBundle().statement,
  bundle_hash:digest(artifactBytes),artifact_hash:digest(artifactBytes),assembly_hash:hash('2'),
  toolchain:policy.toolchain,image:'sha256:'+hash('3'),
  proof_hash:sha256(formalBundle().proof),theorem:`B_${digest(artifactBytes)}.result`,
  dependency_bundle_hashes:Object.fromEntries(dependencies.map(dep=>[dep.id,dep.bundle_hash])),
  dependency_artifact_hashes:Object.fromEntries(dependencies.map(dep=>[dep.id,dep.bundle_hash])),
  axioms:[],sorry:false,proof_body_uses:dependencies.map(dep=>dep.id),
  verified_dependencies:dependencies.map(dep=>({id:dep.id,artifact_hash:dep.bundle_hash,proof_body_use:true,constant:`B_${dep.bundle_hash}.result`})),
 };
 const evidence={...result,chainId:61999,contract:claim.contract,branch:claim.branch,worker_commit:protocol_commit,
  wallet:claim.wallet,pr:PR,claim_digest:digest(claim),github_author_id:AUTHOR,comment_id:COMMENT,comment_created_at:CREATED,
  github_account_created_at:ACCOUNT_CREATED,github_account_type:'User',
  submission_path:claim.submission_path,submission_hash:claim.submission_hash,submission_text:recordBytes.toString('utf8'),
  evidence_kind:submission.evidence.kind,artifact_path:artifactPath,proof:artifactText,submission};
 return {problem,claim,candidate,comment,pr,recordBytes,artifactText,artifactBytes,submission,result,
  attestation:await signedAttestation(evidence,claim)};
}

async function signedComment(claim){
 const envelope={claim,signature:await contributor.signMessage({message:message(claim)})};
 return {
  id:COMMENT,user:{id:AUTHOR},created_at:CREATED,updated_at:CREATED,
  issue_url:`https://api.github.com/repos/${claim.repository}/issues/${claim.pr}`,
  body:[`Open-Mathematics-Claim: ${digest(claim)}`,'```json',json(envelope).trimEnd(),'```'].join('\n'),
 };
}

async function signedAttestation(evidence,claim,account=verifier){
 return {
  claimDigest:digest(claim),evidence,verifier:verifier.address,
  signature:await account.signMessage({message:attestationDomain+canonical(evidence)}),
 };
}

function blob(bytes){
 const sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
 return {sha,size:bytes.length,encoding:'base64',content:bytes.toString('base64')};
}

function treeEntry(file,bytes){
 return {path:file,mode:'100644',type:'blob',sha:blob(bytes).sha};
}

test('the original signed author comment binds the open ledger and worker pin',async()=>{
 const {problem,claim,candidate,comment,pr}=await fixture();
 const {deployment}=problem;
 requireClaimAuthor(candidate,comment,pr,deployment);
 assert.throws(()=>requireClaimAuthor(candidate,{...comment,user:{id:AUTHOR+1}},pr,deployment),/author/);
 await assert.rejects(readOpenClaimComment({comment:{...comment,updated_at:'2026-11-23T00:00:01Z'},problem,commentId:COMMENT}),/unedited/);
 for(const update of [{contract:address('f')},{problem:'other'},{protocol_commit:commit('f')},{goal:'already-approved'}]){
  const replay=await signedComment({...claim,...update});
  await assert.rejects(readOpenClaimComment({comment:replay,problem,commentId:COMMENT}));
 }
 const report={id:candidate.id,commentId:COMMENT,commentCreatedAt:CREATED,contract:claim.contract,chainId:claim.chainId,
  repository:claim.repository,pr:PR,head:claim.head,base:claim.base,claim:candidate.envelope};
 assert.equal(exactOpenReport(candidate,report,deployment),true);
 assert.equal(exactOpenReport(candidate,{...report,commentId:COMMENT+1},deployment),false);
 const retargeted={...pr,state:'closed',base:{...pr.base,ref:'main'}};
 const options={candidate,pr:retargeted,deployment,canonicalHead:claim.base};
 assert.equal(eligibleOpenClaim(options),false);
 assert.equal(eligibleOpenClaim({...options,report}),true);
 assert.equal(eligibleOpenClaim({...options,report:{...report,status:'rejected'},entries:[{id:candidate.id,status:'rejected',needsResume:true}]}),true);
 assert.equal(eligibleOpenClaim({...options,report:{...report,status:'rejected',completedAt:CREATED},explicit:true}),false);
});

test('open admission checks the exact native configuration and chain without a goal lookup',async()=>{
 const {problem}=await fixture();
 const {deployment:d}=problem;
 const config={version:5n,problem:d.problem,repository:d.repository,branch:d.branch,verifier:d.verifier,executor:d.executor,
  window:300n,minimum_account_age_days:30n,policy:problem.policyHash,objective:problem.policy.objective,legacy_ledgers:[]};
 const client={
  getChainId:async()=>61999,
  readContract:async ({address,functionName,args,transactionHashVariant})=>{
   assert.equal(address,d.contract);
   assert.equal(functionName,'get_config');
   assert.deepEqual(args,[]);
   assert.equal(transactionHashVariant,'latest-final');
   return config;
  },
 };
 assert.equal((await requireOpenNative(problem,client)).policy,problem.policyHash);
 await assert.rejects(requireOpenNative(problem,{...client,getChainId:async()=>61500}),/Wrong native chain/);
 await assert.rejects(requireOpenNative(problem,{...client,readContract:async()=>({...config,policy:hash('e')})}),/configuration.*mismatch/);
 await assert.rejects(requireOpenNative(problem,{...client,readContract:async()=>({...config,minimum_account_age_days:31n})}),/configuration.*mismatch/);
});

test('historical index entries cannot block a current ledger claim',async()=>{
 const {problem,claim,candidate,comment,pr}=await fixture();
 const github={
  repository:claim.repository,branchHead:async()=>claim.base,pr:async()=>pr,
  request:async endpoint=>{assert.equal(endpoint,`/issues/comments/${COMMENT}`);return comment;},
 };
 const sameScope={repository:claim.repository,chainId:claim.chainId,contract:claim.contract};
 const input={
  github,problem,eventName:'issue_comment',event:{action:'created',issue:{pull_request:{}},comment:{id:COMMENT}},
 };
 const readEvidence=entry=>async file=>file==='index.json'?{entries:[{id:candidate.id,status:'rejected',...entry}]}:null;
 assert.equal((await selectOpenClaim({...input,readEvidence:readEvidence()})).id,candidate.id);
 assert.equal((await selectOpenClaim({...input,readEvidence:readEvidence({...sameScope,contract:address('f')})})).id,candidate.id);
 assert.equal(await selectOpenClaim({...input,readEvidence:readEvidence(sameScope)}),null);
});

test('deleted or edited original comments select only a signed, scoped stale-registration cleanup',async()=>{
 const f=await fixture(),{problem,claim,candidate,comment,pr,attestation}=f,d=problem.deployment;
 const evidenceJSON=await openEvidenceJSON({attestation,problem,candidate,authorId:AUTHOR});
 const report={id:candidate.id,commentId:COMMENT,commentCreatedAt:CREATED,contract:d.contract,chainId:d.chainId,
  repository:d.repository,pr:PR,head:claim.head,base:claim.base,claim:candidate.envelope,
  attestation,evidenceJSON,status:'approved',transactions:{register:{hash:'0x'+hash('4')}}};
 const entry={id:candidate.id,contract:d.contract,chainId:d.chainId,repository:d.repository,
  commentId:COMMENT,status:'approved',needsResume:true,updatedAt:CREATED};
 for(const eventName of ['schedule','workflow_dispatch'])for(const missing of [true,false]){
  const github={repository:d.repository,branchHead:async()=>claim.base,pr:async()=>({...pr,state:'closed'}),
   request:async endpoint=>{
    if(endpoint===`/issues/comments/${COMMENT}`){if(missing)throw Error('GitHub 404');return {...comment,updated_at:'2025-11-23T00:01:00Z'};}
    if(endpoint.startsWith('/pulls?'))return [];
    assert.fail(endpoint);
   }};
  const readEvidence=async file=>file==='index.json'?{entries:[entry]}:structuredClone(report);
  const input={github,problem,eventName,event:{inputs:{comment_id:String(COMMENT)}},readEvidence};
  const cleanup=await selectOpenClaim(input);
  assert.equal(cleanup.id,candidate.id);assert.equal(cleanup.recoveryOnly,true);
  const blocked=await selectOpenClaim({...input,readEvidence:async file=>file==='index.json'?{entries:[{...entry,needsResume:false}]}:{...report,blockedConsensus:true}});
  assert.equal(blocked.recoveryOnly,true);
  for(const changed of [pr,{...pr,merged:true,state:'closed'},{...pr,state:'closed',user:{id:AUTHOR+1}}]){
   assert.equal(await selectOpenClaim({...input,github:{...github,pr:async()=>changed}}),null);
  }
  const tampered=structuredClone(report);tampered.claim.claim.wallet=address('f');
  assert.equal(await selectOpenClaim({...input,readEvidence:async file=>file==='index.json'?{entries:[entry]}:tampered}),null);
  assert.equal(await selectOpenClaim({...input,readEvidence:async file=>file==='index.json'?{entries:[entry,{...entry,id:'pr-9-aaaaaaaaaaaa-bbbbbbbbbbbb'}]}:report}),null);
  const abandoned=await selectOpenClaim({...input,github:{...github,pr:async()=>pr},readEvidence:async file=>file==='index.json'?{entries:[entry]}:{...report,status:'verifying',transactions:{}}});
  assert.equal(abandoned.abandonOnly,true);
  assert.equal(abandoned.recoveryOnly,true);
 }
 assert.equal((await readOpenRecoveryClaim({problem,commentId:COMMENT,report:{...report,transactions:{}}})).abandonOnly,true);
 await assert.rejects(readOpenRecoveryClaim({problem,commentId:COMMENT,report:{...report,attestation:undefined}}),/signed evidence/);
});

test('cleanup verifies registration and native state before release, and never releases merged or credited work',async()=>{
 const {problem,claim,candidate,pr}=await fixture();
 async function run({status='approved',current={...pr,state:'closed'},receiptError=false,nativeError=false}={}){
  const calls=[];let nativeStatus=status;
  const options={candidate:{...candidate,recoveryOnly:true},deployment:problem.deployment,authorId:AUTHOR,
   github:{pr:async()=>{calls.push('current PR');return current;},branchHead:async()=>claim.base},
   confirmRegistration:async()=>{calls.push('exact registration');if(receiptError)throw Error('Uncertain native receipt');},
   readRecord:async()=>{calls.push('bound native record');if(nativeError)throw Error('Native evidence digest mismatch');return {status:nativeStatus};},
   expire:async seen=>{assert.equal(seen,current);calls.push('journal expiration');nativeStatus='expired';return true;},
  };
  if(receiptError||nativeError||['credited','rejected'].includes(status)||current.merged===true||current===pr){
   await assert.rejects(recoverStaleOpenRegistration(options));
   assert(!calls.includes('journal expiration'));
  }else{
   assert.equal((await recoverStaleOpenRegistration(options)).status,'expired');
   assert.deepEqual(calls,['exact registration','bound native record','current PR','journal expiration','bound native record']);
  }
 }
 await run();await run({receiptError:true});await run({nativeError:true});await run({status:'credited'});await run({status:'rejected'});
 await run({current:{...pr,merged:true,state:'closed'}});await run({current:pr});
});

test('stale work before registration ends its queue entry but an uncertain registration remains pending',()=>{
 const report={status:'verifying',transactions:{},attestation:{},blockedConsensus:true};
 assert.equal(expireUnregisteredOpenReport(report),true);
 assert.equal(report.status,'expired');assert.ok(report.completedAt);assert.equal(report.blockedConsensus,undefined);
 assert.deepEqual(openClaimFailureOutcome(report,Error('PR changed')),{status:'expired'});
 for(const register of [{intent:{method:'register'}},{hash:'0x'+hash('4')},null]){
  const pending={status:'verifying',transactions:{register},attestation:{}};
  assert.equal(expireUnregisteredOpenReport(pending),false);assert.equal(pending.completedAt,undefined);
  assert.notEqual(openClaimFailureOutcome(pending,Error('Uncertain registration')).status,'expired');
 }
});

test('a failing final author-binding callback rereads the PR and terminates only objectively stale or invalid unregistered claims',async()=>{
 const {problem,candidate,pr,comment}=await fixture();
 for(const kind of ['closed','pushed','edited','deleted','transport','uncertain-registration']){
  const calls=[],report={status:'verifying',attestation:{},transactions:kind==='uncertain-registration'?{register:{intent:{method:'register'}}}:{}};
  const current=kind==='closed'?{...pr,state:'closed'}:kind==='pushed'?{...pr,head:{sha:commit('a')}}:pr;
  const github={
   bindAuthor:async()=>{calls.push('bind');throw Error('Author binding failed');},
   pr:async()=>{calls.push('reread PR');return current;},
   request:async()=>{calls.push('reread comment');if(kind==='deleted')throw Error('GitHub 404');return kind==='edited'?{...comment,updated_at:'2025-11-23T00:01:00Z'}:comment;},
  };
  await assert.rejects(bindOpenRegistration({github,report,candidate,problem,
   expire:async seen=>{assert.equal(seen,current);calls.push('stale check');return ['closed','pushed'].includes(kind);},
   save:async()=>calls.push('save'),
  }),/Author binding failed/);
  if(['closed','pushed'].includes(kind)){
   assert.equal(openClaimFailureOutcome(report,Error('binding')).status,'expired');assert.ok(report.completedAt);
   assert.deepEqual(calls,['bind','reread PR','stale check','save']);
  }else if(['edited','deleted'].includes(kind)){
   assert.equal(openClaimFailureOutcome(report,Error('binding')).status,'invalid');assert.ok(report.completedAt);
  }else{
   assert.equal(report.completedAt,undefined);
   assert.notEqual(openClaimFailureOutcome(report,Error('binding')).status,'invalid');
   if(kind==='uncertain-registration')assert.deepEqual(calls,['bind']);
  }
 }
});

test('the native review context carries contribution text without the attribution wallet',async()=>{
 const f=await fixture();
 const e=JSON.parse(await openEvidenceJSON({attestation:f.attestation,problem:f.problem,candidate:f.candidate,authorId:AUTHOR}));
 const context=JSON.parse(e.context);
 assert.equal(context.attribution,f.submission.attribution.contributions);
 assert(!e.context.includes(f.claim.wallet));
});

test('native attempt fencing precedes adjudication and a failed fence cannot call the model',async()=>{
 for(const status of ['submitted','challenged']){
  const calls=[];
  assert.equal(await adjudicateOpenRecord({id:A,record:{status,round:1},tx:async(...call)=>calls.push(call)}),true);
  assert.deepEqual(calls,[[`begin-adjudicate-r1`,'begin_adjudication',[A,1]],[`adjudicate-r1`,'adjudicate',[A,1]]]);
 }
 const calls=[];
 await assert.rejects(adjudicateOpenRecord({id:A,record:{status:'submitted',round:0},tx:async(stage)=>{calls.push(stage);throw Error('Fence unavailable');}}));
 assert.deepEqual(calls,['begin-adjudicate-r0']);
 assert.equal(await adjudicateOpenRecord({id:A,record:{status:'approved',round:0},tx:async()=>assert.fail('No new adjudication')}),false);
});

test('two new immutable regular blobs are accepted and extra or replaced files fail',async()=>{
 const {problem,claim,artifactBytes,recordBytes,submission}=await fixture();
 const record=blob(recordBytes),artifact=blob(artifactBytes);
 const entries=[treeEntry(claim.submission_path,recordBytes),treeEntry(submission.evidence.artifact_path,artifactBytes)];
 function github({headTree=entries,baseTree=[],differentBlob=false}={}){
  return {
   commit:async sha=>({sha,tree:{sha:sha===claim.head?commit('a'):commit('b')},parents:[{sha:claim.base}]}),
   request:async endpoint=>{
    if(endpoint.endsWith('?recursive=1')){
     const sha=endpoint.split('/').at(-1).split('?')[0];
     return {sha,truncated:false,tree:sha===commit('a')?headTree:baseTree};
    }
    if(endpoint.endsWith(record.sha))return record;
    assert.ok(endpoint.endsWith(artifact.sha));
    return differentBlob?{...blob(Buffer.from('different')),sha:artifact.sha}:artifact;
   },
  };
 }
 assert.deepEqual(await readOpenBlobs(github(),claim,problem),{artifactBytes,recordBytes,submission});
 await assert.rejects(readOpenBlobs(github({headTree:[...entries,{...entries[0],path:'README.md'}]}),claim,problem),/exactly one new record/);
 await assert.rejects(readOpenBlobs(github({baseTree:[{...entries[1],sha:commit('e')}]}),claim,problem),/exactly one new record/);
 await assert.rejects(readOpenBlobs(github({headTree:[entries[0],{...entries[1],mode:'120000'}]}),claim,problem),/plain regular/);
 await assert.rejects(readOpenBlobs(github({differentBlob:true}),claim,problem),/blob hash mismatch/);
 await assert.rejects(readOpenBlobs(github(),{...claim,submission_hash:hash('e')},problem),/Signed submission record changed/);
});

function creditFixture(problem,id,index,dependencies=[]){
 const git=prefix=>prefix.repeat(38)+index.toString(16).padStart(2,'0');
 const bytes=Buffer.from(json(formalBundle(dependencies))),evidence={
  id,problem:problem.deployment.problem,repository:problem.deployment.repository,branch:'research',
  contract:problem.deployment.contract,policy:problem.policyHash,head:git('1'),base:git('2'),
  bundle_hash:digest(bytes),artifact_hash:digest(bytes),artifact_path:`research/artifacts/credit-${index}.json`,
  evidence_kind:'formal',verification:'verified',proof:bytes.toString('utf8'),
  formal_statement:formalBundle().statement,dependencies:dependencies.map(dep=>dep.id),
 };
 return {bytes,record:{status:'credited',evidence,merge_commit:git('3')},tree:git('4')};
}

function creditedGitHub(credits,{canonical=true,parents=true}={}){
 return {
  canonicalMerge:async (branch,merge)=>{assert.equal(branch,'research');assert.ok(credits.some(item=>item.record.merge_commit===merge));return canonical;},
  commit:async sha=>{
   const item=credits.find(item=>[item.record.evidence.head,item.record.merge_commit].includes(sha));
   const e=item.record.evidence;
   return {sha,tree:{sha:item.tree},parents:sha===e.head?[{sha:e.base}]:[{sha:e.base},{sha:parents?e.head:commit('e')}]};
  },
  request:async endpoint=>{
   const sha=endpoint.split('/').at(-1).split('?')[0];
   const item=credits.find(item=>[item.tree,blob(item.bytes).sha].includes(sha));
   return endpoint.includes('/git/trees/')?{sha,truncated:false,tree:[treeEntry(item.record.evidence.artifact_path,item.bytes)]}:blob(item.bytes);
  },
 };
}

test('dependency resolution follows exact canonical credited bundles in topological order',async t=>{
 const {problem}=await fixture();
 const prior=creditFixture(problem,A,0);
 const middle=creditFixture(problem,B,1,[{id:A,bundle_hash:prior.record.evidence.bundle_hash}]);
 const candidate=await fixture({dependencies:[{id:B,bundle_hash:middle.record.evidence.bundle_hash}]});
 const credits=[prior,middle];
 const readRecord=async id=>credits.find(item=>item.record.evidence.id===id).record;
 const input={...candidate,github:creditedGitHub(credits),readRecord};
 const resolved=await resolveOpenDependencies(input);
 assert.deepEqual(resolved.artifacts.map(item=>item.id),[A,B]);
 assert.deepEqual(resolved.direct.map(item=>item.id),[B]);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'open-worker-tests-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const rawManifest=fs.readFileSync(writeOpenDependencyManifest(directory,resolved),'utf8');
 const manifest=JSON.parse(rawManifest);
 assert.equal(rawManifest,json(manifest));
 assert.deepEqual(manifest.artifacts.map(item=>item.id),[A,B]);
 assert.deepEqual(fs.readFileSync(manifest.artifacts[0].path),prior.bytes);
 await assert.rejects(resolveOpenDependencies({...input,github:creditedGitHub(credits,{parents:false})}),/exact canonical merge/);
 await assert.rejects(resolveOpenDependencies({...input,github:creditedGitHub(credits,{canonical:false})}),/exact canonical merge/);
 const changeRecord=change=>async id=>{const r=await readRecord(id);return {...r,evidence:{...r.evidence,...change}};};
 await assert.rejects(resolveOpenDependencies({...input,readRecord:changeRecord({contract:address('e')})}),/exact problem ledger/);
 await assert.rejects(resolveOpenDependencies({...input,readRecord:changeRecord({verification:'not-formal'})}),/prior kernel-verified/);
 await assert.rejects(resolveOpenDependencies({...input,readRecord:changeRecord({artifact_hash:hash('e')})}),/missing immutable artifact commitments/);
 await assert.rejects(resolveOpenDependencies({...input,readRecord:changeRecord({proof:'unrelated'})}),/bytes differ/);
});

test('a shared subtree cannot elide a longer branch of the dependency depth check',async()=>{
 const {problem}=await fixture(),credits=[];
 for(let index=0;index<5;index++){
  const previous=credits.at(-1)?.record.evidence;
  const id=`pr-${index+1}-${String(index).repeat(12)}-${'a'.repeat(12)}`;
  credits.push(creditFixture(problem,id,index,previous?[{id:previous.id,bundle_hash:previous.bundle_hash}]:[]));
 }
 const dependencies=[credits[1],credits[4]].map(({record:{evidence}})=>({id:evidence.id,bundle_hash:evidence.bundle_hash}));
 const candidate=await fixture({dependencies});
 await assert.rejects(resolveOpenDependencies({...candidate,github:creditedGitHub(credits),
  readRecord:async id=>credits.find(item=>item.record.evidence.id===id).record}),/dependency depth limit/);
});

test('an imported credited proof remains reusable only with native-bound predecessor evidence',async()=>{
 const {problem}=await fixture(),prior=creditFixture(problem,A,0),original=structuredClone(prior.record);
 const predecessor={address:problem.deployment.contract,snapshot_hash:hash('9')};
 const candidate=await fixture({dependencies:[{id:A,bundle_hash:prior.record.evidence.bundle_hash}]});
 candidate.problem={...candidate.problem,deployment:{...candidate.problem.deployment,contract:address('e'),predecessor}};
 const provenance={inherited:true,predecessor:predecessor.address,snapshot_hash:predecessor.snapshot_hash,
  record_hash:openMigrationHash(prior.record),original_record_hash:openMigrationHash(prior.record)};
 const calls=[],input={...candidate,github:creditedGitHub([prior]),readRecord:async()=>prior.record,
  readInheritance:async id=>{calls.push(id);return provenance;}};
 const resolved=await resolveOpenDependencies(input);
 assert.deepEqual(calls,[A]);assert.deepEqual(resolved.artifacts.map(item=>item.id),[A]);
 assert.deepEqual(resolved.artifacts[0].bytes,prior.bytes);assert.deepEqual(prior.record,original);
 const noGit={commit:()=>assert.fail('Unbound records must not resolve Git objects')};
 for(const altered of [undefined,{inherited:false},{...provenance,predecessor:address('f')},
  {...provenance,snapshot_hash:hash('f')},{...provenance,record_hash:hash('f')},
  {...provenance,original_record_hash:'bad'},{...provenance,extra:true}]){
  await assert.rejects(resolveOpenDependencies({...input,github:noGit,readInheritance:async()=>altered}),/inheritance commitment/);
 }
 await assert.rejects(resolveOpenDependencies({...input,github:noGit,readInheritance:undefined}),/authenticated predecessor/);
 const tampered=structuredClone(prior.record);tampered.evidence.proof+='\n';
 await assert.rejects(resolveOpenDependencies({...input,github:noGit,readRecord:async()=>tampered}),/inheritance commitment/);
 const foreign=structuredClone(prior.record);foreign.evidence.contract=address('f');
 await assert.rejects(resolveOpenDependencies({...input,github:noGit,readRecord:async()=>foreign,readInheritance:async()=>assert.fail('Foreign contracts must fail before provenance reads')}),/foreign contract/);
 const rejected={...prior.record,status:'rejected'};
 await assert.rejects(resolveOpenDependencies({...input,github:noGit,readRecord:async()=>rejected,readInheritance:async()=>({...provenance,record_hash:openMigrationHash(rejected)})}),/must be credited/);
});

test('formal evidence must contain observed direct proof uses and an isolated result',async()=>{
 const fixtureData=await fixture({dependencies:[{id:A,bundle_hash:hash('a')}]});
 const {result}=fixtureData;
 const options={...fixtureData,direct:[{id:A,bundle_hash:hash('a'),artifact_hash:hash('a')}]};
 assert.equal(validateOpenResult(result,options),result);

 assert.throws(()=>validateOpenResult({...result,proof_body_uses:[]},options),/surviving Lean proof body/);
 assert.throws(()=>validateOpenResult({...result,verified_dependencies:[{...result.verified_dependencies[0],artifact_hash:hash('e')}]},options),/differs from its exact credited artifact/);
 assert.throws(()=>validateOpenResult({...result,production_verified:false,mode:'local-diagnostic'},options),/Isolated production/);
 assert.throws(()=>validateOpenResult({...result,axioms:['sorryAx']},options),/Unauthorized Lean axioms/);
 assert.throws(()=>validateOpenResult({...result,artifact_hash:result.assembly_hash},options),/artifact_hash mismatch/);
 assert.throws(()=>validateOpenResult({...result,assembly_hash:undefined},options),/assembly digests/);
 assert.throws(()=>validateOpenResult({...result,dependency_artifact_hashes:{[A]:hash('e')}},options),/credited dependency commitments/);
 assert.throws(()=>validateOpenResult({...result,dependency_artifact_hashes:{[A]:hash('e')},dependency_bundle_hashes:{[A]:hash('e')}},{...options,closure:options.direct}),/closure differs/);
});

test('the checker failure witness survives a failing subprocess without implying verification',()=>{
 const result={checker:'open-mathematics-v5',result:'fail',production_verified:false,verified:false,error:'Lean rejected bundle: unsolved goals'};
 assert.equal(openVerifierFailure({stdout:JSON.stringify(result),stderr:''}),result.error);
 assert.equal(openVerifierFailure({stdout:JSON.stringify({...result,verified:true}),stderr:'process error'}),'process error');
 assert.equal(openVerifierFailure({stdout:null,stderr:null}),'proof check did not finish');
});

test('research notes retain their text and cannot carry a kernel result or monetary dependency use',async()=>{
 const {problem,candidate,attestation,claim,result,submission,artifactText}=await fixture({note:true});
 const input={problem,candidate,attestation,authorId:AUTHOR};
 const raw=await openEvidenceJSON(input),payload=JSON.parse(raw);
 assert.equal(payload.verification,'not-formal');
 assert.equal(payload.formal_statement,'');
 assert.equal(payload.proof,artifactText);
 assert.equal(JSON.parse(payload.context).title,submission.title);
 assert.equal(payload.bundle_hash,digest(artifactText));
 assert.deepEqual(payload.verified_dependencies,[]);
 assert.equal(payload.protocol_commit,claim.protocol_commit);
 assert.equal(payload.github_account_created_at,ACCOUNT_CREATED);
 assert.equal(payload.github_account_type,'User');
 assert.equal(await openEvidenceJSON({...input,cached:raw}),raw);
 await assert.rejects(openEvidenceJSON({...input,cached:raw+'\n'}),/Cached report differs/);
 for(const changed of [{...result,production_verified:true},{...result,axioms:[]},{...result,proof_body_uses:[A]}]){
  assert.throws(()=>validateOpenResult(changed,{problem,claim,submission,artifactText}));
 }
 const native={digest:digest(raw),evidence:{...payload,pr:String(PR),github_author_id:String(AUTHOR),
  claim_comment_id:String(COMMENT),github_account_created_at:String(ACCOUNT_CREATED)}};
 assert.equal(requireOpenRecord(native,raw),native);
 assert.throws(()=>requireOpenRecord({...native,evidence:{...native.evidence,protocol_commit:commit('f')}},raw),/record fields differ/);
});

test('an authorized verifier signature cannot replace the signed record bytes or exact comment identity',async()=>{
 const {problem,claim,attestation}=await fixture();
 const input={problem,claim,authorId:AUTHOR,commentId:COMMENT,createdAt:CREATED};
 assert.equal((await verifyOpenAttestation(attestation,input)).evidence.contract,claim.contract);
 const stricter={...problem,deployment:{...problem.deployment,minimumGitHubAccountAgeDays:31}};
 await assert.rejects(verifyOpenAttestation(attestation,{...input,problem:stricter}),/age|days/i);
 const foreign=await signedAttestation(attestation.evidence,claim,contributor);
 await assert.rejects(verifyOpenAttestation(foreign,input),/Unknown evidence verifier/);
 for(const change of [{comment_id:COMMENT+1},{comment_created_at:'2026-11-23T00:00:01Z'},{worker_commit:commit('f')},
  {github_account_created_at:ACCOUNT_CREATED+1},{github_account_created_at:String(ACCOUNT_CREATED)},{github_account_type:'Bot'},
  {submission_text:attestation.evidence.submission_text+'\n'},{artifact_path:'research/artifacts/other.json'}]){
  const altered=await signedAttestation({...attestation.evidence,...change},claim);
  await assert.rejects(verifyOpenAttestation(altered,input));
 }
});

test('report reconciliation requires the post-reserve native contribution snapshot',async()=>{
 const {problem,candidate,attestation}=await fixture();
 const raw=await openEvidenceJSON({problem,candidate,attestation,authorId:AUTHOR});
 const impact={downstream:candidate.id,source_digest:digest(raw),status:'settled',budget:60,
  paid_points:'40',returned_points:'20'};
 const upfront={digest:digest(raw),evidence:JSON.parse(raw),status:'credited',award_budget:'300',
  credited_points:'240',initial_paid:'240',impact_reserve:'60',reserve_returned:'0',reserve_settled:false};
 assert.equal(requireOpenRecord(upfront,raw).credited_points,'240');
 assert.throws(()=>requireOpenRecord(upfront,raw,{settledImpact:impact}),/reserve settlement do not agree/);
 const final={...upfront,credited_points:'260',reserve_returned:'20',reserve_settled:true};
 assert.equal(requireOpenRecord(final,raw,{settledImpact:impact}).credited_points,'260');
 assert.throws(()=>requireOpenRecord(final,raw,{settledImpact:{...impact,source_digest:hash('e')}}),/reserve settlement do not agree/);
});


test('finalized unresolved consensus leaves a saved claim ineligible for automatic scheduling',async()=>{
 const {problem,claim,candidate,pr}=await fixture();
 const report={id:candidate.id,commentId:COMMENT,commentCreatedAt:CREATED,contract:claim.contract,chainId:claim.chainId,
  repository:claim.repository,pr:PR,head:claim.head,base:claim.base,claim:candidate.envelope,status:'submitted'};
 const observed=JSON.parse(fs.readFileSync(new URL('fixtures/studio-consensus-outcomes.json',import.meta.url))).modernUndetermined;
 let error;try{verifyFinalizedOutcome(observed);}catch(caught){error=caught;}
 assert.equal(error.code,'STUDIO_FINALIZED_OUTCOME_INVALID');
 report.blockedConsensus=blockedOpenConsensus(error);
 assert.equal(report.blockedConsensus,true);
 assert.equal(eligibleOpenClaim({candidate,pr,deployment:problem.deployment,canonicalHead:claim.base,report}),false);
 assert.equal(blockedOpenConsensus(Error('Transaction VALIDATORS_TIMEOUT: hash')),true);
 assert.equal(blockedOpenConsensus(Error('Temporary RPC outage')),false);
});


test('full Lean evidence binds source, semantic statement, pins and every kernel',async()=>{
 const f=await fixture();
 const b={version:2,imports:['Mathlib.Data.Int.Basic'],source:'namespace Contribution\ntheorem result (n : Int) : n = n := rfl\nend Contribution\n',theorem:'Contribution.result',dependencies:[]};
 validateFullLeanBundle(b);
 const artifactText=json(b),bundleHash=sha256(artifactText),canonical_semantics={type:['forall','Int',['Eq','Int',0,0]],definitions:[]};
 f.problem.policy={...f.problem.policy,version:6,toolchain:FULL_LEAN.toolchain,allowed_axioms:FULL_LEAN.axioms,mathlib:{repository:'leanprover-community/mathlib4',commit:FULL_LEAN.mathlibCommit},checker:FULL_LEAN.checker};
 f.problem.policyHash=sha256(json(f.problem.policy));f.claim.policy=f.problem.policyHash;
 const result={...f.result,policy:f.problem.policyHash,toolchain:FULL_LEAN.toolchain,bundle_hash:bundleHash,artifact_hash:bundleHash,proof_hash:sha256(b.source),theorem:`B_${bundleHash}.Contribution.result`,formal_statement:'forall (n : Int), Eq Int n n',canonical_semantics,statement_hash:sha256(canonical_semantics),proposition_hash:sha256('forall (n : Int), Eq Int n n'),legacy_adapters:{},full_kernel:{version:1,lean_commit:FULL_LEAN.leanCommit,mathlib_commit:FULL_LEAN.mathlibCommit,export_hash:hash('a'),baseline_hash:hash('b'),checker_set:['leanchecker','leanchecker-paranoid','lean4lean','nanoda','con-leche','con-ron']}};
 const options={...f,artifactText};
 assert.equal(validateOpenResult(result,options),result);
 const large={...result,formal_statement:'theorem : '+'T'.repeat(32758)};large.proposition_hash=sha256(large.formal_statement);
 assert.equal(validateOpenResult(large,options),large);
 const oversized={...large,formal_statement:large.formal_statement+'T'};oversized.proposition_hash=sha256(oversized.formal_statement);
 assert.throws(()=>validateOpenResult(oversized,options),/semantic statement/);

 for(const mutate of [
  r=>r.full_kernel.checker_set.pop(),r=>r.full_kernel.mathlib_commit=commit('0'),
  r=>r.full_kernel.baseline_hash='',r=>r.canonical_semantics.type=['True'],
  r=>r.formal_statement='False',r=>r.proof_hash=hash('c'),r=>r.theorem='True',
  r=>r.axioms=['sorryAx'],r=>r.production_verified=false,
  r=>delete r.legacy_adapters,r=>r.legacy_adapters=null,r=>r.legacy_adapters[hash('f')]={version:1},
 ]){const changed=structuredClone(result);mutate(changed);assert.throws(()=>validateOpenResult(changed,options));}
 f.problem.policy.version=5;
 assert.throws(()=>validateOpenResult(result,options),/activated Mathlib policy/);
});

test('modern reports require exact reviewed adapters for root and transitive dependency bundles',async()=>{
 const manifestBytes=fs.readFileSync(new URL('../lean/full_lean/legacy_adapters.json',import.meta.url));
 const entry=JSON.parse(manifestBytes).adapters[0];
 const disclosure={[entry.bundle_hash]:{version:1,original_proof_hash:entry.original_proof_hash,
  compiled_proof_hash:entry.compiled_proof_hash,reason:entry.reason,manifest_hash:sha256(manifestBytes)}};
 const historical=fs.readFileSync(new URL('fixtures/full-lean/c-legacy.json',import.meta.url),'utf8');
 assert.equal(sha256(historical),entry.bundle_hash);
 for(const rootAdapter of [true,false]){
  const artifactText=rootAdapter?historical:json(formalBundle([{id:A,bundle_hash:hash('a')}]));
  const bundle=JSON.parse(artifactText),f=await fixture({dependencies:bundle.dependencies});
  f.problem.policy={...f.problem.policy,version:6,toolchain:FULL_LEAN.toolchain,allowed_axioms:FULL_LEAN.axioms};
  f.problem.policyHash=sha256(json(f.problem.policy));f.claim.policy=f.problem.policyHash;
  const canonical_semantics={type:['True'],definitions:[]},bundleHash=sha256(artifactText);
  const result={...f.result,policy:f.problem.policyHash,toolchain:FULL_LEAN.toolchain,
   bundle_hash:bundleHash,artifact_hash:bundleHash,proof_hash:sha256(bundle.proof),theorem:`B_${bundleHash}.result`,
   formal_statement:'True',proposition_hash:sha256('True'),canonical_semantics,statement_hash:sha256(canonical_semantics),
   legacy_adapters:structuredClone(disclosure),full_kernel:{version:1,lean_commit:FULL_LEAN.leanCommit,
    mathlib_commit:FULL_LEAN.mathlibCommit,export_hash:hash('a'),baseline_hash:hash('b'),
    checker_set:['leanchecker','leanchecker-paranoid','lean4lean','nanoda','con-leche','con-ron']}};
  // The adapter can occur below a direct dependency, so validate the entire authenticated closure.
  if(!rootAdapter){result.dependency_bundle_hashes[B]=entry.bundle_hash;result.dependency_artifact_hashes[B]=entry.bundle_hash;}
  const options={...f,artifactText,closure:Object.entries(result.dependency_bundle_hashes).map(([id,hash])=>({id,bundle_hash:hash,artifact_hash:hash}))};
  assert.equal(validateOpenResult(result,options),result);
  for(const mutate of [
   r=>delete r.legacy_adapters,r=>r.legacy_adapters={},
   r=>r.legacy_adapters[entry.bundle_hash].original_proof_hash=hash('c'),
   r=>r.legacy_adapters[entry.bundle_hash].compiled_proof_hash=hash('c'),
   r=>r.legacy_adapters[entry.bundle_hash].manifest_hash=hash('c'),
   r=>r.legacy_adapters[entry.bundle_hash].reason='Caller supplied reason',
   r=>r.legacy_adapters[entry.bundle_hash].version=2,
   r=>r.legacy_adapters[entry.bundle_hash].extra=true,
   r=>r.legacy_adapters[hash('f')]=structuredClone(disclosure[entry.bundle_hash]),
  ]){const changed=structuredClone(result);mutate(changed);assert.throws(()=>validateOpenResult(changed,options),/Legacy adapter disclosure/);}
  if(!rootAdapter){
   const changed=structuredClone(result);delete changed.dependency_bundle_hashes[B];delete changed.dependency_artifact_hashes[B];
   assert.throws(()=>validateOpenResult(changed,{...options,closure:undefined}),/Legacy adapter disclosure/);
   changed.legacy_adapters={};assert.equal(validateOpenResult(changed,{...options,closure:undefined}),changed);
  }
 }
});

test('full Lean bundle blocks path/config injection while allowing ordinary source syntax',()=>{
 const base={version:2,imports:['Mathlib.Tactic.Ring'],source:'-- ordinary source\ninductive Bit where | zero | one\ntheorem result : True := by trivial',theorem:'result',dependencies:[]};
 assert.equal(validateFullLeanBundle(base),base);
 for(const override of [{imports:['Mathlib']},{imports:['Mathlib.../file']},{imports:['Mathlib.Tactic.Ring','Mathlib.Tactic.Ring']},{theorem:'result; command'},{source:''},{lakefile:'run me'},{dependencies:[{id:'x',bundle_hash:hash('a')},{id:'x',bundle_hash:hash('b')}]}])assert.throws(()=>validateFullLeanBundle({...base,...override}));
});
