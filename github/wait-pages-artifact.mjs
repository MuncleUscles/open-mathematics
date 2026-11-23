// Read-only visibility gate for the exact artifact just uploaded by this run.
// deploy-pages still performs its own artifact-service and deployment checks.
import {pathToFileURL} from 'node:url';
import {GitHub} from '../src/github.mjs';

const positive=value=>typeof value==='number'?Number.isSafeInteger(value)&&value>0:
 typeof value==='string'&&/^[1-9][0-9]*$/.test(value)&&Number.isSafeInteger(Number(value));
const need=(ok,message)=>{if(!ok)throw Error('Pages artifact visibility: '+message);};
const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const ATTEMPTS=12,INTERVAL=5000;

export async function waitPagesArtifact({github,artifactId,runId,repositoryId,headSha,now=Date.now,sleep=pause}){
 need(positive(artifactId)&&positive(runId)&&positive(repositoryId)&&typeof headSha==='string'&&/^[a-f0-9]{40}$/.test(headSha),
  'exact uploaded artifact, workflow, repository and head identifiers required');
 const expectedId=Number(artifactId),expectedRun=Number(runId),expectedRepository=Number(repositoryId);
 let visible=false;
 for(let attempt=0;attempt<ATTEMPTS;attempt++){
  // REST listing requires actions:read. Do not follow download URLs or use an
  // artifact from another run. HTTP/auth/rate-limit failures stop immediately.
  const page=await github.request(`/actions/runs/${expectedRun}/artifacts?name=github-pages&per_page=100`,{maxResponseBytes:262144});
  need(Number.isSafeInteger(page?.total_count)&&page.total_count>=0&&page.total_count<=100&&
   Array.isArray(page.artifacts)&&page.artifacts.length===page.total_count,'complete bounded artifact listing required');
  const matches=page.artifacts.filter(artifact=>artifact?.name==='github-pages'||artifact?.id===expectedId);
  need(matches.length<=1,'ambiguous or conflicting Pages artifacts');
  if(matches.length){
   const artifact=matches[0],run=artifact.workflow_run;
   need(artifact.id===expectedId&&artifact.name==='github-pages'&&artifact.expired===false&&
    Number.isSafeInteger(artifact.size_in_bytes)&&artifact.size_in_bytes>0&&
    Number.isFinite(Date.parse(artifact.expires_at))&&Date.parse(artifact.expires_at)>now()&&
    run?.id===expectedRun&&run.repository_id===expectedRepository&&run.head_repository_id===expectedRepository&&
    run.head_branch==='main'&&run.head_sha===headSha,'uploaded artifact identity, scope or expiry mismatch');
   // A second observation avoids racing the upload/list transition. REST
   // visibility does not replace deploy-pages' independent Twirp lookup.
   if(visible)return {artifactId:expectedId,name:'github-pages',runId:expectedRun,headSha,observations:2,readOnly:true};
   visible=true;
  }else visible=false;
  if(attempt+1<ATTEMPTS)await sleep(INTERVAL);
 }
 throw Error('Pages artifact visibility: exact uploaded artifact did not become stably visible; deployment was not attempted');
}

export async function run(environment=process.env){
 need(environment.GITHUB_ACTIONS==='true'&&environment.GITHUB_REF==='refs/heads/main', 'reviewed main workflow required');
 need(typeof environment.GITHUB_TOKEN==='string'&&environment.GITHUB_TOKEN.length>0,'Actions read credential required');
 const github=new GitHub({repository:environment.GITHUB_REPOSITORY,token:environment.GITHUB_TOKEN});
 const result=await waitPagesArtifact({github,artifactId:environment.PAGES_ARTIFACT_ID,runId:environment.GITHUB_RUN_ID,
  repositoryId:environment.GITHUB_REPOSITORY_ID,headSha:environment.GITHUB_SHA});
 console.log(JSON.stringify(result));return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(error=>{
 const token=process.env.GITHUB_TOKEN;
 console.error(token?String(error.message).split(token).join('[redacted]'):String(error.message));process.exitCode=1;
});
