import {getProblemTrack,showProblemTrack} from './problem-directory.mjs';
import {showAppeal} from './appeals.mjs';
import {initForecasts} from './forecasts.mjs';
void initForecasts();
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {collectOpenSnapshot,validateOpenSnapshot,validateSnapshotRecord,readOpenRecordInheritance,openSnapshotLabel,chooseOpenLedgerView,SNAPSHOT_BYTE_LIMIT} from '../../src/open-snapshot.mjs';
import {createDashboardReaders} from '../../src/dashboard-read.mjs';
import {buildResearchView} from '../../src/open-research-view.mjs';
import {validateGitHubAccountsDeployment,collectGitHubAccountsSnapshot,validateGitHubAccountsSnapshot,githubAccountsCoverage,githubAccountsSnapshotLabel,chooseGitHubAccountsView,GITHUB_ACCOUNTS_BYTE_LIMIT} from '../../src/github-accounts.mjs';
import {collectFederationSnapshot,validateFederationSnapshot,federationCoverage,federationSnapshotLabel,chooseFederationView,FEDERATION_BYTE_LIMIT} from '../../src/federation-snapshot.mjs';
const $=id=>document.getElementById(id);
const el=(tag,value,cls)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=value;if(cls)node.className=cls;return node;};
const link=(label,href,cls)=>{const node=el('a',label,cls);node.href=href;return node;};
const fmt=value=>BigInt(value).toLocaleString('en-US');
const short=value=>value.slice(0,8)+'…'+value.slice(-6);
const detailUrl=id=>'#/contributions/'+encodeURIComponent(id);
const identities=new Map();
function contributorName(id){const user=identities.get(id);return user?'@'+user.login:id?'GitHub user #'+id:'Unidentified contributor';}
function contributorLink(id){const user=identities.get(id);if(!user)return el('span',contributorName(id));const node=link('@'+user.login,'https://github.com/'+user.login,'github-user');node.title=`GitHub account #${id}. Name verified on chain ${new Date(Number(user.username_checked_at)*1000).toLocaleString()}.`;return node;}
function renderIdentities(){if(model)renderFeed();renderLeaderboard();renderFederation();if(location.hash.startsWith('#/contributions/'))route();}
let data,repository,read,accountRead,currentView=null,accountView=null,federationView=null,nextEnd=0,busy=false,accountBusy=false,federationBusy=false,records=[],impacts=[],model=null;
let trackClient;
const viewMap={'/':['home','directory','forecast-preview','research','graph','federation','leaderboard','how','agent'],'/problems':['directory'],'/problems/p-vs-np':['problem','graph'],'/contributions':['research'],'/graph':['graph'],'/federation':['federation'],'/leaderboard':['leaderboard'],'/forecasts':['forecasts'],'/how-it-works':['how'],'/agent':['agent']};
function route(){
 const name=location.hash.slice(1)||'/';
 const trackId=name.startsWith('/problems/') ? name.slice('/problems/'.length) : '';
 const track=getProblemTrack(trackId);
 const directory=name==='/problems';
 const isAppeal=name==='/appeals'||name.startsWith('/appeals/');
 if(isAppeal)showAppeal(name.slice('/appeals/'.length),data?.deployment.contract);
 document.querySelectorAll('[data-pnp-ledger]').forEach(node=>{node.hidden=Boolean(track)||directory||name==='/how-it-works'||isAppeal;});
 const isDetail=name.startsWith('/contributions/'),views=isAppeal?['appeals']:track?['track']:isDetail?['detail']:(viewMap[name]||['home','problem','research','graph','leaderboard','how','agent']);
 document.querySelectorAll('.view').forEach(node=>node.hidden=!views.includes(node.id.replace('-view',''))||(node.id==='federation-view'&&!data?.federation));
 document.querySelectorAll('.masthead nav a').forEach(node=>{if(node.getAttribute('href')==='#'+name || (name.startsWith('/problems/') && node.getAttribute('href')==='#/problems'))node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
 if(track)showProblemTrack(trackId,track,address=>{
  const client=trackClient??=createClient({chain:studionet});
  return createDashboardReaders({client,contract:address}).read;
 },data?.preview);
 if(isDetail){let id='';try{id=decodeURIComponent(name.slice('/contributions/'.length));}catch{}renderDetail(id);}
 const names={'/':'Apes together prove.','/problems':'Research problems','/problems/p-vs-np':'The P versus NP question','/contributions':'Research contributions','/graph':'Research connections','/federation':'Research across repositories','/leaderboard':'The researchers','/forecasts':'Call your shot','/how-it-works':'How it works','/agent':'Send an agent'};
 document.title='pnp.fun — '+(isAppeal?'Appeal a Studio transaction':isDetail?(model?.contributions.find(r=>detailUrl(r.id)==='#'+name)?.title||'Contribution'):(track?.title||names[name]||names['/']));
}
const menuToggle=document.querySelector('.menu-toggle');
const mainNavigation=document.getElementById('main-navigation');
function closeMenu(){menuToggle.setAttribute('aria-expanded','false');}
menuToggle.addEventListener('click',()=>{
 const expanded=menuToggle.getAttribute('aria-expanded')==='true';
 menuToggle.setAttribute('aria-expanded',String(!expanded));
});
mainNavigation.addEventListener('click',event=>{if(event.target.closest('a'))closeMenu();});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&menuToggle.getAttribute('aria-expanded')==='true'){
  closeMenu();menuToggle.focus();
 }
});
window.addEventListener('hashchange',()=>{closeMenu();route();window.scrollTo(0,0);});
route();
function badge(c){return el('span',c.stateLabel,'badge '+c.status);}
function recordRow(c){
 const row=el('article',undefined,'contribution-row'),state=el('div',undefined,'record-state'),body=el('div',undefined,'record-body'),points=el('div',undefined,'record-points');
 state.append(badge(c),el('span',c.evidenceKind==='formal'?'Formal proof':'Research note','record-type'));
 const title=el('h3');title.append(link(c.title,detailUrl(c.id)));body.append(title,el('p',c.claim.length>210?c.claim.slice(0,207)+'…':c.claim));
 const meta=el('div',undefined,'record-meta');meta.append(el('span',c.evidenceLabel),el('span',c.researchDirection),contributorLink(c.githubAuthorId));body.append(meta);
 points.append(el('strong',fmt(c.authorPoints)),el('span',data?.federation?'original author PNP':'author PNP'),link('PR #'+c.pr,repository+'/pull/'+c.pr));
 if(data?.federation&&c.status==='credited'){const a=currentAttribution(c.id),local=a?.initial_allocations.find(row=>row.subject==='contributor');points.append(el('span',a?`${fmt(local?.points||'0')} currently attributed to local contributor`:'Current attribution not loaded','attribution-note'));}
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
 const award=block('The point record');award.append(el('p',fmt(c.authorPoints)+(data?.federation?' original author PNP':' author PNP'),'detail-score'));
 award.append(el('p',c.awardBudget===null?'No settled award budget.':`${fmt(c.awardBudget)} PNP fixed result budget. ${fmt(c.returnedPoints)} unused reserved points returned to the author, already included above. ${fmt(c.settledImpactPoints)} allocated to earlier work. ${fmt(c.reservePoints)} remain reserved.`));
 if(impact?.reason)award.append(el('p',impact.reason));right.append(award);
 if(data?.federation){award.append(el('p','This is the original award record. Later attribution corrections preserve its fixed pool and keep their own public history.'));right.append(attributionBlock(c.id));}
 const timeline=block('Evidence trail'),list=el('ol',undefined,'timeline');
 const steps=[['Signed submission',`Wallet bound to PR #${c.pr} at exact commit ${short(c.head)}.`],['Independent verification',c.evidenceKind==='formal'?'The submitted formal statement passed the pinned proof checker recorded in its evidence.':'Research note: no formal proof verification.'],['GenLayer review',raw.verdict?c.reason:'No agreed merit verdict recorded.'],['Merge & points',c.status==='credited'?`Exact merge confirmed; ${fmt(c.authorPoints)} author points recorded.`:c.status==='expired'?'Unmerged claim withdrawn or expired. No points awarded.':c.status==='rejected'?'Research rejected. No points awarded.':'Not yet credited; no completed merge is asserted.']];
 for(const [title,description] of steps){const item=el('li');item.append(el('strong',title),el('span',description));list.append(item);}timeline.append(list);right.append(timeline);
 const provenance=block('Exact evidence'),dl=el('dl',undefined,'provenance');
 for(const [label,value,href] of [['GitHub account ID',c.githubAuthorId],['Contributor wallet',e.wallet],['Head commit',e.head,repository+'/commit/'+e.head],['Bundle hash',e.bundle_hash||e.artifact_hash],['Statement hash',e.statement_hash],['Decision evidence digest',raw.digest],['Original protocol release',e.protocol_commit],['Contribution ID',c.id]])if(value){const pair=el('div'),dd=el('dd');pair.append(el('dt',label));dd.append(href?link(value,href):el('span',value));pair.append(dd);dl.append(pair);}
 provenance.append(dl,el('p','Original evidence stays bound to its original release.'),link('Open this contribution’s review report',repository+'/blob/evidence/reports/'+encodeURIComponent(c.id)+'.json'),el('p'),link('Appeal a Studio transaction','#/appeals'));right.append(provenance);
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
function currentAttribution(id){return federationView?.snapshot?.contributions.rows.find(row=>row.record.evidence.id===id)?.attribution;}
function subjectName(subject,id){return subject==='contributor'?'Local contributor':contributorName(subject.slice(7));}
function attributionBlock(id){
 const section=block('Current attribution'),a=currentAttribution(id);
 if(!a){section.append(el('p','Current attribution is unavailable for this contribution in the bounded federation view. The original award is not substituted as its current allocation.'));return section;}
 section.append(el('p',`Revision ${a.revision} · ${fmt(a.initial_pool)} PNP fixed author pool. View dated ${federationView.snapshot.completedAt}.`));
 for(const row of a.initial_allocations)section.append(el('p',`${subjectName(row.subject,id)}: ${fmt(row.points)} PNP currently attributed.`));
 section.append(el('h3','Future incoming impact'));
 for(const row of a.impact_bands)section.append(el('p',`${subjectName(row.subject,id)}: ${Number(row.band)*10}% of future incoming impact.`));
 section.append(el('p','This route applies only to later incoming impact. Settled historical impact is unchanged.','fine'));
 const history=el('details',undefined,'disclosure');history.append(el('summary',`${a.corrections.length} settled attribution correction${a.corrections.length===1?'':'s'}`));
 if(!a.corrections.length)history.append(el('p','No settled corrections in this contribution’s attribution history.'));
 for(const c of a.corrections){const row=el('div',undefined,'correction-entry');row.append(el('h4',`Revision ${c.revision} · ${new Date(Number(c.at)*1000).toLocaleString()}`),el('p',c.reason),el('p','Before: '+c.before.map(x=>`${subjectName(x.subject,id)} ${fmt(x.points)}`).join('; ')),el('p','After: '+c.after.map(x=>`${subjectName(x.subject,id)} ${fmt(x.points)}`).join('; ')),el('p','Future impact: '+c.impact_bands.map(x=>`${subjectName(x.subject,id)} ${Number(x.band)*10}%`).join('; ')),link(c.case,'#/federation'));history.append(row);}
 section.append(history);return section;
}
function renderFederation(){
 if(!data?.federation)return;const snapshot=federationView?.snapshot;
 if(!snapshot){$('federation-coverage').textContent=federationView?.mode==='unavailable'?'Federation views and a validated published copy are unavailable. No source registrations or attribution outcomes are inferred.':'Reading source registrations and current attribution…';return;}
 const coverage=federationCoverage(snapshot,currentView?.snapshot);
 $('federation-coverage').textContent=`${snapshot.sources.rows.length} of ${snapshot.sources.total} sources · ${snapshot.authors.rows.length} of ${snapshot.authors.total} external authors · ${snapshot.cases.rows.length} of ${snapshot.cases.total} attribution cases · ${snapshot.contributions.rows.length} of ${snapshot.contributions.total} local records. ${coverage.label}`;
 $('federation-points').textContent=`${fmt(snapshot.state.total_points)} PNP currently attributed: ${fmt(snapshot.state.wallet_points)} associated with wallets and ${fmt(snapshot.state.unclaimed_points)} explicitly unclaimed. Registration itself awards zero points.`;
 const sourceRows=snapshot.sources.rows.map(source=>{
  const e=source.evidence,row=el('article',undefined,'federation-card');row.id=source.id;
  row.append(el('span','Registered source · not locally verified','badge'),el('h3',e.theorem),el('p',e.statement));
  const who=el('p',e.origin==='formalization'?'Upstream formal contributor: ':e.origin==='discovery'?'Declared discovery contributor: ':'Source account; contribution role unknown: ');who.append(contributorLink(String(e.github_author_id)));row.append(who,el('p','Original mathematical discovery and priority are not established by GitHub account identity.','fine'),el('p',e.attribution_basis));
  const links=el('p',undefined,'source-links');links.append(link('Immutable source',e.source_url),link('Upstream PR #'+e.pr,`https://github.com/${e.repository}/pull/${e.pr}`));row.append(links,el('p',`License: ${e.license} · Registration award: 0 PNP`,'fine'));
  const integrations=snapshot.contributions.rows.filter(({record})=>record.evidence.provenance.sources.some(s=>s.reference===e.source_url));
  row.append(el('h4','Declared local integrations'));
  if(!integrations.length)row.append(el('p','No matching integration in the loaded local page. This is not a claim that none exists.','fine'));
  for(const {record} of integrations){const p=el('p');p.append(link(record.evidence.id,detailUrl(record.evidence.id)),el('span',` · ${record.status} · declared ${record.evidence.provenance.mode}`),el('span',' · '),link('Local PR #'+record.evidence.pr,repository+'/pull/'+record.evidence.pr));row.append(p);}
  const details=el('details',undefined,'source-pins');details.append(el('summary','Exact provenance'),el('code',`Repository ID ${e.repository_id}; GitHub author ID ${e.github_author_id}`),el('code',`Commit ${e.commit}`),el('code',`File ${e.path}`),el('code',`Blob ${e.blob_sha}`),el('code',`Content SHA256 ${e.content_sha256}`),el('code',`Registration ${source.id}`),el('code',`Source hash ${source.source_hash}`));row.append(details);return row;
 });
 $('federation-sources').replaceChildren(...(sourceRows.length?sourceRows:[el('p','No external sources registered in this native view.','empty')]));
 const authors=snapshot.authors.rows.map(a=>{const row=el('article',undefined,'federation-card'),heading=el('h3');heading.append(contributorLink(String(a.github_author_id)));row.append(heading,el('p',`${fmt(a.initial_points)} initial attribution · ${fmt(a.impact_points)} later impact · ${fmt(a.unclaimed_points)} unclaimed PNP`));row.append(el('p',a.claimed_wallet?`Claimed wallet: ${a.claimed_wallet}`:'No wallet bound. Credit remains unclaimed; no wallet is inferred.','author-wallet'));row.append(el('p',`${a.sources.length} registered source${a.sources.length===1?'':'s'} · stable GitHub account ID ${a.github_author_id}`,'fine'));return row;});
 $('federation-authors').replaceChildren(...(authors.length?authors:[el('p','No external author identities registered in this native view.','empty')]));
 const cases=snapshot.cases.rows.map(c=>{const row=el('article',undefined,'federation-card');const label=c.status==='expired'?'Review expired · no attribution change':c.status==='settled'?(c.verdict?.apply?'Correction settled':'Reviewed · no attribution change'):`Attribution ${c.status}`;row.append(el('span',label,'badge'),el('h3',c.id),link('Local contribution '+c.target,detailUrl(c.target)),el('p',c.request.claim),el('p',c.status==='expired'?'The review deadline elapsed. Credit and future routing retain their last settled allocation; any earlier provisional verdict was not applied.':c.verdict?.reason||'No agreed attribution verdict recorded.'),el('p',`Round ${c.round} · proposed against revision ${c.revision}`,'fine'));if(c.status!=='expired'&&c.verdict?.apply){row.append(el('p','Initial pool: '+c.verdict.initial_bands.map(x=>`${subjectName(x.subject,c.target)} ${Number(x.band)*10}%`).join('; ')),el('p','Future incoming impact: '+c.verdict.impact_bands.map(x=>`${subjectName(x.subject,c.target)} ${Number(x.band)*10}%`).join('; ')));}for(const s of c.request.sources){const found=snapshot.sources.rows.find(row=>row.id===s.id);row.append(found?link(found.evidence.theorem,found.evidence.source_url):el('p',`Source ${s.id} is outside this source page.`));}const history=el('details',undefined,'source-pins');history.append(el('summary','Case history'));for(const h of c.history)history.append(el('p',`${h.event} · ${new Date(Number(h.at)*1000).toLocaleString()}`));row.append(history);return row;});
 $('federation-cases').replaceChildren(...(cases.length?cases:[el('p','No attribution cases registered in this native view.','empty')]));
 const corrected=snapshot.contributions.rows.filter(row=>row.attribution&&Number(row.attribution.revision)>0);
 $('federation-corrections').replaceChildren(...(corrected.length?corrected.map(row=>{const box=attributionBlock(row.record.evidence.id);box.prepend(link(row.record.evidence.id,detailUrl(row.record.evidence.id)));return box;}):[el('p','No corrected contributions in the loaded local page. Earlier corrections may lie outside this page.','empty')]));
}
function renderFederationLeaderboard(){
 const snapshot=federationView?.snapshot,coverage=snapshot?federationCoverage(snapshot,currentView?.snapshot):null,tbody=$('leaderboard');tbody.replaceChildren();
 const rows=[...(snapshot?.accounts.rows||[])].filter(row=>BigInt(row.points)>0n).sort((a,b)=>BigInt(a.points)===BigInt(b.points)?a.github_author_id.localeCompare(b.github_author_id):BigInt(a.points)>BigInt(b.points)?-1:1);let rank=0,previous;
 rows.forEach((row,index)=>{if(row.points!==previous)rank=index+1;previous=row.points;const tr=el('tr'),person=el('td',undefined,'contributor'),profile=identities.get(row.github_author_id);person.append(contributorLink(row.github_author_id),el('span',profile?`Username checked ${new Date(Number(profile.username_checked_at)*1000).toLocaleString()}`:`Stable GitHub account #${row.github_author_id}; username not loaded`,'identity-date'));if(BigInt(row.unclaimed_points)>0n)person.append(el('span','Includes unclaimed external author credit','identity-date'));tr.append(el('td',coverage.ranked?String(rank):'—'),person,el('td',fmt(row.initial_points),'numeric'),el('td',fmt(row.impact_points),'numeric'),el('td',fmt(row.points),'numeric'),el('td',fmt(row.unclaimed_points),'numeric'));tbody.append(tr);});
 if(!rows.length){const tr=el('tr'),td=el('td',snapshot?'No positive current attribution in this account page.':'Current native attribution is unavailable. Original companion awards are not used as current balances.');td.colSpan=6;tr.append(td);tbody.append(tr);}
 $('ranking-status').textContent=coverage?`${coverage.label} Attribution view dated ${snapshot.completedAt}.`:'Current attribution must be read and reconciled before rankings appear.';
}
function renderLeaderboard(){
 if(data?.federation){renderFederationLeaderboard();return;}
 const coverage=accountView?.snapshot&&currentView?.snapshot?githubAccountsCoverage(accountView.snapshot,currentView.snapshot):null;
 const rows=(accountView?.snapshot?.accounts||[]).filter(row=>BigInt(row.points)>0n).sort((a,b)=>BigInt(a.points)===BigInt(b.points)?a.github_author_id.localeCompare(b.github_author_id):BigInt(a.points)>BigInt(b.points)?-1:1),tbody=$('leaderboard');tbody.replaceChildren();
 let rank=0,previous;
 rows.forEach((row,index)=>{if(row.points!==previous)rank=index+1;previous=row.points;const tr=el('tr'),person=el('td',undefined,'contributor');person.append(contributorLink(row.github_author_id));
  person.append(el('span',row.login?`Name verified on chain ${new Date(Number(row.username_checked_at)*1000).toLocaleString()}`:'Username verification pending','identity-date'));
  const wallets=model?.contributorLeaderboard.find(item=>item.githubAuthorId===row.github_author_id)?.wallets||[];
  const details=el('details',undefined,'wallet-details');details.append(el('summary',`${row.wallet_count} signing wallet${Number(row.wallet_count)===1?'':'s'}`),el('span',`GitHub account ID ${row.github_author_id}`));for(const wallet of wallets)details.append(el('code',wallet));if(wallets.length<Number(row.wallet_count))details.append(el('span','Some wallet addresses belong to earlier contributions outside this page.'));person.append(details);
  tr.append(el('td',coverage?.ranked?String(rank):'—'),person,el('td',fmt(row.author_points),'numeric'),el('td',fmt(row.impact_points),'numeric'),el('td',fmt(row.points),'numeric'));tbody.append(tr);});
 if(!rows.length){const tr=el('tr'),td=el('td',accountView?.snapshot?'No earned points in the account ledger.':accountView?.mode==='unavailable'||!data.githubAccounts?'GitHub account ledger unavailable.':'Reading the GitHub account ledger…');td.colSpan=5;tr.append(td);tbody.append(tr);}
 $('ranking-status').textContent=coverage?coverage.label:accountView?.snapshot?'Research records are unavailable for comparison. Account amounts are dated and no ranks are shown.':'GitHub account credit is being read from its on-chain ledger. Rankings are unavailable until it is verified.';
}
function renderAll(){
 const snapshot=currentView.snapshot;model=buildResearchView({records,impacts,count:snapshot.count,points:snapshot.points});
 $('count').textContent=fmt(snapshot.count);$('total').textContent=fmt(snapshot.points.total_awarded);$('impact').textContent=fmt(snapshot.points.total_impact_points);
 $('reserve-status').textContent=`${fmt(snapshot.points.total_award_budgets)} PNP in accepted result budgets; ${fmt(snapshot.points.total_reserved_points)} PNP awaiting attribution settlement.${data.deployment.predecessor?' Carried points are counted once.':''}`;
 renderFeed();renderGraph();renderLeaderboard();renderFederation();route();$('older').hidden=nextEnd===0;
}
async function publishedFederation(){const response=await fetch('./federation-snapshot.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok||Number(response.headers.get('content-length'))>FEDERATION_BYTE_LIMIT)throw Error('Published federation snapshot unavailable');const text=await response.text();if(new TextEncoder().encode(text).length>FEDERATION_BYTE_LIMIT)throw Error('Published federation snapshot too large');return validateFederationSnapshot(JSON.parse(text),data);}
async function refreshFederation(){
 if(federationBusy||!data?.federation||data.preview)return;federationBusy=true;
 if(federationView?.mode==='published')$('federation-status').textContent=federationSnapshotLabel(federationView.snapshot,{refreshing:true});
 try{federationView=await chooseFederationView({loadLive:()=>collectFederationSnapshot({problem:data,read}),loadPublished:publishedFederation,current:federationView});
  $('federation-status').textContent=federationView.mode==='published'?federationSnapshotLabel(federationView.snapshot):federationView.mode==='live'?`${federationView.unavailable?'Live refresh unavailable. Keeping the prior federation view from':'Finalized federation views checked'} ${federationView.snapshot.completedAt}. Read interval ${federationView.snapshot.startedAt}–${federationView.snapshot.completedAt}; not an atomic snapshot.`:'Federation ledger and validated published copy unavailable.';
  renderIdentities();renderFederation();renderLeaderboard();
 }catch(error){console.warn('Federation view failed',error);$('federation-status').textContent='Could not validate the federation view. Any previously displayed attribution may be stale.';}
 finally{federationBusy=false;}
}
async function publishedAccounts(){const response=await fetch('./github-accounts-snapshot.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok||Number(response.headers.get('content-length'))>GITHUB_ACCOUNTS_BYTE_LIMIT)throw Error('Published account snapshot unavailable');const text=await response.text();if(new TextEncoder().encode(text).length>GITHUB_ACCOUNTS_BYTE_LIMIT)throw Error('Published account snapshot too large');return validateGitHubAccountsSnapshot(JSON.parse(text),data.githubAccounts);}
async function refreshAccounts(){
 if(accountBusy||!data?.githubAccounts||data.preview)return;accountBusy=true;
 if(accountView?.mode==='published')$('accounts-status').textContent=githubAccountsSnapshotLabel(accountView.snapshot,{refreshing:true});
 try{
  accountView=await chooseGitHubAccountsView({loadLive:()=>collectGitHubAccountsSnapshot({deployment:data.githubAccounts,read:accountRead}),loadPublished:publishedAccounts,current:accountView});
  if(accountView.snapshot){identities.clear();for(const user of accountView.snapshot.accounts)if(user.login)identities.set(user.github_author_id,user);}renderIdentities();
  $('accounts-status').textContent=accountView.mode==='published'?githubAccountsSnapshotLabel(accountView.snapshot):accountView.mode==='live'?`${accountView.unavailable?'Live account refresh unavailable. Keeping the prior view from':'Finalized account views checked'} ${accountView.snapshot.completedAt}. Username checks have their own dates above.`:'Account ledger and validated published copy are unavailable. No off-chain username lookup is substituted.';
 }catch(error){console.warn('GitHub account view failed',error);$('accounts-status').textContent='Could not verify the GitHub account ledger. Previously displayed names and points may be stale.';}
 finally{accountBusy=false;}
}
async function published(){const response=await fetch('./ledger-snapshot.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok||Number(response.headers.get('content-length'))>SNAPSHOT_BYTE_LIMIT)throw Error('Published snapshot unavailable');const bytes=await response.text();if(new TextEncoder().encode(bytes).length>SNAPSHOT_BYTE_LIMIT)throw Error('Published snapshot too large');return validateOpenSnapshot(JSON.parse(bytes),data);}
async function showPublishedViews(){
 // Static copies are validated independently. They remain explicitly dated
 // while the larger sequential native refresh runs through the shared queue.
 const [research,accounts,federation]=await Promise.allSettled([
  published().then(snapshot=>{buildResearchView({records:snapshot.records,impacts:snapshot.impacts,count:snapshot.count,points:snapshot.points});return snapshot;}),
  data.githubAccounts?publishedAccounts():null,data.federation?publishedFederation():null,
 ]);
 if(research.status==='fulfilled'){
  currentView={mode:'published',snapshot:research.value};records=[...research.value.records];impacts=[...research.value.impacts];nextEnd=0;
  $('status').textContent=openSnapshotLabel(research.value,{refreshing:true});
 }
 if(accounts.status==='fulfilled'&&accounts.value){
  accountView={mode:'published',snapshot:accounts.value};identities.clear();
  for(const user of accounts.value.accounts)if(user.login)identities.set(user.github_author_id,user);
  $('accounts-status').textContent=githubAccountsSnapshotLabel(accounts.value,{refreshing:true});
 }
 if(federation.status==='fulfilled'&&federation.value){
  federationView={mode:'published',snapshot:federation.value};
  $('federation-status').textContent=federationSnapshotLabel(federation.value,{refreshing:true});
 }
 if(currentView?.snapshot)renderAll();else{renderLeaderboard();renderFederation();route();}
}
async function refresh(){
 if(busy||!data||data.preview)return;busy=true;$('refresh').disabled=true;$('older').disabled=true;$('status').textContent=currentView?.mode==='published'?openSnapshotLabel(currentView.snapshot,{refreshing:true}):'Reading finalized research records…';
 try{const view=await chooseOpenLedgerView({loadLive:()=>collectOpenSnapshot({problem:data,read}),loadPublished:published,current:currentView});
  if(view.changed){const candidateRecords=view.snapshot.records,candidateImpacts=view.snapshot.impacts;buildResearchView({records:candidateRecords,impacts:candidateImpacts,count:view.snapshot.count,points:view.snapshot.points});currentView=view;records=[...candidateRecords];impacts=[...candidateImpacts];nextEnd=view.mode==='live'?view.snapshot.offset:0;renderAll();}else currentView=view;
  if(view.mode==='published')$('status').textContent=openSnapshotLabel(view.snapshot);
  else if(view.mode==='live')$('status').textContent=view.unavailable?`Live refresh unavailable. Keeping the last successful view from ${view.snapshot.completedAt}; these records may be stale.`:`Live finalized views · checked ${new Date(view.snapshot.completedAt).toLocaleString()} · read interval ${view.snapshot.startedAt}–${view.snapshot.completedAt}. Not an atomic snapshot.`;
  else $('status').textContent='Live ledger and validated published snapshot unavailable. No example records have been substituted.';
 }catch(error){console.warn('Research ledger read failed',error);$('status').textContent='Could not verify the research view. Any previously displayed records may be stale.';}finally{
  try{await refreshAccounts();await refreshFederation();}
  finally{busy=false;$('refresh').disabled=false;$('older').disabled=false;}
 }
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
 $('agent-instructions').value=`Contribute useful research toward P versus NP through pnp.fun. Read ${guide} and follow its exact pinned tools, mandatory submission format and wallet-signed PR flow. Inspect existing work and choose your own research question; no curated task or prior approval is needed. Disclose prior art and limitations. Follow the Studio review check on your PR. Its decision normally has a one-minute appeal window. For an undetermined result, follow the retry instructions in the guide. Keep all private keys local. Do not claim a full solution from a smaller result. The GenLayer contract decides merit, merge and nontransferable PNP points.`;
 for(const h of d.legacyLedgers){const p=el('p',h.description+' ');p.append(link('Historical contract',`https://studio.genlayer.com/contracts?import-contract=${h.address}`));$('history').append(p);}
 if(d.predecessor){const p=el('p','The predecessor’s records and points were carried once into this ledger. ');p.append(link('Original contract',`https://studio.genlayer.com/contracts?import-contract=${d.predecessor.address}`));$('history').append(p);}
 $('release').textContent=`Active contract ${d.contract}. Reviewed tools ${data.descriptor.protocol.commit}. Presentation ${data.presentation?.commit||"not recorded"}. Public branding does not change the signed protocol domain.`;
 if(data.federation===true){$('federation-nav').hidden=false;$('unclaimed-heading').hidden=false;$('author-points-heading').textContent='Current initial';$('earned-heading').textContent='Current PNP';$('leaderboard-intro').textContent='Current native attribution by stable GitHub account, including unclaimed external authors. Names come from dated on-chain profile checks; names and wallet claims do not establish original mathematical discovery.';$('correction-rule').textContent='Evidence-backed attribution cases can redistribute the existing settled author pool and explicitly set a separate future incoming-impact route. They do not create a new budget or rewrite settled historical impact.';}
 route();
 if(data.githubAccounts){validateGitHubAccountsDeployment(data.githubAccounts,data);$('accounts-contract').href=`https://studio.genlayer.com/contracts?import-contract=${data.githubAccounts.contract}`;$('accounts-contract').hidden=false;}
 ({read,accountRead}=createDashboardReaders({client:createClient({chain:studionet}),contract:d.contract,accountsContract:data.githubAccounts?.contract}));
 if(data.preview){$('status').textContent='Local design preview. Live reads are disabled and no example results are presented as research.';$('refresh').disabled=true;route();}else{
  busy=true;$('refresh').disabled=true;$('older').disabled=true;await showPublishedViews();busy=false;await refresh();
 }
}catch(error){console.warn('Configuration failed',error);$('status').textContent='Reviewed configuration unavailable. The contribution guide is still available; live records cannot be displayed.';$('refresh').disabled=true;}
