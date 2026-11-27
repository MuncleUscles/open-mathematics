import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import {canonical,digest,message} from '../src/security.mjs';
import {goalCommitment,propositionHash,sha256,statementFingerprint,validateProblemPolicy} from '../src/problem.mjs';
import {eligibleProblemClaim,exactProblemReport,readClaimComment,requireClaimAuthor,selectProblemClaim} from '../github/problem-select.mjs';
import {readProblemProofBlobs,requireOpenProblemGoal,requireProblemNative,validateProblemProof,verifyProblemAttestation} from '../github/problem-verify.mjs';
import {problemEvidenceJSON,requireProblemRecord} from '../github/problem-worker.mjs';

const commit=value=>value.repeat(40);
const hash=value=>value.repeat(64);
const address=value=>'0x'+commit(value);
const AUTHOR=27;
const COMMENT=81;
const PR=4;
const CREATED='2026-11-23T00:00:00Z';
const PROOF=Buffer.from('by\n  intro n\n  exact rfl\n');
const json=value=>JSON.stringify(value,null,2)+'\n';
const contributor=privateKeyToAccount('0x'+'29'.repeat(32));
const verifier=privateKeyToAccount('0x'+'36'.repeat(32));

async function fixture(){
 const files={'Definitions.lean':digest('def Value := Nat\n'),'Identity.lean':digest('def Identity : Prop := ∀ n : Value, n = n\n')};
 const goalDefinition={
  path:'research/proofs/identity.proof',theorem:'candidate : Identity',statement:'def Identity : Prop := ∀ n : Value, n = n',
  definition_files:Object.keys(files),dependency:null,rewardable:true,
 };
 goalDefinition.statement_hash=statementFingerprint(goalDefinition,files);
 goalDefinition.goal_hash=goalCommitment('identity',goalDefinition,files);
 const policy=validateProblemPolicy({
  version:4,name:'fixture-v1',problem:'fixture-problem',repository:'Owner/problem',branch:'research',
  toolchain:'lean4:4.19.0',allowed_axioms:['propext','Quot.sound'],files,goals:{identity:goalDefinition},
 });
 const policyBytes=Buffer.from(json(policy));
 const goal={...goalDefinition,id:'identity',policyHash:sha256(policyBytes),problemCommit:commit('1'),protocolCommit:commit('2')};
 const entry={path:'.open-math/policies/fixture-v1.json',sha256:goal.policyHash,sourceCommit:goal.problemCommit,protocolCommit:goal.protocolCommit};
 const deployment={
  protocolVersion:4,problem:policy.problem,repository:policy.repository,branch:policy.branch,chainId:61999,
  contract:address('3'),origin:'https://example.test',curator:address('1'),verifier:verifier.address,executor:address('2'),
  windowSeconds:30,appId:15368,verifierAppId:15368,
  legacyLedger:{chain_id:61999,address:'',reserved_statement_hashes:[],reserved_proposition_hashes:[]},
 };
 const problem={
  deployment,descriptor:{id:policy.problem,repository:policy.repository,branch:policy.branch,configBranch:'main',
   protocol:{commit:goal.protocolCommit},directions:['shared']},
  policies:new Map([[goal.policyHash,{entry,policy,bytes:policyBytes}]]),goals:new Map([[goal.id,goal]]),
 };
 const submission={
  schema_version:2,problem:policy.problem,kind:'lemma',title:'Identity preserves equality',
  claim:'For each natural value in the component, equality with itself holds.',
  novelty:'This spells out a first component of the fixture and relies on a standard reflexivity fact.',
  prior_art:[],research_direction:'shared',
  provenance:{mode:'extension',sources:[],discovery_basis:'This is a controlled fixture of a familiar theorem, with no priority claim.'},
  evidence:{policy:policy.name,goal:goal.id,proof_path:goal.path,reproduce:'Run the isolated verifier with the committed fixture.'},
  dependencies:[],attribution:{wallet:contributor.address,contributions:'The fixture contributor supplied the proof and metadata.'},
  limitations:'This exercises only the pinned equality goal and its exact scope.',
 };
 const recordBytes=Buffer.from(json(submission));
 const claim={
  version:3,domain:deployment.origin,chainId:deployment.chainId,problem:policy.problem,repository:policy.repository,
  pr:PR,head:commit('4'),base:commit('5'),branch:policy.branch,contract:deployment.contract,policy:goal.policyHash,
  goal:goal.id,goal_hash:goal.goal_hash,problem_commit:goal.problemCommit,protocol_commit:goal.protocolCommit,
  submission_path:'research/submissions/equality.json',submission_hash:digest(recordBytes),wallet:contributor.address,
  nonce:'6'.repeat(32),expires:Date.parse(CREATED)+300000,
 };
 const pr={number:PR,state:'open',merged:false,user:{id:AUTHOR},
  head:{sha:claim.head},base:{ref:claim.branch,sha:claim.base,repo:{full_name:claim.repository}}};
 const comment=await signedComment(claim);
 const candidate=await readClaimComment({comment,problem,commentId:COMMENT});
 const result={
  result:'pass',mode:'isolated',production_verified:true,verified:true,verification:'verified',
  checker:'open-mathematics-v4',problem:claim.problem,repository:claim.repository,head:claim.head,base:claim.base,
  problem_commit:claim.problem_commit,protocol_commit:claim.protocol_commit,policy:claim.policy,goal:claim.goal,
  goal_hash:claim.goal_hash,statement_hash:goal.statement_hash,proposition_hash:propositionHash(goal),
  formal_statement:goal.statement,toolchain:policy.toolchain,
  theorem:goal.theorem,theorems:[goal.theorem],proof_hash:digest(PROOF),artifact_hash:hash('7'),source_hashes:files,
  policy_source_hashes:files,rewardable:goal.rewardable,axioms:[],sorry:false,proof_body_uses:[],dependency_artifact:null,
  image:'sha256:'+hash('8'),
 };
 const evidence={...result,worker_commit:problem.descriptor.protocol.commit,
  chainId:deployment.chainId,contract:deployment.contract,branch:claim.branch,
  wallet:claim.wallet,pr:claim.pr,claim_digest:digest(claim),github_author_id:AUTHOR,submission_path:claim.submission_path,
  comment_id:COMMENT,comment_created_at:CREATED,
  submission_hash:claim.submission_hash,submission,proof:PROOF.toString('utf8'),verified_dependencies:[]};
 const attestation=await signedAttestation(evidence,claim);
 const report={
  id:candidate.id,commentId:COMMENT,commentCreatedAt:CREATED,contract:claim.contract,
  chainId:claim.chainId,repository:claim.repository,pr:PR,head:claim.head,base:claim.base,claim:candidate.envelope,
 };
 return {problem,deployment,policy,goal,claim,candidate,result,attestation,report,pr,comment,recordBytes};
}

