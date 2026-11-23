import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccount,abi} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {parseTransaction,decodeFunctionData,fromRlp,keccak256} from 'viem';
import {createStudioClient,withStudioFees,MAX_STUDIO_FEE_DEPOSIT,studioEnvelopeFailure} from '../src/studio-client.mjs';

const address='0x'+'2'.repeat(40),hash='0x'+'a'.repeat(64);
const policy={enabled:true,policy:{genPerTimeUnit:'1',storageUnitPrice:'250000000',receiptGasPrice:'250000000',messageFeeParamsBudgetFloor:'78852000000000',timeUnitOverlayBps:'1500'}};
function quote(){return {policy:{enabled:true},feeValue:1000n,distribution:{leaderTimeunitsAllocation:100n,validatorTimeunitsAllocation:200n,appealRounds:0n,executionBudgetPerRound:500n,executionConsumed:0n,totalMessageFees:0n,rotations:[5n],maxPriceGenPerTimeUnit:2n,storageFeeMaxGasPrice:300000000n,receiptFeeMaxGasPrice:300000000n}};}
function harness(q=quote()){
 const estimates=[],sends=[];
 const client=withStudioFees({chain:{id:61999,isStudio:true},estimateTransactionFees:async options=>{estimates.push(options);return q;},writeContract:async args=>{sends.push({method:'write',args});return hash;},deployContract:async args=>{sends.push({method:'deploy',args});return hash;}});
 return {client,estimates,sends};
}

test('every write and deploy receives an unchanged live quote with bounded funding and no simulation',async()=>{
 const q=quote(),h=harness(q),write={address,functionName:'adjudicate',args:['id',0],leaderOnly:false};
 assert.equal(await h.client.writeContract(write),hash);
 assert.equal(await h.client.deployContract({code:'trusted',args:['config'],leaderOnly:false}),hash);
 assert.equal(h.estimates.length,2);assert.equal(h.sends.length,2);
 for(const s of h.sends){assert.equal(s.args.fees.distribution,q.distribution);assert.equal(s.args.fees.feeValue,q.feeValue);assert.equal(s.args.leaderOnly,false);}
 assert.deepEqual(h.sends[0].args,{...write,consensusMaxRotations:5,fees:{distribution:q.distribution,feeValue:q.feeValue}});
 assert.deepEqual(h.estimates[0],{leaderTimeunitsAllocation:100n,validatorTimeunitsAllocation:200n,appealRounds:0n,rotations:[5n]});
});

test('failed, oversized, malformed and caller-supplied fee quotes cannot reach a signer',async()=>{
 for(const change of [q=>q.feeValue=MAX_STUDIO_FEE_DEPOSIT+1n,q=>q.feeValue=0n,q=>q.feeValue='1000',q=>q.distribution.rotations=[4n],q=>q.distribution.appealRounds=1n,q=>q.messageAllocations=[{}],q=>q.distribution.executionConsumed=1n]){
  const q=quote();change(q);const h=harness(q);
  await assert.rejects(h.client.writeContract({address,functionName:'register',args:['e']}),{code:'STUDIO_FEE_QUOTE_REJECTED'});
  assert.equal(h.sends.length,0);
 }
 const h=harness();h.client.estimateTransactionFees=async()=>{throw Error('RPC unavailable');};
 await assert.rejects(h.client.deployContract({code:'trusted'}),/RPC unavailable/);assert.equal(h.sends.length,0);
 const explicit=harness();
 for(const options of [{fees:quote()},{value:1n},{consensusMaxRotations:3},{consensusMaxRotations:5}])await assert.rejects(explicit.client.writeContract({...options,address}),/reviewed fee quote/);
 assert.equal(explicit.estimates.length,0);assert.equal(explicit.sends.length,0);
 assert.throws(()=>withStudioFees({chain:{id:61997,isStudio:true}}),/61999/);
});

