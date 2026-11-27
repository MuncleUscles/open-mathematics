import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {formatEther} from 'viem';
import {getProblemTrack} from './problem-directory.mjs';

const hashPattern = /^0x[0-9a-f]{64}$/i;
const api = () => createClient({chain: studionet});
const byId = id => document.getElementById(id);
const rpc = (client, method, txId) => client.request({method, params: [{txId}]});

export async function readAppeal(client, txId, contracts) {
  if (!hashPattern.test(txId)) throw Error('Enter the full Studio transaction hash.');
  const [receipt, lifecycle] = await Promise.all([
    client.getTransaction({hash: txId}), rpc(client, 'gen_getTransactionLifecycle', txId),
  ]);
  const track = contracts.get(receipt?.to_address?.toLowerCase());
  if (!track || receipt.hash?.toLowerCase() !== txId.toLowerCase()) throw Error('Choose a transaction from one of the three research contracts.');
  if (typeof lifecycle?.decisionActive !== 'boolean' || !Number.isInteger(lifecycle.storedStatusCode))
    throw Error('Studio has not returned a usable decision yet.');
  const result = {track, status: lifecycle.storedStatus, final: lifecycle.storedStatusCode === 7, outcome: receipt.lifecycle?.outcome};
  if (result.final || !lifecycle.decisionActive || lifecycle.resolutionAction === 'Finalize' ||
      ![5,6,11,12].includes(lifecycle.storedStatusCode)) return result;
  const quote = await rpc(client, 'gen_estimateLatestAppealCharge', txId);
  if (quote.decisionId == null || lifecycle.decisionId == null || BigInt(quote.decisionId) !== BigInt(lifecycle.decisionId))
    throw Error('The decision just changed. Check the new round.');
  const bond = BigInt(quote.bond), funding = BigInt(quote.funding);
  if (bond < 0n || funding < 0n) throw Error('Studio returned an invalid charge.');
  return {...result, decisionId: BigInt(quote.decisionId), charge: bond + funding};
}

// The SDK binds the call to a decision. Also bind the wallet prompt to what the
// visitor actually saw, even if the round changed during wallet connection.
export function quotedProvider(provider, txId, quote) {
  return {request: async request => {
    if (request.method === 'eth_sendTransaction') {
      const tx = request.params?.[0];
      if (tx?.data?.slice(10,74).toLowerCase() !== txId.slice(2).toLowerCase() ||
          BigInt('0x' + tx.data.slice(74,138)) !== quote.decisionId ||
          BigInt(tx.value || 0) !== quote.charge) throw Error('The quoted appeal changed. Review the new decision and charge.');
    }
    return provider.request(request);
  }};
}

export function showAppeal(hash, primaryContract) {
  const form = byId('appeal-lookup'), input = byId('appeal-hash');
  const status = byId('appeal-status'), button = byId('appeal-submit'), explorer = byId('appeal-explorer');
  form.onsubmit = event => { event.preventDefault(); location.hash = '/appeals/' + input.value.trim(); };
  const sequence = ++showAppeal.sequence;
  if (showAppeal.timer) clearTimeout(showAppeal.timer);
  const current = () => sequence === showAppeal.sequence && location.hash === '#/appeals/' + hash;
  input.value = hash || '';
  button.hidden = true;
  explorer.hidden = true;
  status.textContent = '';
  if (!hash) return;
  if (!hashPattern.test(hash)){ status.textContent = 'Enter the full Studio transaction hash.'; return; }
  explorer.href = 'https://explorer-studio.genlayer.com/tx/' + hash;
  explorer.hidden = false;
  const contracts = new Map([
    [primaryContract?.toLowerCase(), 'P vs NP'],
    ...['yang-mills','post-quantum-signatures'].map(id => {
      const t = getProblemTrack(id); return [t.contract.toLowerCase(), t.title];
    }),
  ]);
  contracts.delete(undefined);
  const client = api();
  let submitting = false;
  async function watch() {
    if (!current() || submitting) return;
    try {
      const quote = await readAppeal(client, hash, contracts);
      if (!current() || submitting) return;
      const open = quote.charge !== undefined;
      status.textContent = quote.track + ' · ' + quote.status + '. ' + (open
        ? 'The appeal charge is ' + formatEther(quote.charge) + ' Studio GEN, including the bond and review funding.'
        : quote.final ? (quote.outcome === 'undetermined' ? 'The decision was undetermined. The PR author can request a retry on the original claim.' : 'The appeal window has closed.')
        : 'Watching Studio for an open appeal window…');
      button.hidden = !open;
      if (open) button.onclick = async () => {
        if (submitting) return;
        submitting = true; button.disabled = true; clearTimeout(showAppeal.timer);
        try {
          const wallet = window.ethereum;
          if (!wallet) throw Error('Use a browser wallet or the agent CLI instructions below.');
          const [account] = await wallet.request({method:'eth_requestAccounts'});
          if (BigInt(await wallet.request({method:'eth_chainId'})) !== BigInt(studionet.id)) {
            try { await wallet.request({method:'wallet_switchEthereumChain', params:[{chainId:'0x'+studionet.id.toString(16)}]}); }
            catch(error) {
              if (Number(error.code)!==4902) throw error;
              await wallet.request({method:'wallet_addEthereumChain',params:[{chainId:'0x'+studionet.id.toString(16),chainName:'GenLayer Studio',nativeCurrency:studionet.nativeCurrency,rpcUrls:studionet.rpcUrls.default.http}]});
            }
          }
          const fresh = await readAppeal(client, hash, contracts);
          if (!current() || fresh.decisionId !== quote.decisionId || fresh.charge !== quote.charge)
            throw Error('The appeal decision or charge has changed. Check the transaction again.');
          const signer = createClient({chain:studionet,account,provider:quotedProvider(wallet,hash,quote)});
          await signer.appealTransaction({txId:hash,value:quote.charge});
          if (current()) { status.textContent = 'Appeal submitted. Follow the new round in Studio Explorer.'; button.hidden = true; }
        } catch(error) {
          if (current()) {status.textContent = error.shortMessage || error.message || 'The wallet could not submit the appeal.'; button.hidden = true;}
        } finally {
          submitting = false; button.disabled = false;
          if(current()) showAppeal.timer = setTimeout(watch, 5000);
        }
      };
      if (quote.final) return;
    } catch(error) {
      if (!current() || submitting) return;
      status.textContent = error.shortMessage || error.message || 'The Studio status is unavailable.';
      button.hidden = true;
    }
    if (current()) showAppeal.timer = setTimeout(watch, 5000);
  }
  status.textContent = 'Checking the Studio transaction…';
  void watch();
}
showAppeal.sequence = 0;
