"""Reviewed policy cutover fixtures; source views are mocked, not live consensus."""
import copy
import json
import os
import sys
from pathlib import Path
import pytest
from test_open_research import (SOURCE, POLICY, address, digest, migration_hash, evidence, pilot_snapshot, open_protocol)

OLD = '0x' + '7' * 40
ANCESTOR = '0x' + '6' * 40
NEW_POLICY = 'b' * 64


def balances(records):
    paid = [r for r in records if r['status'] == 'credited']
    total = sum(int(r['credited_points']) for r in paid)
    returned = sum(int(r['reserve_returned']) for r in paid)
    result = []
    for wallet in sorted({r['evidence']['wallet'].lower() for r in records}):
        owned = [r for r in paid if r['evidence']['wallet'].lower() == wallet]
        points = str(sum(int(r['credited_points']) for r in owned))
        result.append({'wallet': wallet, 'value': {'problem': 'p-vs-np', 'points': points, 'initial_points': points,
          'note_points': '0', 'impact_points': '0', 'total_awarded': str(total), 'total_initial_points': str(total),
          'total_note_points': '0', 'total_impact_points': '0', 'returned_points': str(sum(int(r['reserve_returned']) for r in owned)),
          'total_returned_points': str(returned), 'total_award_budgets': str(total), 'total_reserved_points': '0',
          'transferable': False, 'mode': 'contribution points on this Intelligent Contract'}})
    return result


@pytest.fixture
def policy_snapshot(pilot_snapshot):
    s = copy.deepcopy(pilot_snapshot)
    s['config']['predecessor'] = {'address': ANCESTOR, 'snapshot_hash': 'e' * 64}
    s['inheritances'] = []
    for r, i in zip(s['records'], s['impacts']):
        r['evidence']['contract'] = ANCESTOR
        r['digest'] = digest(json.dumps(r['evidence']))
        if 'source_digest' in i: i['source_digest'] = r['digest']
        original = migration_hash(r)
        if r['status'] == 'submitted':
            r.update(status='expired', expiration_reason='Closed unmerged claim: the unresolved review must never be retried.')
        s['inheritances'].append({'inherited': True, 'predecessor': ANCESTOR, 'snapshot_hash': 'e' * 64,
          'record_hash': migration_hash(r), 'original_record_hash': original})
    d = copy.deepcopy(s['records'][0]); e = d['evidence']; e.update(id='second-credit', contract=OLD,
      claim_digest=digest('second-claim'), statement_hash=digest('second-statement'), proposition_hash=digest('second-proposition'),
      proof=e['proof']+'\n', github_author_id=2)
    e['bundle_hash'] = digest(e['proof']); e['artifact_hash'] = e['bundle_hash']; d['digest'] = digest(json.dumps(e))
    i = copy.deepcopy(s['impacts'][0]); i.update(downstream=e['id'], source_digest=d['digest'])
    s['records'].append(d); s['impacts'].append(i); s['inheritances'].append({'inherited': False})
    s['balances'] = balances(s['records'])
    return s


def constructor(s):
    c = copy.deepcopy(s['config']); c['policy'] = NEW_POLICY
    c['predecessor'] = {'version': 2, 'address': OLD, 'snapshot_hash': migration_hash(s), 'source_policy': s['config']['policy'],
      'source_config_hash': migration_hash(s['config']), 'source_code_hash': '9' * 64,
      'records': [{'id': r['evidence']['id'], 'record_hash': migration_hash(r), 'impact_hash': migration_hash(i),
                   'inheritance_hash': migration_hash(h), 'origin_contract': r['evidence']['contract'], 'origin_policy': r['evidence']['policy']}
                  for r, i, h in zip(s['records'], s['impacts'], s['inheritances'])],
      'credited_order': [r['evidence']['id'] for r in s['records'] if r['status'] == 'credited'],
      'semantic_fences': [{'id': r['evidence']['id'], 'statement_hash': digest('canonical:' + r['evidence']['id'])}
                          for r in s['records'] if r['evidence']['evidence_kind'] == 'formal']}
    return c


def deploy_policy(vm, deploy, s, c=None):
    from gltest.direct.vm import InmemManager
    vm._storage = InmemManager()
    if contracts := sys.modules.get('genlayer.gl.genvm_contracts'): contracts.__known_contract__ = None
    def hook(_vm, request):
        from genlayer.py import calldata
        call = request['CallContract']; assert str(call['address']).lower() == OLD.lower(); assert call['state'] == 1
        method, args = call['calldata']['method'], call['calldata'].get('args', [])
        ids = [r['evidence']['id'] for r in s['records']]
        options = {'get_config': lambda:s['config'], 'count_contributions': lambda:len(ids),
          'list_contributions': lambda:{'items': ids, 'total':len(ids), 'next_offset':None},
          'get': lambda:s['records'][ids.index(args[0])], 'get_impact': lambda:s['impacts'][ids.index(args[0])],
          'get_inheritance': lambda:s['inheritances'][ids.index(args[0])],
          'get_points': lambda:next(b['value'] for b in s['balances'] if b['wallet'] == args[0])}
        assert method in options
        return b'\x00' + calldata.encode(copy.deepcopy(options[method]()))
    vm._gl_call_hook = hook
    return deploy(SOURCE, json.dumps(c or constructor(s)), sdk_version='v0.2.16')


