import fs from 'node:fs';
import {createAccount,generatePrivateKey} from 'genlayer-js';
import {clientFor,finalized,saveJSON} from '../github/runtime.mjs';
import {digest} from '../src/security.mjs';
fs.mkdirSync('.data',{recursive:true,mode:0o700});
for(const role of ['verifier','executor'])if(!process.env.OPERATOR_KEY_DIR&&!fs.existsSync(`.data/${role}.key`))fs.writeFileSync(`.data/${role}.key`,generatePrivateKey(),{mode:0o600});
const keyDir=process.env.OPERATOR_KEY_DIR||'.data';
const key=role=>fs.readFileSync(`${keyDir}/${role}.key`,'utf8').trim();
const verifier=createAccount(key('verifier')),executor=createAccount(key('executor')),client=clientFor(key('executor'));
const file=process.env.DEPLOYMENT_FILE||'public/deployment.json';const code=fs.readFileSync('contracts/research.py','utf8');
const d=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{protocolVersion:3,branch:'research',sourceBranch:'protocol',mode:'live',network:'studionet',chainId:61999,repository:'MuncleUscles/open-mathematics',origin:'https://muncleuscles.github.io',codeHash:digest(code),policy:digest(fs.readFileSync('lean/policy.json','utf8')),verifier:verifier.address,executor:executor.address,windowSeconds:300,appId:15368,verifierAppId:15368};
if(d.codeHash!==digest(code))throw Error('Deployment source changed');
if(!d.deployTx){d.deployTx=await client.deployContract({code,args:[d.verifier,d.executor,'p-vs-np',d.policy,d.windowSeconds,true,''],leaderOnly:false});saveJSON(file,d);}
const receipt=await finalized(client,d.deployTx);d.contract=receipt.data?.contract_address||receipt.to_address;d.receipt=receipt;saveJSON(file,d);console.log('Deployed',d.contract);
