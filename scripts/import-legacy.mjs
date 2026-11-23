// Administrative bootstrap for the explicitly frozen v1 record, never contributor keys.
import fs from 'node:fs';import {clientFor,finalized,read,saveJSON} from '../github/runtime.mjs';import {digest} from '../src/security.mjs';
const file=process.env.DEPLOYMENT_FILE||'public/deployment.json',d=JSON.parse(fs.readFileSync(file));
if(d.protocolVersion!==2||d.codeHash!==digest(fs.readFileSync('contracts/research.py')))throw Error('Exact reviewed v2 deployment required');
const key=process.env.EXECUTOR_SIGNING_KEY||fs.readFileSync(`${process.env.OPERATOR_KEY_DIR}/executor.key`,'utf8').trim(),c=clientFor(key);
if(!d.importTx){d.importTx=await c.writeContract({address:d.contract,functionName:'import_legacy',args:[],leaderOnly:false});saveJSON(file,d);}
const receipt=await finalized(c,d.importTx,{address:d.contract,method:'import_legacy',args:[]});
const id='pr-1-ee4678fc76d9-5c22de45baf0',record=await read(c,d.contract,'get',[id]);
const points=await read(c,d.contract,'get_points',[record.evidence.wallet]);
if(record.status!=='credited'||record.credited_points!=='400'||points.initial_points!=='400'||points.impact_points!=='0')throw Error('Migration point invariant failed');
saveJSON('public/migration-evidence.json',{mode:'live-finalized-migration',contract:d.contract,source:record.migration.source_contract,id,record,points,transaction:{hash:d.importTx,receipt},ledgerRule:'V2 replaces v1; never add both balances.'});
console.log('Finalized migration:',d.contract,'initial',points.initial_points,'later',points.impact_points);
