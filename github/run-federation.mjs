// Only the pinned main-branch workflow can access the dedicated pilot roles.
// User inputs are bounded data, never interpolated shell or executable checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run} from '../scripts/manage-federation.mjs';
import {GitHub} from '../src/github.mjs';
import {loadOpenProblem} from '../src/open-research.mjs';
import {readEvidenceFile} from './evidence-file.mjs';
import {clean} from './runtime.mjs';
import {federationJournalFile} from './federation-worker.mjs';
const problem=loadOpenProblem(process.env.OPEN_MATH_PROBLEM_DIR);
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!==problem.deployment.repository)throw Error('Reviewed main-only federation workflow required');
const operation=process.env.FEDERATION_OPERATION,payload=process.env.FEDERATION_PAYLOAD;
if(!['register','attribution','reconcile-impact','verify-author','settle-author'].includes(operation)||typeof payload!=='string'||Buffer.byteLength(payload)>16384)throw Error('Bounded known federation request required');
const github=new GitHub({repository:problem.deployment.repository,token:process.env.GITHUB_TOKEN});
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pnp-federation-'));
try{
 let selection=payload;
 if(['register','verify-author'].includes(operation)){
  selection=path.join(directory,'request.json');fs.writeFileSync(selection,payload,{mode:0o600});
 }else if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(payload))throw Error('Exact native request ID required');
 const journalFile=name=>federationJournalFile(problem.deployment.contract,name);
 await run([operation,problem.root,selection,directory,'--send'],{
  loadJournal:async name=>(await readEvidenceFile(github,journalFile(name)))?.data,
  saveJournal:async(name,value)=>{
   const file=journalFile(name),prior=await readEvidenceFile(github,file);
   await github.request('/contents/'+file,{method:'PUT',body:{branch:'evidence',message:'Record exact federation transaction intent and receipt',content:Buffer.from(JSON.stringify(clean(value),null,2)+'\n').toString('base64'),...(prior?{sha:prior.sha}:{})}});
  }
 });
}finally{fs.rmSync(directory,{recursive:true,force:true});}
