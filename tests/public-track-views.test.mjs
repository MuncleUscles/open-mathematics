import test from 'node:test';
import assert from 'node:assert/strict';
import {detailPath,parseDetailPath,graphFromRows,trackStandings} from '../public/open/track-views.mjs';

test('the same local ID in different ledgers has separate evidence routes and graph edges',()=>{
 for(const track of ['p-vs-np','yang-mills','post-quantum-signatures']){
  assert.deepEqual(parseDetailPath(detailPath(track,'pr-1').slice(1)),{track,id:'pr-1'});
 }
 assert.deepEqual(parseDetailPath('/contributions/pr-1'),{track:'p-vs-np',id:'pr-1'});
 for(const path of ['/contributions/other/pr-1','/contributions/yang-mills/%2f','/contributions/x/y/z'])assert.equal(parseDetailPath(path),null);
 const rows=[{id:'pr-1',title:'Local contribution',status:'credited',edges:[{source:'pr-1',target:'prior'}]}];
 assert.deepEqual(graphFromRows(rows).nodes.map(n=>[n.id,n.loaded]),[['pr-1',true],['prior',false]]);
 assert.deepEqual(graphFromRows([]),{nodes:[],edges:[]});
});

function scope(track,amounts) {
 const identity={track},sum=String(amounts.reduce((total,[,n])=>total+BigInt(n),0n));
 const research={identity,count:1,points:{total_awarded:sum,total_initial_points:sum,total_impact_points:'0',total_award_budgets:sum,total_reserved_points:'0',total_returned_points:'0'}};
 const rows=amounts.map(([id,points])=>({github_author_id:id,points,initial_points:points,impact_points:'0',unclaimed_points:'0'}));
 const attribution={identity,state:{research_records:1,total_points:sum,total_initial_points:sum,total_impact_points:'0',total_award_budgets:sum,total_reserved_points:'0',total_returned_points:'0'},accounts:{rows,offset:0,total:rows.length},accountsReconciled:true};
 return {track,research,attribution};
}
test('combined ranks add stable accounts across reconciled ledgers, preserving exact amounts and ties',()=>{
 const large='9007199254740993';
 const scopes=[scope('p-vs-np',[['12',large],['13','4']]),scope('yang-mills',[['13',large]]),scope('post-quantum-signatures',[['12','4'],['14','2']])];
 const {rows,missing}=trackStandings(scopes);
 assert.deepEqual(missing,[]);
 assert.deepEqual(rows.map(r=>[r.id,r.points,r.rank]),[['12',9007199254740997n,1],['13',9007199254740997n,1],['14',2n,3]]);
 scopes[1].research.count=2;
 assert.deepEqual(trackStandings(scopes),{rows:[],missing:['yang-mills']});
 assert.equal(trackStandings([scopes[0]]).rows[0].points,BigInt(large));
 scopes[2].attribution=null;
 assert.deepEqual(trackStandings(scopes).missing,['yang-mills','post-quantum-signatures']);
});
