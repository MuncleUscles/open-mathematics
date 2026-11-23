// Lossless ABI evidence for reviewed read-only captures. Not an import format.
import {abi} from 'genlayer-js';
import {CalldataAddress} from 'genlayer-js/types';
export const TYPE_LIMITS=Object.freeze({maxDepth:32,maxNodes:100000,maxItems:10000,maxBytes:2*1024*1024});
const fail=message=>{throw Error(message);};

// Bound lengths, recursion and UTF-8 before the SDK decoder allocates arrays.
function preflight(bytes,limits){
 let offset=0,nodes=0;
 const utf8=new TextDecoder('utf-8',{fatal:true});
 function number(){let value=0n;for(let shift=0;shift<560;shift+=7){if(offset>=bytes.length)fail('Truncated ABI integer');const byte=bytes[offset++];value|=BigInt(byte&127)<<BigInt(shift);if(byte<128)return value;}fail('ABI integer exceeds bound');}
 function take(size,text=false){if(size>BigInt(bytes.length-offset))fail('Truncated ABI value');const n=Number(size),value=bytes.subarray(offset,offset+n);offset+=n;if(text)return utf8.decode(value);}
 function walk(depth){
  if(depth>limits.maxDepth||++nodes>limits.maxNodes)fail('ABI structural budget exceeded');
  const header=number(),type=Number(header&7n),length=header>>3n;
  if(type===0){if(header===0n||header===8n||header===16n)return;if(header===24n){take(20n);return;}fail('Unknown ABI special value');}
  if(type===1||type===2)return;
  if(type===3||type===4){take(length,type===4);return;}
  if(type!==5&&type!==6)fail('Unknown ABI type');
  if(length>BigInt(limits.maxItems)||length>BigInt(limits.maxNodes-nodes))fail('ABI collection bound exceeded');
  const keys=new Set();
  for(let i=0n;i<length;i++){
   if(type===6){const key=take(number(),true);if(keys.has(key))fail('Duplicate ABI map key');keys.add(key);}
   walk(depth+1);
  }
 }
 walk(0);if(offset!==bytes.length)fail('Trailing ABI bytes');return nodes;
}

export function taggedValue(value){
 if(value===null)return ['null'];
 if(typeof value==='boolean')return ['bool',value];
 if(typeof value==='bigint')return ['int',value.toString()];
 if(typeof value==='string')return ['string',value];
 if(value instanceof Uint8Array)return ['bytes',Buffer.from(value).toString('hex')];
 if(value instanceof CalldataAddress)return ['address',Buffer.from(value.bytes).toString('hex')];
 if(Array.isArray(value))return ['list',value.map(taggedValue)];
 if(value instanceof Map)return ['map',[...value].map(([key,item])=>{if(typeof key!=='string')fail('Non-string ABI map key');return [key,taggedValue(item)];})];
 fail('Unsupported decoded ABI type');
}
export function decodeRaw(raw,options={}){
 const limits={...TYPE_LIMITS,...options};
 if(typeof raw!=='string'||raw.length<4||raw.length>2+limits.maxBytes*2||!/^0x(?:[0-9a-fA-F]{2})+$/.test(raw))fail('Invalid or oversized raw ABI hex');
 const bytes=Buffer.from(raw.slice(2),'hex'),nodes=preflight(bytes,limits);
 const value=abi.calldata.decode(bytes),encoded=Buffer.from(abi.calldata.encode(value));
 if(!encoded.equals(bytes))fail('ABI round-trip mismatch');
 return {value,tagged:taggedValue(value),rawABI:raw,nodes};
}
export function encodedArgs(args,options={}){
 // Caller constructs only reviewed, bounded argument lists, never source scripts.
 return decodeRaw('0x'+Buffer.from(abi.calldata.encode(args)).toString('hex'),options);
}
export function boundedJSON(value,options={}){
 const limits={...TYPE_LIMITS,...options};let nodes=0,estimatedBytes=0;
 function walk(x,depth){
  if(depth>limits.maxDepth||++nodes>limits.maxNodes)fail('JSON structural budget exceeded');
  if(x===null||typeof x==='boolean'){estimatedBytes+=5;return;}
  if(typeof x==='number'){if(!Number.isFinite(x)||(Number.isInteger(x)&&!Number.isSafeInteger(x)))fail('Unsafe JSON number');estimatedBytes+=32;return;}
  if(typeof x==='string'){estimatedBytes+=Buffer.byteLength(x);if(estimatedBytes>limits.maxBytes)fail('JSON byte budget exceeded');return;}
  if(Array.isArray(x)){if(x.length>limits.maxItems)fail('JSON collection bound exceeded');for(const item of x)walk(item,depth+1);return;}
  if(!x||Object.getPrototypeOf(x)!==Object.prototype)fail('Unexpected JSON response type');
  const entries=Object.entries(x);if(entries.length>limits.maxItems)fail('JSON collection bound exceeded');
  for(const [key,item]of entries){walk(key,depth+1);walk(item,depth+1);}
 }
 walk(value,0);const text=JSON.stringify(value);if(Buffer.byteLength(text)>limits.maxBytes)fail('JSON byte budget exceeded');return text;
}
