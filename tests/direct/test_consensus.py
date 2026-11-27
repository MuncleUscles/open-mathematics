import json
from test_contract import setup,evidence,decision
from test_impact import pair,review

def test_validator_checks_leader_schema_and_references(direct_vm,direct_deploy,direct_alice):
    c=setup(direct_vm,direct_deploy,direct_alice);c.register(evidence(direct_alice));decision(direct_vm);v=c.adjudicate('lemma',c.get('lemma')["round"])
    assert direct_vm.run_validator() is True
    forged={k:value for k,value in v.items() if k!='award'};forged['evidence_refs']=['invented']
    with direct_vm.expect_revert('references'):direct_vm.run_validator(leader_result=forged)
    forged['evidence_refs']=['lemma'];forged['reason']=''
    with direct_vm.expect_revert('reasons'):direct_vm.run_validator(leader_result=forged)
    assert direct_vm.run_validator(leader_error=Exception('failed leader')) is False

def test_impact_validator_rejects_foreign_recipient_and_disagreement(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice);pair(c,direct_vm,direct_alice,direct_bob);review(direct_vm);c.review_impact('downstream',c.get_impact('downstream').get("round",0))
    assert direct_vm.run_validator() is True
    forged=dict(allocations=[dict(id='stranger',band=1,reason='Invented recipient is never an eligible prior contributor.')],reason='The leader cannot inject an unlisted recipient in its proposed award.',evidence_refs=['downstream'])
    with direct_vm.expect_revert('recipient'):direct_vm.run_validator(leader_result=forged)
    review(direct_vm,[])
    assert direct_vm.run_validator() is False

def test_only_executor_can_request_and_settle_consensus(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice);pair(c,direct_vm,direct_alice,direct_bob)
    direct_vm.sender=direct_bob
    for call in [lambda:c.adjudicate('downstream',0),lambda:c.finalize('downstream',0),lambda:c.review_impact('downstream',0),lambda:c.settle_impact('downstream',0)]:
        with direct_vm.expect_revert('consensus executor'):call()
    assert c.get_points('0x'+direct_alice.hex())['impact_points']=='0'

def test_stale_round_cannot_reuse_old_receipt(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice);c.register(evidence(direct_alice));decision(direct_vm);c.adjudicate('lemma',0)
    direct_vm.sender=direct_bob;c.challenge('lemma','This should be re-evaluated using new evidence about duplication.')
    direct_vm.sender=direct_alice
    with direct_vm.expect_revert('stale adjudication round'):c.adjudicate('lemma',0)
    c.adjudicate('lemma',1)
    with direct_vm.expect_revert('stale finalization round'):c.finalize('lemma',0)

def test_unmergeable_approval_releases_statement_but_never_earned_points(direct_vm,direct_deploy,direct_alice):
    from datetime import datetime,timezone,timedelta
    c=setup(direct_vm,direct_deploy,direct_alice);c.register(evidence(direct_alice));decision(direct_vm);c.adjudicate('lemma',0)
    direct_vm.warp((datetime.now(timezone.utc)+timedelta(seconds=30)).isoformat());c.finalize('lemma',0)
    with direct_vm.expect_revert('reserved'):c.register(evidence(direct_alice,'replacement'))
    c.release_unmerged('lemma','The author changed the exact approved PR head before merge.')
    assert c.get('lemma')['status']=='expired'
    c.register(evidence(direct_alice,'replacement'))
    with direct_vm.expect_revert('not approved'):c.confirm_merge('lemma','a'*40,'c'*40)
    assert c.get_points('0x'+direct_alice.hex())['points']=='0'
