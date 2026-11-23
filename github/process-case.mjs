// A restartable trusted worker for native documentary cases. No contributor code runs here.
import fs from 'node:fs';
import {journaledTransaction} from './journaled-transaction.mjs';
import {createAccount} from 'genlayer-js';
import {GitHub} from '../src/github.mjs';import {digest} from '../src/security.mjs';
import {clientFor,read,clean,sleep} from './runtime.mjs';import {verifyCaseDocumentary} from './verify-case.mjs';
import {isStaleCase,isTerminalCase,reconcileV3CaseExpiration,requireV3CaseCanProceed,staleCaseDiagnostic} from './case-expiration.mjs';
const d=JSON.parse(fs.readFileSync('public/deployment.json'));
if(d.protocolVersion!==3||d.codeHash!==digest(fs.readFileSync('contracts/research.py'))||d.policy!==digest(fs.readFileSync('lean/policy.json')))throw Error('Exact reviewed v3 deployment required');
if(process.env.GITHUB_REF!=='refs/heads/protocol'||process.env.GITHUB_REPOSITORY!==d.repository)throw Error('Trusted protocol branch required');
const gh=new GitHub({repository:d.repository,token:process.env.GITHUB_TOKEN}),verifier=clientFor(process.env.VERIFIER_SIGNING_KEY),executor=clientFor(process.env.EXECUTOR_SIGNING_KEY);
if(createAccount(process.env.VERIFIER_SIGNING_KEY).address.toLowerCase()!==d.verifier.toLowerCase()||createAccount(process.env.EXECUTOR_SIGNING_KEY).address.toLowerCase()!==d.executor.toLowerCase())throw Error('Wrong enrolled operators');
const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH)),requested=event.inputs?.case_id||'';
const readView=(method,args)=>read(executor,d.contract,method,args);
const files=fs.readdirSync('.github/provenance-reviews').filter(x=>/^case-[a-f0-9]{32}\.json$/.test(x)).sort();
const admitted=requested?[]:await read(executor,d.contract,'list_review_cases',[]);
const admissions=new Set(admitted.slice(0,100));
// The pilot inspects up to 100 configured admissions and 100 already-admitted IDs per run.
const configured=files.map(x=>x.slice(0,-5)).filter(id=>!admissions.has(id)).slice(0,100);
const candidates=requested?[requested]:[...configured,...admissions];
async function getFile(file){try{const r=await gh.request(`/contents/${file}?ref=evidence`);return {sha:r.sha,data:JSON.parse(Buffer.from(r.content,'base64'))};}catch(e){if(e.message==='GitHub 404')return null;throw e;}}
async function put(file,value){const old=await getFile(file);return gh.request(`/contents/${file}`,{method:'PUT',body:{branch:'evidence',message:'Record native provenance case',content:Buffer.from(JSON.stringify(clean(value),null,2)+'\n').toString('base64'),...(old?{sha:old.sha}:{})}});}
function admission(id){const file=`.github/provenance-reviews/${id}.json`;return fs.existsSync(file)?fs.readFileSync(file):null;}
let selected,saved,admissionBytes,configHash;
for(const id of candidates){
 if(!/^case-[a-f0-9]{32}$/.test(id))throw Error('Invalid case ID');
 const c=await read(executor,d.contract,'get_case',[id]);
 const prior=(await getFile(`cases/${id}.json`))?.data;
 if(!requested&&isTerminalCase(c.status)&&(!prior||prior.completedAt))continue;
 const bytes=admission(id),hash=bytes?digest(bytes):null;
 const repeated=prior?.error&&Number(prior.failedRound)===Number(c.round)&&prior.failedConfigHash===hash&&prior.case?.status===c.status;
 if(!requested&&repeated&&(prior.error===staleCaseDiagnostic||!await isStaleCase(c,readView)))continue;
 selected=c;saved=prior;admissionBytes=bytes;configHash=hash;break;
}
if(!selected){console.log('No admitted provenance work or unfinished terminal journal.');process.exit(0);}
const id=selected.id,reportPath=`cases/${id}.json`;
const report=saved||{id,contract:d.contract,chainId:d.chainId,payloadHash:digest(selected.payload),reporter:selected.reporter,transactions:{},rounds:{},startedAt:new Date().toISOString()};
if(report.id!==id||report.contract!==d.contract||report.chainId!==d.chainId||report.payloadHash!==digest(selected.payload)||report.reporter!==selected.reporter)throw Error('Case journal identity mismatch');
async function save(){report.updatedAt=new Date().toISOString();report.run=`https://github.com/${d.repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;await put(reportPath,report);}
async function tx(stage,client,method,args,independent=false,recoverOnly=false){
 return journaledTransaction({client,address:d.contract,sender:client===verifier?d.verifier:d.executor,method,args,independent,recoverOnly,transactions:report.transactions,stage,save});
}
async function state(){const c=await read(executor,d.contract,'get_case',[id]);if(c.reporter!==report.reporter||digest(c.payload)!==report.payloadHash)throw Error('Native case changed its original identity');report.case=c;await save();return c;}
async function reconcileAttestation(c){
 const event=c.history?.findLast(item=>item.event==='documentary-verification');
 const round=Number(event?.round),prepared=report.rounds[round];
 if(!Number.isSafeInteger(round)||round<0||round>Number(c.round)||!c.attestation_hash||event.hash!==c.attestation_hash||typeof prepared?.evidenceJSON!=='string'||digest(prepared.evidenceJSON)!==c.attestation_hash)
  throw Error('Exact prepared documentary attestation is unavailable; operator recovery required');
 await tx(`attest-r${round}`,verifier,'attest_case',[id,round,prepared.evidenceJSON],false,true);
}
try{
 let c=await state();
 await requireV3CaseCanProceed(c,readView);
 if(['submitted','challenged'].includes(c.status)){
  const round=Number(c.round),stage=`attest-r${round}`;
  const journaled=Object.hasOwn(report.transactions,stage);
  const config=!journaled&&admissionBytes?JSON.parse(admissionBytes):null;
  if(c.status==='submitted'||journaled||config?.round===round){
   if(!config&&!journaled){
    console.log('Case awaits reviewed source and identity admission in the protocol branch.');
   }else{
    let prepared=report.rounds[round];
    if(!journaled){
     const authors=await read(executor,d.contract,'get_external_authors',[]);
     const attestation=await verifyCaseDocumentary(c,config,d,{authors});
     prepared={configHash:digest(config),evidenceJSON:JSON.stringify(attestation)};report.rounds[round]=prepared;await save();
    }
    if(typeof prepared?.evidenceJSON!=='string')throw Error('Journaled documentary attestation lacks its exact prepared JSON');
    await tx(stage,verifier,'attest_case',[id,round,prepared.evidenceJSON]);c=await state();
    if(c.attestation_hash!==digest(prepared.evidenceJSON))throw Error('Native attestation differs from verified source snapshots');
   }
  }
 }
 if(['verified','challenged'].includes(c.status)){
  await reconcileAttestation(c);
  const round=Number(c.round);
  await tx(`review-r${round}`,executor,'review_case',[id,round,c.attestation_hash],true);c=await state();
 }
 if(c.status==='provisional'){
  await reconcileAttestation(c);
  await tx(`review-r${c.round}`,executor,'review_case',[id,Number(c.round),c.attestation_hash],true,true);
  while(Date.now()<Number(c.deadline)*1000+1500)await sleep(Math.min(5000,Number(c.deadline)*1000+1500-Date.now()));
  c=await state();if(c.status==='challenged')throw Error('Case challenged; next recovery requests a new independent review');
  if(c.status==='provisional'){
   await tx(`settle-r${c.round}`,executor,'settle_case',[id,Number(c.round),c.attestation_hash]);c=await state();
  }
 }
 if(c.status==='settled'){
  await reconcileAttestation(c);
  const round=Number(c.round);
  await tx(`review-r${round}`,executor,'review_case',[id,round,c.attestation_hash],true,true);
  await tx(`settle-r${round}`,executor,'settle_case',[id,round,c.attestation_hash],false,true);
 }else{
  await reconcileV3CaseExpiration(c,executor,tx);
 }
 if(isTerminalCase(c.status))report.completedAt=new Date().toISOString();
 else delete report.completedAt;
 delete report.error;delete report.failedRound;delete report.failedConfigHash;delete report.blockedConsensus;
 await save();console.log('Provenance case:',id,c.status);
}catch(error){
 report.error=[process.env.GITHUB_TOKEN,process.env.VERIFIER_SIGNING_KEY,process.env.EXECUTOR_SIGNING_KEY].filter(Boolean).reduce((s,k)=>s.split(k).join('[redacted]'),String(error.message));
 report.failedRound=Number(report.case?.round??selected.round);report.failedConfigHash=configHash;
 report.blockedConsensus=/UNDETERMINED|CANCELED|LEADER_TIMEOUT|Finalized execution failed|failed receipt verification/.test(report.error);
 await save();throw Error(report.error);
}
