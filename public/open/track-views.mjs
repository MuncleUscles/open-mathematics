import {federationCoverage} from '../../src/federation-snapshot.mjs';
import {trackNames} from './problem-directory.mjs';

export function detailPath(track, id) {
 return '#/contributions/'+track+'/'+encodeURIComponent(id);
}

export function parseDetailPath(path) {
 const parts=path.slice('/contributions/'.length).split('/');
 if(parts.length===1) parts.unshift('p-vs-np'); // Published pilot links.
 const [track, encoded]=parts;
 if(parts.length!==2 || !Object.hasOwn(trackNames,track))return null;
 try {
  const id=decodeURIComponent(encoded);
  return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(id)?{track,id}:null;
 } catch {return null;}
}

export function graphFromRows(rows) {
 const nodes=new Map(rows.map(({id,title,status})=>[id,{id,title,status,loaded:true}]));
 const edges=rows.flatMap(row=>row.edges??[]);
 for(const {target} of edges)if(!nodes.has(target))nodes.set(target,{id:target,title:target,status:'unloaded',loaded:false});
 return {nodes:[...nodes.values()],edges};
}

export function trackStandings(scopes) {
 const missing=scopes.filter(({attribution,research})=>!attribution||!federationCoverage(attribution,research).ranked);
 if(missing.length)return {missing:missing.map(({track})=>track),rows:[]};
 const accounts=new Map();
 for(const {attribution} of scopes)for(const account of attribution.accounts.rows) {
  const id=String(account.github_author_id);
  const combined=accounts.get(id)??{id,points:0n,initial_points:0n,impact_points:0n,unclaimed_points:0n};
  for(const field of ['initial_points','impact_points','points','unclaimed_points'])combined[field]+=BigInt(account[field]);
  accounts.set(id,combined);
 }
 const rows=[...accounts.values()].filter(row=>row.points>0n).sort((a,b)=>a.points===b.points?a.id.localeCompare(b.id):a.points>b.points?-1:1);
 let previous,rank;
 for(const [index,row] of rows.entries()){
  if(row.points!==previous)rank=index+1;
  row.rank=rank; previous=row.points;
 }
 return {missing:[],rows};
}
