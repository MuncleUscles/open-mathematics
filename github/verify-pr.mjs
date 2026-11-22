// Trusted worker entrypoint. Run from a reviewed immutable checkout, never PR code.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {recoverMessageAddress} from 'viem';import {privateKeyToAccount} from 'viem/accounts';
import {GitHub} from '../src/github.mjs';import {validateClaim,message,digest,canonical} from '../src/security.mjs';
const [claimFile]=process.argv.slice(2);if(!claimFile)throw Error('Usage: node github/verify-pr.mjs signed-claim.json');
const {claim,signature}=JSON.parse(fs.readFileSync(claimFile,'utf8'));
validateClaim(claim,{domain:process.env.APP_ORIGIN,chainId:Number(process.env.CHAIN_ID||61999),now:Number(process.env.CLAIM_AT||Date.now())});
const signer=await recoverMessageAddress({message:message(claim),signature});if(signer.toLowerCase()!==claim.wallet.toLowerCase())throw Error('Invalid wallet claim');
const gh=new GitHub({repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN});const pr=await gh.bindAuthor(claim.pr,claim);
// Narrow formal adapter. General research contributions need their own reviewed
// objective evidence policy, not a universal "verified" flag.
const files=await gh.request(`/pulls/${claim.pr}/files?per_page=100`);
if(pr.changed_files!==files.length||files.length!==1||files[0].filename!=='research/proofs/renaming.proof')throw Error('Only the enrolled proof expression may change');
const blob=await gh.request(`/contents/research/proofs/renaming.proof?ref=${claim.head}`);
if(blob.type!=='file'||blob.encoding!=='base64'||blob.size>12000)throw Error('Invalid proof blob');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-proof-'));try{
 const proof=path.join(dir,'candidate.proof');fs.writeFileSync(proof,Buffer.from(blob.content,'base64'));
 const run=spawnSync('python3',['scripts/verify_lean.py',proof,'--head',claim.head,'--base',pr.base.sha,'--repository',gh.repository],{encoding:'utf8',timeout:60000,maxBuffer:100000,env:{PATH:process.env.PATH,TRUSTED_LEAN_IMAGE:process.env.TRUSTED_LEAN_IMAGE}});
 if(run.status!==0)throw Error('Isolated verifier rejected: '+run.stderr);
 const evidence={...JSON.parse(run.stdout),claim_digest:digest(claim),wallet:claim.wallet,pr:claim.pr};const verifier=privateKeyToAccount(process.env.VERIFIER_SIGNING_KEY);
 const attestation={evidence,claimDigest:digest(claim),verifier:verifier.address,signature:await verifier.signMessage({message:'Open Mathematics proof attestation v1\n'+canonical(evidence)})};
 console.log(JSON.stringify(attestation,null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
