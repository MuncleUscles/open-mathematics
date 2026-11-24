import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareBenchmark,reportBenchmark} from '../scripts/judging-benchmark.mjs';

const FIXTURES=resolve('fixtures/benchmark'),exec=promisify(execFile);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function copyFixture(t){
 const root=await mkdtemp(join(tmpdir(),'judging-benchmark-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await cp(FIXTURES,root,{recursive:true});return root;
}
async function manifest(root){return JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));}
async function save(root,value){await writeFile(join(root,'manifest.json'),JSON.stringify(value,null,2)+'\n');}
async function addSource(root,m,{id,kind,role,text}){
 const path='sources/'+id+(kind==='exact_prompt'?'.txt':'.json'),bytes=Buffer.from(text);
 await writeFile(join(root,path),bytes);
 m.sources.push({id,kind,role,path,bytes:bytes.length,sha256:digest(bytes),url:null,commit:null});
}
function documentary(){return {priority_assessment:'insufficient_evidence',milestones:[
 {source_ref:'source:qin-commit',kind:'commit',timestamp_utc:'2026-09-27T08:15:33Z'},
 {source_ref:'source:bibliography',kind:'publication',timestamp_utc:'2026-09-27T18:48:56Z'},
 {source_ref:'source:frenzy-verification',kind:'self_reported_verification',timestamp_utc:'2026-09-28T21:13:31.666678+00:00'},
 {source_ref:'source:bibliography',kind:'publication',timestamp_utc:'2026-10-06T13:27:51Z'},
 ],verification_reproduced:false,mathematical_discovery_claimed:false,final_award_confirmed:false,attribution_shares:null,
 reason:'The record distinguishes milestones but does not reproduce either complete proof or exclude all earlier public versions.',
 evidence_refs:['source:qin-commit','source:frenzy-verification','source:bibliography'],uncertainties:['Mathematical equivalence and complete publication history have not been independently reviewed.']};}
function run(prepared,changes={}){return {run_id:'synthetic-local-test',case_id:'jsp-000007',arm:'centralized_single',status:'completed',
 prompt_sha256:prepared.cases.find(c=>c.case_id==='jsp-000007').prompt_sha256,
 models:[{provider:'test-only',model:'synthetic-fixture',revision:'fixture-v1'}],parameters:{temperature:0},elapsed_ms:123,cost_usd:null,outcome:documentary(),...changes};}

test('prepares a reproducible blinded documentary input and leaves five other cases unavailable',async()=>{
 const first=await prepareBenchmark(),second=await prepareBenchmark();assert.deepEqual(first,second);
 assert.equal(first.execution_performed,false);assert.equal(first.cases.length,6);
 const ready=first.cases.filter(c=>c.input_status==='ready');assert.equal(ready.length,1);
 const item=ready[0];assert.equal(item.prompt_sha256,digest(item.prompt));
 assert.ok(!item.prompt.includes('wontfix'));assert.ok(!item.prompt.includes('closing this issue'));
 assert.ok(!item.prompt.includes('historical_reference'));assert.ok(!item.prompt.includes('organizer-response'));
 const data=JSON.parse(item.prompt.split('\nUNTRUSTED_DATA=')[1]);
 const issue=data.documents.find(d=>d.ref==='source:objection').content;
 assert.equal(issue.number,5582);assert.ok(issue.body.includes('This objection does not allege misconduct'));
 for(const key of ['state','labels','closed_at','comments','updated_at'])assert.ok(!Object.hasOwn(issue,key));
 assert.ok(first.cases.filter(c=>c.input_status!=='ready').every(c=>c.prompt===null&&c.prompt_sha256===null));
});

