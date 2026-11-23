import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readContributionInspection,matchingSnapshotContribution,contributionInspectionMarkup} from '../public/contribution-inspection.mjs';
import {provenanceMarkup} from '../public/research-community.mjs';

function fixture(){
 const deployment=JSON.parse(fs.readFileSync(new URL('../public/deployment.json',import.meta.url)));
 const snapshot=JSON.parse(fs.readFileSync(new URL('../public/community-snapshot.json',import.meta.url)));
 const record=snapshot.records.find(r=>r.status==='credited');
 const report={id:record.evidence.id,status:record.status,pr:record.evidence.pr,head:record.evidence.head,contract:deployment.contract,claim:{claim:{wallet:record.evidence.wallet},signature:'signed'},record:{...structuredClone(record),credited_points:'98765432109876543210'},points:{initial_points:'98765432109876543210',impact_points:'98765432109876543210'},impact:{status:'settled',paid_points:'98765432109876543210',allocations:[]},updatedAt:'2026-11-01T00:00:00.000Z'};
 const markup=view=>contributionInspectionMarkup({view,report,address:deployment.contract,reportURL:'https://example.org/evidence',runURL:'https://github.com/MuncleUscles/open-mathematics/actions/runs/1'});
 return {deployment,snapshot,record,report,markup};
}
test('unavailable primary native record uses only an exact deployment/id/head/wallet snapshot match',async()=>{
 const f=fixture();let reads=0,loads=0;
 const view=await readContributionInspection({read:async()=>{reads++;throw Error('rate limited');},address:f.deployment.contract,report:f.report,deployment:f.deployment,loadSnapshot:async()=>{loads++;return f.snapshot;}});
 assert.equal(reads,1);assert.equal(loads,1);assert.equal(view.source,'snapshot');assert.equal(view.record,f.record);
 assert.equal(view.provenance,f.snapshot.provenances.find(p=>p.id===f.report.id).value);
 assert.equal(view.points,f.snapshot.walletBalances.find(p=>p.wallet.toLowerCase()===f.record.evidence.wallet.toLowerCase()).value);
 assert.equal(view.impact,f.snapshot.impacts.find(p=>p.id===f.report.id).value);
 const html=f.markup(view);
 assert.match(html,/Published snapshot ·/);assert.ok(html.includes(f.snapshot.collectedAt));assert.match(html,/historical, not current/);assert.match(html,/Published provenance snapshot/);assert.ok(!html.includes('Fresh finalized'));assert.ok(!html.includes('Finalized native read'));assert.ok(!html.includes('98765432109876543210'));
 for(const changes of [{id:'unknown-record'},{head:'0'.repeat(40)},{claim:{claim:{wallet:'0x'+'9'.repeat(40)}}}])assert.equal(matchingSnapshotContribution(f.snapshot,f.deployment,{...f.report,...changes}),null);
 assert.equal(matchingSnapshotContribution({...f.snapshot,contract:'0x'+'9'.repeat(40)},f.deployment,f.report),null);
});
test('successful primary read with failed subviews does not load or label archived/snapshot values as native',async()=>{
 const f=fixture();let loads=0;
 const view=await readContributionInspection({read:async(_address,method)=>{if(method==='get')return f.record;throw Error('subview unavailable');},address:f.deployment.contract,report:f.report,deployment:f.deployment,loadSnapshot:async()=>{loads++;return f.snapshot;}});
 assert.equal(loads,0);assert.equal(view.source,'native');assert.equal(view.record,f.record);assert.equal(view.points,null);assert.equal(view.impact,null);assert.equal(view.provenance,null);assert.deepEqual(view.unavailable,['impact','points','provenance']);
 const html=f.markup(view);assert.match(html,/Finalized contribution record · some subviews unavailable/);assert.match(html,/Native provenance is unavailable/);assert.match(html,/Later impact view unavailable/);assert.ok(!html.includes('98765432109876543210'));assert.ok(!html.includes('Published snapshot'));
});
test('successful subviews remain native even when another subview fails',async()=>{
 const f=fixture(),provenance=f.snapshot.provenances.find(p=>p.id===f.report.id).value;
 const view=await readContributionInspection({read:async(_address,method)=>{if(method==='get')return f.record;if(method==='get_provenance')return provenance;throw Error('unavailable');},address:f.deployment.contract,report:f.report,deployment:f.deployment,loadSnapshot:async()=>assert.fail('No snapshot when primary succeeds')});
 assert.equal(view.provenance,provenance);assert.deepEqual(view.unavailable,['impact','points']);assert.match(f.markup(view),/Finalized native read/);assert.match(f.markup(view),/Unavailable native subviews: impact, points/);
});
test('invalid or missing matching snapshot leaves the report explicitly historical',async()=>{
 const f=fixture();
 const view=await readContributionInspection({read:async()=>{throw Error('unavailable');},address:f.deployment.contract,report:f.report,deployment:f.deployment,loadSnapshot:async()=>({...f.snapshot,policy:'0'.repeat(64)})});
 assert.equal(view.source,'archive');assert.equal(view.record,f.report.record);assert.match(f.markup(view),/Archived public report · 2026-11-01T00:00:00.000Z/);assert.match(f.markup(view),/historical; native read unavailable/);assert.ok(!f.markup(view).includes('Fresh finalized'));
});
test('terminal registration rejection skips nonexistent native/snapshot reads and shows only the safe failure witness',async()=>{
 const f=fixture(),hash='0x'+'4'.repeat(64),safe='<img src=x onerror=alert(1)> statement already reserved or credited';
 const report={...f.report,status:'rejected',record:undefined,registrationRejection:{hash,reason:safe},error:'PRIVATE GENERIC EXECUTION PAYLOAD',transactions:{register:{hash,failedReceipt:{hash}}}};
 const view=await readContributionInspection({read:async()=>assert.fail('No nonexistent record RPC'),address:f.deployment.contract,report,deployment:f.deployment,loadSnapshot:async()=>assert.fail('No snapshot on terminal registration rejection')});
 assert.equal(view.source,'registration-rejection');assert.equal(view.points,null);
 const html=contributionInspectionMarkup({view,report,address:f.deployment.contract});
 assert.match(html,/Registration rejected · PR/);assert.match(html,/GenLayer registration/);assert.ok(html.includes(hash));assert.match(html,/Merit review not reached/);assert.match(html,/No contribution record or merit verdict was created/);assert.match(html,/0 points/);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('PRIVATE GENERIC EXECUTION PAYLOAD'));assert.ok(!html.includes('98765432109876543210'));assert.ok(!html.includes('class="done">GenLayer merit review'));assert.ok(!html.includes('class="done">IC points'));
});
test('historical provenance labels are escaped and do not imply a fresh identity or current credit read',()=>{
 const html=provenanceMarkup({evidence:{research_direction:'shared'}},{mode:'formalization',sources:[],current_initial_points:'300',corrections:[]},{native:true,historical:true,readLabel:'Published provenance snapshot <img src=x>'});
 assert.match(html,/Published provenance snapshot &lt;img/);assert.match(html,/Initial credit in these historical views/);assert.ok(!html.includes('<img'));assert.ok(!html.includes('Finalized native read'));assert.ok(!html.includes('Current initial credit'));
});
