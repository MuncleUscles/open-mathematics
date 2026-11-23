import test from 'node:test';import assert from 'node:assert/strict';
import {validateOpenSubmission,decodeOpenSubmission,openSubmissionBlobs,validateOpenClaim,requireOpenConfiguration} from '../src/open-research.mjs';
import {claimFor,submissionTemplate} from '../scripts/open-agent.mjs';
const wallet='0x'+'1'.repeat(40),contract='0x'+'2'.repeat(40),hash='a'.repeat(64),head='b'.repeat(40),base='c'.repeat(40),worker='d'.repeat(40);
const problem={descriptor:{id:'p-vs-np',protocol:{commit:worker}},policyHash:hash,policy:{objective:'Resolve P versus NP; useful work toward either outcome is welcome.'},deployment:{problem:'p-vs-np',repository:'owner/problem',branch:'research',chainId:61999,contract,origin:'https://example.com',verifier:'0x'+'3'.repeat(40),executor:'0x'+'4'.repeat(40),windowSeconds:300,minimumGitHubAccountAgeDays:30,legacyLedgers:[]}};
function record(){return {schema_version:3,problem:'p-vs-np',kind:'failed-approach',title:'A concrete limitation of this research direction',claim:'This note identifies a precise missing premise in the proposed constructive reduction.',novelty:'It isolates an assumption not established by the existing repository results.',prior_art:[],research_direction:'A new direction proposed by the contributor',provenance:{mode:'extension',sources:[],discovery_basis:'This pilot checks repository context only; no claim of a globally novel mathematical discovery is made.'},evidence:{kind:'research-note',artifact_path:'research/notes/new-direction.md',reproduce:'Read the exact note and follow each stated assumption and implication.'},dependencies:[],attribution:{wallet,contributions:'I supplied the argument and documented its limitations.'},limitations:'This is a reviewed argument, not a formal Lean proof or a solution to P versus NP.'};}
test('open submissions accept a new direction without any task or goal registry',()=>{
 const s=record();assert.equal(validateOpenSubmission(s,{wallet,problem}).research_direction,s.research_direction);
 const bytes=Buffer.from(JSON.stringify(s,null,2)+'\n');assert.deepEqual(decodeOpenSubmission(bytes,{wallet,problem}),s);
 assert.throws(()=>decodeOpenSubmission(Buffer.from(JSON.stringify(s).replace('"schema_version":3','"schema_version":2,"schema_version":3')),{wallet,problem}),/normalized/);
});
test('research notes cannot masquerade as a formal result and attribution binds the signer',()=>{
 const s=record();s.kind='research-note';s.evidence={kind:'formal',artifact_path:'research/artifacts/new-direction.json',reproduce:s.evidence.reproduce};assert.throws(()=>validateOpenSubmission(s,{wallet,problem}),/cannot claim/);
 assert.throws(()=>validateOpenSubmission(record(),{wallet:contract,problem}),/attribution/);
 const t=submissionTemplate('new-direction',wallet);assert.throws(()=>validateOpenSubmission(t,{wallet,problem}),/replace|placeholder/);
});
test('claims bind exact release and policy without a curator-chosen goal',()=>{
 const bytes=Buffer.from(JSON.stringify(record(),null,2)+'\n'),now=Date.now(),c=claimFor(problem,{pr:3,head,base,recordPath:'research/submissions/new-direction.json',recordBytes:bytes,wallet,now});
 assert.equal(c.version,4);assert.equal(Object.hasOwn(c,'goal'),false);assert.equal(validateOpenClaim(c,problem,{now}),c);
 for(const mutation of [{goal:'enrolled'}, {protocol_commit:'f'.repeat(40)},{policy:'f'.repeat(64)},{contract:wallet},{expires:now-1}])assert.throws(()=>validateOpenClaim({...c,...mutation},problem,{now}));
});
test('only two new regular files directly on the signed base can be submitted',()=>{
 const claim={base,submission_path:'research/submissions/new-direction.json'},entry=p=>({path:p,type:'blob',mode:'100644',sha:'e'.repeat(40)}),old=entry('README.md'),artifact=entry('research/notes/new-direction.md'),record=entry(claim.submission_path),tree={truncated:false,tree:[old,artifact,record]},baseTree={truncated:false,tree:[old]},commit={parents:[{sha:base}]};
 const args={claim,tree,baseTree,head:commit};assert.equal(openSubmissionBlobs(args).artifactPath,artifact.path);
 assert.throws(()=>openSubmissionBlobs({...args,tree:{...tree,tree:[...tree.tree,entry('.github/workflows/attack.yml')]}}),/exactly/);
 assert.throws(()=>openSubmissionBlobs({...args,tree:{...tree,tree:[old,{...artifact,mode:'120000'},record]}}),/regular/);
 assert.throws(()=>openSubmissionBlobs({...args,baseTree:{...baseTree,tree:[old,artifact]}}),/exactly/);
 assert.throws(()=>openSubmissionBlobs({...args,head:{parents:[{sha:head}]}}),/signed/);
 assert.throws(()=>openSubmissionBlobs({...args,tree:{...tree,tree:[...tree.tree,old]}}),/unique/);
});
test('native open rules and service identities must match local reviewed configuration',async()=>{
 const d=problem.deployment,config={version:'5',problem:d.problem,repository:d.repository,branch:d.branch,verifier:d.verifier,executor:d.executor,window:'300',minimum_account_age_days:'30',policy:hash,objective:problem.policy.objective,legacy_ledgers:[]};
 assert.equal(await requireOpenConfiguration(problem,async()=>config),config);
 await assert.rejects(requireOpenConfiguration(problem,async()=>({...config,policy:'f'.repeat(64)})),/mismatch/);
 await assert.rejects(requireOpenConfiguration(problem,async()=>({...config,verifier:wallet})),/role/);
});