def test_policy_upgrade_preserves_800_once_same_wallet_and_multihop_records(policy_snapshot, direct_vm, direct_deploy):
    s = policy_snapshot; child = deploy_policy(direct_vm, direct_deploy, s)
    assert child.count_contributions() == 4
    for r, i in zip(s['records'], s['impacts']):
        key = r['evidence']['id']; assert child.get(key) == r; assert child.get_impact(key) == i
        h = child.get_inheritance(key)
        assert h['original_record_hash'] == migration_hash(r) == h['record_hash']
        assert h['origin_chain'][0]['contract'] == OLD
        assert h['origin_chain'][-1]['contract'] == r['evidence']['contract']
        assert len(h['origin_chain']) == (2 if r['evidence']['contract'] == ANCESTOR else 1)
    assert child.get_points(s['records'][0]['evidence']['wallet'])['points'] == '800'
    for b in s['balances']: assert child.get_points(b['wallet']) == b['value']
    assert child.get_config()['policy'] == NEW_POLICY


@pytest.mark.parametrize('key,reason', [('credited','already reserved'),('rejected','previously rejected'),('pending','unresolved adjudication')])
def test_old_and_new_semantic_identities_cannot_reroll(policy_snapshot, direct_vm, direct_deploy, direct_alice, direct_owner, key, reason):
    child = deploy_policy(direct_vm, direct_deploy, policy_snapshot)
    old = next(r for r in policy_snapshot['records'] if r['evidence']['id'] == key)
    for statement in [old['evidence']['statement_hash'], digest('canonical:' + key)]:
        fresh = evidence(direct_vm, direct_owner, 'fresh', policy=NEW_POLICY, statement_hash=statement)
        direct_vm.sender = direct_alice
        with direct_vm.expect_revert(reason): child.register(json.dumps(fresh))
    fresh = evidence(direct_vm, direct_owner, 'independent', policy=NEW_POLICY)
    child.register(json.dumps(fresh))  # Expired C does not retain the account slot.


@pytest.mark.parametrize('change,reason', [
 (lambda s:s['records'][2].update(status='submitted'), 'terminal reviewed'),
 (lambda s:s['records'][2].update(adjudication_finished_round=0), 'adjudication fence'),
 (lambda s:s['records'][0].update(round=1), 'unsupported predecessor'),
 (lambda s:s['records'][0].update(reserve_settled=False), 'fully returned'),
 (lambda s:s['impacts'][0].update(allocations=[{'id':'other'}]), 'without upstream'),
 (lambda s:s['inheritances'][0].update(record_hash='0'*64), 'authenticated source'),
 (lambda s:s['balances'][0]['value'].update(total_awarded='999'), 'accounting'),
])
def test_unsupported_or_inconsistent_reviewed_history_reverts(policy_snapshot, direct_vm, direct_deploy, change, reason):
    change(policy_snapshot)
    if reason != "authenticated source":
        for r, h in zip(policy_snapshot["records"], policy_snapshot["inheritances"]):
            if h.get("inherited"): h["record_hash"] = migration_hash(r)
    with direct_vm.expect_revert(reason): deploy_policy(direct_vm, direct_deploy, policy_snapshot)


@pytest.mark.parametrize('change,reason', [
 (lambda c:c['predecessor'].update(source_config_hash='0'*64), 'source configuration'),
 (lambda c:c['predecessor']['records'][0].update(record_hash='0'*64), 'record commitment'),
 (lambda c:c['predecessor']['records'][0].update(origin_contract=OLD), 'origin mismatch'),
 (lambda c:c['predecessor'].update(snapshot_hash='0'*64), 'snapshot commitment'),
 (lambda c:c.update(window=11), 'preserve source roles'),
 (lambda c:c['predecessor'].update(credited_order=['credited']), 'complete credited'),
 (lambda c:c['predecessor'].update(semantic_fences=[]), 'one reviewed semantic'),
 (lambda c:c['predecessor']['semantic_fences'][1].update(statement_hash=c['predecessor']['semantic_fences'][0]['statement_hash']), 'unique reviewed semantic'),
])
def test_constructor_cannot_substitute_reviewed_scope_or_fences(policy_snapshot, direct_vm, direct_deploy, change, reason):
    c = constructor(policy_snapshot); change(c)
    with direct_vm.expect_revert(reason): deploy_policy(direct_vm, direct_deploy, policy_snapshot, c)


@pytest.mark.skipif(not os.environ.get('OPEN_MATH_ACCOUNTS_SOURCE_SNAPSHOT'), reason='Optional captured current native ledger supplied by release audit')
def test_actual_four_record_cutover_keeps_original_c_expired_and_800(direct_vm, direct_deploy):
    snapshot = json.loads(Path(os.environ['OPEN_MATH_ACCOUNTS_SOURCE_SNAPSHOT']).read_text())
    s = {k: snapshot[k] for k in ['config','records','impacts','inheritances']}
    s['balances'] = balances(s['records'])
    # The actual source address is retained; only the mock dispatch address varies.
    global OLD
    previous = OLD; OLD = snapshot['identity']['contract']
    try:
        child = deploy_policy(direct_vm, direct_deploy, s)
        assert child.get_points(s['records'][0]['evidence']['wallet'])['total_awarded'] == '800'
        assert child.get('pr-9-327123f9d1b4-2c91a42f97f7')['status'] == 'expired'
    finally: OLD = previous
