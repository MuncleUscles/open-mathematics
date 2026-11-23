// A rebuildable, dated public read model. No signer, transaction or scoring.
import fs from 'node:fs';
import {clientFor,read,saveJSON} from '../github/runtime.mjs';
import {digest} from '../src/security.mjs';
import {createReadCapture} from '../github/read-capture.mjs';
import {validatedCommunitySnapshot} from '../public/community-snapshot.mjs';

const d=JSON.parse(fs.readFileSync('public/deployment.json'));
if(d.protocolVersion!==3||d.codeHash!==digest(fs.readFileSync('contracts/research.py'))||d.policy!==digest(fs.readFileSync('lean/policy.json')))throw Error('Exact reviewed v3 deployment required');
const client=clientFor(),file='.data/community-capture.json';
fs.mkdirSync('.data',{recursive:true});
const resume=process.argv.includes('--resume'),fresh=process.argv.includes('--fresh');
if(resume&&fresh)throw Error('Choose --resume or --fresh');
let prior=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
if(prior&&!prior.completedAt&&!resume&&!fresh)throw Error('An incomplete read capture exists; honor the provider cooldown, then use --resume');
if(fresh||prior?.completedAt&&!resume)prior=null;
const capture=createReadCapture({identity:{contract:d.contract,chainId:d.chainId,codeHash:d.codeHash,policy:d.policy},prior,read:(method,args)=>read(client,d.contract,method,args),save:async value=>saveJSON(file,value)});
if(capture.state.completedAt){console.log('Read capture already completed at',capture.state.completedAt);process.exit(0);}
const startedAt=capture.state.startedAt,view=capture.view;
// Sequential reads avoid a burst against Studio. Any failure stops publication;
// saveJSON replaces the complete previous snapshot only after every read succeeds.
const affiliations=await view('get_affiliations');
const authors=await view('get_external_authors');
const problem=await view('get_problem');
const ids=await view('list_contributions');
const caseIds=await view('list_cases');
if(!Array.isArray(ids)||!Array.isArray(caseIds)||ids.length>100||caseIds.length>100)throw Error('Pilot snapshot bounds exceeded');
if(5+ids.length*4+caseIds.length>200)throw Error('Snapshot exceeds the 200-read pilot budget; use a paginated indexer');
const records=[],provenances=[],impacts=[],cases=[],walletBalances=[];
for(const id of ids){
 const record=await view('get',[id]);
 if(record.evidence?.id!==id)throw Error('Contribution identity mismatch');
 records.push(record);
 if(record.status==='credited')provenances.push({id,value:await view('get_provenance',[id])});
 impacts.push({id,value:await view('get_impact',[id])});
}
for(const id of caseIds){const record=await view('get_case',[id]);if(record.id!==id)throw Error('Case identity mismatch');cases.push(record);}
for(const wallet of [...new Set(records.map(r=>r.evidence.wallet))])walletBalances.push({wallet,value:await view('get_points',[wallet])});
const capturedReads=Object.entries(capture.state.entries).map(([key,value])=>({call:JSON.parse(key),readAt:value.readAt}));
const collectedAt=capturedReads.map(r=>r.readAt).sort().at(-1);
const snapshot={version:1,contract:d.contract,chainId:d.chainId,codeHash:d.codeHash,policy:d.policy,startedAt,collectedAt,readMode:'Sequential latest-final native views; collected over an interval, not an atomic block snapshot. Historical read model only; never merge or reward authority.',capturedReads,affiliations,authors,problem,records,provenances,impacts,cases,walletBalances};
if(!validatedCommunitySnapshot(snapshot,d))throw Error('Native snapshot failed presentation validation; no public snapshot was written');
saveJSON('public/community-snapshot.json',snapshot);
await capture.complete();
console.log(JSON.stringify({contract:snapshot.contract,collectedAt:snapshot.collectedAt,records:records.length,cases:cases.length,authors:authors.length,readCalls:capturedReads.length}));
