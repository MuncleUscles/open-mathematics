import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {GitHub} from '../src/github.mjs';
import {MAX_EVIDENCE_BYTES,readEvidenceFile} from '../github/evidence-file.mjs';

const report='reports/pr-8-c9ee3e5efe6b-979433977845.json';
function fixture({bytes=Buffer.from('{"reason":"A résumé and a proof"}\n'),file=report,large=false}={}){
  const sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const blob={sha,size:bytes.length,encoding:'base64',content:bytes.toString('base64').match(/.{1,60}/g).join('\n')+'\n'};
  const metadata={...blob,type:'file',path:file,...(large?{encoding:'none',content:''}:{}),download_url:'https://untrusted.example/never-fetch'};
  const calls=[];
  const github={request:async(route,options)=>{
    calls.push({route,options});
    if(route===`/contents/${file}?ref=evidence`)return metadata;
    if(route===`/git/blobs/${sha}`)return blob;
    throw Error('Unexpected request '+route);
  }};
  return {github,metadata,blob,calls,sha,bytes,file};
}

test('inline evidence preserves exact UTF-8 bytes and the SHA for optimistic updates',async()=>{
  for(const file of [report,'index.json']){
    const f=fixture({file}),result=await readEvidenceFile(f.github,file);
    assert.deepEqual(result,{sha:f.sha,data:{reason:'A résumé and a proof'}});
    assert.deepEqual(f.calls.map(c=>c.route),[`/contents/${file}?ref=evidence`]);
    assert(f.calls.every(c=>Number.isSafeInteger(c.options.maxResponseBytes)));
  }
});

test('a report over 1 MiB loads the exact immutable blob and preserves finalized transaction journals',async()=>{
  const data={status:'submitted',transactions:{register:{hash:'0x'+'a'.repeat(64),receipt:{status:'FINALIZED',result:'SUCCESS',evidence:'x'.repeat(1024*1024)}}}};
  const f=fixture({bytes:Buffer.from(JSON.stringify(data,null,2)+'\n'),large:true});
  assert(f.bytes.length>1024*1024);
  assert.deepEqual(await readEvidenceFile(f.github,report),{sha:f.sha,data});
  assert.deepEqual(f.calls.map(c=>c.route),[`/contents/${report}?ref=evidence`,`/git/blobs/${f.sha}`]);
  assert(f.calls.every(c=>c.options.method===undefined));
});

test('metadata path, regular file, hash and size must be valid before requesting a fallback',async()=>{
  for(const mutation of [{path:'index.json'},{type:'symlink'},{sha:'bad'},{size:MAX_EVIDENCE_BYTES+1},{size:0},{size:'20'},{size:1.5}]){
    const f=fixture({large:true});Object.assign(f.metadata,mutation);
    await assert.rejects(readEvidenceFile(f.github,report),/Malformed evidence file/);
    assert.equal(f.calls.length,1);
  }
  const f=fixture();
  for(const file of ['../index.json','reports/../index.json','index.json?ref=main','https://example.com/report','reports/a/b.json'])
    await assert.rejects(readEvidenceFile(f.github,file),/invalid evidence path/);
  assert.equal(f.calls.length,0);
});

test('a changed blob, hash, encoding or size cannot stand in for the referenced evidence',async()=>{
  for(const mutation of [{sha:'a'.repeat(40)},{size:10},{encoding:'none'},{content:Buffer.from('different bytes').toString('base64')},{content:'%%%='}]){
    const f=fixture({large:true});Object.assign(f.blob,mutation);
    await assert.rejects(readEvidenceFile(f.github,report),/Malformed evidence file/);
  }
  const f=fixture();f.metadata.content=Buffer.from(f.bytes.toString().replace('proof','spoof')).toString('base64');
  await assert.rejects(readEvidenceFile(f.github,report),/Git blob hash mismatch/);
  const g=fixture();g.metadata.encoding='none'; // An incomplete response must not silently trigger a fallback.
  await assert.rejects(readEvidenceFile(g.github,report),/bounded base64/);assert.equal(g.calls.length,1);
});

test('invalid UTF-8, non-object JSON and noncanonical base64 are rejected after checking the blob hash',async()=>{
  for(const bytes of [Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d]),Buffer.from('null'),Buffer.from('[]'),Buffer.from('{broken'),Buffer.from('\ufeff{}')]){
    const f=fixture({bytes});await assert.rejects(readEvidenceFile(f.github,report),/UTF-8 JSON|JSON object/);
  }
  const f=fixture({bytes:Buffer.from('{}')});f.metadata.content='e31='; // Same decoded bytes, nonzero padding bits.
  await assert.rejects(readEvidenceFile(f.github,report),/base64 mismatch/);
  const g=fixture();g.metadata.content=g.metadata.content.replace('\n',' ');
  await assert.rejects(readEvidenceFile(g.github,report),/invalid base64/);
});

test('only an initial Contents 404 means missing; a missing immutable blob or transport error stays fatal',async()=>{
  const missing={request:async()=>{throw Error('GitHub 404');}};
  assert.equal(await readEvidenceFile(missing,report),null);
  for(const message of ['GitHub 403','GitHub 429','GitHub 500','network failed']){
    await assert.rejects(readEvidenceFile({request:async()=>{throw Error(message);}},report),{message});
  }
  for(const message of ['GitHub 404','GitHub 403','network failed']){
    const f=fixture({large:true}),request=f.github.request;
    f.github.request=async(...args)=>{if(args[0].startsWith('/git/blobs/'))throw Error(message);return request(...args);};
    await assert.rejects(readEvidenceFile(f.github,report),{message});
  }
});

test('the GitHub client bounds the streamed API response and refuses redirects for evidence reads',async()=>{
  const f=fixture({large:true}),calls=[];
  const gh=new GitHub({repository:'owner/problem',fetcher:async(url,options)=>{
    calls.push({url,options});
    return new Response(JSON.stringify(url.includes('/git/blobs/')?f.blob:f.metadata));
  }});
  assert.deepEqual(await readEvidenceFile(gh,report),{sha:f.sha,data:JSON.parse(f.bytes)});
  assert(calls.every(c=>c.options.redirect==='error'));
  for(const declared of [undefined,'20','bad']){
    let canceled=false;
    const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(20));},cancel(){canceled=true;}});
    const client=new GitHub({repository:'owner/problem',fetcher:async()=>new Response(body,{headers:declared===undefined?{}:{'content-length':declared}})});
    await assert.rejects(client.request('/contents/index.json',{maxResponseBytes:10}),/exceeds the byte limit/);
    assert.equal(canceled,true);
  }
  const client=new GitHub({repository:'owner/problem',fetcher:async()=>new Response(Buffer.from([0xff]))});
  await assert.rejects(client.request('/contents/index.json',{maxResponseBytes:10}),/encoded data/);
  await assert.rejects(client.request('/contents/index.json',{maxResponseBytes:0}),/Positive/);
});