test('default report claims preparation only and keeps all measurement and accuracy cells absent',async()=>{
 const report=await reportBenchmark();assert.equal(report.preparation.sources_verified,7);
 assert.equal(report.measurements.imported_attempts,0);assert.equal(report.measurements.reported_cost_usd,null);
 assert.ok(report.rows.every(row=>row.cells.every(cell=>cell.status==='not_run')));
 assert.equal(report.expert_ground_truth,null);assert.equal(report.accuracy,null);
 assert.equal(report.false_acceptance_rate,null);assert.equal(report.false_rejection_rate,null);
 assert.equal(report.rows.find(r=>r.case_id==='pnp-pr21').historical_reference.accept,false);
 assert.equal(report.rows.find(r=>r.case_id==='pnp-pr22').historical_reference.award,300);
});

test('the recorded first-answer baseline is bound to its unchanged prompt, raw answer and published report',async()=>{
 const runId='codex-fresh-agent-jsp-2026-11-24',prefix='runs/'+runId+'/',root=join(FIXTURES,prefix);
 const audit=JSON.parse(await readFile(join(root,'audit.json'),'utf8'));
 const originals=['benchmark-jsp-prompt.txt','benchmark-jsp-output.json','benchmark-jsp-start.json','benchmark-jsp-completion.json'];
 assert.deepEqual(Object.keys(audit.artifacts).sort(),[...originals.map(name=>prefix+name),'measurements.json','report.json'].sort());
 for(const [path,expected] of Object.entries(audit.artifacts)){
  const bytes=await readFile(join(FIXTURES,path));assert.equal(bytes.length,expected.bytes);assert.equal(digest(bytes),expected.sha256);
 }
 const prepared=await prepareBenchmark(),item=prepared.cases.find(c=>c.case_id==='jsp-000007');
 const prompt=await readFile(join(root,'benchmark-jsp-prompt.txt'));
 assert.deepEqual(prompt,Buffer.from(item.prompt));assert.equal(audit.prompt_sha256,item.prompt_sha256);
 assert.equal(audit.benchmark_manifest_sha256,prepared.manifest_hash);
 const start=JSON.parse(await readFile(join(root,'benchmark-jsp-start.json'),'utf8'));
 const completion=JSON.parse(await readFile(join(root,'benchmark-jsp-completion.json'),'utf8'));
 assert.equal(start.prompt_sha256,item.prompt_sha256);assert.equal(completion.first_attempt,true);
 assert.equal(audit.execution_record.parent_conversation_inherited,false);
 assert.equal(audit.execution_record.independently_verified_by_reporter,false);
 const measurements=JSON.parse(await readFile(join(FIXTURES,'measurements.json'),'utf8'));
 assert.equal(measurements.runs.length,1);const recorded=measurements.runs[0];
 assert.equal(recorded.run_id,runId);assert.equal(recorded.prompt_sha256,item.prompt_sha256);
 assert.deepEqual(recorded.outcome,JSON.parse(await readFile(join(root,'benchmark-jsp-output.json'),'utf8')));
 assert.equal(recorded.models[0].revision,'not-exposed');assert.equal(audit.model_identity.exact_model_identifier,null);assert.equal(audit.model_identity.exact_revision,null);
 assert.equal(recorded.elapsed_ms,null);assert.equal(recorded.cost_usd,null);
 const report=await reportBenchmark({measurements});
 assert.deepEqual(report,JSON.parse(await readFile(join(FIXTURES,'report.json'),'utf8')));
 assert.equal(report.measurements.completed_valid,1);assert.equal(report.measurements.execution_independently_verified_by_harness,false);
 assert.equal(report.rows.flatMap(row=>row.cells).filter(cell=>cell.status==='not_run').length,17);
 assert.ok(report.rows.every(row=>row.comparisons.every(comparison=>comparison.paired===false)));
 assert.equal(report.rows[0].cells[0].outcome.priority_assessment,'insufficient_evidence');
 assert.equal(report.rows[0].cells[0].metrics.milestones_matching_frozen_records,4);assert.equal(report.rows[0].cells[0].metrics.unmatched_milestones,1);
 for(const field of ['expert_ground_truth','accuracy','false_acceptance_rate','false_rejection_rate'])assert.equal(report[field],null);
 const cli=await exec(process.execPath,[resolve('scripts/judging-benchmark.mjs'),'report','--measurements',join(FIXTURES,'measurements.json')]);
 assert.deepEqual(JSON.parse(cli.stdout),report);
});

