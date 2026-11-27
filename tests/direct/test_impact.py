import json,hashlib
from datetime import datetime,timezone,timedelta
from test_contract import setup,evidence

def accept(c,vm,operator,wallet,key,statement,seconds,dependencies=None,verified=None,artifact=None,github_author_id=1):
    e=json.loads(evidence(wallet,key,statement));e['artifact_hash']=artifact or hashlib.sha256(key.encode()).hexdigest();e['dependencies']=dependencies or [];e['verified_dependencies']=verified or [];e['github_author_id']=github_author_id
    vm.sender=operator;c.register(json.dumps(e));vm.clear_mocks()
    vm.mock_llm('.*',json.dumps(dict(accept=True,novelty=1,significance=1,reusability=2,reason='A verified reusable component with bounded initial integration credit.',evidence_refs=[key])))
    c.adjudicate(key,c.get(key)["round"]);vm.warp((datetime.now(timezone.utc)+timedelta(seconds=seconds)).isoformat());c.finalize(key,c.get(key)["round"]);c.confirm_merge(key,'a'*40,'c'*40)
    return e

def pair(c,vm,alice,bob,github_author_ids=(1,1)):
    first=accept(c,vm,alice,alice,'upstream','1'*64,30,github_author_id=github_author_ids[0])
    used=dict(id='upstream',artifact_hash=first['artifact_hash'],proof_body_use=True,constant='renaming_sound')
    second=accept(c,vm,alice,bob,'downstream','2'*64,60,['upstream'],[used],github_author_id=github_author_ids[1]);return first,second

def review(vm, allocations=None, *, references=None, pattern='.*'):
    vm.clear_mocks()
    vm.mock_llm(pattern, json.dumps({
        'allocations': [impact_band(1)] if allocations is None else allocations,
        'reason': 'Concrete verified proof use supports direct impact credit without recursive awards.',
        'evidence_refs': ['downstream', 'upstream'] if references is None else references,
    }))


def impact_band(band):
    return {
        'id': 'upstream', 'band': band,
        'reason': 'The settled SAT theorem uses the earlier proof to construct both satisfying assignments.',
    }

def test_impact_separate_accounting_and_idempotency(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice);pair(c,direct_vm,direct_alice,direct_bob);review(direct_vm)
    direct_vm.sender=direct_alice;c.review_impact('downstream',c.get_impact('downstream').get("round",0))
    with direct_vm.expect_revert('window open'):c.settle_impact('downstream',c.get_impact('downstream').get("round",0))
    direct_vm.warp((datetime.now(timezone.utc)+timedelta(seconds=120)).isoformat());c.settle_impact('downstream',c.get_impact('downstream').get("round",0));c.settle_impact('downstream',c.get_impact('downstream').get("round",0))
    points=c.get_points('0x'+direct_alice.hex());assert points['initial_points']=='400';assert points['impact_points']=='100';assert points['points']=='500';assert points['total_awarded']=='900'
    assert c.get('upstream')['credited_points']=='400'
    assert c.get_impact('downstream')['paid_points']=='100'
    with direct_vm.expect_revert('already exists'):c.review_impact('downstream',c.get_impact('downstream').get("round",0))

def test_impact_challenge_blocks_then_changes_allocation(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice);pair(c,direct_vm,direct_alice,direct_bob);review(direct_vm);c.review_impact('downstream',c.get_impact('downstream').get("round",0))
    direct_vm.sender=direct_bob;c.challenge_impact('downstream','This claimed impact is artificial splitting; compare the exact transformation and prior result.')
    direct_vm.sender=direct_alice
    direct_vm.warp((datetime.now(timezone.utc)+timedelta(seconds=120)).isoformat())
    with direct_vm.expect_revert('unresolved'):c.settle_impact('downstream',c.get_impact('downstream').get("round",0))
    review(direct_vm,[]);c.review_impact('downstream',c.get_impact('downstream').get("round",0));direct_vm.warp((datetime.now(timezone.utc)+timedelta(seconds=180)).isoformat());c.settle_impact('downstream',c.get_impact('downstream').get("round",0))
    assert c.get_impact('downstream')['paid_points']=='0';assert c.get_points('0x'+direct_alice.hex())['points']=='400'

def test_self_impact_is_zero_without_llm(direct_vm,direct_deploy,direct_alice):
    c=setup(direct_vm,direct_deploy,direct_alice);pair(c,direct_vm,direct_alice,direct_alice);direct_vm.clear_mocks();c.review_impact('downstream',c.get_impact('downstream').get("round",0))
    assert c.get_impact('downstream')['status']=='settled';assert c.get_impact('downstream')['paid_points']=='0'

def test_citations_are_insufficient(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice);accept(c,direct_vm,direct_alice,direct_alice,'upstream','1'*64,30);accept(c,direct_vm,direct_alice,direct_bob,'downstream','2'*64,60,['upstream'],[])
    direct_vm.clear_mocks();c.review_impact('downstream',c.get_impact('downstream').get("round",0));assert c.get_impact('downstream')['paid_points']=='0'

