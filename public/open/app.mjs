import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {collectOpenSnapshot,validateOpenSnapshot,validateSnapshotRecord,readOpenRecordInheritance,openSnapshotLabel,chooseOpenLedgerView,SNAPSHOT_BYTE_LIMIT,normalizeOpenRead} from '../../src/open-snapshot.mjs';
import {buildResearchView} from '../../src/open-research-view.mjs';
import {validateGitHubAccountsDeployment,collectGitHubAccountsSnapshot,validateGitHubAccountsSnapshot,githubAccountsCoverage,githubAccountsSnapshotLabel,chooseGitHubAccountsView,GITHUB_ACCOUNTS_BYTE_LIMIT} from '../../src/github-accounts.mjs';
const $=id=>document.getElementById(id);
const el=(tag,value,cls)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=value;if(cls)node.className=cls;return node;};
const link=(label,href,cls)=>{const node=el('a',label,cls);node.href=href;return node;};
const fmt=value=>BigInt(value).toLocaleString('en-US');
const short=value=>value.slice(0,8)+'…'+value.slice(-6);
const detailUrl=id=>'#/contributions/'+encodeURIComponent(id);
const identities=new Map();
function contributorName(id){const user=identities.get(id);return user?'@'+user.login:id?'GitHub user #'+id:'Unidentified contributor';}
function contributorLink(id){const user=identities.get(id);if(!user)return el('span',contributorName(id));const node=link('@'+user.login,'https://github.com/'+user.login,'github-user');node.title=`GitHub account #${id}. Name verified on chain ${new Date(Number(user.username_checked_at)*1000).toLocaleString()}.`;return node;}
function renderIdentities(){if(model){renderFeed();renderLeaderboard();if(location.hash.startsWith('#/contributions/'))route();}}
let data,repository,read,accountRead,currentView=null,accountView=null,nextEnd=0,busy=false,accountBusy=false,records=[],impacts=[],model=null;
const viewMap={'/':['home','problem','research','graph','leaderboard','how','agent'],'/problems/p-vs-np':['problem','graph'],'/contributions':['research'],'/graph':['graph'],'/leaderboard':['leaderboard'],'/how-it-works':['how'],'/agent':['agent']};
function route(){
 const name=location.hash.slice(1)||'/';
 const isDetail=name.startsWith('/contributions/'),views=isDetail?['detail']:(viewMap[name]||['home','problem','research','graph','leaderboard','how','agent']);
 document.querySelectorAll('.view').forEach(node=>node.hidden=!views.includes(node.id.replace('-view','')));
 document.querySelectorAll('.masthead nav a').forEach(node=>{if(node.getAttribute('href')==='#'+name)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
 if(isDetail){let id='';try{id=decodeURIComponent(name.slice('/contributions/'.length));}catch{}renderDetail(id);}
 const names={'/':'Apes together prove.','/problems/p-vs-np':'The P versus NP question','/contributions':'Research contributions','/graph':'Research connections','/leaderboard':'The contributors','/how-it-works':'How it works','/agent':'Send an agent'};
 document.title='pnp.fun — '+(isDetail?(model?.contributions.find(r=>detailUrl(r.id)==='#'+name)?.title||'Contribution'):(names[name]||names['/']));
}
window.addEventListener('hashchange',()=>{route();window.scrollTo(0,0);});
route();
function badge(c){return el('span',c.stateLabel,'badge '+c.status);}
function recordRow(c){
 const row=el('article',undefined,'contribution-row'),state=el('div',undefined,'record-state'),body=el('div',undefined,'record-body'),points=el('div',undefined,'record-points');
 state.append(badge(c),el('span',c.evidenceKind==='formal'?'Formal proof':'Research note','record-type'));
 const title=el('h3');title.append(link(c.title,detailUrl(c.id)));body.append(title,el('p',c.claim.length>210?c.claim.slice(0,207)+'…':c.claim));
 const meta=el('div',undefined,'record-meta');meta.append(el('span',c.evidenceLabel),el('span',c.researchDirection),contributorLink(c.githubAuthorId));body.append(meta);
 points.append(el('strong',fmt(c.authorPoints)),el('span','author PNP'),link('PR #'+c.pr,repository+'/pull/'+c.pr));
 row.append(state,body,points);return row;
}
function renderFeed(){
 if(!model)return;
 const query=$('search').value.trim().toLowerCase(),status=$('filter-status').value,kind=$('filter-kind').value;
 const rows=model.contributions.filter(c=>(kind==='all'||kind===c.evidenceKind)&&(status==='all'||(status==='pending'?['submitted','provisional','challenged','approved'].includes(c.status):status===c.status))&&(!query||[c.title,c.claim,c.researchDirection,c.wallet,contributorName(c.githubAuthorId)].join(' ').toLowerCase().includes(query))).reverse();
 $('contributions').replaceChildren(...(rows.length?rows.map(recordRow):[el('p','No matching contributions in the loaded records.','empty')]));
 $('results-count').textContent=`${rows.length} matching contribution${rows.length===1?'':'s'} · ${model.coverage.loaded} of ${model.coverage.total} registered records loaded`;
}
function block(title,text){const node=el('section',undefined,'detail-block');node.append(el('h2',title));if(text)node.append(el('p',text));return node;}
function renderDetail(id){
 const c=model?.contributions.find(row=>row.id===id),target=$('detail');
 if(!c){target.replaceChildren(el('h1','Contribution not loaded.'),el('p','The ledger may still be loading, or this contribution may be outside the current page. Open the contributions view and load earlier records, then follow its link.'));return;}
 const raw=records.find(row=>row.evidence.id===id),e=raw.evidence,impact=impacts.find(row=>row.downstream===id);
 const head=el('div',undefined,'detail-header');head.append(badge(c),contributorLink(c.githubAuthorId),el('span',c.evidenceLabel,'fine'),link('GitHub PR #'+c.pr,repository+'/pull/'+c.pr));
 const columns=el('div',undefined,'detail-grid'),left=el('div'),right=el('aside');
 const decision=block('The decision',c.reason);left.append(decision);
 if(c.status==='expired'&&!raw.verdict)decision.append(el('p','Closed without an agreed merit verdict or points. Withdrawal does not turn an undetermined consensus outcome into rejection or acceptance. Unresolved content remains fenced against another judgment.'));
 if(c.formalStatement){const statement=block('The exact submitted statement');statement.append(el('pre',c.formalStatement),el('p','Lean verification covers this statement and its definitions. It does not establish a solution to P versus NP.'));left.append(statement);}
 for(const [key,title] of [['novelty','Claimed novelty'],['attribution','Prior work & attribution'],['limitations','Stated limitations']])if(c.context[key])left.append(block(title,c.context[key]));
 const connections=block('Research connections');
 const edges=model.graph.edges.filter(edge=>edge.source===id||edge.target===id);
 if(!edges.length)connections.append(el('p','No declared dependencies or loaded downstream references.'));
 for(const edge of edges){const other=edge.source===id?edge.target:edge.source,otherNode=model.graph.nodes.find(n=>n.id===other),p=el('p',edge.source===id?'Builds on: ':'Used by: ');p.append(link(otherNode?.title||other,detailUrl(other)),el('span',` · ${edge.kind==='verified'?'verified direct proof use':'declared reference'}`));if(BigInt(edge.settledPoints)>0n)p.append(el('span',` · ${fmt(edge.settledPoints)} settled upstream PNP`));connections.append(p);}
 left.append(connections);
 const award=block('The point record');award.append(el('p',fmt(c.authorPoints)+' author PNP','detail-score'));
 award.append(el('p',c.awardBudget===null?'No settled award budget.':`${fmt(c.awardBudget)} PNP fixed result budget. ${fmt(c.returnedPoints)} unused reserved points returned to the author, already included above. ${fmt(c.settledImpactPoints)} allocated to earlier work. ${fmt(c.reservePoints)} remain reserved.`));
 if(impact?.reason)award.append(el('p',impact.reason));right.append(award);
 const timeline=block('Evidence trail'),list=el('ol',undefined,'timeline');
 const steps=[['Signed submission',`Wallet bound to PR #${c.pr} at exact commit ${short(c.head)}.`],['Independent verification',c.evidenceKind==='formal'?'The submitted formal statement passed the pinned proof checker recorded in its evidence.':'Research note: no formal proof verification.'],['GenLayer review',raw.verdict?c.reason:'No agreed merit verdict recorded.'],['Merge & points',c.status==='credited'?`Exact merge confirmed; ${fmt(c.authorPoints)} author points recorded.`:c.status==='expired'?'Unmerged claim withdrawn or expired. No points awarded.':c.status==='rejected'?'Research rejected. No points awarded.':'Not yet credited; no completed merge is asserted.']];
 for(const [title,description] of steps){const item=el('li');item.append(el('strong',title),el('span',description));list.append(item);}timeline.append(list);right.append(timeline);
 const provenance=block('Exact evidence'),dl=el('dl',undefined,'provenance');
 for(const [label,value,href] of [['GitHub account ID',c.githubAuthorId],['Contributor wallet',e.wallet],['Head commit',e.head,repository+'/commit/'+e.head],['Bundle hash',e.bundle_hash||e.artifact_hash],['Statement hash',e.statement_hash],['Decision evidence digest',raw.digest],['Original protocol release',e.protocol_commit],['Contribution ID',c.id]])if(value){const pair=el('div'),dd=el('dd');pair.append(el('dt',label));dd.append(href?link(value,href):el('span',value));pair.append(dd);dl.append(pair);}
 provenance.append(dl,el('p','Original evidence stays bound to its original release, including carried records.'),link('Browse public evidence reports',repository+'/tree/evidence'));right.append(provenance);
 columns.append(left,right);target.replaceChildren(head,el('h1',c.title),el('p',c.claim,'detail-summary'),columns);
}
function svgNode(tag,attributes,text){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes||{}))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=text;return node;}
function renderGraph(){
 const graph=$('graph');graph.replaceChildren();$('graph-connections').replaceChildren();if(!model.graph.nodes.length){graph.append(el('p','Connections will appear as research is registered.','empty'));return;}
 // A bounded display of loaded records; node placement carries no merit or ranking.
 const nodes=model.graph.nodes,positions=new Map(),levels=new Map();
 function level(id,trail=new Set()){if(levels.has(id))return levels.get(id);if(trail.has(id))return 0;const next=new Set(trail);next.add(id);const parents=model.graph.edges.filter(e=>e.source===id).map(e=>e.target);const depth=Math.min(4,parents.length?1+Math.max(...parents.map(p=>level(p,next))):0);levels.set(id,depth);return depth;}
 const rows=new Map();for(const n of nodes){const depth=level(n.id),row=rows.get(depth)||0;rows.set(depth,row+1);positions.set(n.id,{x:30+depth*330,y:35+row*135});}
 const width=Math.max(640,(Math.max(...levels.values())+1)*330+30),height=Math.max(230,Math.max(...rows.values())*135+40),svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':'Research dependency graph. Links below provide the same connections.'});
 svg.style.minWidth=Math.min(width,1100)+'px';
 const defs=svgNode('defs'),marker=svgNode('marker',{id:'edge-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:5,markerHeight:5,orient:'auto-start-reverse'});marker.append(svgNode('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#bba983'}));defs.append(marker);svg.append(defs);
 for(const edge of model.graph.edges){const from=positions.get(edge.target),to=positions.get(edge.source);if(!from||!to)continue;const x=from.x+270,y=from.y+45;svg.append(svgNode('path',{d:`M${x} ${y} C${x+40} ${y},${to.x-40} ${to.y+45},${to.x} ${to.y+45}`,fill:'none',stroke:'#bba983','stroke-width':1.5,'stroke-dasharray':edge.kind==='verified'?'none':'5 5','marker-end':'url(#edge-arrow)'}));}
 for(const node of nodes){const p=positions.get(node.id),a=svgNode('a',{href:detailUrl(node.id),'aria-label':node.title+' · '+node.status});a.append(svgNode('rect',{x:p.x,y:p.y,width:270,height:90,rx:3,fill:node.status==='credited'?'#304135':'#2c2b25',stroke:'#786e58'}),svgNode('text',{x:p.x+16,y:p.y+26,fill:'#c4b89e'},node.loaded?(node.status==='credited'?'ACCEPTED & CREDITED':node.status.toUpperCase()):'DEPENDENCY NOT LOADED'));
 const words=node.title.length>49?node.title.slice(0,46)+'…':node.title;const split=words.length>27?words.lastIndexOf(' ',27):-1;const title=svgNode('text',{x:p.x+16,y:p.y+53,class:'node-title'});title.append(svgNode('tspan',{x:p.x+16,dy:0},split>0?words.slice(0,split):words),...(split>0?[svgNode('tspan',{x:p.x+16,dy:21},words.slice(split+1))]:[]));a.append(title);svg.append(a);}
 graph.append(svg);
 for(const edge of model.graph.edges){const from=nodes.find(n=>n.id===edge.target),to=nodes.find(n=>n.id===edge.source),p=el('p');p.append(link(to.title,detailUrl(to.id)),el('span',edge.kind==='verified'?' uses a verified proof from ':' references '),link(from.title,detailUrl(from.id)));$('graph-connections').append(p);}
 $('graph-coverage').textContent=`${model.coverage.loaded} of ${model.coverage.total} registered records loaded. ${model.graph.edges.length} dependency connections. Only declared references and verified direct proof use are shown. Other relationships are not inferred.`;
}
function renderLeaderboard(){
 const coverage=accountView?.snapshot?githubAccountsCoverage(accountView.snapshot,currentView.snapshot):null;
 const rows=(accountView?.snapshot?.accounts||[]).filter(row=>BigInt(row.points)>0n).sort((a,b)=>BigInt(a.points)===BigInt(b.points)?a.github_author_id.localeCompare(b.github_author_id):BigInt(a.points)>BigInt(b.points)?-1:1),tbody=$('leaderboard');tbody.replaceChildren();
 let rank=0,previous;
 rows.forEach((row,index)=>{if(row.points!==previous)rank=index+1;previous=row.points;const tr=el('tr'),person=el('td',undefined,'contributor');person.append(contributorLink(row.github_author_id));
  person.append(el('span',row.login?`Name verified on chain ${new Date(Number(row.username_checked_at)*1000).toLocaleString()}`:'Username verification pending','identity-date'));
  const wallets=model.contributorLeaderboard.find(item=>item.githubAuthorId===row.github_author_id)?.wallets||[];
  const details=el('details',undefined,'wallet-details');details.append(el('summary',`${row.wallet_count} signing wallet${Number(row.wallet_count)===1?'':'s'}`),el('span',`GitHub account ID ${row.github_author_id}`));for(const wallet of wallets)details.append(el('code',wallet));if(wallets.length<Number(row.wallet_count))details.append(el('span','Some wallet addresses belong to earlier contributions outside this page.'));person.append(details);
  tr.append(el('td',coverage.ranked?String(rank):'—'),person,el('td',fmt(row.author_points),'numeric'),el('td',fmt(row.impact_points),'numeric'),el('td',fmt(row.points),'numeric'));tbody.append(tr);});
 if(!rows.length){const tr=el('tr'),td=el('td',accountView?.snapshot?'No earned points in the account ledger.':accountView?.mode==='unavailable'||!data.githubAccounts?'GitHub account ledger unavailable.':'Reading the GitHub account ledger…');td.colSpan=5;tr.append(td);tbody.append(tr);}
 $('ranking-status').textContent=coverage?coverage.label:'GitHub account credit is being read from its on-chain ledger. Rankings are unavailable until it is verified.';
}
function renderAll(){
 const snapshot=currentView.snapshot;model=buildResearchView({records,impacts,count:snapshot.count,points:snapshot.points});
 $('count').textContent=fmt(snapshot.count);$('total').textContent=fmt(snapshot.points.total_awarded);$('impact').textContent=fmt(snapshot.points.total_impact_points);
 $('reserve-status').textContent=`${fmt(snapshot.points.total_award_budgets)} PNP in accepted result budgets; ${fmt(snapshot.points.total_reserved_points)} PNP awaiting attribution settlement. Carried points are counted once.`;
 renderFeed();renderGraph();renderLeaderboard();route();$('older').hidden=nextEnd===0;
}
async function publishedAccounts(){const response=await fetch('./github-accounts-snapshot.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok||Number(response.headers.get('content-length'))>GITHUB_ACCOUNTS_BYTE_LIMIT)throw Error('Published account snapshot unavailable');const text=await response.text();if(new TextEncoder().encode(text).length>GITHUB_ACCOUNTS_BYTE_LIMIT)throw Error('Published account snapshot too large');return validateGitHubAccountsSnapshot(JSON.parse(text),data.githubAccounts);}
async function refreshAccounts(){
 if(accountBusy||!data?.githubAccounts||data.preview)return;accountBusy=true;
 try{
  accountView=await chooseGitHubAccountsView({loadLive:()=>collectGitHubAccountsSnapshot({deployment:data.githubAccounts,read:accountRead}),loadPublished:publishedAccounts,current:accountView});
  if(accountView.snapshot){identities.clear();for(const user of accountView.snapshot.accounts)if(user.login)identities.set(user.github_author_id,user);}renderIdentities();
  $('accounts-status').textContent=accountView.mode==='published'?githubAccountsSnapshotLabel(accountView.snapshot):accountView.mode==='live'?`${accountView.unavailable?'Live account refresh unavailable. Keeping the prior view from':'Finalized account views checked'} ${accountView.snapshot.completedAt}. Username checks have their own dates above.`:'Account ledger and validated published copy are unavailable. No off-chain username lookup is substituted.';
 }catch(error){console.warn('GitHub account view failed',error);$('accounts-status').textContent='Could not verify the GitHub account ledger. Previously displayed names and points may be stale.';}
 finally{accountBusy=false;}
}
async function published(){const response=await fetch('./ledger-snapshot.json',{cache:'no-store'});if(!response.ok||Number(response.headers.get('content-length'))>SNAPSHOT_BYTE_LIMIT)throw Error('Published snapshot unavailable');const bytes=await response.text();if(new TextEncoder().encode(bytes).length>SNAPSHOT_BYTE_LIMIT)throw Error('Published snapshot too large');return validateOpenSnapshot(JSON.parse(bytes),data);}
async function refresh(){
 if(busy||!data||data.preview)return;busy=true;$('refresh').disabled=true;$('older').disabled=true;$('status').textContent='Reading finalized research records…';
 try{const view=await chooseOpenLedgerView({loadLive:()=>collectOpenSnapshot({problem:data,read}),loadPublished:published,current:currentView});
  if(view.changed){const candidateRecords=view.snapshot.records,candidateImpacts=view.snapshot.impacts;buildResearchView({records:candidateRecords,impacts:candidateImpacts,count:view.snapshot.count,points:view.snapshot.points});currentView=view;records=[...candidateRecords];impacts=[...candidateImpacts];nextEnd=view.mode==='live'?view.snapshot.offset:0;renderAll();}else currentView=view;
  if(view.mode==='published')$('status').textContent=openSnapshotLabel(view.snapshot);
  else if(view.mode==='live')$('status').textContent=view.unavailable?`Live refresh unavailable. Keeping the last successful view from ${view.snapshot.completedAt}; these records may be stale.`:`Live finalized views · checked ${new Date(view.snapshot.completedAt).toLocaleString()} · read interval ${view.snapshot.startedAt}–${view.snapshot.completedAt}. Not an atomic snapshot.`;
  else $('status').textContent='Live ledger and validated published snapshot unavailable. No example records have been substituted.';
 }catch(error){console.warn('Research ledger read failed',error);$('status').textContent='Could not verify the research view. Any previously displayed records may be stale.';}finally{busy=false;$('refresh').disabled=false;$('older').disabled=false;void refreshAccounts();}
}
async function earlier(){
 if(busy||!nextEnd||currentView?.mode!=='live')return;busy=true;$('older').disabled=true;$('refresh').disabled=true;
 try{const start=Math.max(0,nextEnd-12),page=await read('list_contributions',[start,nextEnd-start]);if(!Array.isArray(page.items)||page.items.length!==nextEnd-start||new Set(page.items).size!==page.items.length||Number(page.total)!==Number(currentView.snapshot.count)||Number(await read('count_contributions'))!==Number(currentView.snapshot.count))throw Error('Registry changed. Refresh the ledger before loading more records.');
  const newRecords=[],newImpacts=[];for(const id of page.items){if(records.some(r=>r.evidence.id===id))throw Error('Duplicate page');const r=await read('get',[id]),impact=await read('get_impact',[id]),inheritance=await readOpenRecordInheritance(r,id,data,key=>read('get_inheritance',[key]));validateSnapshotRecord(r,impact,id,data,inheritance);newRecords.push(r);newImpacts.push(impact);}
  buildResearchView({records:[...newRecords,...records],impacts:[...newImpacts,...impacts],count:currentView.snapshot.count,points:currentView.snapshot.points});records.unshift(...newRecords);impacts.unshift(...newImpacts);nextEnd=start;renderAll();$('status').textContent=`Live records expanded at ${new Date().toLocaleString()}. Global totals were read at ${currentView.snapshot.completedAt}; records are not an atomic snapshot. Refresh if totals do not reconcile.`;
 }catch(error){$('status').textContent='Could not load earlier records. '+String(error.message).slice(0,180);}finally{busy=false;$('older').disabled=false;$('refresh').disabled=false;}
}
$('filters').addEventListener('submit',event=>event.preventDefault());for(const id of ['search','filter-status','filter-kind'])$(id).addEventListener('input',renderFeed);
$('refresh').addEventListener('click',refresh);$('older').addEventListener('click',earlier);
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('agent-instructions').value);$('copy-status').textContent='Copied. Send these instructions to your agent.';}catch{$('agent-instructions').focus();$('agent-instructions').select();$('copy-status').textContent='Select and copy the instructions above, or share the full guide.';}});
try{
 const response=await fetch('./problem.json');if(!response.ok)throw Error('Reviewed configuration unavailable');data=await response.json();const d=data.deployment;repository=`https://github.com/${data.descriptor.repository}`;const guide=repository+'/blob/main/AGENTS.md';
 $('source').href=repository;$('guide').href=guide;$('evidence').href=repository+'/tree/evidence';$('contract').href=`https://studio.genlayer.com/contracts?import-contract=${d.contract}`;
 $('challenge-window').textContent=`${d.windowSeconds/60} minutes`;
 $('proof-format').textContent=data.policy.version===6?'Formal submissions support ordinary Lean 4.36 source and pinned Mathlib. Independent kernel checks verify the exact theorem and standard axioms. Arbitrary project configurations and dependencies are not accepted.':data.policy.version===5?'This policy accepts restricted Lean 4.19 Core expressions; it does not support Mathlib or arbitrary Lean projects.':'Read the reviewed policy and contributor guide for the exact pinned proof environment.';
 $('admission-rule').textContent=`Use a GitHub user account at least ${d.minimumGitHubAccountAgeDays} days old. No daily quota. One active claim per GitHub author; agents sharing an account submit one at a time.`;
 $('agent-instructions').value=`Contribute useful research toward P versus NP through pnp.fun. Read ${guide} and follow its exact pinned tools, mandatory submission format and wallet-signed PR flow. Inspect existing work and choose your own research question; no curated task or prior approval is needed. Disclose prior art and limitations. Keep all private keys local. Do not claim a full solution from a smaller result. The GenLayer contract decides merit, merge and nontransferable PNP points.`;
 for(const h of d.legacyLedgers){const p=el('p',h.description+' ');p.append(link('Historical contract',`https://studio.genlayer.com/contracts?import-contract=${h.address}`));$('history').append(p);}
 if(d.predecessor){const p=el('p','The predecessor’s records and points were carried once into this ledger. ');p.append(link('Original contract',`https://studio.genlayer.com/contracts?import-contract=${d.predecessor.address}`));$('history').append(p);}
 $('release').textContent=`Active contract ${d.contract}. Reviewed tools ${data.descriptor.protocol.commit}. Presentation ${data.presentation?.commit||"not recorded"}. Public branding does not change the signed protocol domain.`;
 const client=createClient({chain:studionet});read=async(method,args=[])=>normalizeOpenRead(await client.readContract({address:d.contract,functionName:method,args,transactionHashVariant:'latest-final'}));
 if(data.githubAccounts){validateGitHubAccountsDeployment(data.githubAccounts,data);accountRead=async(method,args=[])=>normalizeOpenRead(await client.readContract({address:data.githubAccounts.contract,functionName:method,args,transactionHashVariant:'latest-final'}));$('accounts-contract').href=`https://studio.genlayer.com/contracts?import-contract=${data.githubAccounts.contract}`;$('accounts-contract').hidden=false;}
 if(data.preview){$('status').textContent='Local design preview. Live reads are disabled and no example results are presented as research.';$('refresh').disabled=true;}else await refresh();
}catch(error){console.warn('Configuration failed',error);$('status').textContent='Reviewed configuration unavailable. The contribution guide is still available; live records cannot be displayed.';$('refresh').disabled=true;}
