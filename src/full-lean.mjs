// Protocol-owned pins and input shapes. Validation here is not proof checking.
export const FULL_LEAN = Object.freeze({
 toolchain:'lean4:4.36.0',
 leanCommit:'611c117bfaf7b7ae1cfcf246ce6fba31e8f509e9',
 mathlibCommit:'fc4f59e577feb1a4956671bc04ac18aaaf8cd842',
 checker:'serialized-kernels-v1',
 axioms:Object.freeze(['propext','Classical.choice','Quot.sound']),
});
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const need=(ok,msg)=>{if(!ok)throw Error('Full Lean: '+msg);};
const name=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;
export function validateFullLeanBundle(bundle){
 need(exact(bundle,['version','imports','source','theorem','dependencies'])&&bundle.version===2,'exact version-two source bundle required');
 need(Array.isArray(bundle.imports)&&bundle.imports.length<=8&&new Set(bundle.imports).size===bundle.imports.length&&bundle.imports.every(m=>typeof m==='string'&&m.length<=160&&m.startsWith('Mathlib.')&&name.test(m)),'up to eight specific pinned Mathlib imports required');
 need(typeof bundle.source==='string'&&bundle.source.trim().length>0&&Buffer.byteLength(bundle.source)<=30000,'bounded Lean source required');
 need(typeof bundle.theorem==='string'&&bundle.theorem.length<=160&&!bundle.theorem.startsWith('B_')&&name.test(bundle.theorem),'explicit relative theorem name required');
 need(Array.isArray(bundle.dependencies)&&bundle.dependencies.length<=4,'at most four direct dependencies');
 const ids=new Set(),hashes=new Set();
 for(const d of bundle.dependencies){
  need(exact(d,['id','bundle_hash'])&&typeof d.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(d.id)&&typeof d.bundle_hash==='string'&&/^[a-f0-9]{64}$/.test(d.bundle_hash)&&!ids.has(d.id)&&!hashes.has(d.bundle_hash),'unique exact dependency ID and bundle hash required');
  ids.add(d.id);hashes.add(d.bundle_hash);
 }
 return bundle;
}
export function fullLeanTheorem(bundle,hash){
 return `B_${hash}.${bundle.version===2?bundle.theorem:'result'}`;
}
