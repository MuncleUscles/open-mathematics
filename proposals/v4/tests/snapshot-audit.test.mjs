import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditSnapshot} from '../audit-snapshot.mjs';
const root=new URL('../../../',import.meta.url);
const deployment=JSON.parse(fs.readFileSync(new URL('public/deployment.json',root)));
const original=JSON.parse(fs.readFileSync(new URL('public/community-snapshot.json',root)));
const copy=()=>structuredClone(original);
test('actual historical views reconcile 800 points but never authorize migration',()=>{
 const result=auditSnapshot(original,deployment);
 assert.equal(result.consistent,true);assert.equal(result.readyForMigration,false);
 assert.deepEqual(result.accounting,{historicalInitial:'700',retainedInitial:'700',externalAllocated:'0',unclaimed:'0',revoked:'0',laterImpact:'100',total:'800'});
 assert(result.unverifiedRequirements.some(x=>x.includes('atomic')));
 assert(result.unverifiedRequirements.some(x=>x.includes('latest 100')));
});
test('a display-schema-valid omission of the identity case cannot silently lose binding history',()=>{
 const s=copy();s.cases=s.cases.filter(c=>c.kind!=='authorship');
 const r=auditSnapshot(s,deployment);assert.equal(r.consistent,false);
 assert(r.issues.some(x=>x.includes('binding is not supported')));
});
test('an accounting-balanced correction fixture is distinct from actual source authority',()=>{
 const s=copy(),p=s.provenances[0].value,author=s.authors[0];
 const correction=structuredClone(s.cases.find(c=>c.kind==='external-solution'&&c.status==='settled'));
 correction.id='case-'+'7'.repeat(32);correction.kind='attribution';correction.target=p.contribution;
 correction.verdict={apply:true,mode:'integration',retain_initial_points:'300',external_allocations:[{author_id:author.id,points:'100'}]};
 s.cases.push(correction);
 p.version='1';p.corrections=[{case:correction.id,version:'1',reason:'Synthetic test fixture only, not a native correction.'}];
 p.current_initial_points='300';p.external_allocations=[{author_id:author.id,points:'100'}];
 const first=s.walletBalances.find(b=>b.wallet===s.records[0].evidence.wallet).value;
 const second=s.walletBalances.find(b=>b.wallet===author.claimed_wallet).value;
 first.initial_points='300';first.points='400';second.initial_points='400';second.points='400';
 const r=auditSnapshot(s,deployment);assert.equal(r.consistent,true);assert.equal(r.readyForMigration,false);
 assert.equal(r.accounting.externalAllocated,'100');assert.equal(r.accounting.total,'800');
 // Matching aggregate totals do not establish a cutoff or authenticate source state.
});
test('missing an external author wallet balance cannot be hidden by contribution-only wallet enumeration',()=>{
 const s=copy(),a=s.authors[0],wallet='0x'+'9'.repeat(40);
 a.claimed_wallet=wallet;a.claim_history.at(-1).wallet=wallet;
 s.cases.find(c=>c.kind==='authorship').reporter=wallet;
 const r=auditSnapshot(s,deployment);assert.equal(r.consistent,false);
 assert(r.issues.some(x=>x.includes('missing its balance view')));
});
test('budget loss, duplicate impact payout and mixed-time totals fail internal reconciliation',()=>{
 const corruptions=[
  s=>{s.provenances[0].value.current_initial_points='300';},
  s=>{const v=s.impacts.find(x=>x.value.status==='settled'&&x.value.allocations.length).value;v.allocations.push(structuredClone(v.allocations[0]));},
  s=>{s.walletBalances[1].value.total_awarded='700';},
  s=>{s.walletBalances[0].value.impact_points='0';},
  s=>{s.walletBalances[0].value.historical_initial_points='300';},
  s=>{s.records[1].evidence.statement_hash=s.records[0].evidence.statement_hash;},
 ];
 for(const corrupt of corruptions){const s=copy();corrupt(s);const r=auditSnapshot(s,deployment);assert.equal(r.consistent,false,String(corrupt));assert.equal(r.readyForMigration,false);}
});
test('in-flight cases and impact reviews require explicit treatment',()=>{
 for(const change of [s=>{s.cases[0].status='submitted';},s=>{s.impacts.find(x=>x.value.status==='settled').value.status='provisional';}]){
  const s=copy();change(s);const r=auditSnapshot(s,deployment);assert.equal(r.consistent,false);assert(r.issues.some(x=>x.includes('flight')));
 }
});
test('wrong source deployment and old migration shapes cannot pass the draft audit',()=>{
 for(const s of [{...copy(),contract:'0x'+'8'.repeat(40)},{version:2,records:[],total_points:'700'}]){
  const r=auditSnapshot(s,deployment);assert.equal(r.consistent,false);assert.equal(r.readyForMigration,false);
 }
});
