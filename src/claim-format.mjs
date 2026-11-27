import {isAddress} from 'viem';

export const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const message=c=>`Open Mathematics PR claim v${c.version}\n${canonical(c)}`;
export function validateClaim(c,{domain,chainId,contract,policy,branch,problem='p-vs-np',now=Date.now()}){
  if(!c||!([1,2].includes(c.version))||c.domain!==domain||c.chainId!==chainId||c.problem!==problem)throw Error('Wrong signing domain, chain or problem');
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(c.repository)||!Number.isSafeInteger(c.pr)||c.pr<1||!/[0-9a-f]{40}/.test(c.head)||c.head.length!==40||!isAddress(c.wallet))throw Error('Malformed PR identity');
  if(contract||c.version===2){
    const fields=['version','domain','chainId','problem','repository','pr','head','base','branch','contract','policy','submission_path','submission_hash','wallet','nonce','expires'];
    if(c.version!==2||Object.keys(c).length!==fields.length||fields.some(k=>!Object.hasOwn(c,k)))throw Error('Exact v2 claim fields required');
    if(!isAddress(c.contract)||c.contract.toLowerCase()!==contract?.toLowerCase()||c.policy!==policy||c.branch!==branch)throw Error('Wrong contract, policy or canonical branch');
    if(!/^[a-f0-9]{40}$/.test(c.base)||!/^[a-f0-9]{64}$/.test(c.policy)||!/^[a-f0-9]{64}$/.test(c.submission_hash)||!/^research\/submissions\/[a-z0-9][a-z0-9-]{0,63}\.json$/.test(c.submission_path)||/^0x0{40}$/i.test(c.wallet))throw Error('Malformed submission binding');
  }
  if(!/^[0-9a-f]{32}$/.test(c.nonce)||!Number.isSafeInteger(c.expires)||c.expires<=now||c.expires>now+600000)throw Error('Expired or invalid challenge');
}