async function signedComment(claim,overrides={}){
 const envelope={claim,signature:await contributor.signMessage({message:message(claim)})};
 return {
  id:COMMENT,created_at:CREATED,updated_at:CREATED,user:{id:AUTHOR},
  issue_url:`https://api.github.com/repos/${claim.repository}/issues/${claim.pr}`,
  body:[`Open-Mathematics-Claim: ${digest(claim)}`,'```json',json(envelope).trimEnd(),'```'].join('\n'),
  ...overrides,
 };
}

async function signedAttestation(evidence,claim,account=verifier){
 return {
  evidence,claimDigest:digest(claim),verifier:verifier.address,
  signature:await account.signMessage({message:'Open Mathematics proof attestation v2\n'+canonical(evidence)}),
 };
}

test('queue admits the exact author comment on the fresh canonical base',async()=>{
 const {problem,claim,candidate,pr,comment}=await fixture();
 const github={
  repository:claim.repository,
  branchHead:async branch=>{assert.equal(branch,claim.branch);return claim.base;},
  pr:async number=>{assert.equal(number,PR);return pr;},
  request:async endpoint=>{assert.equal(endpoint,`/issues/comments/${COMMENT}`);return comment;},
 };
 const input={github,problem,eventName:'issue_comment',event:{action:'created',issue:{pull_request:{}},comment:{id:COMMENT}},readEvidence:async()=>null};
 assert.equal((await selectProblemClaim(input)).id,candidate.id);
 const advanced={...github,branchHead:async()=>commit('e')};
 assert.equal(await selectProblemClaim({...input,github:advanced}),null);
 const differentComment={...github,request:async()=>({...comment,id:COMMENT+1})};
 assert.equal(await selectProblemClaim({...input,github:differentComment}),null);
 const unauthored={...github,pr:async()=>({...pr,user:{id:AUTHOR+1}})};
 assert.equal(await selectProblemClaim({...input,github:unauthored}),null);
 const upgraded={...problem,descriptor:{...problem.descriptor,protocol:{commit:commit('e')}}};
 assert.equal((await selectProblemClaim({...input,problem:upgraded})).goal.protocolCommit,claim.protocol_commit);
});

