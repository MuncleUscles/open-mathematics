// Reviewed migration snapshot: read authoritative finalized state; never invent credits.
import fs from 'node:fs';import {clientFor,read,saveJSON} from '../github/runtime.mjs';import {GitHub} from '../src/github.mjs';import {canonical,digest} from '../src/security.mjs';import {verifyReceipt} from '../src/studio.mjs';
const file=process.env.SOURCE_DEPLOYMENT_FILE;if(!file)throw Error('Explicit source deployment metadata required');const d=JSON.parse(fs.readFileSync(file));
const c=clientFor(),gh=new GitHub({repository:d.repository,token:process.env.GITHUB_TOKEN}),ids=await read(c,d.contract,'list_contributions',[]);
if(!ids.length||ids.length>100)throw Error('Bounded nonempty finalized ledger required');
const records=[],impacts=[],wallets=new Map(),provenance=[];
for(const id of ids){
 const record=await read(c,d.contract,'get',[id]);if(record.status!=='credited')throw Error('Cannot freeze unsettled record '+id);
 const pr=await gh.pr(Number(record.evidence.pr));if(!pr.merged||pr.head.sha!==record.evidence.head||pr.merge_commit_sha!==record.merge_commit||!await gh.canonicalMerge(d.branch,record.merge_commit))throw Error('Canonical historical merge mismatch');
 const commit=await gh.commit(record.merge_commit);if(commit.parents.length!==2||commit.parents[0].sha!==record.evidence.base||commit.parents[1].sha!==record.evidence.head)throw Error('Historical merge parent mismatch');
 const res=await fetch(`https://raw.githubusercontent.com/${d.repository}/evidence/reports/${id}.json`,{signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error('Historical receipt unavailable');const report=await res.json();
 const tx=report.transactions.merge;const receipt=await c.getTransaction({hash:tx.hash});verifyReceipt(receipt,{hash:tx.hash,address:report.contract,method:'confirm_merge',args:[id,record.evidence.head,record.merge_commit]});
 records.push({id,record});wallets.set(record.evidence.wallet.toLowerCase(),record.evidence.wallet);provenance.push({id,sourceContract:report.contract,mergeTransaction:tx.hash,mergeCommit:record.merge_commit});
 const impact=await read(c,d.contract,'get_impact',[id]);if(!['not-requested','settled'].includes(impact.status))throw Error('Cannot freeze unsettled impact '+id);if(impact.status==='settled')impacts.push({id,record:impact});
}
const balances=[];let total=0,totalImpact=0,reportedTotal;
for(const wallet of [...wallets.values()].sort()){const p=await read(c,d.contract,'get_points',[wallet]);total+=Number(p.points);totalImpact+=Number(p.impact_points);if(reportedTotal!==undefined&&reportedTotal!==p.total_awarded)throw Error('Ledger changed during snapshot');reportedTotal=p.total_awarded;balances.push({wallet,points:p.points,impact_points:p.impact_points});}
if(String(total)!==reportedTotal||total>1000000||total!==records.reduce((n,x)=>n+Number(x.record.credited_points),0)+totalImpact)throw Error('Snapshot conservation check failed');
const snapshot={source_contract:d.contract,source_policy:d.policy,source_code_hash:d.codeHash,canonical_branch:d.branch,canonical_head:await gh.branchHead(d.branch),records,impacts,balances,total_points:String(total),total_impact_points:String(totalImpact)};
fs.writeFileSync('public/ledger-snapshot.json',canonical(snapshot));saveJSON('public/ledger-snapshot-provenance.json',{snapshotHash:digest(canonical(snapshot)),capturedAt:new Date().toISOString(),source:d.contract,records:provenance,rule:'Replacement ledger, never additive across versions. Native finalized state plus actual canonical GitHub parents and merge-confirmation receipts were checked.'});
console.log(JSON.stringify({source:d.contract,records:records.length,points:total,laterPoints:totalImpact,snapshotHash:digest(canonical(snapshot))}));
