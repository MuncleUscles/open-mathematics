import test from 'node:test';import assert from 'node:assert/strict';
import {activityBySide,provenanceMarkup,sourceURL,mountResearchCommunity,authorRows,casesMarkup} from '../public/research-community.mjs';
test('changing affiliation does not rewrite accepted contribution direction or count pending work',()=>{
 const records=[{status:'credited',evidence:{research_direction:'shared'}},{status:'credited',evidence:{research_direction:'p-equals-np'}},{status:'provisional',evidence:{research_direction:'p-not-equals-np'}},{status:'credited',evidence:{}}];
 const counts=activityBySide(records,[{wallet:'one',side:'p-not-equals-np'}]);
 assert.deepEqual(counts,[{side:'p-equals-np',affiliated:0,accepted:1},{side:'p-not-equals-np',affiliated:1,accepted:0},{side:'shared',affiliated:0,accepted:1}]);
});
test('source presentation escapes untrusted text and forbids executable or credential-bearing links',()=>{
 const payload='<img src=x onerror=alert(1)>',p={mode:payload,discovery_basis:payload,sources:[{reference:'javascript:alert(1)',title:payload,authors:[payload],relationship:payload,priority_evidence:payload}],corrections:[{reason:payload}]};
 const html=provenanceMarkup({evidence:{research_direction:'shared'}},p,{native:true});
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('Finalized native read'));
 for(const url of ['javascript:alert(1)','data:text/html,hi','http://example.org','https://user:pass@example.org'])assert.equal(sourceURL(url),null);
 assert.equal(sourceURL('https://example.org/paper'),'https://example.org/paper');
 assert.match(provenanceMarkup({evidence:{}},null),/earlier protocol version/);
});
test('author registry exposes exact IDs and registered source URLs while escaping untrusted values',()=>{
 const url='https://example.org/author?revision=1&copy=2',id='author-123',hostile='<img src=x onerror=alert(1)>';
 const html=authorRows([{id,name:hostile,sources:[url,'javascript:alert(1)'],unclaimed_points:'100',claimed_wallet:null}]);
 assert.match(html,/<code>author-123<\/code>/);assert.match(html,/Registered source:/);
 assert.ok(html.includes('href="https://example.org/author?revision=1&amp;copy=2"'));
 assert.ok(html.includes('>https://example.org/author?revision=1&amp;copy=2</a>'));
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript:'));
});
test('settled external-solution reviews explicitly distinguish a negative resolution verdict',()=>{
 const html=casesMarkup([{id:'case1',kind:'external-solution',status:'settled',verdict:{resolve:false}},{id:'case2',kind:'attribution',status:'withdrawn'}]);
 assert.match(html,/<span class="badge">Reviewed — not a resolution<\/span>/);
 assert.match(html,/<span class="badge">withdrawn<\/span>/);
 assert.match(html,/&quot;resolve&quot;: false/);
});
test('old deployment explicitly disables new native views and invented counts',async t=>{
 const prior=globalThis.fetch;t.after(()=>globalThis.fetch=prior);globalThis.fetch=async()=>({ok:true,json:async()=>({protocolVersion:2})});
 const container={innerHTML:''};let calls=0;await mountResearchCommunity({container,chainRead:async()=>{calls++;throw Error('must not call');}});
 assert.equal(calls,0);assert.match(container.innerHTML,/feature unavailable/);assert.match(container.innerHTML,/No sides, author identities or new awards are inferred/);assert.ok(!container.innerHTML.includes('side-counts'));
});
test('missing, malformed or unsupported protocol versions cannot enable v3 native presentation',async t=>{
 const prior=globalThis.fetch;t.after(()=>globalThis.fetch=prior);let calls=0;
 for(const protocolVersion of [undefined,'3','invalid',true,4]){
  globalThis.fetch=async()=>({ok:true,json:async()=>({protocolVersion})});
  const container={innerHTML:''};await mountResearchCommunity({container,chainRead:async()=>{calls++;throw Error('must not call');}});
  assert.match(container.innerHTML,/feature unavailable/);
 }
 assert.equal(calls,0);
});
test('incomplete active native reads show unavailable instead of zero activity',async t=>{
 const prior=globalThis.fetch;t.after(()=>globalThis.fetch=prior);globalThis.fetch=async()=>({ok:true,json:async()=>({protocolVersion:3,contract:'0x1'})});
 const container={innerHTML:''};await mountResearchCommunity({container,chainRead:async()=>{throw Error('network unavailable');}});
 assert.match(container.innerHTML,/could not be read completely/);assert.ok(!container.innerHTML.includes('side-counts'));
});
test('a temporary native outage clears the old problem badge and offers a fresh retry',async t=>{
 const previousFetch=globalThis.fetch,previousDocument=globalThis.document;
 t.after(()=>{globalThis.fetch=previousFetch;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
 globalThis.fetch=async()=>({ok:true,json:async()=>({protocolVersion:3,contract:'0x123'})});
 const badge={textContent:'OPEN'},button={};globalThis.document={querySelector:()=>badge};
 const container={innerHTML:'',querySelector:()=>button};let calls=0;
 await mountResearchCommunity({container,chainRead:async()=>{calls++;throw Error('unavailable');}});
 assert.equal(badge.textContent,'STATUS UNAVAILABLE');assert.match(container.innerHTML,/Live data temporarily unavailable/);
 assert.ok(!container.innerHTML.includes('are not active here'));assert.equal(typeof button.onclick,'function');
 await button.onclick();assert.equal(calls,10);assert.ok(!container.innerHTML.includes('side-counts'));
});
test('complete native fixture renders source authors, correction history and under-review status',async t=>{
 const previousFetch=globalThis.fetch,previousDocument=globalThis.document;
 t.after(()=>{globalThis.fetch=previousFetch;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
 globalThis.fetch=async()=>({ok:true,json:async()=>({protocolVersion:3,contract:'0x123'})});
 const badge={textContent:''};globalThis.document={querySelector:()=>badge};
 const buttons=new Map(),container={innerHTML:'',querySelector:selector=>{if(!buttons.has(selector))buttons.set(selector,{});return buttons.get(selector);}};
 const source={reference:'https://example.org/paper',title:'External result',authors:['Source Author'],relationship:'Formalizes the result with explicit assumptions.',priority_evidence:'Dated public source and its publication history.'};
 const record={status:'credited',credited_points:'100',evidence:{id:'c1',pr:7,wallet:'0x111',research_direction:'shared',title:'Verified integration',dependencies:[]}};
 const views={get_affiliations:[{wallet:'0x111',side:'p-not-equals-np',changed_at:1700000000,history:[]}],get_external_authors:[{id:'a1',name:'Source Author',sources:[source.reference],unclaimed_points:'200',claimed_wallet:null}],get_problem:{id:'p-vs-np',status:'external-solution-under-review',target_statement_hash:null,external_solutions:[{source:source.reference,status:'under-review'}]},list_contributions:['c1'],get:record,get_provenance:{contribution:'c1',version:2,mode:'formalization',sources:[source],corrections:[{case:'case1'}]},list_cases:['case1'],get_case:{id:'case1',kind:'attribution',status:'settled',target:'c1',history:[{reason:'Earlier source now attributed.'}]}};
 const methods=[];await mountResearchCommunity({container,chainRead:async(_,method)=>{methods.push(method);return views[method];}});
 assert.match(container.innerHTML,/Live · finalized protocol v3 reads/);assert.match(container.innerHTML,/Verified integration/);assert.match(container.innerHTML,/Source Author/);assert.match(container.innerHTML,/200 unclaimed points/);assert.match(container.innerHTML,/No author wallet assigned/);assert.match(container.innerHTML,/Earlier source now attributed/);assert.equal(badge.textContent,'UNDER REVIEW');assert.ok(!container.innerHTML.includes('Resolved by the native problem registry'));
 assert.equal(typeof buttons.get('[data-affiliation]').onclick,'function');assert.ok(methods.includes('get_provenance'));
});

import {validatedCommunitySnapshot} from '../public/community-snapshot.mjs';
function publishedFixture(){
 const wallet='0x'+'1'.repeat(40),author='author-'+'a'.repeat(32),caseId='case-'+'c'.repeat(32),id='pr-1-ee4678fc76d9-5c22de45baf0';
 const deployment={protocolVersion:3,contract:'0x'+'2'.repeat(40),chainId:61999,codeHash:'a'.repeat(64),policy:'b'.repeat(64)};
 const source={reference:'https://example.org/paper',title:'Published source',authors:['Source Author'],relationship:'Formalizes the existing source result.',priority_evidence:'Reviewed dated publication evidence.'};
 const snapshot={version:1,contract:deployment.contract,chainId:deployment.chainId,codeHash:deployment.codeHash,policy:deployment.policy,collectedAt:'2026-11-22T12:00:00.000Z',
  affiliations:[{wallet,side:'shared',changed_at:'1795348800',history:[{side:'shared',at:'1795348800'}]}],
  authors:[{id:author,name:'Source Author',sources:[source.reference],unclaimed_points:'0',claimed_wallet:wallet,claim_history:[{case:caseId,wallet,at:'1795348800'}]}],
  problem:{id:'p-vs-np',status:'open',target_statement_hash:'',external_solutions:[caseId]},
  records:[{status:'credited',credited_points:'300',evidence:{id,pr:'1',wallet,research_direction:'shared',title:'Accepted published integration',dependencies:[]}}],
  provenances:[{id,value:{contribution:id,version:'1',mode:'formalization',sources:[source],original_initial_points:'300',current_initial_points:'300',external_allocations:[],revoked_points:'0',corrections:[{case:caseId,reason:'Reviewed source attribution.'}]}}],
  cases:[{id:caseId,kind:'external-solution',target:'p-vs-np',reporter:wallet,payload:{sources:[source]},status:'settled',round:'0',deadline:'1795348800',verdict:{resolve:false},history:[{event:'settlement',at:'1795348800'}]}],
  impacts:[{id,value:{downstream:id,status:'not-requested'}}],
  walletBalances:[{wallet,value:{problem:'p-vs-np',historical_initial_points:'300',total_historical_initial_awarded:'700',total_awarded:'800',points:'300',initial_points:'300',impact_points:'0',total_impact_points:'100',transferable:false,mode:'contribution points on the Intelligent Contract'}}]};
 return {snapshot,deployment};
}
test('published snapshot validator binds the deployment, preserves native strings and accepts bounded optional views',()=>{
 const {snapshot,deployment}=publishedFixture();
 assert.equal(validatedCommunitySnapshot(snapshot,deployment),snapshot);
 const withoutOptional=structuredClone(snapshot);delete withoutOptional.impacts;delete withoutOptional.walletBalances;withoutOptional.future_display_field='Ignored metadata';
 assert.equal(validatedCommunitySnapshot(withoutOptional,deployment),withoutOptional);
 const fullImpact=structuredClone(snapshot);fullImpact.impacts[0].value={downstream:snapshot.records[0].evidence.id,status:'settled',budget:'300',round:'0',deadline:'1795348800',paid_points:'100',eligible:[],allocations:[{id:snapshot.records[0].evidence.id,band:'1',reason:'Verified reuse.'}],challenges:[]};
 assert.equal(validatedCommunitySnapshot(fullImpact,deployment),fullImpact);
 for(const [field,value] of [['version',2],['version','1'],['contract','0x'+'3'.repeat(40)],['chainId',1],['chainId','61999'],['codeHash','c'.repeat(64)],['policy','d'.repeat(64)],['collectedAt','not a date'],['collectedAt',new Date(Date.now()+120000).toISOString()]]){
  assert.equal(validatedCommunitySnapshot({...snapshot,[field]:value},deployment),null,field);
 }
 assert.equal(validatedCommunitySnapshot(snapshot,{...deployment,protocolVersion:2}),null);
});
test('published snapshot rejects malformed native arrays, cross-record mappings and optional accounting views',()=>{
 const {snapshot,deployment}=publishedFixture();
 const mutations=[
  s=>{s.affiliations={};},s=>{s.affiliations[0].side='a fake side';},s=>{s.affiliations[0].history[0].at=-1;},s=>{s.affiliations=Array(501).fill(s.affiliations[0]);},
  s=>{s.authors[0].claimed_wallet='not a wallet';},s=>{s.authors[0].sources=['javascript:alert(1)'];},s=>{s.authors[0].unclaimed_points='-1';},s=>{s.authors.push(s.authors[0]);},
  s=>{s.problem.status='solved';},s=>{s.problem.external_solutions=[{}];},s=>{s.records[0].evidence.dependencies={};},s=>{s.records.push(s.records[0]);},
  s=>{s.provenances=[];},s=>{s.provenances[0].value.contribution='different';},s=>{s.provenances[0].value.sources[0].authors=Array(9).fill('Name');},s=>{s.provenances[0].value.corrections=[null];},
  s=>{s.cases[0].round='3';},s=>{s.cases[0].history='not a list';},s=>{s.cases[0].payload.sources[0].reference='https://user:pass@example.org';},
  s=>{s.impacts[0].id='different';},s=>{s.impacts[0].value.downstream='different';},s=>{s.impacts[0].value.status='made-up';},s=>{s.walletBalances[0].value.points='infinite';},s=>{s.walletBalances[0].value.transferable=true;},s=>{s.walletBalances[0].value.problem='different';},s=>{s.walletBalances.push(s.walletBalances[0]);},
 ];
 for(const mutate of mutations){const bad=structuredClone(snapshot);mutate(bad);assert.equal(validatedCommunitySnapshot(bad,deployment),null,String(mutate));}
});
test('native failure renders a dated snapshot with escaped native fields, no Live label, and manual recovery',async t=>{
 const previousFetch=globalThis.fetch,previousDocument=globalThis.document;t.after(()=>{globalThis.fetch=previousFetch;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
 const {snapshot,deployment}=publishedFixture(),requests=[];
 snapshot.records[0].evidence.title='<img src=x onerror=alert(1)> accepted integration';
 globalThis.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>url==='deployment-metadata.json'?deployment:snapshot};};
 const badge={textContent:'OPEN'},buttons=new Map();globalThis.document={querySelector:()=>badge};
 const container={innerHTML:'',querySelector:selector=>{if(!buttons.has(selector))buttons.set(selector,{});return buttons.get(selector);}};
 let available=false;
 const views={get_affiliations:snapshot.affiliations,get_external_authors:snapshot.authors,get_problem:snapshot.problem,list_contributions:snapshot.records.map(r=>r.evidence.id),get:snapshot.records[0],get_provenance:snapshot.provenances[0].value,list_cases:snapshot.cases.map(c=>c.id),get_case:snapshot.cases[0]};
 await mountResearchCommunity({container,chainRead:async(_,method)=>{if(!available)throw Error('rate limited');return views[method];}});
 assert.deepEqual(requests,['deployment-metadata.json','community-snapshot.json']);
 assert.match(container.innerHTML,/Published snapshot · 2026-11-22T12:00:00.000Z/);assert.match(container.innerHTML,/Historical finalized views/);assert.match(container.innerHTML,/not current state/);assert.match(container.innerHTML,/PROBLEM STATUS · PUBLISHED SNAPSHOT/);
 assert.ok(!/\bLive\b|\bfresh\b/.test(container.innerHTML));assert.equal(badge.textContent,'SNAPSHOT · OPEN');
 assert.match(container.innerHTML,/Source Author/);assert.match(container.innerHTML,/Registered source/);assert.match(container.innerHTML,/Verified claim recorded/);assert.match(container.innerHTML,/Reviewed — not a resolution/);assert.match(container.innerHTML,/&lt;img/);assert.ok(!container.innerHTML.includes('<img'));assert.match(container.innerHTML,/side-counts/);
 assert.equal(typeof buttons.get('[data-refresh-community]').onclick,'function');available=true;await buttons.get('[data-refresh-community]').onclick();
 assert.equal(badge.textContent,'OPEN');assert.match(container.innerHTML,/Live · finalized protocol v3 reads/);assert.ok(!container.innerHTML.includes('Published snapshot'));assert.equal(requests.filter(x=>x==='community-snapshot.json').length,1);
});
test('wrong-deployment and malformed snapshots fail closed without retaining previous counts',async t=>{
 const previousFetch=globalThis.fetch,previousDocument=globalThis.document;t.after(()=>{globalThis.fetch=previousFetch;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
 const {snapshot,deployment}=publishedFixture(),badge={textContent:'SNAPSHOT · OPEN'},button={};globalThis.document={querySelector:()=>badge};
 for(const bad of [{...snapshot,policy:'0'.repeat(64)},{...snapshot,cases:null}]){
  globalThis.fetch=async url=>({ok:true,json:async()=>url==='deployment-metadata.json'?deployment:bad});
  const container={innerHTML:'old counts',querySelector:()=>button};await mountResearchCommunity({container,chainRead:async()=>{throw Error('offline');}});
  assert.equal(badge.textContent,'STATUS UNAVAILABLE');assert.match(container.innerHTML,/no valid published snapshot/);assert.ok(!container.innerHTML.includes('side-counts'));assert.ok(!container.innerHTML.includes('Published snapshot ·'));assert.equal(typeof button.onclick,'function');
 }
});