test('edited, cross-problem, stale-release and author-swapped claim comments fail',async()=>{
 const {problem,claim,comment,candidate,pr,deployment}=await fixture();
 assert.throws(()=>requireClaimAuthor(candidate,{...comment,user:{id:AUTHOR+1}},pr,deployment),/author/);
 const edited={...comment,updated_at:'2026-11-23T00:00:01Z'};
 await assert.rejects(readClaimComment({comment:edited,problem,commentId:COMMENT}),/unedited/);
 for(const [field,value] of Object.entries({problem:'another-problem',protocol_commit:commit('e'),problem_commit:commit('e'),goal_hash:hash('e'),version:2})){
  const changed=await signedComment({...claim,[field]:value});
  await assert.rejects(readClaimComment({comment:changed,problem,commentId:COMMENT}),undefined,field);
 }
});

test('resume uses the exact signed envelope, original creation time and deployment',async()=>{
 const {deployment,claim,candidate,report,pr}=await fixture();
 const changed={...pr,state:'closed',base:{...pr.base,ref:'main'}};
 const input={candidate,pr:changed,deployment,canonicalHead:claim.base};
 assert.equal(eligibleProblemClaim(input),false);
 assert.equal(eligibleProblemClaim({...input,report}),true);
 assert.equal(eligibleProblemClaim({...input,report:{...report,blockedConsensus:true}}),false);
 assert.equal(eligibleProblemClaim({...input,report:{...report,blockedConsensus:true},explicit:true}),true);
 assert.equal(eligibleProblemClaim({...input,report:{...report,status:'invalid'},explicit:true}),false);
 for(const tampered of [
  {...report,commentCreatedAt:'2026-11-23T00:00:01Z'},
  {...report,commentId:COMMENT+1},
  {...report,contract:address('e')},
  {...report,claim:{...report.claim,claim:{...claim,problem_commit:commit('e')}}},
 ])assert.equal(exactProblemReport(candidate,tampered,deployment),false);
});

