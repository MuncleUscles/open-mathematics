import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {loadOpenProblem,verifyOpenCheckout,readProblemFile,parseProblemJSON} from '../src/open-research.mjs';
import {validateGitHubAccountsDeployment,collectGitHubAccountsSnapshot} from '../src/github-accounts.mjs';
import {clientFor,read} from '../github/runtime.mjs';
import {withStudioBatchPacing} from '../github/batch-studio-client.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: build-open-site.mjs TRUSTED_PROBLEM OUTPUT [--snapshot | --preview for local layout only] [--protocol-checkout PATH]';

export function parseOpenSiteArgs(argv,{actions=Boolean(process.env.GITHUB_ACTIONS)}={}){
 const [directory,destination,...options]=argv;
 if(!directory||!destination||directory.startsWith('--')||destination.startsWith('--'))throw Error(usage);
 let preview=false,snapshot=false,protocolCheckout;
 for(let index=0;index<options.length;index++){
  const option=options[index];
  if(option==='--snapshot'&&!snapshot&&!preview)snapshot=true;
  else if(option==='--preview'&&!preview&&!snapshot)preview=true;
  else if(option==='--protocol-checkout'&&protocolCheckout===undefined&&options[index+1]&&!options[index+1].startsWith('--'))protocolCheckout=options[++index];
  else throw Error(usage);
 }
 if(preview&&(actions||protocolCheckout!==undefined))throw Error(usage);
 return {directory,destination,preview,snapshot,protocolCheckout};
}

function rendererCommit(directory,{preview}){
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:directory,encoding:'utf8'}).trim();
 if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Pinned renderer commit required');
 if(!preview){
  execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:directory,stdio:'pipe'});
  if(execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:directory,encoding:'utf8'}).trim())throw Error('Untracked files in trusted renderer checkout');
 }
 return commit;
}

// Presentation may ship independently. The problem's protocol pin still owns
// all submission tools and snapshot capture; a renderer release never replaces it.
export async function buildOpenSite({directory,destination,preview=false,snapshot=false,protocolCheckout},{rendererRoot=root}={}){
 if(preview&&(snapshot||protocolCheckout!==undefined||process.env.GITHUB_ACTIONS))throw Error(usage);
 const p=loadOpenProblem(directory),protocolRoot=protocolCheckout===undefined?rendererRoot:fs.realpathSync(protocolCheckout);
 if(!preview)verifyOpenCheckout(p,protocolRoot);
 const commit=rendererCommit(rendererRoot,{preview});
 fs.mkdirSync(destination,{recursive:true});
 fs.rmSync(path.join(destination,'ledger-snapshot.json'),{force:true});
 if(snapshot)execFileSync(process.execPath,[path.join(protocolRoot,'scripts/capture-open-ledger.mjs'),path.resolve(directory),path.resolve(destination,'ledger-snapshot.json')],{cwd:protocolRoot,stdio:'inherit'});
 let githubAccounts;
 fs.rmSync(path.join(destination,'github-accounts-snapshot.json'),{force:true});
 fs.rmSync(path.join(destination,'contributors.json'),{force:true});
 if(fs.existsSync(path.join(p.root,'.open-math/github-accounts.json'))){
  githubAccounts=validateGitHubAccountsDeployment(parseProblemJSON(readProblemFile(p.root,'.open-math/github-accounts.json')),p);
  if(snapshot){
   const client=withStudioBatchPacing(clientFor());if(await client.getChainId()!==githubAccounts.chainId)throw Error('Wrong account ledger chain');
   const accounts=await collectGitHubAccountsSnapshot({deployment:githubAccounts,read:(method,args=[])=>read(client,githubAccounts.contract,method,args)});
   fs.writeFileSync(path.join(destination,'github-accounts-snapshot.json'),JSON.stringify(accounts)+'\n');
  }
 }
 fs.copyFileSync(path.join(rendererRoot,'public/open/index.html'),path.join(destination,'index.html'));
 for(const name of ['style.css','favicon.svg'])fs.copyFileSync(path.join(rendererRoot,'public/open',name),path.join(destination,name));
 fs.cpSync(path.join(rendererRoot,'public/open/assets'),path.join(destination,'assets'),{recursive:true});
 const presentation={commit,protocolCommit:p.descriptor.protocol.commit,readOnly:true};
 fs.writeFileSync(path.join(destination,'problem.json'),JSON.stringify({descriptor:p.descriptor,deployment:p.deployment,policyHash:p.policyHash,policy:p.policy,preview,presentation,...(githubAccounts?{githubAccounts}:{})},null,2)+'\n');
 fs.writeFileSync(path.join(destination,'agent.json'),JSON.stringify({version:5,objective:p.policy.objective,admission:'open',guide:`https://github.com/${p.descriptor.repository}/blob/main/AGENTS.md`,protocol:p.descriptor.protocol,rewards:'Native nontransferable contribution and later-impact points',wallet:'Contributor-owned; signatures only',liveContract:p.deployment.contract},null,2)+'\n');fs.writeFileSync(path.join(destination,'.nojekyll'),'');
 await build({entryPoints:[path.join(rendererRoot,'public/open/app.mjs')],outfile:path.join(destination,'app.js'),bundle:true,format:'esm',platform:'browser',minify:true});
 return {directory:destination,mode:preview?'local-layout-preview':'live-native-read',admission:'open',contract:p.deployment.contract,presentation};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildOpenSite(parseOpenSiteArgs(process.argv.slice(2)))));
