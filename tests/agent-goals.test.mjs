import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeGoals} from '../scripts/agent.mjs';

const policy={goals:{renaming:{statement_hash:'first',dependency:null},renaming_sat:{statement_hash:'second',dependency:'renaming_sound'},independent:{statement_hash:'third',dependency:null},future:{statement_hash:'fourth',dependency:'unknown_alias'}}};
const record=(status,hash,id)=>({status,evidence:{statement_hash:hash,id}});
test('goals expose credited dependencies only for their enrolled dependency',()=>{
 const goals=summarizeGoals(policy,[record('credited','first','original')]);
 assert.deepEqual(goals.map(g=>[g.id,g.status,g.creditedDependency]),[
  ['renaming','closed',null],['renaming_sat','open','original'],['independent','open',null],['future','open',null]
 ]);
});
test('an approved reservation closes a goal but cannot serve as a credited dependency',()=>{
 for(const status of ['submitted','provisional','rejected','expired','approved']){
  const goals=summarizeGoals(policy,[record(status,'first','not-credited')]);
  assert.equal(goals[0].status,status==='approved'?'closed':'open');
  assert.equal(goals[1].creditedDependency,null);
 }
});
test('a policy with no renaming goal does not invent a dependency or throw',()=>{
 assert.deepEqual(summarizeGoals({goals:{independent:policy.goals.independent}},[]),[{id:'independent',...policy.goals.independent,status:'open',creditedDependency:null}]);
});
