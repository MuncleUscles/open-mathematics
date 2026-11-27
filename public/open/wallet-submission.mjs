import {abi,createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {recoverMessageAddress} from 'viem';
import {withStudioFees} from '../../src/studio-client.mjs';
import {canonical,message,validateClaim} from '../../src/claim-format.mjs';
import tracks from './wallet-tracks.json' with {type:'json'};

const hash=/^0x[a-f0-9]{64}$/;
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const native=(client,address,functionName,args=[])=>client.readContract({address,functionName,args,transactionHashVariant:'latest-final'});
const field=(data,key)=>data instanceof Map?data.get(key):data?.[key];

async function github(path,raw=false){
 const response=await fetch('https://api.github.com/repos/MuncleUscles/'+path,{cache:'no-store',
  headers:{Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('GitHub could not read the public claim or report ('+response.status+').');
 return response.json();
}

export async function prepareWalletSubmission(link,prior,{client,readGitHub=github}){
 const match=link.match(/^https:\/\/github\.com\/MuncleUscles\/(p-vs-np|yang-mills|post-quantum-signatures)\/pull\/([1-9][0-9]*)#issuecomment-([1-9][0-9]*)$/i);
 if(!match||!Number.isSafeInteger(Number(match[2]))||!Number.isSafeInteger(Number(match[3])))throw Error('Paste the permalink to the original signed comment on a research PR.');
 if(prior&&!hash.test(prior))throw Error('Enter the full hash of the undetermined review.');
 const track=match[1].toLowerCase(),repository='MuncleUscles/'+track,pr=Number(match[2]),commentId=Number(match[3]),deployment=tracks[track];
 const [comment,pull,config,descriptor]=await Promise.all([readGitHub(track+'/issues/comments/'+commentId),readGitHub(track+'/pulls/'+pr),native(client,deployment.intake,'get_config'),readGitHub(track+'/contents/.open-math/open.json?ref=main',true)]);
 if(field(config,'version')!=='wallet-intake-v1'||field(config,'repository')!==repository||field(config,'problem')!==track||
    field(config,'policy')!==deployment.policy||!eq(field(config,'ledger'),deployment.ledger))throw Error('Studio intake binding does not match this track.');
 const envelope=comment.body?.match(/^Open-Mathematics-Claim: ([a-f0-9]{64})\n`{3}json\n([\s\S]+)\n`{3}\s*$/);
 if(!envelope||comment.id!==commentId||!Number.isFinite(Date.parse(comment.created_at))||comment.created_at!==comment.updated_at||comment.issue_url!=='https://api.github.com/repos/'+repository+'/issues/'+pr||
    !comment.user?.id||comment.user.id!==pull.user?.id)throw Error('Use the original, unedited signed comment from the PR author.');
 const signed=JSON.parse(envelope[2]);
 if(!signed||Object.keys(signed).length!==2||!signed.claim||!signed.signature)throw Error('Use the exact signed claim envelope.');
 const {claim,signature}=signed,serialized=canonical(claim);
 const {protocol_commit,...baseClaim}=claim;
 validateClaim({...baseClaim,version:2},{domain:'https://muncleuscles.github.io',chainId:61999,
  problem:track,branch:'research',contract:deployment.ledger,policy:deployment.policy,now:Date.parse(comment.created_at)});
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized));
 const digest=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
 if(digest!==envelope[1]||descriptor.repository!==repository||descriptor.protocol?.commit!==protocol_commit||claim.version!==4||claim.pr!==pr||claim.repository!==repository||
    pull.base?.repo?.full_name!==repository||pull.base.ref!==claim.branch||pull.state!=='open'||pull.merged!==false||
    claim.head!==pull.head?.sha||claim.base!==pull.base.sha||
    !eq(await recoverMessageAddress({message:message(claim),signature}),claim.wallet))throw Error('This signed claim does not match the current PR, track or wallet.');
 const address=deployment.intake,stateArgs=[claim.wallet,digest,pr,commentId,prior],args=[digest,pr,commentId,...(prior?[prior]:[])];
 const exists=await native(client,address,'has_request',stateArgs);
 if(typeof exists!=='boolean')throw Error('Invalid finalized request state');
 if(prior&&!exists){
  const id='pr-'+pr+'-'+claim.head.slice(0,12)+'-'+digest.slice(0,12);
  const [record,report,receipt]=await Promise.all([native(client,deployment.ledger,'get',[id]),
   readGitHub(track+'/contents/reports/'+id+'.json?ref=evidence',true),client.getTransaction({hash:prior})]);
  const round=Number(field(record,'round')),entry=report.transactions?.['adjudicate-r'+round];
  const call=abi.calldata.decode(Uint8Array.from(receipt?.data?.calldata?.raw||[]));
  const configLedger=await native(client,deployment.ledger,'get_config');
  const params=field(call,'args');
  const statuses=[receipt?.status,receipt?.status_name,receipt?.statusName].filter(value=>value!==undefined);
  if(!['submitted','challenged'].includes(field(record,'status'))||
     Number(field(record,'adjudication_started_round'))!==round||Number(field(record,'adjudication_finished_round'))===round||
     report.id!==id||report.commentId!==commentId||report.commentCreatedAt!==comment.created_at||
     !eq(report.contract,deployment.ledger)||report.chainId!==61999||report.repository!==repository||report.pr!==pr||
     report.head!==claim.head||report.base!==claim.base||canonical(report.claim)!==canonical(signed)||
     !statuses.length||statuses.some(value=>value!==7&&value!=='FINALIZED')||
     entry?.hash!==prior||!eq(receipt.hash,prior)||!eq(receipt.to_address,deployment.ledger)||!eq(receipt.from_address,field(configLedger,'executor'))||
     receipt.leader_only!==false||receipt.lifecycle?.state!=='finalized'||receipt.lifecycle?.outcome!=='undetermined'||
     receipt.result!==2||(receipt.result_name??receipt.resultName)!=='MAJORITY_DISAGREE'||
     (field(call,'method')??field(call,''))!=='adjudicate'||params?.length!==2||params[0]!==id||
     (params[1]!==round&&params[1]!==BigInt(round))||(receipt.resultName!==undefined&&receipt.resultName!=='MAJORITY_DISAGREE'))
   throw Error('Only the latest finalized undetermined merit review is eligible for a retry.');
 }
 return {track,address,wallet:claim.wallet,pr,commentId,method:prior?'request_retry':'submit',args,stateArgs,exists};
}

export function initWalletSubmission(){
 const el=id=>document.getElementById(id),form=el('wallet-submit-form'),button=el('wallet-send'),status=el('wallet-status');
 const client=createClient({chain:studionet});let proposal,revision=0,busy=false;
 const values=()=>[el('wallet-comment').value.trim(),el('wallet-prior').value.trim()];
 form.oninput=()=>{revision++;proposal=null;button.hidden=true;status.textContent='';el('wallet-receipt').hidden=true;};
 form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const current=++revision;button.hidden=true;proposal=null;el('wallet-receipt').hidden=true;status.textContent='Checking your signed claim and Studio contract…';
  try{
   const result=await prepareWalletSubmission(...values(),{client});
   if(current!==revision)return;
   proposal=result;
   status.textContent=result.exists?'Your wallet request is already finalized. The worker can process it.':
    result.track+' · PR #'+result.pr+' · '+result.method+' from '+result.wallet+' to '+result.address;
   button.hidden=result.exists;
  }catch(error){if(current===revision)status.textContent=error.shortMessage||error.message;}
 };
 button.onclick=async()=>{
  if(busy||!proposal)return;
  const current=revision,selected=proposal;
  busy=true;button.disabled=true;
  try{
   const wallet=window.ethereum;
   if(!wallet)throw Error('Open this page in a browser with a wallet, or use the pnp command in the contributor guide.');
   const [account]=await wallet.request({method:'eth_requestAccounts'});
   if(!eq(account,selected.wallet))throw Error('Select the wallet that signed this claim: '+selected.wallet);
   const chainId='0x'+studionet.id.toString(16);
   if(BigInt(await wallet.request({method:'eth_chainId'}))!==BigInt(studionet.id)){
    try{await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId}]});}
    catch(error){if(Number(error.code)!==4902)throw error;
     await wallet.request({method:'wallet_addEthereumChain',params:[{chainId,chainName:'GenLayer Studio',nativeCurrency:studionet.nativeCurrency,rpcUrls:studionet.rpcUrls.default.http}]});}
   }
   const fresh=await prepareWalletSubmission(...values(),{client});
   if(current!==revision||location.hash!=='#/submit'||!eq(account,fresh.wallet)||fresh.address!==selected.address||
      fresh.method!==selected.method||canonical(fresh.args)!==canonical(selected.args))throw Error('Review the request again before signing.');
   if(fresh.exists){status.textContent='Your wallet request is already finalized.';button.hidden=true;return;}
   const signer=withStudioFees(createClient({chain:studionet,account,provider:wallet}));
   const tx=await signer.writeContract({address:fresh.address,functionName:fresh.method,args:fresh.args,leaderOnly:false});
   if(current===revision){
    button.hidden=true;
    const link=el('wallet-receipt');link.href='https://explorer-studio.genlayer.com/tx/'+tx;link.hidden=false;
    status.textContent='Sent. Waiting for Studio finality…';
   }
   await client.waitForTransactionReceipt({hash:tx,status:'FINALIZED',retries:120});
   if(await native(client,fresh.address,'has_request',fresh.stateArgs)!==true)throw Error('Studio has not recorded this request. Inspect the transaction before sending again.');
   if(current===revision)status.textContent='Your wallet request is finalized. The worker will pick it up. To wake it sooner, comment Open-Mathematics-Process: '+fresh.commentId+' on the original PR.';
  }catch(error){if(current===revision)status.textContent=error.shortMessage||error.message;}
  finally{busy=false;button.disabled=false;}
 };
}
