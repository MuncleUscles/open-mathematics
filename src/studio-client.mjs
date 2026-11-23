import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';

// A reviewed Studio pilot ceiling, in native base units (18 decimals). This is
// a transaction fee deposit, unrelated to the contribution-points ledger.
export const MAX_STUDIO_FEE_DEPOSIT=250_000_000_000_000_000n;
export const STUDIO_CONSENSUS_ROTATIONS=5;
export const STUDIO_FEE_ESTIMATE=Object.freeze({
  leaderTimeunitsAllocation:100n,validatorTimeunitsAllocation:200n,
  appealRounds:0n,rotations:Object.freeze([BigInt(STUDIO_CONSENSUS_ROTATIONS)]),
});

export function studioEnvelopeFailure(error){
  // SDK 2.0 preserves this outer hash in a controlled error prefix. It is a
  // diagnostic hint, never a native receipt or permission to broadcast again.
  const match=typeof error?.message==='string'&&error.message.match(/^Transaction reverted: EVM tx (0x[a-fA-F0-9]{64})(?:\. ([\s\S]*))?$/);
  return match?{kind:'studio-envelope-reverted',hash:match[1].toLowerCase(),reason:(match[2]||'No reason supplied').slice(0,300),verified:false}:null;
}

export function requireStudioFeeQuote(quote){
  const d=quote?.distribution,keys=['leaderTimeunitsAllocation','validatorTimeunitsAllocation','appealRounds',
    'executionBudgetPerRound','executionConsumed','totalMessageFees','maxPriceGenPerTimeUnit',
    'storageFeeMaxGasPrice','receiptFeeMaxGasPrice'];
  if(typeof quote?.policy?.enabled!=='boolean'||typeof quote.feeValue!=='bigint'||quote.feeValue<0n||
    quote.feeValue>MAX_STUDIO_FEE_DEPOSIT||(quote.policy.enabled&&quote.feeValue===0n)||
    !d||keys.some(k=>typeof d[k]!=='bigint'||d[k]<0n)||d.leaderTimeunitsAllocation!==100n||
    d.validatorTimeunitsAllocation!==200n||d.appealRounds!==0n||d.executionConsumed!==0n||d.totalMessageFees!==0n||
    !Array.isArray(d.rotations)||d.rotations.length!==1||d.rotations[0]!==BigInt(STUDIO_CONSENSUS_ROTATIONS)||
    (quote.messageAllocations!==undefined&&(!Array.isArray(quote.messageAllocations)||quote.messageAllocations.length!==0)))
    throw Object.assign(Error('Studio fee quote is invalid or exceeds the 0.25 GEN pilot deposit cap; no transaction was signed'),{code:'STUDIO_FEE_QUOTE_REJECTED'});
  return {distribution:d,feeValue:quote.feeValue};
}

export function withStudioFees(client){
  if(client.chain?.id!==61999||client.chain.isStudio!==true)throw Error('The reviewed Studio fee policy requires chain 61999');
  for(const method of ['writeContract','deployContract']){
    const send=client[method].bind(client);
    client[method]=async args=>{
      if(!args||Object.hasOwn(args,'fees')||Object.hasOwn(args,'consensusMaxRotations')||(args.value!==undefined&&BigInt(args.value)!==0n))
        throw Error('Studio pilot writes use the reviewed fee quote and no transferred value');
      // This reads prices only. Never simulate a model judgment to obtain fees.
      const quote=await client.estimateTransactionFees({...STUDIO_FEE_ESTIMATE,rotations:[...STUDIO_FEE_ESTIMATE.rotations]});
      return send({...args,consensusMaxRotations:STUDIO_CONSENSUS_ROTATIONS,fees:requireStudioFeeQuote(quote)});
    };
  }
  return client;
}

export const createStudioClient=({account}={})=>withStudioFees(createClient({chain:studionet,...(account?{account}:{})}));
