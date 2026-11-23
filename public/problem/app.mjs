import {createClient} from 'genlayer-js';import {studionet} from 'genlayer-js/chains';
const $=id=>document.getElementById(id),text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
const data=await fetch('./problem.json').then(r=>{if(!r.ok)throw Error('Task catalog unavailable');return r.json();});
const repository=`https://github.com/${data.descriptor.repository}`,configBranch=data.descriptor.configBranch;
$('source').href=repository;$('guide').href=`${repository}/blob/${configBranch}/AGENTS.md`;
const rows=new Map();
for(const goal of data.goals){
 const card=document.createElement('article');card.className='task';const state=text('span',goal.rewardable?'Eligibility not yet checked':goal.role);state.className='state';card.append(state,text('h3',goal.title),text('p',goal.description));
 const details=document.createElement('details');details.append(text('summary','Exact trusted statement'),text('pre',goal.statement));card.append(details);
 const a=text('a',goal.rewardable?'Read task and contribution guide':'Read supporting material');a.href=`${repository}/blob/${configBranch}/goals/${goal.id}/TASK.md`;card.append(a);
 $(goal.rewardable?'tasks':'references').append(card);rows.set(goal.id,{goal,state});
}
if(!data.deployment){$('status').textContent='Draft task catalog. Native deployment and enrollment are pending; these are not live reward offers.';$('refresh').disabled=true;$('availability').textContent='Pending activation';}
else{
 const d=data.deployment;$('status').textContent='Reviewed task definitions loaded. Check finalized contract state before starting work.';$('contract').hidden=false;$('contract').href=`https://studio.genlayer.com/contracts?import-contract=${d.contract}`;$('contract').textContent='Contract '+d.contract.slice(0,10)+'…';
 $('refresh').addEventListener('click',async()=>{
  $('refresh').disabled=true;$('status').textContent='Reading finalized GenLayer state…';
  for(const {goal,state}of rows.values())if(goal.rewardable){state.className='state';state.textContent='Checking…';}
  try{
   const client=createClient({chain:studionet}),read=async(method,args=[])=>client.readContract({address:d.contract,functionName:method,args,transactionHashVariant:'latest-final'}),normalize=v=>v instanceof Map?Object.fromEntries([...v].map(([k,x])=>[k,normalize(x)])):Array.isArray(v)?v.map(normalize):typeof v==='bigint'?String(v):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;
   const config=normalize(await read('get_config'));if(config.problem!==d.problem||config.repository!==d.repository||config.branch!==d.branch||String(config.version)!=='4')throw Error('Native deployment differs from the reviewed catalog');
   let open=0;
   for(const {goal,state}of rows.values()){
    const native=normalize(await read('get_goal',[goal.id]));if(native.goal_hash!==goal.goal_hash||native.policy_hash!==goal.policyHash||native.problem_commit!==goal.problemCommit||native.protocol_commit!==goal.protocolCommit||native.rewardable!==goal.rewardable)throw Error('Native task differs from its reviewed definition');
    state.textContent=goal.rewardable?(native.status==='open'?'Open for submissions':native.status):goal.role;state.className='state'+(goal.rewardable&&native.status==='open'?' open':'');if(goal.rewardable&&native.status==='open')open++;
   }
   $('availability').textContent=`${open} open reward-eligible ${open===1?'task':'tasks'}`;$('status').textContent='Finalized task state checked at '+new Date().toLocaleTimeString()+'. Availability can change; the agent helper checks again before signing.';
   $('ledger-state').textContent='Active problem ledger: '+d.contract+'. Point balances and accepted work are recorded here, separately from the earlier pilot.';
  }catch(error){$('status').textContent='Live availability could not be verified. '+String(error.message).slice(0,160);$('availability').textContent='Native state unavailable';for(const {goal,state}of rows.values())if(goal.rewardable){state.className='state';state.textContent='Availability unverified';}}
  finally{$('refresh').disabled=false;}
 });
}