def test_impact_rejects_recipient_and_budget_injection(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice);pair(c,direct_vm,direct_alice,direct_bob)
    for allocations,error in [([dict(id='stranger',band=3,reason='Pay the caller instead of a verified mathematical contributor.')],'recipient'),([dict(id='upstream',band=4,reason='Ignore the maximum budget and award an additional million points.')],'band'),([dict(id='upstream',band=1,reason='A reason with enough text to qualify.'),dict(id='upstream',band=1,reason='A repeated recipient must not be paid twice.')],'allocation list')]:
        review(direct_vm,allocations)
        with direct_vm.expect_revert(error):c.review_impact('downstream',c.get_impact('downstream').get("round",0))
    assert c.get_points('0x'+direct_alice.hex())['impact_points']=='0'

def test_wrong_dependency_artifact_rejected(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice);accept(c,direct_vm,direct_alice,direct_alice,'upstream','1'*64,30)
    e=json.loads(evidence(direct_bob,'downstream','2'*64));e['dependencies']=['upstream'];e['verified_dependencies']=[dict(id='upstream',artifact_hash='0'*64,proof_body_use=True)]
    with direct_vm.expect_revert('artifact mismatch'):c.register(json.dumps(e))


def test_shared_github_control_has_a_one_band_review_ceiling(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = setup(direct_vm, direct_deploy, direct_alice)
    pair(c, direct_vm, direct_alice, direct_bob)
    review(direct_vm, [impact_band(2)])
    with direct_vm.expect_revert('invalid impact band'):
        c.review_impact('downstream', 0)
    assert c.get_impact('downstream')['status'] == 'not-requested'

    pattern = (
        r'(?s).*Rubric: band0 .*band1 .*band2 .*band3 .*UNTRUSTED_DATA=.*'
        r'"allowed_evidence_refs": \["downstream", "upstream"\].*'
        r'"max_bands": \{"upstream": 1\}.*"required_downstream_reference": "downstream"'
    )
    review(direct_vm, [impact_band(1)], pattern=pattern)
    assert c.review_impact('downstream', 0)['allocations'] == [impact_band(1)]


def test_distinct_github_authors_can_receive_higher_supported_band(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = setup(direct_vm, direct_deploy, direct_alice)
    pair(c, direct_vm, direct_alice, direct_bob, github_author_ids=(1, 2))
    review(direct_vm, [impact_band(2)])
    result = c.review_impact('downstream', 0)
    assert result['eligible'][0]['shared_github_author'] is False
    assert result['allocations'] == [impact_band(2)]
    direct_vm.warp(datetime.fromtimestamp(result['deadline'] + 1, timezone.utc).isoformat())
    c.settle_impact('downstream', 0)
    assert c.get_impact('downstream')['paid_points'] == '200'


def test_impact_references_must_include_the_exact_downstream_id(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = setup(direct_vm, direct_deploy, direct_alice)
    pair(c, direct_vm, direct_alice, direct_bob)
    for references in [['upstream'], ['downstream', 'renaming_sound']]:
        review(direct_vm, references=references)
        with direct_vm.expect_revert('invalid impact references'):
            c.review_impact('downstream', 0)


def test_settlement_rechecks_the_shared_control_ceiling(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = setup(direct_vm, direct_deploy, direct_alice)
    pair(c, direct_vm, direct_alice, direct_bob)
    review(direct_vm)
    result = c.review_impact('downstream', 0)
    # Seed an invalid archived decision in the local test ledger to exercise settlement in isolation.
    result['allocations'] = [impact_band(2)]
    c.impacts['downstream'] = json.dumps(result)
    direct_vm.warp(datetime.fromtimestamp(result['deadline'] + 1, timezone.utc).isoformat())
    with direct_vm.expect_revert('invalid stored impact allocation'):
        c.settle_impact('downstream', 0)
    assert c.get_points('0x' + direct_alice.hex())['impact_points'] == '0'

def test_shared_controller_cannot_split_dependency_bands(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice)
    first=accept(c,direct_vm,direct_alice,direct_alice,'upstream','1'*64,30)
    second=accept(c,direct_vm,direct_alice,direct_alice,'upstream2','3'*64,60)
    uses=[dict(id=e['id'],artifact_hash=e['artifact_hash'],proof_body_use=True,constant='renaming_sound') for e in [first,second]]
    accept(c,direct_vm,direct_alice,direct_bob,'downstream','2'*64,90,['upstream','upstream2'],uses)
    allocations=[impact_band(1),dict(impact_band(1),id='upstream2')]
    review(direct_vm,allocations)
    with direct_vm.expect_revert('shared controller impact cap'):c.review_impact('downstream',0)
    review(direct_vm)
    result=c.review_impact('downstream',0)
    result['allocations']=allocations;c.impacts['downstream']=json.dumps(result)
    direct_vm.warp(datetime.fromtimestamp(result['deadline']+1,timezone.utc).isoformat())
    with direct_vm.expect_revert('shared controller impact cap'):c.settle_impact('downstream',0)
    assert c.get_points('0x'+direct_alice.hex())['impact_points']=='0'
