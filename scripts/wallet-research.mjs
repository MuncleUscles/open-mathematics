// Submit from a contributor's Studio wallet. The GitHub comment binds its author to the signed claim.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {GitHub} from '../src/github.mjs';
import {loadOpenProblem,readProblemFile,parseProblemJSON} from '../src/open-research.mjs';
import {walletIntake,walletRequest} from '../src/wallet-intake.mjs';
import {clientFor,read,finalized} from '../github/runtime.mjs';
import {exactOpenReport,readOpenClaimComment,requireClaimAuthor} from '../github/open-select.mjs';
import {readEvidenceFile} from '../github/evidence-file.mjs';
import {resolveContributorGitHubToken} from './contributor-local.mjs';
import {loadLocalSigner} from './problem-agent.mjs';
import {createStudioClient} from '../src/studio-client.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const usage='om-wallet submit COMMENT_ID [--send] | om-wallet retry COMMENT_ID FAILED_REVIEW_HASH [--send]';
export async function run(args=process.argv.slice(2)){
 if(!args.length||args[0]==='help'){console.log(usage);return;}
 const send=args.at(-1)==='--send',[command,comment,prior]=send?args.slice(0,-1):args;
 if(!['submit','retry'].includes(command)||args.length!==(command==='submit'?2:3)+Number(send)||
    !/^[1-9][0-9]*$/.test(comment)||!Number.isSafeInteger(Number(comment))||
    (command==='retry'&&!/^0x[a-f0-9]{64}$/.test(prior)))throw Error(usage);
 const problem=loadOpenProblem(process.env.OPEN_MATH_PROBLEM_DIR);
 const descriptor=parseProblemJSON(readProblemFile(problem.root,'.open-math/wallet-intake.json'));
 const git=(...rest)=>execFileSync('git',rest,{cwd:root,encoding:'utf8'}).trim();
 if(git('rev-parse','HEAD')!==descriptor.clientCommit||git('status','--porcelain','--untracked-files=normal'))throw Error('Use the clean wallet tool release pinned in the track configuration');
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
 if(!send){console.log(JSON.stringify({...info,studio:'https://studio.genlayer.com/contracts?import-contract='+intake.contract,next:'Send these exact arguments from the displayed wallet in Studio, or repeat with --send.'},null,2));return;}
 const account=loadLocalSigner(process.env.CONTRIBUTOR_KEY_FILE,[root,problem.root,fs.realpathSync(process.cwd())]);
 if(account.address.toLowerCase()!==claim.wallet.toLowerCase())throw Error('The transaction sender must be the wallet that signed this claim');
 const signer=createStudioClient({account});
 if(await signer.getChainId()!==61999)throw Error('Stable Studio chain 61999 required');
 const hash=await signer.writeContract({address:intake.contract,functionName:request.method,args:request.args,leaderOnly:false});
 console.error('Broadcast Studio request '+hash+'. Keep this hash if confirmation is interrupted.');
 const receipt=await finalized(client,hash,{address:intake.contract,...request});
 if(receipt.from_address?.toLowerCase()!==claim.wallet.toLowerCase()||!await intake.has(candidate,previous))
  throw Error('Finalized sender or intake state mismatch for '+hash);
 console.log(JSON.stringify({...info,hash,status:'finalized',optionalWakeComment:notify},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e.message);process.exitCode=1;});
