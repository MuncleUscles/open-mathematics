import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {Claims} from './security.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const port=Number(process.env.PORT||4173),origin=process.env.APP_ORIGIN||`http://localhost:${port}`;
if(process.env.MODE&&process.env.MODE!=='demo')throw Error('Live ingress is disabled until verifier and GitHub App enrollment is complete');
fs.mkdirSync(path.join(root,'.data'),{recursive:true});
const db=new DatabaseSync(path.join(root,'.data','claims.sqlite'));const claims=new Claims({domain:origin,db});
const limits=new Map();
const server=http.createServer(async(req,res)=>{try{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(req.url.startsWith('/api/')){
    if(req.method==='GET'&&req.url==='/api/status'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({mode:'demo',signatureVerification:'live-local',github:'not enrolled',studio:'see archived receipt',token:'simulated ledger'}));}
    if(req.method!=='POST'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))throw Error('Same-origin JSON required');
    const key=req.socket.remoteAddress,now=Date.now();let rate=limits.get(key);if(!rate||now-rate.start>60000){rate={start:now,count:0};limits.set(key,rate);}if(++rate.count>30)throw Error('Rate limit');
    let body='';for await(const chunk of req){body+=chunk;if(body.length>20000)throw Error('Request too large');}const input=JSON.parse(body);
    let result;if(req.url==='/api/challenge')result=claims.issue(input);else if(req.url==='/api/claim')result=await claims.verify(input.claim,input.signature);else throw Error('Unknown endpoint');
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));
  }
  if(req.method!=='GET'&&req.method!=='HEAD')throw Error('Method not allowed');
  const pathname=decodeURIComponent(new URL(req.url,origin).pathname);const file=path.resolve(root,'dist','.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(path.join(root,'dist')+path.sep))throw Error('Invalid path');
  if(!fs.existsSync(file)){res.statusCode=404;return res.end('Not found');}
  const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.zip':'application/zip','.md':'text/plain'}[path.extname(file)]||'application/octet-stream';res.setHeader('Content-Type',type);fs.createReadStream(file).pipe(res);
}catch(err){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:err.message}));}});
server.listen(port,'127.0.0.1',()=>console.log(`Open Mathematics: http://localhost:${port}`));
