// Submit from a contributor's Studio wallet. The GitHub comment binds its author to the signed claim.
import {GitHub} from '../src/github.mjs';
import {walletIntake,walletRequest} from '../src/wallet-intake.mjs';
import {clientFor,read,finalized} from '../github/runtime.mjs';
import {exactOpenReport,readOpenClaimComment,requireClaimAuthor} from '../github/open-select.mjs';
import {readEvidenceFile} from '../github/evidence-file.mjs';
import {resolveContributorGitHubToken} from './contributor-local.mjs';
import {loadLocalSigner} from './problem-agent.mjs';
import {createStudioClient} from '../src/studio-client.mjs';

// The GenLayer CLI infers scalar types. Only offer a shell command when every
// argument round-trips with its native type, including unusual numeric digests.
export function cliSubmission(address,request){
 if(request.method!=='submit')return null;
 const [claim,pr,comment]=request.args;
 if(!/^0x[0-9a-fA-F]{40}$/.test(address)||!/^[0-9a-f]{64}$/.test(claim)||!Number.isNaN(Number(claim))||
    ![pr,comment].every(value=>Number.isSafeInteger(value)&&value>0))return null;
 return `genlayer write ${address} submit --args ${claim} ${pr} ${comment}`;
}

export async function sendResearchRequest(args,{problem,signerRoots}){
 const usage='pnp submit COMMENT_ID [--send] | pnp retry COMMENT_ID FAILED_REVIEW_HASH [--send]';
 const send=args.at(-1)==='--send',[command,comment,prior]=send?args.slice(0,-1):args;
 if(!['submit','retry'].includes(command)||args.length!==(command==='submit'?2:3)+Number(send)||
    !/^[1-9][0-9]*$/.test(comment)||!Number.isSafeInteger(Number(comment))||
    (command==='retry'&&!/^0x[a-f0-9]{64}$/.test(prior)))throw Error(usage);
 const d=problem.deployment,github=new GitHub({repository:d.repository,token:resolveContributorGitHubToken()});
 const commentId=Number(comment),original=await github.request('/issues/comments/'+commentId);
 const candidate=await readOpenClaimComment({comment:original,commentId,problem});
 const {claim,id}=candidate,pr=await github.pr(claim.pr);
 requireClaimAuthor(candidate,original,pr,d);
 if(pr.state!=='open'||pr.merged!==false||pr.base.ref!==d.branch||pr.head.sha!==claim.head||
    pr.base.sha!==claim.base||await github.branchHead(d.branch)!==claim.base)throw Error('The signed PR is no longer current');
 const client=clientFor(),intake=walletIntake(problem,client),previous=prior||'';
 const alreadySent=await intake.has(candidate,previous);
 const request=walletRequest(candidate,previous);
 const info={network:'GenLayer Studio',chainId:61999,contract:intake.contract,sender:claim.wallet,...request};
 const notify='Open-Mathematics-Process: '+commentId;
 if(alreadySent){console.log(JSON.stringify({...info,status:'already finalized',optionalWakeComment:notify},null,2));return;}
 if(prior){
  const record=await read(client,d.contract,'get',[id]),round=Number(record?.round);
  const report=(await readEvidenceFile(github,`reports/${id}.json`))?.data;
  if(!report||!exactOpenReport(candidate,report,d)||!['submitted','challenged'].includes(record?.status)||
     Number(record.adjudication_started_round)!==round||Number(record.adjudication_finished_round)===round||
     report.transactions?.[`adjudicate-r${round}`]?.hash!==prior||!await intake.canRetry(candidate,prior,round))
   throw Error('Retry requires the latest finalized undetermined review of this open claim and round');
 }
 if(!send){console.log(JSON.stringify({...info,studio:'https://studio.genlayer.com/contracts?import-contract='+intake.contract,genlayerCli:cliSubmission(intake.contract,request),next:'Repeat with --send to use GenLayerJS. For the optional CLI command, select studionet and confirm the active account matches sender.'},null,2));return;}
 const account=loadLocalSigner(process.env.CONTRIBUTOR_KEY_FILE,signerRoots);
 if(account.address.toLowerCase()!==claim.wallet.toLowerCase())throw Error('The transaction sender must be the wallet that signed this claim');
 const signer=createStudioClient({account});
 if(await signer.getChainId()!==61999)throw Error('GenLayer Studio testnet (Studionet) chain ID 61999 required');
 const hash=await signer.writeContract({address:intake.contract,functionName:request.method,args:request.args,leaderOnly:false});
 console.error('Broadcast Studio request '+hash+'. Keep this hash if confirmation is interrupted.');
 const receipt=await finalized(client,hash,{address:intake.contract,...request});
 if(receipt.from_address?.toLowerCase()!==claim.wallet.toLowerCase()||!await intake.has(candidate,previous))
  throw Error('Finalized sender or intake state mismatch for '+hash);
 console.log(JSON.stringify({...info,hash,status:'finalized',optionalWakeComment:notify},null,2));
}