test('native configuration and exact enrolled contents are required before worker execution',async()=>{
 const {deployment:d,goal,problem}=await fixture();
 const config={
  version:4n,problem:d.problem,repository:d.repository,branch:d.branch,curator:d.curator,verifier:d.verifier,
  executor:d.executor,window:30n,directions:['shared'],legacy_ledger:{...d.legacyLedger,chain_id:61999n},
 };
 const enrolled={
  ...goal,policy_hash:goal.policyHash,problem_commit:goal.problemCommit,protocol_commit:goal.protocolCommit,
  proposition_hash:propositionHash(goal),status:'open',
 };
 const calls=[];
 function client({settings=config,row=enrolled,chain=d.chainId}={}){
  return {
   getChainId:async()=>chain,
   readContract:async ({address,functionName,args,transactionHashVariant})=>{
    calls.push(functionName);
    assert.equal(address,d.contract);
    assert.equal(transactionHashVariant,'latest-final');
    if(functionName==='get_config'){assert.deepEqual(args,[]);return settings;}
    assert.equal(functionName,'get_goal');
    assert.deepEqual(args,[goal.id]);
    return row;
   },
  };
 }
 assert.equal((await requireProblemNative(problem,goal,client())).status,'open');
 assert.deepEqual(calls,['get_config','get_goal']);
 const closed=await requireProblemNative(problem,goal,client({row:{...enrolled,status:'closed'}}));
 assert.throws(()=>requireOpenProblemGoal(closed),/requires an open goal/);
 await assert.rejects(requireProblemNative(problem,goal,client({chain:123})),/Wrong native chain/);
 await assert.rejects(requireProblemNative(problem,goal,client({settings:{...config,verifier:address('e')}})),/native role mismatch/);
 await assert.rejects(requireProblemNative(problem,goal,client({settings:{...config,window:31n}})),/native integer mismatch/);
 await assert.rejects(requireProblemNative(problem,goal,client({row:{...enrolled,problem_commit:commit('e')}})),/native enrollment mismatch/);
 await assert.rejects(requireProblemNative(problem,goal,client({row:{...enrolled,statement:'A different theorem'}})),/Native goal content mismatch/);
});

test('immutable-tree and blob gate admits only the signed proof and record bytes',async()=>{
 const {claim,goal,recordBytes}=await fixture();
 const gitBlob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
 const blobs=new Map([[gitBlob(PROOF),PROOF],[gitBlob(recordBytes),recordBytes]]);
 const parents=[{sha:claim.base}];
 const headTree=commit('a'),baseTree=commit('b');
 const entries=[
  {path:goal.path,type:'blob',mode:'100644',sha:gitBlob(PROOF)},
  {path:claim.submission_path,type:'blob',mode:'100644',sha:gitBlob(recordBytes)},
 ];
 function provider({tree=entries,proof=PROOF,treeSha=headTree}={}){
  return {
   commit:async sha=>({sha,parents,tree:{sha:sha===claim.head?headTree:baseTree}}),
   request:async endpoint=>{
    if(endpoint===`/git/trees/${headTree}?recursive=1`)return {sha:treeSha,truncated:false,tree};
    if(endpoint===`/git/trees/${baseTree}?recursive=1`)return {sha:baseTree,truncated:false,tree:[]};
    const sha=endpoint.split('/').at(-1),data=sha===gitBlob(PROOF)?proof:blobs.get(sha);
    assert.ok(data,'requested blob exists');
    return {sha,content:data.toString('base64'),size:data.length,encoding:'base64'};
   },
  };
 }
 assert.deepEqual(await readProblemProofBlobs(provider(),claim,goal),{proofBytes:PROOF,recordBytes});
 await assert.rejects(readProblemProofBlobs(provider({treeSha:commit('e')}),claim,goal),/tree binding/);
 await assert.rejects(readProblemProofBlobs(provider({tree:[...entries,{...entries[0],path:'README.md'}]}),claim,goal),/exactly one enrolled proof/);
 await assert.rejects(readProblemProofBlobs(provider({tree:[...entries,entries[0]]}),claim,goal),/unique paths/);
 await assert.rejects(readProblemProofBlobs(provider({tree:[{...entries[0],mode:'120000'},entries[1]]}),claim,goal),/Plain immutable files/);
 await assert.rejects(readProblemProofBlobs(provider({proof:Buffer.concat([PROOF,Buffer.from(' ')])}),claim,goal),/blob hash mismatch/);
 await assert.rejects(readProblemProofBlobs(provider(),{...claim,submission_hash:hash('e')},goal),/Signed submission record changed/);
});

