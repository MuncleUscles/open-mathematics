import json
from pathlib import Path
from test_contract import setup,evidence

KEY='pr-1-ee4678fc76d9-5c22de45baf0'
ORIGIN='0x8981C4fc15024752702e0851e4e063adebc40C7C'
SNAPSHOT=Path('public/legacy-record.json').read_text()
WALLET=json.loads(SNAPSHOT)['evidence']['wallet']

def test_frozen_legacy_import_is_exact_authorized_and_once_only(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice,carry_legacy=True)
    direct_vm.sender=direct_bob
    with direct_vm.expect_revert('trusted verifier'):c.import_legacy(SNAPSHOT)
    direct_vm.sender=direct_alice
    for field,bad in [('status','approved'),('digest','f'*64),('credited_points','500'),('merge_commit','f'*40)]:
        changed=json.loads(SNAPSHOT);changed[field]=bad
        with direct_vm.expect_revert('frozen legacy'):c.import_legacy(json.dumps(changed))
        assert c.get_points(WALLET)['points']=='0'
    changed=json.loads(SNAPSHOT);changed['evidence']['wallet']='0x'+direct_bob.hex()
    with direct_vm.expect_revert('frozen legacy'):c.import_legacy(json.dumps(changed))
    with direct_vm.expect_revert('frozen legacy'):c.import_legacy(SNAPSHOT+' ')
    c.import_legacy(SNAPSHOT);c.import_legacy(SNAPSHOT)
    assert c.list_contributions()==[KEY]
    points=c.get_points(WALLET);assert points['initial_points']=='400';assert points['impact_points']=='0';assert points['total_awarded']=='400'
    assert c.get_points('0x'+direct_alice.hex())['points']=='0'
    assert c.get(KEY)['migration']['source_contract']==ORIGIN
    assert c.get(KEY)['migration']['trust']=='verifier-attested-frozen-snapshot'

def test_migration_disabled_for_fresh_ledgers(direct_vm,direct_deploy,direct_alice):
    c=setup(direct_vm,direct_deploy,direct_alice)
    with direct_vm.expect_revert('migration disabled'):c.import_legacy(SNAPSHOT)

def test_migration_cannot_be_preempted_by_registration(direct_vm,direct_deploy,direct_alice):
    c=setup(direct_vm,direct_deploy,direct_alice,carry_legacy=True)
    with direct_vm.expect_revert('legacy import required'):c.register(evidence(direct_alice))
    assert c.list_contributions()==[]
