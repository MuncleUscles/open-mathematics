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