test('a valid verifier signature cannot substitute different proof identity or local diagnostics',async()=>{
 const {problem,goal,claim,result,attestation}=await fixture();
 const input={problem,goal,claim,authorId:AUTHOR,commentId:COMMENT,createdAt:CREATED};
 assert.equal((await verifyProblemAttestation(attestation,input)).submission.evidence.goal,goal.id);
 const changedSigner=await signedAttestation(attestation.evidence,claim,contributor);
 await assert.rejects(verifyProblemAttestation(changedSigner,input),/Unknown proof verifier/);
 for(const [field,value] of Object.entries({
  goal_hash:hash('e'),protocol_commit:commit('e'),problem_commit:commit('e'),statement_hash:hash('e'),proposition_hash:hash('e'),
  proof_hash:hash('e'),formal_statement:'Unrelated theorem text',production_verified:false,verified:false,
  verification:'diagnostic-only',mode:'local-diagnostic',axioms:['Classical.choice'],github_author_id:AUTHOR+1,
  comment_id:COMMENT+1,comment_created_at:'2026-11-23T00:00:01Z',
  submission_path:'research/submissions/other.json',source_hashes:{},image:'unchecked-image',worker_commit:commit('e'),
 })){
  const changed=await signedAttestation({...attestation.evidence,[field]:value},claim);
  await assert.rejects(verifyProblemAttestation(changed,input),undefined,field);
 }
 assert.throws(()=>validateProblemProof({...result,problem:'other'}, {...input,proofBytes:PROOF}),/problem mismatch/);
});

test('an upgraded worker can verify older goals and preserves earlier journal bindings',async()=>{
 const {problem,goal,claim,candidate,attestation}=await fixture();
 const upgraded={...problem,descriptor:{...problem.descriptor,protocol:{commit:commit('e')}}};
 const proof=await signedAttestation({...attestation.evidence,worker_commit:upgraded.descriptor.protocol.commit},claim);
 const input={problem:upgraded,candidate,authorId:AUTHOR};
 const evidence=JSON.parse(await problemEvidenceJSON({...input,attestation:proof}));
 assert.equal(evidence.protocol_commit,goal.protocolCommit);
 assert.equal(evidence.worker_commit,upgraded.descriptor.protocol.commit);
 await assert.rejects(problemEvidenceJSON({...input,attestation}),{code:'WORKER_ATTESTATION_MISMATCH'});
});

test('registration bytes and finalized record preserve both commits and signed metadata',async()=>{
 const {problem,candidate,attestation}=await fixture();
 const input={problem,candidate,attestation,authorId:AUTHOR};
 const raw=await problemEvidenceJSON(input),record=JSON.parse(raw);
 assert.equal(record.claim_digest,digest(candidate.claim));
 assert.equal(record.problem_commit,candidate.claim.problem_commit);
 assert.equal(record.protocol_commit,candidate.claim.protocol_commit);
 assert.equal(record.worker_commit,problem.descriptor.protocol.commit);
 assert.equal(record.goal_hash,candidate.claim.goal_hash);
 assert.equal(record.proposition_hash,propositionHash(candidate.goal));
 assert.equal(record.claim_comment_id,COMMENT);
 assert.equal(record.claim_comment_created_at,CREATED);
 assert.equal(record.contract,problem.deployment.contract);
 assert.equal(await problemEvidenceJSON({...input,cached:raw}),raw);
 await assert.rejects(problemEvidenceJSON({...input,cached:raw+'\n'}),/Cached report differs/);
 await assert.rejects(problemEvidenceJSON({...input,candidate:{...candidate,goal:{...candidate.goal,protocolCommit:commit('e')}}}),/commitments differ/);
 const response={digest:digest(raw),evidence:{...record,pr:String(PR),github_author_id:String(AUTHOR),claim_comment_id:String(COMMENT)}};
 assert.equal(requireProblemRecord(response,raw),response);
 assert.throws(()=>requireProblemRecord({...response,digest:hash('e')},raw),/Native record differs/);
 assert.throws(()=>requireProblemRecord({...response,evidence:{...response.evidence,problem_commit:commit('e')}},raw),/record fields differ/);
});
