import copy,json
from test_contract import setup,evidence

KEY='pr-1-ee4678fc76d9-5c22de45baf0'
ORIGIN='0x8981C4fc15024752702e0851e4e063adebc40C7C'

def test_frozen_legacy_import_is_finalized_and_once_only(direct_vm,direct_deploy,direct_alice,monkeypatch):
    c=setup(direct_vm,direct_deploy,direct_alice)
    from genlayer import gl
    from genlayer.py.public_abi import StorageType
    old=dict(evidence=json.loads(evidence(direct_alice,KEY)),status='credited',digest='86a7f754b717c46f2d160d9508244a5b3e99dd1a67ad73ff42d70a9259c02685',credited_points='400',merge_commit='5ea768475ae512f554c71041fa299900fbe01083')
    class Source:
        def view(self,**kw):
            assert kw==dict(state=StorageType.LATEST_FINAL);return self
        def get(self,key):
            assert key==KEY;return copy.deepcopy(old)
    def source(address):
        assert str(address).lower()==ORIGIN.lower();return Source()
    monkeypatch.setattr(gl,'get_contract_at',source)
    for field,bad in [('status','approved'),('digest','f'*64),('credited_points','500'),('merge_commit','f'*40)]:
        saved=old[field];old[field]=bad
        with direct_vm.expect_revert('frozen legacy'):c.import_legacy()
        assert c.get_points('0x'+direct_alice.hex())['points']=='0'
        old[field]=saved
    c.import_legacy();c.import_legacy()
    assert c.list_contributions()==[KEY]
    points=c.get_points('0x'+direct_alice.hex());assert points['initial_points']=='400';assert points['impact_points']=='0';assert points['total_awarded']=='400'
    assert c.get(KEY)['migration']['source_contract']==ORIGIN

def test_migration_cannot_be_preempted_by_registration(direct_vm,direct_deploy,direct_alice):
    c=setup(direct_vm,direct_deploy,direct_alice,carry_legacy=True)
    with direct_vm.expect_revert('legacy import required'):c.register(evidence(direct_alice))
    assert c.list_contributions()==[]
