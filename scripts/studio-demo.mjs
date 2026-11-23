import fs from 'node:fs';
import {createAccount,generatePrivateKey} from 'genlayer-js';
import {createStudioClient} from '../src/studio-client.mjs';
import {studionet} from 'genlayer-js/chains';
import {digest,message} from '../src/security.mjs';
import {normalize} from '../src/studio.mjs';
import {randomBytes} from 'node:crypto';
const out='public/studio-evidence.json';
const account=createAccount(generatePrivateKey()); // ephemeral operator, never a contributor key
const client=createStudioClient({account});
const stringify=x=>JSON.stringify(x,(_,v)=>v instanceof Map?Object.fromEntries(v):typeof v==='bigint'?String(v):v,2);
const report={mode:'live-studio-with-fixture-inputs',network:'studionet',chainId:studionet.id,authority:account.address,startedAt:new Date().toISOString(),transactions:{},records:{},limitations:['GitHub PRs and merge confirmations are fixtures.','Points are nontransferable records on the IC; no token or bridge.','Operator key exists only in process memory. Re-run deploys a new demonstration.']};
function save(){fs.writeFileSync(out,stringify(report));}
async function wait(stage,hash){report.transactions[stage]={hash,status:'submitted'};save();console.log(stage,hash);let receipt;for(let i=0;i<240;i++){receipt=await client.getTransaction({hash});const status=receipt.status_name||receipt.statusName||receipt.status;if(status==='FINALIZED')break;if(['UNDETERMINED','CANCELED','LEADER_TIMEOUT'].includes(status))throw Error(`${stage}: ${status}`);await new Promise(r=>setTimeout(r,2500));}
  report.transactions[stage]={hash,receipt:JSON.parse(stringify(receipt), (k,v)=>["node_config","contract_state","execution_stats"].includes(k)?undefined:v)};save();const status=receipt.status_name||receipt.statusName||receipt.status;
  const leaders=receipt.consensus_data?.leader_receipt;const leader=Array.isArray(leaders)?leaders[0]:leaders;
  if(status!=='FINALIZED'||leader?.execution_result!=='SUCCESS')throw Error(`${stage}: not finalized successful execution`);
  if(receipt.leader_only!==false)throw Error(`${stage}: leader-only result is not consensus`);
  return receipt;}
try{
if(await client.getChainId()!==studionet.id)throw Error('Wrong Studio chain');
const code=fs.readFileSync('contracts/research.py','utf8');report.codeHash=digest(code);
const policy=digest(fs.readFileSync('lean/policy.json','utf8'));
const deploy=await client.deployContract({code,args:[account.address,account.address,'p-vs-np',policy,10,false,''],leaderOnly:false});
const receipt=await wait('deploy',deploy);const address=receipt.data?.contract_address||receipt.to_address;if(!/^0x[\da-f]{40}$/i.test(address))throw Error('No deployed address');report.contract=address;save();
const write=async(stage,fn,args)=>wait(stage,await client.writeContract({address,functionName:fn,args,leaderOnly:false}));
const lean=JSON.parse(fs.readFileSync('public/lean-evidence.json','utf8'));
const tautology=JSON.parse(fs.readFileSync('public/tautology-evidence.json','utf8'));
for(const [id,claim,statement] of [
  ['demo-renaming','Adds a core Lean CNF syntax and proves evaluation commutes with arbitrary variable renaming for all assignments and formulas. This is established textbook mathematics, not a new discovery; the repository previously had no verified renaming component. It is useful infrastructure for subsequent verified SAT reductions. Award only modest integration credit.',lean.statement_hash],
  ['demo-tautology','Proves True. Claims this solves P vs NP. No reduction, complexity bound or relevant mathematical content is supplied.',digest('True')]]){
  const claimEnvelope={version:1,domain:'https://open-mathematics.demo',chainId:61999,problem:'p-vs-np',repository:'fixture/open-mathematics',pr:id==='demo-renaming'?1:2,head:'a'.repeat(40),wallet:account.address,nonce:randomBytes(16).toString('hex'),expires:Date.now()+300000};
  const signature=await account.signMessage({message:message(claimEnvelope)});
  report.claims??={};report.claims[id]={claim:claimEnvelope,signature};
  const e={id,problem:'p-vs-np',policy,repository:'fixture/open-mathematics',pr:id==='demo-renaming'?1:2,head:'a'.repeat(40),base:'b'.repeat(40),wallet:account.address,claim_digest:digest(claimEnvelope),statement_hash:statement,artifact_hash:id==='demo-renaming'?lean.artifact_hash:tautology.artifact_hash,verification:'verified',claim,context:'Bounded integration demonstration. P vs NP remains open; no complete P/NP formalization is present. No prior renaming theorem in this demo component.',dependencies:[],kind:'lemma',submission_hash:digest('explicit fixture submission'),github_author_id:1,verified_dependencies:[],research_direction:'shared',provenance:{mode:'extension',sources:[],discovery_basis:'Controlled known-mathematics fixture for integration testing only; no discovery or priority claim.'},proof:'by\n  simp [evalCNF]',formal_statement:id==='demo-renaming'?'For all renamings, assignments and formulas: CNF evaluation commutes with variable renaming.':'The proposition True; no mathematical content about P vs NP.'};
  await write(id+'-register','register',[JSON.stringify(e)]);
  await write(id+'-adjudicate','adjudicate',[id,0]);
  const judgment=report.transactions[id+'-adjudicate'].receipt;
  if(!judgment.consensus_data?.validators?.some(v=>v.mode==='validator'&&v.vote==='agree'))throw Error('No independent validator agreement');
  await new Promise(r=>setTimeout(r,11000));
  await write(id+'-finalize','finalize',[id,0]);
  let record=normalize(await client.readContract({address,functionName:'get',args:[id],transactionHashVariant:'latest-final'}));
  if(record.status==='approved')await write(id+'-simulated-merge','confirm_merge',[id,e.head,'c'.repeat(40)]);
  report.records[id]=normalize(await client.readContract({address,functionName:'get',args:[id],transactionHashVariant:'latest-final'}));save();
}
report.points=normalize(await client.readContract({address,functionName:'get_points',args:[account.address],transactionHashVariant:'latest-final'}));if(report.records['demo-renaming']?.status!=='credited'||report.records['demo-tautology']?.status!=='rejected')throw Error('Expected demonstration outcomes were not reached; inspect actual contract judgment');report.completedAt=new Date().toISOString();report.status='complete';save();console.log('Studio demonstration complete',address);
}catch(e){report.status='incomplete';report.error=e.message;save();console.error(e.message);process.exitCode=1;}