test('source hashes reject edits rather than silently refreshing documentary evidence',async t=>{
 const root=await copyFixture(t);await writeFile(join(root,'sources/mathdb-submission.lean'),'changed source');
 await assert.rejects(prepareBenchmark({fixturesDir:root}),/hash or size mismatch/);
});

test('historical outcomes cannot be included as model input',async t=>{
 const root=await copyFixture(t),m=await manifest(root);m.cases[0].input_source_ids.push('organizer-response');await save(root,m);
 await assert.rejects(prepareBenchmark({fixturesDir:root}),/historical answers/);
});

test('rejects path traversal, symlinks and oversized documentary sources',async t=>{
 const root=await copyFixture(t),original=await manifest(root);
 for(const path of ['../manifest.json','sources/../../outside','/absolute']){
  const m=structuredClone(original);m.sources[0].path=path;await save(root,m);
  await assert.rejects(prepareBenchmark({fixturesDir:root}),/relative source path/);
 }
 const m=structuredClone(original);m.sources[0].bytes=256*1024+1;await save(root,m);
 await assert.rejects(prepareBenchmark({fixturesDir:root}),/bounded source/);
 await save(root,original);await rm(join(root,original.sources[0].path));
 await symlink(join(root,'sources/qin-commit-api.json'),join(root,original.sources[0].path));
 await assert.rejects(prepareBenchmark({fixturesDir:root}),/symlinked/);
});

test('a defensible abstention is valid and disagreement with organizers is not counted as inaccuracy',async()=>{
 const prepared=await prepareBenchmark(),r=run(prepared),report=await reportBenchmark({measurements:{schema_version:1,runs:[r]}});
 const cell=report.rows[0].cells[0];assert.equal(cell.status,'completed');
 assert.equal(cell.metrics.milestones_matching_frozen_records,4);assert.equal(cell.metrics.unmatched_milestones,0);
 assert.equal(cell.metrics.historical_decision_agreement,false);assert.equal(cell.metrics.mathematical_accuracy,null);
 assert.equal(report.rows[0].comparisons[0].paired,false);assert.equal(report.measurements.missing_cost_measurements,1);
});

test('reports unsupported documentary claims separately from schema validity',async()=>{
 const prepared=await prepareBenchmark(),r=run(prepared);r.outcome.verification_reproduced=true;r.outcome.mathematical_discovery_claimed=true;r.outcome.final_award_confirmed=true;
 const report=await reportBenchmark({measurements:{schema_version:1,runs:[r]}}),metrics=report.rows[0].cells[0].metrics;
 assert.equal(metrics.unsupported_reproduction_claim,true);assert.equal(metrics.unsupported_discovery_claim,true);assert.equal(metrics.unsupported_award_confirmation,true);
 assert.equal(report.accuracy,null);
});

test('malformed model responses count as invalid outputs without disappearing from attempts',async()=>{
 const prepared=await prepareBenchmark(),r=run(prepared);r.outcome.evidence_refs=['source:invented'];
 const report=await reportBenchmark({measurements:{schema_version:1,runs:[r]}});
 assert.equal(report.measurements.imported_attempts,1);assert.equal(report.measurements.invalid_outputs,1);
 assert.equal(report.rows[0].cells[0].status,'invalid_output');assert.equal(report.rows[0].cells[0].metrics,null);
});

test('preserves failed and unresolved attempts and rejects favorable replacement runs',async()=>{
 const prepared=await prepareBenchmark(),failed=run(prepared,{status:'failed',outcome:null,failure_reason:'Synthetic transport failure'});
 const report=await reportBenchmark({measurements:{schema_version:1,runs:[failed]}});assert.equal(report.measurements.failed,1);
 const replacement=run(prepared,{run_id:'second-try'});
 await assert.rejects(reportBenchmark({measurements:{schema_version:1,runs:[failed,replacement]}}),/duplicate attempt/);
 const unresolved=run(prepared,{status:'unresolved',outcome:null,failure_reason:'Synthetic panel disagreement'});
 assert.equal((await reportBenchmark({measurements:{schema_version:1,runs:[unresolved]}})).measurements.unresolved,1);
});

