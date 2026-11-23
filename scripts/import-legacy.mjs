// Administrative bootstrap for the explicitly frozen v1 record, never contributor keys.
import fs from 'node:fs';
import {clientFor,finalized,read,saveJSON} from '../github/runtime.mjs';
import {digest,canonical} from '../src/security.mjs';
import {verifyReceipt} from '../src/studio.mjs';
const file=process.env.DEPLOYMENT_FILE||'public/deployment.json',d=JSON.parse(fs.readFileSync(file));
if(d.protocolVersion!==2||d.codeHash!==digest(fs.readFileSync('contracts/research.py')))throw Error('Exact reviewed v2 deployment required');
const key=process.env.VERIFIER_SIGNING_KEY||fs.readFileSync(`${process.env.OPERATOR_KEY_DIR}/verifier.key`,'utf8').trim(),c=clientFor(key);
const id='pr-1-ee4678fc76d9-5c22de45baf0',source='0x8981C4fc15024752702e0851e4e063adebc40C7C';
const snapshot=fs.readFileSync('public/legacy-record.json','utf8');
const snapshotHash='7fd204e013c81962c19776134d123df21669e647baed96b46497a337fa1b9584';
if(digest(snapshot)!==snapshotHash)throw Error('Frozen migration snapshot mismatch');
const original=await read(c,source,'get',[id]);
if(canonical(original)!==snapshot)throw Error('Finalized source state differs from frozen snapshot');
const archived=JSON.parse(fs.readFileSync('public/live-example.json'));
const mergeReceipt=await c.getTransaction({hash:archived.transactions.merge.hash});
verifyReceipt(mergeReceipt,{hash:archived.transactions.merge.hash,address:source,method:'confirm_merge',args:[id,original.evidence.head,original.merge_commit]});
const args=[snapshot];
if(!d.importTx){d.importTx=await c.writeContract({address:d.contract,functionName:'import_legacy',args,leaderOnly:false});saveJSON(file,d);}
const receipt=await finalized(c,d.importTx,{address:d.contract,method:'import_legacy',args});
const record=await read(c,d.contract,'get',[id]);
const points=await read(c,d.contract,'get_points',[record.evidence.wallet]);
if(record.status!=='credited'||record.credited_points!=='400'||points.initial_points!=='400'||points.impact_points!=='0')throw Error('Migration point invariant failed');
saveJSON('public/migration-evidence.json',{mode:'live-finalized-verifier-attested-migration',trust:'Existing trusted verifier checked finalized v1 state and the original merge-confirmation receipt; contract permits only the exact frozen snapshot.',snapshotHash,contract:d.contract,source,id,record,points,transaction:{hash:d.importTx,receipt},sourceMergeReceipt:mergeReceipt,abandonedAttempt:{contract:'0x9A2f4a3b5875bcf5762ac9E371c16e5537c45726',transaction:'0xbfe3cbbb051e839e4966256cd4a80cbf802678271380f1a28dd48e1d95a0ba83',outcome:'Studio cross-contract read exceeded 600-second leader execution limit; never activated.'},ledgerRule:'V2 replaces v1; never add both balances.'});
console.log('Finalized migration:',d.contract,'initial',points.initial_points,'later',points.impact_points);
