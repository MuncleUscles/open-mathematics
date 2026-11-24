import {DOMAIN,canonical,bytes,digest,hex,validateQuestion} from '../../forecasting/core.mjs';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const date=t=>new Date(t).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
const ape=id=>'Ape '+id.slice(0,8);
let api,identity,questions=[],history=[],timeOffset=0;
async function request(path,options){const r=await fetch(api+path,{...options,cache:'no-store',signal:AbortSignal.timeout(20000)});let data;try{data=await r.json();}catch{throw Error('The forecast desk is temporarily unavailable.');}if(!r.ok)throw Error(data.error||'The forecast desk is temporarily unavailable.');return data;}
async function identityStore(create=false){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pnp-forecast-identity',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{
  const saved=await new Promise((resolve,reject)=>{const r=db.transaction('keys').objectStore('keys').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});if(saved||!create)return saved;
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',pair.publicKey),publicKey={kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y};
  const item={publicKey,privateKey:pair.privateKey,participant:await digest(publicKey)};
  // add() keeps two tabs from replacing an already-created identity.
  try{await new Promise((resolve,reject)=>{const t=db.transaction('keys','readwrite');t.objectStore('keys').add(item,'current');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});return item;}catch{return identityStore(false);}
 }finally{db.close();}
}
function identityLabel(){
 $('forecast-identity').textContent=identity?`You are ${ape(identity.participant)}. Your signing key stays in this browser. Clearing site data loses editing access; published forecasts remain public.`:'Your first forecast creates a browser identity. No wallet or GitHub account needed. Your probability, reasoning and revisions will be public.';
 $('forecast-history-link').hidden=!identity;if(identity)$('forecast-history-link').href=api+'/api/audit?participant='+identity.participant;
}
async function loadHistory(){history=[];if(!identity)return;let cursor=0;do{const data=await request('/api/audit?participant='+identity.participant+'&after='+cursor);history.push(...data.records);cursor=data.nextCursor;}while(cursor!==null);}
function renderHistory(){const root=$('my-forecasts');root.replaceChildren();
 if(!identity){root.append(node('p','Publish a forecast to start your track record.','empty'));return;}
 if(!history.length){root.append(node('p','No published forecasts for this browser identity yet.','empty'));return;}
 for(const r of [...history].reverse()){const q=questions.find(q=>q.id===r.questionId),row=node('article',undefined,'forecast-history-row');row.append(node('strong',r.probability+'%'),node('div',q?.text||r.questionId),node('span',`Revision ${r.revision} · ${date(r.acceptedAt)}`,'fine'));if(r.reason)row.append(node('p',r.reason));root.append(row);}
}
function detailsFor(q){const details=node('details',undefined,'disclosure');details.append(node('summary','The question, the evidence & the rules'));const body=node('div');body.append(node('p',q.criteria),node('p',`Opens ${date(q.opensAt)}. Forecasts close ${date(q.closesAt)}. Native checkpoint ${date(q.checkpointAt)}–${date(q.resolutionDeadline)}.`),node('p',q.inconclusivePolicy),node('p',q.verificationPolicy));
 for(const url of q.evidenceSources){const a=node('a',url.includes('studio')?'Finalized research contract':'Research evidence');a.href=url;a.target='_blank';a.rel='noopener';body.append(a,node('br'));}
 const audit=node('a','All signed forecasts for this question');audit.href=api+'/api/audit?question='+q.id;audit.target='_blank';audit.rel='noopener';body.append(audit,node('p',`Question ${q.id} · version ${q.version}`,'fine'),node('code',q.hash,'question-hash'));
 details.append(body);return details;
}
function trendFor(q){const details=node('details',undefined,'forecast-trend');details.append(node('summary','How the community call has changed'));const table=node('table');const caption=node('caption','Daily snapshots of the median forecast. A dash means fewer than five browser identities.');table.append(caption);const head=node('thead'),tr=node('tr');for(const title of ['As of','Community call','Forecasters'])tr.append(node('th',title));head.append(tr);table.append(head);const body=node('tbody');for(const t of q.trend||[]){const row=node('tr');row.append(node('td',date(t.at)),node('td',t.probability===null?'—':t.probability+'%'),node('td',String(t.count)));body.append(row);}table.append(body);details.append(table);return details;}
function card(q){const section=node('article',undefined,'forecast-card');section.id='forecast-'+q.id;
 const now=Date.now()+timeOffset,open=now>=Date.parse(q.opensAt)&&now<Date.parse(q.closesAt),latest=history.filter(r=>r.questionId===q.id).at(-1),state=q.resolution?.status==='resolved'?(q.resolution.outcome?'Resolved YES':'Resolved NO'):q.resolution?.status==='inconclusive'?'Inconclusive':open?'Open for calls':now<Date.parse(q.opensAt)?'Opening soon':'Calls closed';
 const top=node('div',undefined,'forecast-card-top');top.append(node('span',q.topic,'eyebrow'),node('span',state,'badge'));section.append(top,node('h3',q.text));
 const stats=node('div',undefined,'forecast-community'),value=node('strong',q.aggregate.probability===null?'?':q.aggregate.probability+'%');stats.append(value,node('span',q.aggregate.probability===null?`${q.aggregate.count} ${q.aggregate.count===1?'forecaster':'forecasters'} · community call appears at 5`:`Community call · ${q.aggregate.count} ${q.aggregate.count===1?'forecaster':'forecasters'}`));section.append(stats,node('p',`Calls close ${date(q.closesAt)}`,'fine'));
 if(q.resolution){section.append(node('p',q.resolution.status==='resolved'?`Finalized ledger value: ${q.resolution.value}. ${q.resolution.method}.`:(q.resolution.reason||q.inconclusivePolicy),'forecast-resolution'));}
 const form=node('form',undefined,'forecast-form'),id=q.id+'-probability',label=node('label',undefined,'probability-label'),output=node('output',(latest?.probability??50)+'%');output.htmlFor=id;label.htmlFor=id;label.append(node('span',latest?'Update your call':'Your call'),output);
 const slider=node('input');slider.type='range';slider.id=id;slider.min='0';slider.max='100';slider.step='1';slider.value=latest?.probability??50;slider.disabled=!open;slider.setAttribute('aria-label','Your probability of YES');slider.setAttribute('aria-valuetext',slider.value+' percent probability of YES');
 const ends=node('div',undefined,'slider-ends');ends.append(node('span','Definitely no'),node('span','Definitely yes'));
 const why=node('details',undefined,'forecast-reason');why.append(node('summary','Why? Add your reasoning (optional)'));const reasonLabel=node('label','Your public reasoning'),reason=node('textarea');reason.rows=3;reason.maxLength=1000;reason.value=latest?.reason||'';reason.placeholder='What evidence would change your mind?';reason.disabled=!open;reasonLabel.append(reason);why.append(reasonLabel);
 const button=node('button',latest?'Publish revision':'Publish my forecast','button');button.type='submit';button.disabled=!open;
 const status=node('p',latest?`Your last call: ${latest.probability}% · ${date(latest.acceptedAt)}`:'','fine');status.setAttribute('role','status');status.setAttribute('aria-live','polite');let pending;
 slider.addEventListener('input',()=>{output.textContent=slider.value+'%';slider.setAttribute('aria-valuetext',slider.value+' percent probability of YES');pending=null;});reason.addEventListener('input',()=>pending=null);
 form.append(label,slider,ends,why,button,status);form.addEventListener('submit',async event=>{
  event.preventDefault();button.disabled=true;status.textContent='Signing and publishing your call…';
  try{identity??=await identityStore(true);identityLabel();
   if(!pending){const previous=history.filter(r=>r.questionId===q.id).at(-1),forecast={domain:DOMAIN,questionId:q.id,questionHash:q.hash,probability:Number(slider.value),reason:reason.value.trim(),revision:(previous?.revision||0)+1,previous:previous?.receipt||null,nonce:hex(crypto.getRandomValues(new Uint8Array(16)))};
    pending={forecast,publicKey:identity.publicKey,signature:hex(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.privateKey,bytes(canonical(forecast))))};}
   const accepted=await request('/api/forecasts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});
   const expected=await digest({participant:identity.participant,forecast:pending.forecast,publicKey:pending.publicKey,signature:pending.signature,acceptedAt:accepted.acceptedAt});if(expected!==accepted.receipt)throw Error('The receipt could not be verified. Refresh your history before trying again.');
   pending=null;await load();$('forecast-service-status').textContent=`Published ${accepted.probability}% for “${q.text}”. Your signed revision is in the public history.`;
  }catch(error){status.textContent=error.message;button.disabled=false;}
 });
 section.append(form,trendFor(q),detailsFor(q));return section;
}
async function renderRanks(){const root=$('forecast-ranking');root.replaceChildren();try{const data=await request('/api/leaderboard');if(!data.ranks.length){root.append(node('p','The scoreboard is waiting for the evidence. Rankings begin after the first resolved question.','empty'));return;}const table=node('table'),caption=node('caption','Forecasters · time-weighted Brier loss, lower is better');table.append(caption);const head=node('thead'),tr=node('tr');for(const x of ['Rank','Forecaster','Resolved calls','Brier loss'])tr.append(node('th',x));head.append(tr);table.append(head);const body=node('tbody');data.ranks.forEach((r,i)=>{const row=node('tr'),who=node('td'),a=node('a',ape(r.participant));a.href=api+'/api/audit?participant='+r.participant;who.append(a);row.append(node('td',String(i+1)),who,node('td',String(r.resolved)),node('td',r.brier.toFixed(3)));body.append(row);});table.append(body);root.append(table,node('p','Early results are a small sample, not proof of forecasting skill.','fine'));}catch{root.append(node('p','Forecaster rankings are temporarily unavailable.','empty'));}}
async function load(){const result=await request('/api/questions');timeOffset=Date.parse(result.serverTime)-Date.now();
 questions=await Promise.all(result.questions.map(async q=>{const {hash,aggregate,resolution,trend,...definition}=q;validateQuestion(definition);if(hash!==await digest(definition))throw Error('Question commitment could not be verified.');return q;}));
 const preview=questions.map(q=>{const box=node('article'),a=node('a',q.text);a.href='#/forecasts';box.append(a,node('p',q.aggregate.probability===null?`${q.aggregate.count} ${q.aggregate.count===1?'forecaster':'forecasters'} · waiting for five calls`:`${q.aggregate.probability}% community call · ${q.aggregate.count} forecasters`,'fine'));return box;});$('forecast-preview-calls').replaceChildren(...preview);
 await loadHistory();identityLabel();$('forecast-questions').replaceChildren(...questions.map(card));renderHistory();await renderRanks();$('forecast-service-status').textContent=`Desk checked ${date(result.serverTime)}. Median of each identity’s latest call; at least five to display. Browser identities are not verified independent people.`;
}
export async function initForecasts(){
 try{const response=await fetch('./forecasts-config.json',{cache:'no-store'});if(!response.ok)throw Error('The forecast desk has not been configured for this problem.');const config=await response.json();const base=new URL(config.api);if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw Error('Forecast service address is invalid.');api=base.origin;
  try{identity=await identityStore();}catch{$('forecast-identity').textContent='Browser identity storage is unavailable. Public forecasts can still be read.';}
  await load();
 }catch(error){$('forecast-preview-calls').replaceChildren(node('p','The desk is temporarily unavailable.','fine'));$('forecast-service-status').textContent=error.message;$('forecast-questions').replaceChildren(node('p','The forecasting desk is temporarily unavailable. The research notebook is still open.','empty'));}
 $('refresh-forecasts').addEventListener('click',async event=>{event.target.disabled=true;try{await load();}catch(error){$('forecast-service-status').textContent=error.message;}finally{event.target.disabled=false;}});
}
