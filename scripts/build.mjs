import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
fs.mkdirSync('dist',{recursive:true});fs.cpSync('public','dist',{recursive:true});
await build({entryPoints:['public/app.mjs'],bundle:true,outfile:'dist/app.js',minify:true,platform:'browser',target:'es2022'});
fs.rmSync('dist/app.mjs',{force:true});
for(const file of ['README.md','AGENTS.md'])if(fs.existsSync(file))fs.copyFileSync(file,'dist/'+file);
execFileSync('python3',['scripts/package.py'],{stdio:'inherit'});
console.log('Built Open Mathematics in dist/');
