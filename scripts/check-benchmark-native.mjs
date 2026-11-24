import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {abi} from 'genlayer-js';
import {journaledTransaction} from '../github/journaled-transaction.mjs';
import {verifyFinalizedOutcome} from '../src/studio.mjs';

const MAX_CAPTURE=512*1024,MAX_PROMPT=128*1024,MAX_RETURN=64*1024;
const SOURCE_HASH='429da6bb99951cfb2da1db693e5b164df54f2b22082148722c411917b818ac27';
const PROTOCOLS=new Set(['421740e654a18f730a07abb6bb3ed3112f5fef7a','7669a2cdd54dee1f828f02f86723b4d5ff526075']);
const IDENTITY_FIELDS=['wallet','github_author_id','github_account_created_at','github_account_type','claim_comment_id','claim_comment_created_at'];
const OUTCOME_FIELDS=['accept','novelty','significance','reusability','reason','evidence_refs'];
const need=(value,message)=>{if(!value)throw Error('Native benchmark receipt: '+message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value);
const sameAddress=(a,b)=>address(a)&&address(b)&&a.toLowerCase()===b.toLowerCase();
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.isWellFormed();
const band=(value,allowString=false)=>{
 if(typeof value==='bigint')need(value>=0n&&value<=3n,'out-of-range ABI merit integer');
 else if(typeof value==='number')need(Number.isInteger(value)&&value>=0&&value<=3,'out-of-range merit integer');
 else need(allowString&&typeof value==='string'&&/^[0-3]$/.test(value),'merit bands must retain integer types');
 return Number(value);
};

function checkedOutcome(value,{award=false,allowString=false,allowedRefs,submissionId}){
 const obj=value instanceof Map?Object.fromEntries(value):value;
 const fields=award?[...OUTCOME_FIELDS,'award']:OUTCOME_FIELDS;
 need(object(obj)&&Object.keys(obj).length===fields.length&&fields.every(k=>Object.hasOwn(obj,k)),'unexpected returned verdict fields');
 need(typeof obj.accept==='boolean','accept must be boolean');
 need(text(obj.reason,4000)&&obj.reason.trim().length>=20,'bounded verdict reason required');
 need(Array.isArray(obj.evidence_refs)&&obj.evidence_refs.length>=1&&obj.evidence_refs.length<=12&&
  obj.evidence_refs.includes(submissionId)&&obj.evidence_refs.every(ref=>typeof ref==='string'&&allowedRefs.includes(ref)),'returned evidence references do not bind the submission');
 const result={accept:obj.accept,novelty:band(obj.novelty,allowString),significance:band(obj.significance,allowString),
  reusability:band(obj.reusability,allowString),reason:obj.reason,evidence_refs:[...obj.evidence_refs]};
 need(!result.accept||Math.min(result.novelty,result.significance,result.reusability)>=1,'accepted verdict has a zero merit band');
 if(award){
  need(typeof obj.award==='string'&&/^(?:0|[1-9][0-9]{0,2})$/.test(obj.award)&&Number(obj.award)<=900,'bounded string award required');
  result.award=obj.award;
 }
 return result;
}

function decodeReturn(value,options){
 const raw=typeof value==='string'?value:value?.raw;
 need(text(raw,MAX_RETURN)&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw),'bounded canonical base64 result required');
 const bytes=Buffer.from(raw,'base64');
 need(bytes.length>1&&bytes[0]===0&&bytes.toString('base64')===raw,'successful ABI return required');
 if(object(value)){
  need(value.status==='return','decoded result status is not return');
  if(value.payload?.raw!==undefined)need(Array.isArray(value.payload.raw)&&
   value.payload.raw.length===bytes.length-1&&value.payload.raw.every((byte,i)=>Number.isInteger(byte)&&byte===bytes[i+1]),'decoded result payload contradicts raw bytes');
 }
 // SDK readable strings are diagnostic renderings, not JSON. Decode ABI bytes.
 return checkedOutcome(abi.calldata.decode(bytes.subarray(1)),options);
}

/** Recheck a bounded frozen capture with the same journal/receipt code used live.
 * The only client method returns the captured transaction. No RPC, signing,
 * history discovery, polling, model call, or network write is available here.
 */
