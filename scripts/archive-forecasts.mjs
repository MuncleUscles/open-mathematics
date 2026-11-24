import fs from 'node:fs';
const [configPath,output]=process.argv.slice(2);if(!configPath||!output)throw Error('Usage: archive-forecasts.mjs CONFIG OUTPUT');
const config=JSON.parse(fs.readFileSync(configPath,'utf8')),base=new URL(config.api);if(base.protocol!=='https:'||base.pathname!=='/')throw Error('HTTPS service origin required');
const get=async(path,method='GET')=>{const r=await fetch(base.origin+path,{method,signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`${path}: HTTP ${r.status}`);return r.json();};
const checkpoint=await get('/api/checkpoint','POST'),questions=await get('/api/questions'),leaderboard=await get('/api/leaderboard'),records=[];let cursor=0;
do{const page=await get('/api/audit?after='+cursor);records.push(...page.records);if(page.nextCursor!==null&&(!Number.isSafeInteger(page.nextCursor)||page.nextCursor<=cursor))throw Error('Invalid audit cursor');cursor=page.nextCursor;}while(cursor!==null);
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(output+'/forecast-audit.json',JSON.stringify({capturedAt:new Date().toISOString(),service:base.origin,checkpoint,questions,leaderboard,records},null,2)+'\n');console.log(JSON.stringify({questions:questions.questions.length,records:records.length,resolved:checkpoint.resolutions.length}));
