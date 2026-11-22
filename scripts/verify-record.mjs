import fs from 'node:fs';import assert from 'node:assert/strict';import {recoverMessageAddress} from 'viem';import {digest,message} from '../src/security.mjs';import {verifyReceipt} from '../src/studio.mjs';
const r=JSON.parse(fs.readFileSync('public/studio-evidence.json','utf8'));assert.equal(r.status,'complete');assert.equal(r.codeHash,digest(fs.readFileSync('contracts/research.py','utf8')));
for(const [id,record] of Object.entries(r.records)){
 const c=r.claims[id];assert.equal((await recoverMessageAddress({message:message(c.claim),signature:c.signature})).toLowerCase(),record.evidence.wallet.toLowerCase());assert.equal(digest(c.claim),record.evidence.claim_digest);
 for(const method of ['adjudicate','finalize']){const t=r.transactions[id+'-'+method];verifyReceipt(t.receipt,{hash:t.hash,address:r.contract,method,id,independent:method==='adjudicate'});}
 assert(record.verdict.reason.length>20);
}
assert.equal(r.records['demo-renaming'].status,'credited');assert.equal(r.records['demo-tautology'].status,'rejected');assert.equal(r.points.total_awarded,r.records['demo-renaming'].credited_points);
console.log('Verified archived Studio source hash, signatures, finalized consensus receipts and point accounting.');
