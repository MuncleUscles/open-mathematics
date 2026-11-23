import json
from pathlib import Path
from test_contract import setup,evidence

SNAPSHOT=Path('public/ledger-snapshot.json').read_text()
FROZEN=json.loads(SNAPSHOT)
KEYS=[x['id'] for x in FROZEN['records']]
ORIGIN=FROZEN['source_contract']

def test_frozen_ledger_import_is_exact_authorized_and_once_only(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice,carry_legacy=True)
    direct_vm.sender=direct_bob
    with direct_vm.expect_revert('trusted verifier'):c.import_snapshot(SNAPSHOT)
    direct_vm.sender=direct_alice
    for field,bad in [('total_points','800'),('total_impact_points','100'),('source_contract','0x'+direct_bob.hex())]:
        changed=json.loads(SNAPSHOT);changed[field]=bad
        with direct_vm.expect_revert('frozen ledger'):c.import_snapshot(json.dumps(changed))
    changed=json.loads(SNAPSHOT);changed['balances'][0]['wallet']='0x'+direct_bob.hex()
    with direct_vm.expect_revert('frozen ledger'):c.import_snapshot(json.dumps(changed))
    with direct_vm.expect_revert('frozen ledger'):c.import_snapshot(SNAPSHOT+' ')
    assert c.list_contributions()==[]
    c.import_snapshot(SNAPSHOT);c.import_snapshot(SNAPSHOT)
    assert c.list_contributions()==KEYS
    for balance in FROZEN['balances']:
        points=c.get_points(balance['wallet'])
        assert points['initial_points']==balance['points']
        assert points['impact_points']=='0'
        assert points['total_awarded']=='700'
        assert points['total_historical_initial_awarded']=='700'
    assert c.get_points('0x'+direct_alice.hex())['points']=='0'
    for key in KEYS:
        r=c.get(key)
        assert r['ledger_migration']['source_contract']==ORIGIN
        assert r['ledger_migration']['trust']=='verifier-attested-frozen-snapshot'
        assert type(r['round']) is int and type(r['evidence']['pr']) is int
        assert c.get_provenance(key)['current_initial_points']==int(r['credited_points'])
        assert c.get_impact(key)['status']=='not-requested'
    assert c.get(KEYS[0])['migration']['github_author_id']==c.get(KEYS[1])['evidence']['github_author_id']
    # Import remains a no-op after unrelated subsequent earned credits.
    c.register(evidence(direct_alice));c.import_snapshot(SNAPSHOT)
    assert c.list_contributions()==KEYS+['lemma']

def test_migration_disabled_for_fresh_ledgers(direct_vm,direct_deploy,direct_alice):
    c=setup(direct_vm,direct_deploy,direct_alice)
    with direct_vm.expect_revert('migration disabled'):c.import_snapshot(SNAPSHOT)

def test_migration_cannot_be_preempted_by_registration(direct_vm,direct_deploy,direct_alice):
    c=setup(direct_vm,direct_deploy,direct_alice,carry_legacy=True)
    with direct_vm.expect_revert('legacy import required'):c.register(evidence(direct_alice))
    assert c.list_contributions()==[]