export async function checkNativeBenchmarkCapture({capture,prompt}){
 need(object(capture)&&capture.schema_version===1,'versioned capture required');
 let encoded;
 try{encoded=JSON.stringify(capture);}catch{throw Error('Native benchmark receipt: JSON-compatible capture required');}
 need(Buffer.byteLength(encoded)<=MAX_CAPTURE,'capture exceeds bound');
 need(text(prompt,MAX_PROMPT)&&Buffer.byteLength(prompt)<=MAX_PROMPT,'bounded exact prompt required');
 need(capture.chain_id===61999&&capture.round===0,'this checker requires Studio initial round zero');
 need(address(capture.contract)&&address(capture.executor)&&typeof capture.policy==='string'&&/^[a-f0-9]{64}$/.test(capture.policy),'contract, executor and policy binding required');
 need(capture.source_code_sha256===SOURCE_HASH&&PROTOCOLS.has(capture.protocol_commit),'unreviewed contract source or protocol revision');
 need(text(capture.case_id,64)&&text(capture.submission_id,100)&&text(capture.captured_at,60)&&Number.isFinite(Date.parse(capture.captured_at)),'case, submission and capture time required');
 need(object(capture.source_report)&&text(capture.source_report.url,2048)&&capture.source_report.url.startsWith('https://')&&
  typeof capture.source_report.git_blob==='string'&&/^[a-f0-9]{40}$/.test(capture.source_report.git_blob),'immutable source-report reference required');
 need(capture.prompt_sha256===hash(prompt),'prompt hash mismatch');
 const marker='\nUNTRUSTED_DATA=',index=prompt.indexOf(marker);
 need(index>0,'contract prompt evidence delimiter required');
 let data,evidence;
 try{data=JSON.parse(prompt.slice(index+marker.length));evidence=JSON.parse(capture.evidence_json);}catch{throw Error('Native benchmark receipt: valid prompt and original evidence JSON required');}
 need(object(data)&&object(evidence)&&text(capture.evidence_json,65536)&&Buffer.byteLength(capture.evidence_json)<=65536,'bounded original registration evidence required');
 const expectedDataFields=['objective','policy','submission','prior','historical_ledger_references','allowed_evidence_refs','required_submission_reference','challenges','challenged','previous_verdict','content_merit_ceiling'];
 need(Object.keys(data).length===expectedDataFields.length&&expectedDataFields.every(k=>Object.hasOwn(data,k)),'exact initial prompt context fields required');
 need(data.policy===capture.policy&&data.required_submission_reference===capture.submission_id&&
  isDeepStrictEqual(data.allowed_evidence_refs,[capture.submission_id,'historical-ledger']),'prompt policy or evidence references mismatch');
 need(data.challenged===false&&data.previous_verdict===null&&data.content_merit_ceiling===null&&
  ['prior','challenges','historical_ledger_references'].every(k=>Array.isArray(data[k])&&data[k].length===0),'expected fresh pre-verdict context is absent');
 need(evidence.id===capture.submission_id&&sameAddress(evidence.contract,capture.contract)&&evidence.policy===capture.policy&&
  evidence.protocol_commit===capture.protocol_commit,'registration identity or policy mismatch');
 for(const field of ['pr','github_author_id','github_account_created_at','claim_comment_id'])need(Number.isSafeInteger(evidence[field])&&evidence[field]>=0,'original registration integer type lost: '+field);
 const record=capture.record;
 need(object(record)&&record.digest===hash(capture.evidence_json)&&isDeepStrictEqual(record.evidence,evidence),'native evidence digest or values mismatch');
 need(record.round===0&&record.adjudication_started_round===0&&record.adjudication_finished_round===0&&
  Array.isArray(record.challenges)&&record.challenges.length===0,'native record is not the completed initial adjudication');
 const merit=Object.fromEntries(Object.entries(evidence).filter(([key])=>!IDENTITY_FIELDS.includes(key)));
 need(isDeepStrictEqual(data.submission,merit),'prompt submission differs from identity-masked original registration');
 need(object(capture.journal)&&object(capture.journal.intent)&&object(capture.journal.receipt)&&
  /^0x[0-9a-f]{64}$/i.test(capture.journal.hash),'existing journal hash, intent and receipt required');
 const rawReceipt=capture.journal.receipt;
 // This guard precedes the journal helper so invalid fixtures cannot start its
 // live polling loop. Only a successful finalized receipt reaches the client.
 verifyFinalizedOutcome(rawReceipt);
 const leaders=rawReceipt.consensus_data?.leader_receipt;
 need(Array.isArray(leaders)&&leaders.length>=1&&leaders.length<=32&&leaders[0]?.mode==='leader','explicit bounded leader receipts required');
 const validators=rawReceipt.consensus_data?.validators;
 need(Array.isArray(validators)&&validators.length<=64,'bounded validator receipt list required');
 const stage='adjudicate-r0',transactions={[stage]:structuredClone(capture.journal)};
 let receiptReads=0,journalSaves=0;
 const client={getTransaction:async({hash:requested})=>{
  need(requested===capture.journal.hash&&receiptReads===0,'unexpected receipt read');
  receiptReads++;
  return structuredClone(rawReceipt);
 }};
 await journaledTransaction({client,address:capture.contract,sender:capture.executor,method:'adjudicate',args:[capture.submission_id,0],
  independent:true,transactions,stage,recoverOnly:true,save:async()=>{journalSaves++;}});
 need(receiptReads===1,'journal checker did not inspect the frozen receipt');
 const options={allowedRefs:data.allowed_evidence_refs,submissionId:capture.submission_id};
 const returned=decodeReturn(leaders[0].result,{...options,award:true});
 const stored=checkedOutcome(record.verdict,{...options,award:true,allowString:true});
 need(isDeepStrictEqual(returned,stored),'leader return does not match native record verdict');
 const {award,...outcome}=returned;
 const expectedAward=outcome.accept?(outcome.novelty+outcome.significance+outcome.reusability)*100:0;
 need(Number(award)===(evidence.evidence_kind==='research-note'?Math.min(expectedAward,300):expectedAward),'award does not match the initial total result budget');
 const eqOutput=leaders[0].eq_outputs?.['0'];
 need(eqOutput!==undefined&&isDeepStrictEqual(decodeReturn(eqOutput,options),outcome),'leader nondeterministic output differs from the returned judgment');
 const agreeing=validators.filter(v=>v.mode==='validator'&&v.vote==='agree'&&v.execution_result==='SUCCESS');
 need(agreeing.length>=1,'independent successful validator agreement required');
 for(const validator of agreeing)need(isDeepStrictEqual(decodeReturn(validator.result,{...options,award:true}),returned),'agreeing validator return differs from the leader and native record');
 const leaderArrayValidators=leaders.filter(v=>v.mode==='validator'&&v.vote==='agree'&&v.execution_result==='SUCCESS');
 for(const validator of leaderArrayValidators)need(isDeepStrictEqual(decodeReturn(validator.result,{...options,award:true}),returned),'validator return in leader receipt array differs from the native record');
 return {outcome,award,validation:{
  checker:'journaledTransaction -> finalized -> verifyReceipt',read_only:true,network_calls:0,model_calls:0,receipt_reads:receiptReads,journal_copy_saves:journalSaves,
  transaction_finalized:true,execution_succeeded:true,independent_validator_agreement:true,exact_call_and_sender_verified:true,
  original_evidence_digest_verified:true,original_numeric_types_preserved:true,prompt_submission_binding_verified:true,
  leader_return_matches_native_record:true,leader_eq_output_matches_return:true,agreeing_validator_returns_match:true,
  agreeing_validator_return_entries:agreeing.length,validator_entries:validators.length,distinct_validator_count:null,
  independent_validator_model_responses_captured:false,protocol_phase:'initial_adjudication',full_protocol_completion_claimed:false,
  award_semantics:'total_result_budget_not_credited_points',native_model_identities:null,
  tx_hash:capture.journal.hash,contract:capture.contract,policy:capture.policy,round:capture.round,source_code_sha256:capture.source_code_sha256,
 }};
}
