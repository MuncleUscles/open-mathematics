// Bind successful native deployment receipts to exact source and constructor bytes.
import {abi} from 'genlayer-js';
import {sha256} from './problem.mjs';
import {verifyFinalizedOutcome} from './studio.mjs';

export function validateNativeDeploymentReceipt(receipt,{hash,sender,codeHash,config}){
 verifyFinalizedOutcome(receipt);
 if(typeof receipt.hash!=='string'||receipt.hash.toLowerCase()!==hash.toLowerCase()||
  typeof receipt.from_address!=='string'||receipt.from_address.toLowerCase()!==sender.toLowerCase())
  throw Error('Deployment receipt binding mismatch');
 // A matching constructor view does not prove which program was deployed.
 // The finalized receipt must contain the exact reviewed source and call bytes.
 const encoded=receipt.data?.contract_code;
 if(typeof encoded!=='string'||encoded.length===0||encoded.length>2*1024*1024||
  !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
  throw Error('Canonical deployment source bytes required');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded||sha256(bytes)!==codeHash)throw Error('Deployed source differs from reviewed code');
 const calldata=receipt.data?.calldata,raw=calldata?.raw;
 if(!Array.isArray(raw)||raw.length===0||raw.length>65536||raw.some(value=>!Number.isInteger(value)||value<0||value>255))
  throw Error('Exact constructor calldata bytes required');
 const actual=Buffer.from(raw),expected=Buffer.from(abi.calldata.encode({args:[JSON.stringify(config)]}));
 if(!actual.equals(expected)||
  (Object.hasOwn(calldata,'base64')&&calldata.base64!==actual.toString('base64')))
  throw Error('Deployment constructor differs from reviewed serialization');
 const address=receipt.data?.contract_address;
 if(address!==undefined&&receipt.to_address!==undefined&&
  (typeof address!=='string'||typeof receipt.to_address!=='string'||address.toLowerCase()!==receipt.to_address.toLowerCase()))
  throw Error('Deployment contract address mismatch');
 return receipt;
}
