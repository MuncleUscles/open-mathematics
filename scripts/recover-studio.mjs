import fs from 'node:fs';
import {clientFor,finalized,read,saveJSON} from '../github/runtime.mjs';
const p='public/studio-evidence.json',r=JSON.parse(fs.readFileSync(p,'utf8')),client=clientFor();
for(const [stage,t] of Object.entries(r.transactions))if(!t.receipt){t.receipt=await finalized(client,t.hash);delete t.status;saveJSON(p,r);}
for(const id of ['demo-renaming','demo-tautology'])r.records[id]=await read(client,r.contract,'get',[id]);
r.points=await read(client,r.contract,'get_points',[r.authority]);
if(r.records['demo-renaming'].status==='credited'&&r.records['demo-tautology'].status==='rejected'){r.status='complete';r.completedAt=new Date().toISOString();delete r.error;}saveJSON(p,r);console.log(r.status,r.points);