test('rejects changed prompts, missing original inputs, unpinned models and invented native receipts',async()=>{
 const prepared=await prepareBenchmark();
 for(const change of [{prompt_sha256:'f'.repeat(64)},{case_id:'pnp-pr21'},{case_id:'federation-a'},{models:[]},{arm:'genlayer'},{elapsed_ms:-1},{cost_usd:-1}]){
  await assert.rejects(reportBenchmark({measurements:{schema_version:1,runs:[run(prepared,change)]}}),/Judging benchmark/);
 }
});

test('centralized panel declares at least two pinned models and a fixed aggregation rule',async()=>{
 const prepared=await prepareBenchmark(),r=run(prepared,{arm:'centralized_panel'});
 await assert.rejects(reportBenchmark({measurements:{schema_version:1,runs:[r]}}),/model versions/);
 r.models.push({provider:'test-only',model:'second-synthetic',revision:'fixture-v1'});
 await assert.rejects(reportBenchmark({measurements:{schema_version:1,runs:[r]}}),/aggregation/);
 r.aggregation='exact-outcome-unanimity-v1';
 assert.equal((await reportBenchmark({measurements:{schema_version:1,runs:[r]}})).measurements.completed_valid,1);
});

test('generic federation fixture compares identical inputs to a separately frozen normalized receipt',async t=>{
 const root=await copyFixture(t),m=await manifest(root),item=m.cases.find(c=>c.id==='federation-a');
 const prompt='Synthetic local test prompt only. Review contribution test-a under this test policy. UNTRUSTED_DATA={"id":"test-a"}';
 await addSource(root,m,{id:'a-prompt',kind:'exact_prompt',role:'input',text:prompt});
 Object.assign(item,{input_status:'ready',input_source_ids:['a-prompt'],prompt_source_id:'a-prompt',allowed_refs:['test-a'],native_receipt_source_id:'a-receipt'});
 const outcome={accept:true,novelty:1,significance:1,reusability:1,reason:'Synthetic local fixture representing an honest modest formalization.',evidence_refs:['test-a']};
 await addSource(root,m,{id:'a-receipt',kind:'normalized_native_receipt',role:'measurement',text:JSON.stringify({verification:'independently-finalized-receipt',status:'completed',prompt_sha256:digest(prompt),outcome,test_only:true})});
 await save(root,m);
 const prepared=await prepareBenchmark({fixturesDir:root});assert.equal(prepared.cases.find(c=>c.case_id==='federation-a').prompt,prompt);
 assert.ok(!JSON.stringify(prepared).includes('a-receipt'));
 const central=run(prepared,{case_id:'federation-a',prompt_sha256:digest(prompt),outcome});
 const native={...central,run_id:'synthetic-native-test',arm:'genlayer',receipt_source_id:'a-receipt',models:[]};
 const report=await reportBenchmark({fixturesDir:root,measurements:{schema_version:1,runs:[central,native]}});
 assert.equal(report.rows.find(r=>r.case_id==='federation-a').comparisons[0].outcome_agreement,true);assert.equal(report.accuracy,null);
 native.outcome={...outcome,significance:2};
 await assert.rejects(reportBenchmark({fixturesDir:root,measurements:{schema_version:1,runs:[native]}}),/does not match/);
});

test('CLI reports without invoking evaluators and refuses to overwrite a prior artifact',async t=>{
 const root=await mkdtemp(join(tmpdir(),'judging-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const output=join(root,'report.json'),script=resolve('scripts/judging-benchmark.mjs');
 await exec(process.execPath,[script,'report','--out',output]);
 const first=await readFile(output);assert.equal(JSON.parse(first).measurements.imported_attempts,0);
 await assert.rejects(exec(process.execPath,[script,'report','--out',output]),/EEXIST/);
 assert.deepEqual(await readFile(output),first);
});
