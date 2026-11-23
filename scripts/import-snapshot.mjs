// Bootstrap one reviewed replacement ledger. No contributor keys or caller-selected awards.
import fs from 'node:fs';import {createAccount} from 'genlayer-js';
import {clientFor,read,saveJSON} from '../github/runtime.mjs';
import {digest,canonical} from '../src/security.mjs';import {verifyReceipt} from '../src/studio.mjs';
import {journaledTransaction} from '../github/journaled-transaction.mjs';
const file=process.env.DEPLOYMENT_FILE||'public/deployment.json',d=JSON.parse(fs.readFileSync(file));
if(d.protocolVersion!==3||d.codeHash!==digest(fs.readFileSync('contracts/research.py')))throw Error('Exact reviewed v3 deployment required');
const key=process.env.VERIFIER_SIGNING_KEY||fs.readFileSync(`${process.env.OPERATOR_KEY_DIR}/verifier.key`,'utf8').trim(),c=clientFor(key),sender=createAccount(key).address;
if(sender.toLowerCase()!==d.verifier.toLowerCase())throw Error('Enrolled verifier required');
const snapshot=fs.readFileSync('public/ledger-snapshot.json','utf8'),frozen=JSON.parse(snapshot),origin=JSON.parse(fs.readFileSync('public/ledger-snapshot-provenance.json'));
if(digest(snapshot)!==origin.snapshotHash||origin.source!==frozen.source_contract)throw Error('Exact frozen snapshot required');
const sourceReceipts=[];
for(const {id,record} of frozen.records){
 if(canonical(await read(c,frozen.source_contract,'get',[id]))!==canonical(record))throw Error('Source record changed since freeze');
 const p=origin.records.find(x=>x.id===id),receipt=await c.getTransaction({hash:p.mergeTransaction});
 verifyReceipt(receipt,{hash:p.mergeTransaction,address:p.sourceContract,method:'confirm_merge',args:[id,record.evidence.head,record.merge_commit]});sourceReceipts.push({id,hash:p.mergeTransaction,receipt});
}
for(const balance of frozen.balances){const p=await read(c,frozen.source_contract,'get_points',[balance.wallet]);if(p.points!==balance.points||p.impact_points!==balance.impact_points||p.total_awarded!==frozen.total_points)throw Error('Source balances changed since freeze');}
const journalFile='.data/v3-import-journal.json',journal=fs.existsSync(journalFile)?JSON.parse(fs.readFileSync(journalFile)):{transactions:{}};
const tx=await journaledTransaction({client:c,address:d.contract,sender,method:'import_snapshot',args:[snapshot],independent:false,transactions:journal.transactions,stage:'import',save:async()=>saveJSON(journalFile,journal)});
const balances=[];
for(const expected of frozen.balances){const p=await read(c,d.contract,'get_points',[expected.wallet]);if(p.points!==expected.points||p.impact_points!==expected.impact_points||p.total_awarded!==frozen.total_points)throw Error('Imported balance mismatch');balances.push({wallet:expected.wallet,...p});}
d.importTx=tx.hash;saveJSON(file,d);
saveJSON('public/v3-migration-evidence.json',{mode:'live-finalized-verifier-attested-migration',source:frozen.source_contract,contract:d.contract,snapshotHash:origin.snapshotHash,transaction:tx,sourceReceipts,balances,ledgerRule:'V3 replaces v2; never add balances across deployments. Historical native integers are restored from decimal RPC strings; immutable evidence digests, awards and merge history are preserved.'});
console.log('Finalized migration:',d.contract,'total',frozen.total_points,'later',frozen.total_impact_points);
