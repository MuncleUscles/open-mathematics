import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deploymentMetadata} from '../scripts/deployment-metadata.mjs';
import {validatedCommunitySnapshot} from '../public/community-snapshot.mjs';
const full=JSON.parse(fs.readFileSync(new URL('../public/deployment.json',import.meta.url)));
const snapshot=JSON.parse(fs.readFileSync(new URL('../public/community-snapshot.json',import.meta.url)));

test('browser metadata excludes bulky deployment payloads without changing identity or the full record',()=>{
 const input=structuredClone(full),original=structuredClone(full);
 input.futurePayload={code:'x'.repeat(100000)};
 const metadata=deploymentMetadata(Object.freeze(input));
 assert.deepEqual(Object.keys(metadata),['protocolVersion','contract','chainId','codeHash','policy']);
 for(const key of Object.keys(metadata))assert.equal(metadata[key],full[key]);
 assert.ok(Buffer.byteLength(JSON.stringify(metadata,null,2)+'\n')<512);
 assert.equal(Object.hasOwn(metadata,'receipt'),false);assert.equal(Object.hasOwn(metadata,'futurePayload'),false);
 const {futurePayload,...unchanged}=input;assert.deepEqual(unchanged,original);assert.equal(futurePayload.code.length,100000);
});
test('generation refuses missing or malformed binding fields rather than publishing partial metadata',()=>{
 for(const field of ['protocolVersion','contract','chainId','codeHash','policy']){
  const missing={...full};delete missing[field];assert.throws(()=>deploymentMetadata(missing),/binding metadata/,field);
 }
 for(const input of [null,[],false])assert.throws(()=>deploymentMetadata(input),/requires an object/);
 for(const [field,value] of [['protocolVersion','3'],['protocolVersion',0],['chainId','61999'],['chainId',-1],['chainId',Infinity],['contract','0x123'],['codeHash','invalid'],['policy','b'.repeat(63)]])assert.throws(()=>deploymentMetadata({...full,[field]:value}),/binding metadata/,field);
});
test('compact metadata preserves actual snapshot binding and refuses every identity mismatch',()=>{
 const metadata=deploymentMetadata(full);
 assert.equal(validatedCommunitySnapshot(snapshot,metadata),snapshot);
 for(const [field,value] of [['protocolVersion',2],['contract','0x'+'0'.repeat(40)],['chainId',1],['codeHash','0'.repeat(64)],['policy','0'.repeat(64)]]){
  assert.equal(validatedCommunitySnapshot(snapshot,{...metadata,[field]:value}),null,field);
 }
});
