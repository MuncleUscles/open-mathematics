import test from 'node:test';
import assert from 'node:assert/strict';
import {formalBundleTemplate,formalReuseReference,localCheckResult,submissionTemplate} from '../scripts/open-agent.mjs';
import {validateOpenArtifactBytes,validateOpenSubmission,sha256} from '../src/open-research.mjs';

test('formal starter is a bounded v2 Mathlib example while its submission still requires original research metadata',()=>{
 const bundle=formalBundleTemplate(),bytes=Buffer.from(JSON.stringify(bundle,null,2)+'\n');
 assert.equal(JSON.parse(validateOpenArtifactBytes(bytes,'formal')).version,2);
 assert.deepEqual(bundle.imports,['Mathlib.Data.Int.Basic','Mathlib.Tactic.Ring']);
 assert.match(bundle.source,/theorem result[\s\S]*\n  ring\n/);
 assert.match(bundle.source,/Textbook identity/);
 assert.equal(bundle.theorem,'Contribution.result');
 const wallet='0x'+'1'.repeat(40),record=submissionTemplate('my-result',wallet);
 assert.throws(()=>validateOpenSubmission(record,{wallet}),/replace|placeholder/i);
 assert.equal(formalBundleTemplate({policyVersion:5}).version,1);
 assert.throws(()=>formalBundleTemplate({policyVersion:99}),/Unsupported/);
});

test('reuse names bind exact raw bundle bytes and distinguish legacy and full-source targets',()=>{
 const modern=formalBundleTemplate(),legacy={version:1,definitions:[],statement:'True',proof:'by\n  constructor',dependencies:[]};
 for(const [bundle,target] of [[modern,'Contribution.result'],[legacy,'result'],[{...modern,theorem:'Other.answer'},'Other.answer']]){
  const proof=JSON.stringify(bundle,null,2)+'\n',hash=sha256(proof);
  const ref=formalReuseReference({evidence_kind:'formal',proof,bundle_hash:hash});
  assert.deepEqual(ref,{version:bundle.version,namespace:`B_${hash}`,theorem:`B_${hash}.${target}`,reference:`_root_.B_${hash}.${target}`});
  assert.throws(()=>formalReuseReference({evidence_kind:'formal',proof:proof+'\n',bundle_hash:hash}),/Exact formal bundle/);
 }
 assert.equal(formalReuseReference({evidence_kind:'research-note'}),null);
 assert.throws(()=>formalReuseReference({evidence_kind:'formal',proof:'{}\n',bundle_hash:sha256('{}\n')}),/bundle/);
});

test('local format checks cannot display proof verification and Docker results cannot be substituted by diagnostics',()=>{
 const syntax={result:'syntax-pass',mode:'syntax-only',verified:false,production_verified:false,verification:'syntax-only'};
 const isolated={result:'pass',mode:'isolated',verified:true,production_verified:true,verification:'verified'};
 assert.match(localCheckResult(syntax).assessment,/has not parsed, typechecked or proved/);
 assert.match(localCheckResult(isolated,{lean:true}).assessment,/not a merit decision or an award/);
 for(const result of [isolated,{...syntax,verified:true},{...syntax,production_verified:true},null,{},[]])assert.throws(()=>localCheckResult(result),/mode\/result mismatch/);
 for(const result of [syntax,{...isolated,mode:'local-diagnostic'},{...isolated,production_verified:false},{...isolated,verification:'diagnostic-only'}])assert.throws(()=>localCheckResult(result,{lean:true}),/mode\/result mismatch/);
});
