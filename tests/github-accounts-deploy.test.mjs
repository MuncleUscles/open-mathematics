import test from 'node:test';
import assert from 'node:assert/strict';
import {abi} from 'genlayer-js';
import {sha256} from '../src/open-research.mjs';
import {validateGitHubAccountsDeploymentReceipt} from '../scripts/manage-github-accounts.mjs';

const address=letter=>'0x'+letter.repeat(40),hash='0x'+'a'.repeat(64),sender=address('b');
const config={version:1,source_contract:address('c'),source_config_hash:'d'.repeat(64),
 problem:'p-vs-np',repository:'fixture/research',policy:'e'.repeat(64)};
const source='# reviewed native source\n';
const expected={hash,sender,codeHash:sha256(source),config};
const call=args=>{const bytes=Buffer.from(abi.calldata.encode({args}));return {raw:[...bytes],base64:bytes.toString('base64'),readable:'non-authoritative display'};};
// Shape of an actual saved Studio v0.6 deployment receipt: base64 source and
// decoded calldata object. Fixture carries no live transaction or signing key.
function receipt(){return {hash,from_address:sender,to_address:address('f'),statusName:'FINALIZED',status:7,
 result:1,result_name:'MAJORITY_AGREE',txExecutionResult:1,txExecutionResultName:'FINISHED_WITH_RETURN',leader_only:false,
 lifecycle:{state:'finalized',outcome:'accepted'},consensus_data:{leader_receipt:[{execution_result:'SUCCESS'}]},
 data:{contract_address:address('f'),contract_code:Buffer.from(source).toString('base64'),calldata:call([JSON.stringify(config)])}};}

test('deployment receipt binds exact source and constructor bytes before descriptor publication',()=>{
 const r=receipt();assert.equal(validateGitHubAccountsDeploymentReceipt(r,expected),r);
 r.data.calldata.readable='a different human-readable summary';
 assert.equal(validateGitHubAccountsDeploymentReceipt(r,expected),r);
});

test('matching constructor views cannot certify substituted or noncanonical deployed source',()=>{
 for(const value of [undefined,'',Buffer.from(source+'# substituted\n').toString('base64'),
  receipt().data.contract_code+'\n',receipt().data.contract_code.replace(/=+$/,'')]){
  const r=receipt();r.data.contract_code=value;
  assert.throws(()=>validateGitHubAccountsDeploymentReceipt(r,expected),/source/);
 }
});

test('constructor serialization, argument type and the complete ABI envelope must match',()=>{
 const reversed=Object.fromEntries(Object.entries(config).reverse());
 for(const args of [[config],[JSON.stringify(reversed)],[JSON.stringify(config,null,2)],[],[JSON.stringify(config),'extra']]){
  const r=receipt();r.data.calldata=call(args);
  assert.throws(()=>validateGitHubAccountsDeploymentReceipt(r,expected),/constructor/);
 }
 const r=receipt();r.data.calldata.raw=[...abi.calldata.encode({args:[JSON.stringify(config)],method:'some_method'})];
 r.data.calldata.base64=Buffer.from(r.data.calldata.raw).toString('base64');
 assert.throws(()=>validateGitHubAccountsDeploymentReceipt(r,expected),/constructor/);
});

test('conflicting receipt bytes, identity, address or consensus outcome fail closed',()=>{
 const changes=[
  r=>{r.data.calldata.base64='AAAA';},r=>{r.data.calldata.raw[0]=256;},
  r=>{delete r.data.calldata.raw;},r=>{r.hash='0x'+'1'.repeat(64);},
  r=>{r.from_address=address('1');},r=>{r.data.contract_address=address('1');},
  r=>{r.result_name='MAJORITY_DISAGREE';},r=>{r.lifecycle.outcome='undetermined';},
 ];
 for(const change of changes){const r=receipt();change(r);assert.throws(()=>validateGitHubAccountsDeploymentReceipt(r,expected));}
});
