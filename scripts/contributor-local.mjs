// Contributor-machine utilities only. Never log credential material or send it
// to a contribution checkout; GitHub authentication is used for public reads.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {loadLocalSigner} from './problem-agent.mjs';

function token(value){
 if(typeof value!=='string'||value.length>8192)throw Error('Invalid GitHub read credential configuration');
 const normalized=value.trim();
 if(normalized&&!/^[\x21-\x7e]+$/.test(normalized))throw Error('Invalid GitHub read credential configuration');
 return normalized||undefined;
}

/** Returns a credential or undefined; callers must never serialize the return value. */
export function resolveContributorGitHubToken({env=process.env,run=spawnSync}={}){
 for(const name of ['GITHUB_TOKEN','GH_TOKEN']){
  if(env[name]!==undefined){const value=token(env[name]);if(value)return value;}
 }
 try{
  const result=run('gh',['auth','token','--hostname','github.com'],{
   encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:4000,maxBuffer:16384,env,
  });
  if(result?.status!==0||result.error||result.signal)return undefined;
  return token(result.stdout);
 }catch{return undefined;} // No CLI, no login, timeout or malformed output: public anonymous reads.
}

function walletPath(file,roots){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||file.split(path.sep).includes('..'))
  throw Error('Use an explicit absolute wallet file path outside repositories');
 const target=path.normalize(file),parent=path.dirname(target);
 if(target===parent)throw Error('Wallet destination must be a file');
 let directory=path.parse(parent).root;
 const components=parent.slice(directory.length).split(path.sep).filter(Boolean);
 for(const component of ['',...components]){
  if(component)directory=path.join(directory,component);
  const stat=fs.lstatSync(directory,{throwIfNoEntry:false});
  if(!stat||!stat.isDirectory()||stat.isSymbolicLink())
   throw Error('Wallet parent must already exist and contain no symlinks');
  if(fs.lstatSync(path.join(directory,'.git'),{throwIfNoEntry:false}))
   throw Error('Keep the private wallet file outside every Git repository');
 }
 if(!Array.isArray(roots))throw Error('Repository guard roots must be an array');
 for(const root of roots){
  const real=fs.realpathSync(root);
  if(target===real||target.startsWith(real+path.sep))throw Error('Keep the private wallet file outside all repositories');
 }
 const stat=fs.lstatSync(target,{throwIfNoEntry:false});
 if(stat?.isSymbolicLink())throw Error('Wallet file cannot be a symlink');
 return {target,stat};
}

/** Creates an exclusive 0600 key file; returns only its public address. */
export function createLocalWallet(file,{roots=[]}={}){
 const {target,stat}=walletPath(file,roots);
 if(stat)throw Error('Refusing to overwrite an existing wallet path');
 const key=generatePrivateKey(),address=privateKeyToAccount(key).address;
 let fd;
 try{
  fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  fs.fchmodSync(fd,0o600);
  fs.writeFileSync(fd,key+'\n');
  fs.fsyncSync(fd);
 }catch{
  throw Error('Wallet creation failed; inspect the destination before trying again');
 }finally{if(fd!==undefined)fs.closeSync(fd);}
 return {address};
}

/** Reads an existing owner-only key locally and returns only its public address. */
export function localWalletAddress(file,{roots=[]}={}){
 const {target,stat}=walletPath(file,roots);
 if(!stat?.isFile()||stat.size>256)throw Error('A bounded regular wallet file is required');
 if((stat.mode&0o077)!==0)throw Error('Private wallet file must be readable only by its owner (chmod 600)');
 try{return {address:loadLocalSigner(target,roots).address};}
 catch{throw Error('Unable to read a valid local wallet; check the private file format and permissions');}
}
