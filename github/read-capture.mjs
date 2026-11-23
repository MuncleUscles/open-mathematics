// Resumable public reads, not a transaction journal or an authoritative index.
import {isDeepStrictEqual} from 'node:util';
export function createReadCapture({identity,prior,read,save,now=Date.now}){
 const current=now();
 const state=prior||{version:1,identity,startedAt:new Date(current).toISOString(),entries:{}};
 if(state.version!==1||!isDeepStrictEqual(state.identity,identity)||!state.entries||typeof state.entries!=='object'||Array.isArray(state.entries)||Object.keys(state.entries).length>200)throw Error('Read capture identity or structure mismatch');
 const start=Date.parse(state.startedAt);
 if(!Number.isFinite(start)||start>current||(!state.completedAt&&current-start>15*60*1000))throw Error('Read capture is expired or has an invalid timestamp; start a fresh capture');
 for(const entry of Object.values(state.entries)){
  const at=Date.parse(entry?.readAt);
  if(!Number.isFinite(at)||at<start||at>current||!Object.hasOwn(entry,'value'))throw Error('Invalid captured read');
 }
 return {
  state,
  async view(method,args=[]){
   const key=JSON.stringify([method,args]);
   if(Object.hasOwn(state.entries,key))return state.entries[key].value;
   if(state.completedAt)throw Error('A completed capture cannot accept new reads');
   if(Object.keys(state.entries).length>=200)throw Error('Read capture budget exhausted');
   const value=await read(method,args);
   state.entries[key]={readAt:new Date(now()).toISOString(),value};
   await save(state);
   return value;
  },
  async complete(){if(!state.completedAt){state.completedAt=new Date(now()).toISOString();await save(state);}},
 };
}