test('the pinned SDK sends the quoted fee tuple and exact native call, and retains a reverted envelope hash',async t=>{
 const account=createAccount('0x'+'1'.repeat(64)),requests=[],sent=[];
 let reverted=false,lastHash;
 t.mock.method(globalThis,'fetch',async(_url,{body})=>{
  const request=JSON.parse(body);requests.push(request.method);let result;
  switch(request.method){
   case 'sim_getFeeConfig':result=policy;break;
   case 'eth_getTransactionCount':result='0x0';break;
   case 'eth_estimateGas':result='0x7a120';break;
   case 'eth_gasPrice':result='0x0';break;
   case 'eth_blockNumber':result='0x1';break;
   case 'eth_sendRawTransaction':{
    const raw=request.params[0];sent.push(parseTransaction(raw));lastHash=keccak256(raw);result=lastHash;break;
   }
   case 'eth_getTransactionReceipt':result={transactionHash:lastHash,transactionIndex:'0x0',blockHash:hash,blockNumber:'0x1',from:account.address,to:studionet.consensusMainContract.address,cumulativeGasUsed:'0x1',gasUsed:'0x1',effectiveGasPrice:'0x0',contractAddress:null,logs:[],logsBloom:'0x'+'00'.repeat(256),status:reverted?'0x0':'0x1',type:'0x0',...(reverted?{revertReason:'FeesDistributionMissing'}:{})};break;
   default:throw Error('Unexpected RPC '+request.method);
  }
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
 });
 const client=createStudioClient({account}),evidence='exact original evidence';
 const result=await client.writeContract({address,functionName:'register',args:[evidence],leaderOnly:false});
 assert.equal(result,lastHash);assert.equal(sent.length,1);assert.equal(sent[0].chainId,61999);
 assert(sent[0].value>0n&&sent[0].value<=MAX_STUDIO_FEE_DEPOSIT);
 const call=decodeFunctionData({abi:studionet.consensusMainContract.abi,data:sent[0].data});
 assert.equal(call.functionName,'addTransaction');
 const params=call.args[0];
 assert.equal(params.recipient.toLowerCase(),address);assert.equal(params.feesDistribution.leaderTimeunitsAllocation,100n);
 assert.deepEqual(params.feesDistribution.rotations,[5n]);assert.equal(params.userValue,0n);assert.equal(params.maxRotations,5n);assert.equal(params.maxRotations,params.feesDistribution.rotations[0]);
 const data=fromRlp(params.txCalldata,'bytes'),native=abi.calldata.decode(data[0]);
 assert.equal(native.get('method')??native.get(''),'register');assert.deepEqual(native.get('args'),[evidence]);
 assert.deepEqual([...data[1]],[0]);
 assert(!requests.some(m=>['gen_call','sim_call'].includes(m)));
 await client.deployContract({code:'trusted deployment source',args:['config'],leaderOnly:false});
 assert.equal(sent.length,2);assert(sent[1].value>0n&&sent[1].value<=MAX_STUDIO_FEE_DEPOSIT);
 const deployment=decodeFunctionData({abi:studionet.consensusMainContract.abi,data:sent[1].data}).args[0];
 assert.equal(deployment.recipient,'0x'+'0'.repeat(40));
 assert.deepEqual(deployment.feesDistribution,params.feesDistribution);assert.equal(deployment.maxRotations,5n);assert.equal(deployment.maxRotations,deployment.feesDistribution.rotations[0]);
 const deploymentData=fromRlp(deployment.txCalldata,'bytes');
 assert.equal(new TextDecoder().decode(deploymentData[0]),'trusted deployment source');
 assert.deepEqual(abi.calldata.decode(deploymentData[1]).get('args'),['config']);
 reverted=true;
 await assert.rejects(client.writeContract({address,functionName:'register',args:[evidence],leaderOnly:false}),error=>{
  assert.match(error.message,/Transaction reverted: EVM tx 0x[a-f0-9]{64}\. FeesDistributionMissing/);
  assert.deepEqual(studioEnvelopeFailure(error),{kind:'studio-envelope-reverted',hash:lastHash,reason:'FeesDistributionMissing',verified:false});return true;
 });
 assert.equal(sent.length,3,'each explicit test call sends once; the SDK must not retry a reverted envelope');
});
