import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {prepareOpenContribution,currentOpenStatus,submissionTemplate} from '../scripts/open-agent.mjs';
import {deploymentIntent,assertDeploymentJournal} from '../scripts/manage-open.mjs';
import {assertOpenConfiguration,openNativeConfiguration,validateOpenArtifactBytes,validateOpenConstructor} from '../src/open-research.mjs';
const wallet='0x'+'1'.repeat(40),contract='0x'+'2'.repeat(40),head='a'.repeat(40),base='b'.repeat(40),headTree='c'.repeat(40),baseTree='d'.repeat(40);
const problem={descriptor:{id:'p-vs-np',protocol:{commit:'e'.repeat(40)}},policyHash:'f'.repeat(64),policy:{objective:'Resolve P versus NP; useful work toward either outcome is welcome.'},deployment:{problem:'p-vs-np',repository:'owner/problem',branch:'research',chainId:61999,contract,verifier:'0x'+'3'.repeat(40),executor:'0x'+'4'.repeat(40),windowSeconds:300,minimumGitHubAccountAgeDays:30,legacyLedgers:[]}};
function fixture(){
 const record=submissionTemplate('a-note',wallet,{kind:'research-note'});
 Object.assign(record,{title:'A precise limitation of the reduction',claim:'This note identifies a concrete unstated premise required for the proposed reduction.',novelty:'The contribution isolates the exact premise that the current reduction leaves unproved.',research_direction:'Limits of the proposed reduction',limitations:'This argument is not a formal theorem or a resolution of P versus NP.'});
 record.attribution.contributions='I wrote the argument and recorded its assumptions and limits.';
 record.provenance.discovery_basis='I searched the existing repository; no exhaustive literature search or priority claim is implied.';
 const recordBytes=Buffer.from(JSON.stringify(record,null,2)+'\n'),artifactBytes=Buffer.from('# Limited reduction\n\nThis argument requires a premise that has not been established.\n');
 const hash=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'),recordSha=hash(recordBytes),artifactSha=hash(artifactBytes),blobs=new Map([[recordSha,recordBytes],[artifactSha,artifactBytes]]);
 const entries=[{path:'research/submissions/a-note.json',type:'blob',mode:'100644',sha:recordSha},{path:'research/notes/a-note.md',type:'blob',mode:'100644',sha:artifactSha}];
 const calls=[],github={pr:async()=>({state:'open',merged:false,head:{sha:head},base:{sha:base,ref:'research',repo:{full_name:'owner/problem'}}}),branchHead:async()=>base,commit:async sha=>({sha,tree:{sha:sha===head?headTree:baseTree},parents:sha===head?[{sha:base}]:[]}),request:async route=>{calls.push(route);if(route.startsWith('/git/trees/'))return {sha:route.includes(headTree)?headTree:baseTree,truncated:false,tree:route.includes(headTree)?entries:[]};const sha=route.split('/').at(-1),bytes=blobs.get(sha);return {sha,encoding:'base64',size:bytes.length,content:bytes.toString('base64')};}};
 return {github,blobs,calls,recordSha,artifactSha,recordBytes,artifactBytes,options:{problem,github,number:1,recordPath:'research/submissions/a-note.json',wallet}};
}
test('prepare binds both exact Git blobs, including the original artifact newline',async()=>{
 const f=fixture(),r=await prepareOpenContribution(f.options);assert.deepEqual(r.recordBytes,f.recordBytes);assert.deepEqual(r.artifactBytes,f.artifactBytes);assert(f.calls.includes('/git/blobs/'+f.artifactSha));
 f.blobs.set(f.artifactSha,Buffer.from(f.artifactBytes.toString().replace('premise','fiction')));await assert.rejects(prepareOpenContribution(f.options),/blob hash mismatch/);
});
test('prepare rejects a substituted tree, oversized artifact and malformed note bytes before signing',async()=>{
 const f=fixture(),original=f.github.request;f.github.request=async route=>{const r=await original(route);return route.includes('/git/trees/')?{...r,sha:'0'.repeat(40)}:r;};await assert.rejects(prepareOpenContribution(f.options),/tree binding/);
 const g=fixture();g.blobs.set(g.artifactSha,Buffer.alloc(12001,65));await assert.rejects(prepareOpenContribution(g.options),/maximum 12000 bytes/);
 assert.throws(()=>validateOpenArtifactBytes(Buffer.from('😀'.repeat(3001)),'research-note'),/12,000 UTF-8 bytes/);
 assert.throws(()=>validateOpenArtifactBytes(Buffer.from([0xff,0xfe,0xfd]),'research-note'),/encoded data/);
 assert.throws(()=>validateOpenArtifactBytes(Buffer.from('abc\u0000def'),'research-note'),/control/);
});
test('native readback compares the entire constructor, preserving case-sensitive evidence',()=>{
 const c=openNativeConfiguration(problem);assert.equal(assertOpenConfiguration({...c,version:'5',window:'300',minimum_account_age_days:'30'},c).version,'5');
 for(const changed of [{window:301},{objective:c.objective.toLowerCase()},{repository:'OWNER/problem'},{extra:'ignored'},{legacy_ledgers:[{address:wallet}]}])assert.throws(()=>assertOpenConfiguration({...c,...changed},c),/mismatch/);
 assert.throws(()=>validateOpenConstructor({...c,executor:c.verifier}),/distinct/);
 assert.throws(()=>validateOpenConstructor({...c,window:300.5}),/bounded/);
});
test('deployment journal binds exact constructor serialization, source, release, chain and signer',()=>{
 const c=openNativeConfiguration(problem),intent=deploymentIntent('reviewed source',c,head),journal={...intent,status:'prepared',sender:wallet};assertDeploymentJournal(journal,intent,wallet);
 for(const mutation of [{configJSONHash:'0'.repeat(64)},{chainId:1},{sender:contract},{status:'broadcasting'}])assert.throws(()=>assertDeploymentJournal({...journal,...mutation},intent,wallet),/changed|unknown/);
 const reordered=Object.fromEntries(Object.entries(c).reverse());assert.notEqual(deploymentIntent('reviewed source',reordered,head).configJSONHash,intent.configJSONHash);
});
test('status never relabels legacy entries when index deployment changes',()=>{
 const entry={id:'old',pr:1},current={id:'current',pr:1,contract,chainId:61999,repository:'owner/problem'},index={deployment:problem.deployment,entries:[entry,{...current,contract:wallet},current]};assert.equal(currentOpenStatus(index,1,problem.deployment),current);assert.equal(currentOpenStatus({...index,entries:[entry]},1,problem.deployment),undefined);
});
