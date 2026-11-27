#!/usr/bin/env node
// Curator tooling only. A compiled file cannot enroll itself or grant rewards.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {parseProblemJSON,readProblemFile,sha256,statementFingerprint,goalCommitment,validateProblemPolicy} from '../src/problem.mjs';
export function compilePack(directory,repository){
 const manifest=parseProblemJSON(readProblemFile(directory,'pack.json'));
 if(manifest.schemaVersion!==1||manifest.toolchain!=='leanprover/lean4:v4.19.0'||manifest.activation!=='draft-unenrolled')throw Error('Reviewed unenrolled Lean 4.19 problem pack required');
 for(const [file,hash]of Object.entries(manifest.trustedFiles))if(sha256(readProblemFile(directory,file))!==hash)throw Error('Pack content changed: '+file);
 const files={'Definitions.lean':manifest.definitions.sha256},goals={},copies=new Map([['Definitions.lean',readProblemFile(directory,manifest.definitions.path)]]);
 for(const source of manifest.goals){
  // A deferred task is not enrolled as a permanent reference: that would burn
  // its immutable id/proposition and prevent a later reward-eligible batch.
  if(source.status==='deferred'){if(source.rewardable)throw Error('Deferred goal cannot be rewardable');continue;}
  const file=`goals/${source.id}.lean`,bytes=readProblemFile(directory,source.statementPath);
  if(sha256(bytes)!==source.statementSha256||bytes.toString('utf8').trim()!==source.statementDisplay)throw Error('Statement mismatch');
  if(source.dependencies.length)throw Error('Initial pack does not import credited proofs');
  if(source.rewardable&&(source.referenceProof||source.status!=='proposed-open'))throw Error('A published reference cannot be an open rewarded task');
  files[file]=sha256(bytes);copies.set(file,bytes);
  const g={path:source.proofPath,theorem:source.declaration,statement:source.statementDisplay,statement_hash:'',goal_hash:'',definition_files:['Definitions.lean',file],dependency:null,rewardable:source.rewardable};
  g.statement_hash=statementFingerprint(g,files);g.goal_hash=goalCommitment(source.id,g,files);goals[source.id]=g;
 }
 const policy={version:4,name:manifest.id,problem:manifest.problem.id,repository,branch:'research',toolchain:'lean4:4.19.0',allowed_axioms:manifest.allowedAxioms,files,goals};
 validateProblemPolicy(policy);return {policy,copies};
}
export function writeCompiledPack(source,destination,repository){
 const {policy,copies}=compilePack(source,repository),file=`.open-math/policies/${policy.name}.json`,bytes=JSON.stringify(policy,null,2)+'\n';
 for(const [relative,content]of copies){const target=path.join(destination,'lean',relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content,{flag:'wx'});}
 fs.mkdirSync(path.join(destination,'.open-math/policies'),{recursive:true});fs.writeFileSync(path.join(destination,file),bytes,{flag:'wx'});
 return {file,sha256:sha256(bytes),goals:Object.keys(policy.goals)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [source,destination,repository]=process.argv.slice(2);if(!repository)throw Error('Usage: compile-problem.mjs PACK DEST OWNER/REPO');console.log(JSON.stringify(writeCompiledPack(source,destination,repository),null,2));}
