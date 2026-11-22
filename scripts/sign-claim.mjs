// The contributor runs this locally. Only the public envelope goes to GitHub.
import fs from 'node:fs';import {randomBytes} from 'node:crypto';import {privateKeyToAccount} from 'viem/accounts';
import {canonical,digest,message} from '../src/security.mjs';
const [pr,head,metadataFile]=process.argv.slice(2);
if(!metadataFile||!process.env.CONTRIBUTOR_KEY_FILE)throw Error('CONTRIBUTOR_KEY_FILE=/private/path node scripts/sign-claim.mjs PR HEAD metadata.json');
const account=privateKeyToAccount(fs.readFileSync(process.env.CONTRIBUTOR_KEY_FILE,'utf8').trim());
const deployment=JSON.parse(fs.readFileSync('public/deployment.json','utf8'));
const claim={version:1,domain:deployment.origin,chainId:deployment.chainId,problem:'p-vs-np',repository:deployment.repository,pr:Number(pr),head,wallet:account.address,nonce:randomBytes(16).toString('hex'),expires:Date.now()+600000,contribution:JSON.parse(fs.readFileSync(metadataFile,'utf8'))};
const envelope={claim,signature:await account.signMessage({message:message(claim)})};
process.stdout.write(`Open-Mathematics-Claim: ${digest(claim)}\n\`\`\`json\n${JSON.stringify(envelope,null,2)}\n\`\`\`\n`);
