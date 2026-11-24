import registry from './questions.json' with {type:'json'};
import {DOMAIN,canonical,bytes,digest,need,validateQuestion,validateForecast,aggregate,leaderboard,resolveCheckpoint} from './core.mjs';
import {captureNative} from './native.mjs';
const questions=registry.map(validateQuestion);
const ALLOWED_ORIGINS=new Set(['https://muncleuscles.github.io','https://pnp.fun','https://www.pnp.fun','http://localhost:4178','http://127.0.0.1:4178']);
const parseRow=r=>({...JSON.parse(r.payload),participant:r.participant,acceptedAt:r.accepted_at,receipt:r.receipt,publicKey:JSON.parse(r.public_key),signature:r.signature,sequence:r.seq});
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const first=async(db,sql,...args)=>db.prepare(sql).bind(...args).first();
async function initialize(db){
 for(const q of questions){const hash=await digest(q);await db.prepare('INSERT OR IGNORE INTO questions (id, hash, definition) VALUES (?, ?, ?)').bind(q.id,hash,canonical(q)).run();const row=await first(db,'SELECT hash FROM questions WHERE id = ?',q.id);need(row.hash===hash,'Published question changed; restore its original definition');}
 const saved=await all(db,'SELECT id FROM questions');need(saved.every(q=>questions.some(x=>x.id===q.id)),'Published questions cannot be removed');
}
async function rateLimit(db,key,now,limit=30){
 const bucket=Math.floor(now/900000);
 const row=await db.prepare('INSERT INTO rate_limits (key, bucket, count) VALUES (?, ?, 1) ON CONFLICT(key, bucket) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(key,bucket,limit).first();
 need(row,'Too many requests; try again in 15 minutes');
}
async function boundedBody(request){const reader=request.body?.getReader();need(reader,'Empty body');let length=0;const chunks=[];for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>8192){await reader.cancel();throw Error('Submission too large');}chunks.push(value);}const out=new Uint8Array(length);let i=0;for(const c of chunks){out.set(c,i);i+=c.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(out));}
async function submit(request,db,now){
 const {forecast,publicKey,signature}=await boundedBody(request),q=questions.find(q=>q.id===forecast?.questionId);need(q,'Unknown question');validateForecast(forecast,q,now);need(forecast.questionHash===await digest(q),'Question rules changed; refresh before publishing');
 need(publicKey&&Object.keys(publicKey).sort().join(',')==='crv,kty,x,y'&&publicKey.kty==='EC'&&publicKey.crv==='P-256'&&/^[A-Za-z0-9_-]{43}$/.test(publicKey.x)&&/^[A-Za-z0-9_-]{43}$/.test(publicKey.y),'Invalid public identity');
 need(typeof signature==='string'&&/^[a-f0-9]{128}$/.test(signature),'Invalid signature');
 const participant=await digest(publicKey),key=await crypto.subtle.importKey('jwk',publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const signatureBytes=new Uint8Array(signature.match(/../g).map(x=>parseInt(x,16)));
 need(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signatureBytes,bytes(canonical(forecast))),'Signature does not match this identity');
 const duplicate=await first(db,'SELECT * FROM forecasts WHERE participant = ? AND nonce = ?',participant,forecast.nonce);
 if(duplicate){need(duplicate.payload===canonical(forecast),'Nonce already used');return parseRow(duplicate);}
 await rateLimit(db,await digest('submit:'+ (request.headers.get('CF-Connecting-IP')||'local')),now);
 const latest=await first(db,'SELECT * FROM forecasts WHERE participant = ? AND question_id = ? ORDER BY revision DESC LIMIT 1',participant,q.id);
 need(forecast.revision===(latest?latest.revision+1:1)&&forecast.previous===(latest?.receipt||null),'Forecast history changed; refresh and try again');
 need(!latest||now-Date.parse(latest.accepted_at)>=60000,'Wait one minute between revisions');
 const count=await first(db,'SELECT count(*) AS n FROM forecasts WHERE question_id = ?',q.id);need(count.n<10000,'This pilot question has reached its recording capacity');
 const acceptedAt=new Date(now).toISOString(),receipt=await digest({participant,forecast,publicKey,signature,acceptedAt});
 const result=await db.prepare('INSERT OR IGNORE INTO forecasts (question_id, participant, revision, nonce, accepted_at, payload, public_key, signature, receipt) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE COALESCE((SELECT MAX(revision) FROM forecasts WHERE question_id = ? AND participant = ?), 0) = ?').bind(q.id,participant,forecast.revision,forecast.nonce,acceptedAt,canonical(forecast),canonical(publicKey),signature,receipt,q.id,participant,forecast.revision-1).run();
 need(result.meta.changes===1,'Concurrent revision; refresh and try again');return {participant,...forecast,acceptedAt,receipt,publicKey,signature};
}
async function latestAt(db,at){return (await all(db,'SELECT participant, question_id AS questionId, revision, accepted_at AS acceptedAt, json_extract(payload, \'$.probability\') AS probability FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY question_id, participant ORDER BY revision DESC) AS position FROM forecasts WHERE accepted_at <= ?) WHERE position = 1',new Date(at).toISOString()));}
async function resolutions(db){return (await all(db,'SELECT result FROM resolutions')).map(r=>JSON.parse(r.result));}
async function tick(db,now,capture){
 const done=await resolutions(db),pending=questions.filter(q=>!done.some(r=>r.questionId===q.id)&&now>=Date.parse(q.checkpointAt));if(!pending.length)return {checkedAt:new Date(now).toISOString(),resolutions:done};
 let evidence;
 for(const q of pending){let result;
  if(now>Date.parse(q.resolutionDeadline))result={questionId:q.id,status:'inconclusive',reason:'The fixed checkpoint window passed without a complete stable native reading. No score.'};
  else {evidence??=await capture(q.source);result=resolveCheckpoint(q,evidence);result.evidence=evidence;result.evidenceHash=await digest(evidence);}
  result.questionHash=await digest(q);result.resolvedAt=new Date().toISOString();await db.prepare('INSERT OR IGNORE INTO resolutions (question_id, result) VALUES (?, ?)').bind(q.id,canonical(result)).run();
 }
 return {checkedAt:new Date().toISOString(),resolutions:await resolutions(db)};
}
export function createWorker({clock=()=>Date.now(),capture=captureNative}={}){return {async fetch(request,env,ctx){
 const url=new URL(request.url),origin=request.headers.get('Origin'),cors=origin&&(ALLOWED_ORIGINS.has(origin)||origin===url.origin)?origin:null;
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cors?{'Access-Control-Allow-Origin':cors,'Vary':'Origin'}:{})};
 const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
 if(origin&&!cors&&request.method==='POST')return json({error:'Origin not permitted'},403);
 if(url.pathname==='/')return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>pnp.fun Forecast Desk</title><body style="font:20px Georgia;max-width:42rem;margin:10vh auto;padding:2rem;background:#eee9db;color:#26261f"><p>pnp.fun · Infinite monkeys. Finite proofs.</p><h1>The Ape Forecasting Desk</h1><p>Some apes prove. Some apes predict. Everyone learns.</p><p><a href="https://muncleuscles.github.io/p-vs-np/#/forecasts">Call your shot on pnp.fun</a></p><p>This service stores public, signed forecasts. Research points and forecast scores are separate.</p><p><a href="/api/questions">Question registry</a> · <a href="/api/audit">Public audit log</a></p></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
 try{
  need(env.DB,'Forecast storage unavailable');await initialize(env.DB);const now=clock();
  if(request.method==='POST'&&url.pathname==='/api/forecasts')return json(await submit(request,env.DB,now),201);
  if(request.method==='POST'&&url.pathname==='/api/checkpoint'){await rateLimit(env.DB,'checkpoint',now,5);return json(await tick(env.DB,now,capture));}
  if(request.method!=='GET')return json({error:'Method not allowed'},405);
  if(url.pathname==='/api/questions'){
   const latest=await latestAt(env.DB,now),trends=new Map(questions.map(q=>[q.id,[]]));
   const firstDay=Math.min(...questions.map(q=>Date.parse(q.opensAt))),last=Math.min(now,Math.max(...questions.map(q=>Date.parse(q.closesAt))));
   // At most 14 daily snapshots plus the current call; questions remain small and bounded.
   for(let t=firstDay;t<last;t+=Math.max(86400000,Math.ceil((last-firstDay)/14))){const past=await latestAt(env.DB,t);for(const q of questions)if(t>=Date.parse(q.opensAt)&&t<=Date.parse(q.closesAt))trends.get(q.id).push({at:new Date(t).toISOString(),...aggregate(past.filter(r=>r.questionId===q.id),q,t)});}
   for(const q of questions)trends.get(q.id).push({at:new Date(Math.min(now,Date.parse(q.closesAt))).toISOString(),...aggregate(latest.filter(r=>r.questionId===q.id),q,now)});
   const rs=await resolutions(env.DB);
   return json({serverTime:new Date(now).toISOString(),questions:await Promise.all(questions.map(async q=>({...q,hash:await digest(q),trend:trends.get(q.id),aggregate:aggregate(latest.filter(r=>r.questionId===q.id),q,now),resolution:rs.find(r=>r.questionId===q.id)||null}))),identityPolicy:'Browser signing identities are pseudonyms, not verified independent people. One current forecast per identity; multiple identities remain possible.'});
  }
  if(url.pathname==='/api/audit'){
   const after=Number(url.searchParams.get('after')||0),participant=url.searchParams.get('participant'),question=url.searchParams.get('question');need(Number.isSafeInteger(after)&&after>=0,'Invalid cursor');need(!participant||/^[a-f0-9]{64}$/.test(participant),'Invalid participant');need(!question||questions.some(q=>q.id===question),'Invalid question');
   const rows=await all(env.DB,'SELECT * FROM forecasts WHERE seq > ? AND (? IS NULL OR participant = ?) AND (? IS NULL OR question_id = ?) ORDER BY seq LIMIT 101',after,participant,participant,question,question);
   return json({records:rows.slice(0,100).map(parseRow),nextCursor:rows.length>100?rows[99].seq:null});
  }
  if(url.pathname==='/api/leaderboard'){
   const rs=await resolutions(env.DB),ids=rs.filter(r=>r.status==='resolved').map(r=>r.questionId);let rows=[];for(const id of ids)rows.push(...(await all(env.DB,'SELECT * FROM forecasts WHERE question_id = ?',id)).map(parseRow));
   return json({ranks:leaderboard(questions,rows,rs),scoring:'Time-weighted Brier loss. Lower is better. Neutral 50% before first submission. At least 50% window participation to rank. Each eligible question has equal weight. Inconclusive questions excluded.',provisional:true});
  }
  return json({error:'Not found'},404);
 }catch(error){const message=String(error.message);const expected=/Invalid|Choose|Reason|Wrong|not open|Unknown|refresh|Signature|Nonce|Wait|Too many|capacity|Concurrent|Submission too large|Empty body|Origin/.test(message);return json({error:expected?message:'The forecast service could not verify this request. Please try again later.'},expected?400:503);}
}};}
export default createWorker();
