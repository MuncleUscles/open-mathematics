import test from 'node:test';
import assert from 'node:assert/strict';
import {quotedProvider,readAppeal} from '../public/open/appeals.mjs';

const txId='0x'+'f'.repeat(64),contract='0x'+'d'.repeat(40);
const contracts=new Map([[contract,'Yang–Mills']]);
function client(lifecycle={},quote={}) {
  return {getTransaction:async()=>({hash:txId,to_address:contract,lifecycle:{outcome:'undetermined'}}),
    request:async({method})=>method==='gen_getTransactionLifecycle'
      ? {storedStatus:'Undetermined',storedStatusCode:6,decisionActive:true,decisionId:3,...lifecycle}
      : {decisionId:3,bond:'200',funding:'10',...quote}};
}
test('the appeal page quotes the current Studio decision and closes finalized or expired windows',async()=>{
  const result=await readAppeal(client(),txId,contracts);
  assert.equal(result.charge,210n);
  assert.equal(result.decisionId,3n);
  assert.equal((await readAppeal(client({storedStatusCode:7}),txId,contracts)).charge,undefined);
  assert.equal((await readAppeal(client({resolutionAction:'Finalize'}),txId,contracts)).charge,undefined);
  await assert.rejects(readAppeal(client({},{decisionId:4}),txId,contracts),/changed/);
  await assert.rejects(readAppeal(client(),txId,new Map()),/research contracts/);
});
test('wallet signing only forwards the displayed transaction, decision and exact charge',async()=>{
  const requests=[],sender=quotedProvider({request:async req=>requests.push(req)},txId,{decisionId:3n,charge:210n});
  const send=(id,decision,value)=>sender.request({method:'eth_sendTransaction',params:[{data:'0x01234567'+id.slice(2)+decision.toString(16).padStart(64,'0'),value}]});
  await send(txId,3,'0xd2');
  for(const args of [[txId,4,'0xd2'],[txId,3,'0xd1'],['0x'+'b'.repeat(64),3,'0xd2']]) await assert.rejects(send(...args),/quote|charge/);
  assert.equal(requests.length,1);
});
