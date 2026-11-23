from datetime import datetime, timezone
from hashlib import sha256
import json

import pytest

from test_contract import evidence, setup
from test_impact import accept, pair, review


PAPER = 'https://example.org/archive/early-renaming'
REVISED_PAPER = 'https://example.org/archive/revised-attribution'
EXCERPT = 'The archived proceedings list the authors and describe the exact renaming component.'
REASON = 'The documentary record supports this allocation for the identified proof component.'
EXPIRATION = 'The recorded target revision is superseded by a settled provenance case.'


def wallet(address):
    return '0x' + bytes(address).hex()


def source(reference=PAPER, author='Example Mathematician'):
    return {
        'reference': reference,
        'title': 'Earlier work on CNF renaming',
        'authors': [author],
        'relationship': 'This source documents the prior use of the variable renaming result.',
        'priority_evidence': 'The archived proceedings record the publication and author attribution.',
    }


def request(kind, target, contract, *, sources=None, component='CNF variable renaming'):
    return contract.report_case(kind, target, json.dumps({
        'claim': 'The archived document identifies the relevant mathematical work and its authorship.',
        'component': component,
        'sources': [source()] if sources is None else sources,
    }))


def subject(name):
    return 'author-registry:' + name.lower().replace(' ', '-')


def documentary(case, **changes):
    authorship = case['kind'] == 'authorship'
    snapshots = []
    for index, item in enumerate(case['payload']['sources']):
        excerpt = EXCERPT
        if authorship and index == 0:
            excerpt += '\n' + case['identity_challenge']
        snapshots.append({
            'reference': item['reference'],
            'content_hash': sha256((item['reference'] + '\n' + excerpt).encode()).hexdigest(),
            'excerpt': excerpt,
            'retrieved_at': case['created_at'],
            'verified_authors': [{'name': name, 'subject': subject(name)} for name in item['authors']],
        })
    priority = [{
        'kind': 'publisher-record',
        'reference': item['reference'],
        'content_hash': item['content_hash'],
        'excerpt': EXCERPT,
    } for item in snapshots]
    return {
        'sources': snapshots,
        'priority_verified': True,
        'priority_basis': priority,
        'identity_subject': snapshots[0]['verified_authors'][0]['subject'] if authorship else '',
        'identity_challenge': case.get('identity_challenge', ''),
        'identity_author_id': case['target'] if authorship else '',
        'identity_source': snapshots[0]['reference'] if authorship else '',
        'authorship_verified': authorship,
        'formal_verified': False,
        'statement_hash': '',
        'artifact_hash': '',
        'policy': '',
        **changes,
    }


def attest(contract, key, **changes):
    case = contract.get_case(key)
    contract.attest_case(key, case['round'], json.dumps(documentary(case, **changes)))
    return contract.get_case(key)


def correction(retain, allocations=(), **changes):
    return {
        'apply': True,
        'mode': 'integration',
        'retain_initial_points': retain,
        'external_allocations': list(allocations),
        **changes,
    }


def decision(vm, case, **verdict):
    vm.clear_mocks()
    vm.mock_llm('.*', json.dumps({
        'reason': REASON,
        'evidence_refs': [case['id'], 'source:0'],
        **verdict,
    }))


def review_provenance(contract, vm, key, **verdict):
    case = contract.get_case(key)
    decision(vm, case, **verdict)
    return contract.review_case(key, case['round'], case['attestation_hash'])


def after_deadline(vm, record):
    vm.warp(datetime.fromtimestamp(record['deadline'] + 1, timezone.utc).isoformat())


def settle(contract, vm, key):
    case = contract.get_case(key)
    after_deadline(vm, case)
    contract.settle_case(key, case['round'], case['attestation_hash'])
    return contract.get_case(key)


def author_record(contract, author_id):
    return next(author for author in contract.get_external_authors() if author['id'] == author_id)


def assert_conserved(contract, key, *, retained, external, revoked):
    provenance = contract.get_provenance(key)
    assert provenance['current_initial_points'] == retained
    assert sum(item['points'] for item in provenance['external_allocations']) == external
    assert provenance['revoked_points'] == revoked
    assert retained + external + revoked == provenance['original_initial_points'] == 400
    return provenance


def test_correction_claim_and_supersession_conserve_original_award(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = setup(direct_vm, direct_deploy, direct_alice)
    pair(c, direct_vm, direct_alice, direct_bob)
    review(direct_vm)
    c.review_impact('downstream', 0)
    after_deadline(direct_vm, c.get_impact('downstream'))
    c.settle_impact('downstream', 0)
    original = c.get('upstream')
    impact = c.get_impact('downstream')

    case = request('attribution', 'upstream', c)
    recipient, = attest(c, case)['author_ids']
    review_provenance(c, direct_vm, case, **correction(100, [{'author_id': recipient, 'points': 200}]))
    first = settle(c, direct_vm, case)
    assert_conserved(c, 'upstream', retained=100, external=200, revoked=100)
    assert c.get_points(wallet(direct_alice))['initial_points'] == '100'
    assert c.get_points(wallet(direct_alice))['impact_points'] == '100'
    assert c.get_points(wallet(direct_alice))['total_awarded'] == '800'
    assert author_record(c, recipient)['unclaimed_points'] == '200'

    direct_vm.sender = direct_bob
    claim = request('authorship', recipient, c)
    assert wallet(direct_bob).lower() in c.get_case(claim)['identity_challenge'].lower()
    direct_vm.sender = direct_alice
    attest(c, claim)
    review_provenance(c, direct_vm, claim, approve=True)
    claimed = settle(c, direct_vm, claim)
    c.settle_case(claim, claimed['round'], claimed['attestation_hash'])
    author = author_record(c, recipient)
    assert author['claimed_wallet'].lower() == wallet(direct_bob).lower()
    assert author['unclaimed_points'] == '0'
    assert len(author['claim_history']) == 1
    assert c.get_points(wallet(direct_bob))['initial_points'] == '600'
    assert c.get_points(wallet(direct_bob))['total_awarded'] == '800'

    replacement = request('attribution', 'upstream', c, sources=[source(REVISED_PAPER, 'Another Mathematician')])
    alternate, = attest(c, replacement)['author_ids']
    review_provenance(c, direct_vm, replacement, **correction(300, [{'author_id': alternate, 'points': 100}]))
    second = settle(c, direct_vm, replacement)
    c.settle_case(replacement, second['round'], second['attestation_hash'])
    c.settle_case(case, first['round'], first['attestation_hash'])
    c.settle_impact('downstream', 0)

    effective = assert_conserved(c, 'upstream', retained=300, external=100, revoked=0)
    assert effective['version'] == 2
    assert [change['case'] for change in effective['corrections']] == [case, replacement]
    assert effective['corrections'][0]['after'] == effective['corrections'][1]['before']
    assert c.get('upstream') == original
    assert c.get_impact('downstream') == impact
    assert c.get_points(wallet(direct_alice))['points'] == '400'
    assert c.get_points(wallet(direct_alice))['impact_points'] == '100'
    assert c.get_points(wallet(direct_bob))['initial_points'] == '400'
    assert author_record(c, alternate)['unclaimed_points'] == '100'
    assert c.get_points(wallet(direct_alice))['total_awarded'] == '900'


def test_concurrent_attribution_decisions_cannot_apply_twice(direct_vm, direct_deploy, direct_alice):
    c = setup(direct_vm, direct_deploy, direct_alice)
    accept(c, direct_vm, direct_alice, direct_alice, 'lemma', 'd' * 64, 30)
    first = request('attribution', 'lemma', c, component='first disputed component')
    second = request('attribution', 'lemma', c, component='second disputed component')
    for key, retained in [(first, 200), (second, 300)]:
        assert attest(c, key)['revision'] == 0
        review_provenance(c, direct_vm, key, **correction(retained))
    with direct_vm.expect_revert('only objectively stale'):
        c.expire_case(second, EXPIRATION)
    for component in ['third disputed component', 'fourth disputed component']:
        request('attribution', 'lemma', c, component=component)
    with direct_vm.expect_revert('four unresolved cases'):
        request('attribution', 'lemma', c, component='quota reached')

    settle(c, direct_vm, first)
    request('attribution', 'lemma', c, component='slot released by settlement')
    stale = c.get_case(second)
    within = c.get_provenance('lemma')
    after_deadline(direct_vm, stale)
    with direct_vm.expect_revert('superseded attribution revision'):
        c.settle_case(second, stale['round'], stale['attestation_hash'])
    assert c.get_provenance('lemma') == within
    assert c.get_points(wallet(direct_alice))['initial_points'] == '200'
    c.expire_case(second, EXPIRATION)
    c.expire_case(second, EXPIRATION)
    assert c.get_case(second)['status'] == 'expired'
    request('attribution', 'lemma', c, component='slot released by expiration')
    with direct_vm.expect_revert('four unresolved cases'):
        request('attribution', 'lemma', c, component='replay did not free a second slot')


def test_competing_wallet_claims_and_stale_identity_challenge(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = setup(direct_vm, direct_deploy, direct_alice)
    accept(c, direct_vm, direct_alice, direct_alice, 'lemma', 'd' * 64, 30)
    correction_id = request('attribution', 'lemma', c)
    author, = attest(c, correction_id)['author_ids']
    for actor in (direct_bob, direct_charlie):
        direct_vm.sender = actor
        key = request('authorship', author, c)
        if actor == direct_bob:
            first = key
        else:
            second = key

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert('exact unexpired wallet and author identity'):
        attest(c, second, identity_challenge=c.get_case(first)['identity_challenge'])
    for key in (first, second):
        attest(c, key)
        review_provenance(c, direct_vm, key, approve=True)
    settle(c, direct_vm, first)
    stale = c.get_case(second)
    after_deadline(direct_vm, stale)
    with direct_vm.expect_revert('stale or expired author binding'):
        c.settle_case(second, stale['round'], stale['attestation_hash'])
    c.expire_case(second, EXPIRATION)
    assert c.get_case(second)['status'] == 'expired'
    author = author_record(c, author)
    assert author['claimed_wallet'].lower() == wallet(direct_bob).lower()
    assert author['binding_version'] == 1


def test_report_roles_targets_and_typed_verdicts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = setup(direct_vm, direct_deploy, direct_alice)
    c.register(evidence(direct_alice, 'pending', 'e' * 64))
    accept(c, direct_vm, direct_alice, direct_alice, 'lemma', 'd' * 64, 30)
    direct_vm.sender = direct_bob
    for kind, target, message in [
        ('attribution', 'pending', 'settled contribution'),
        ('attribution', 'missing', 'unknown contribution'),
        ('authorship', 'unlisted-author', 'unknown external author'),
        ('external-solution', 'another-problem', 'unknown or already resolved problem'),
    ]:
        with direct_vm.expect_revert(message):
            request(kind, target, c)
    with direct_vm.expect_revert('cannot select wallets'):
        request('attribution', 'lemma', c, sources=[{**source(), 'wallet': wallet(direct_bob)}])

    key = request('attribution', 'lemma', c)
    with direct_vm.expect_revert('trusted verifier'):
        attest(c, key)
    with direct_vm.expect_revert('consensus executor'):
        c.review_case(key, 0, '')

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert('exact documentary attestation'):
        attest(c, key, priority_verified=1)
    case = attest(c, key)
    author, = case['author_ids']
    for verdict, message in [
        (correction(100, apply=1), 'boolean provenance decision'),
        (correction(True), 'invalid retained initial allocation'),
        (correction(500), 'invalid retained initial allocation'),
        (correction(100, [{'author_id': author, 'points': 400}]), 'point budget exceeded'),
        (correction(100, [{'author_id': 'unlisted-author', 'points': 100}]), 'verified author without wallet'),
        (correction(100, [{'author_id': author, 'points': 100, 'wallet': wallet(direct_bob)}]), 'verified author without wallet'),
    ]:
        with direct_vm.expect_revert(message):
            review_provenance(c, direct_vm, key, **verdict)
    assert c.get_case(key)['status'] == 'verified'
    assert c.get_points(wallet(direct_alice))['initial_points'] == '400'


def test_documentary_attestation_binds_snapshot_and_registered_source_author(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = setup(direct_vm, direct_deploy, direct_alice)
    accept(c, direct_vm, direct_alice, direct_alice, 'lemma', 'd' * 64, 30)
    key = request('attribution', 'lemma', c, sources=[source(), source(REVISED_PAPER, 'Another Mathematician')])
    case = c.get_case(key)
    assert key in c.list_cases()
    assert c.list_case_page(0, 1) == [key]
    assert c.list_case_page(1, 1) == []
    with direct_vm.expect_revert('bounded case page required'):
        c.list_case_page(0, 101)
    assert key not in c.list_review_cases()

    renamed = documentary(case)
    renamed['sources'][0]['verified_authors'][0]['name'] = 'Unlisted Mathematician'
    with direct_vm.expect_revert('reporter names differ from verified source authors'):
        c.attest_case(key, c.get_case(key)["round"], json.dumps(renamed))
    mixed = documentary(case)
    mixed['priority_basis'][0]['content_hash'] = mixed['sources'][1]['content_hash']
    with direct_vm.expect_revert('corroborated priority evidence'):
        c.attest_case(key, c.get_case(key)["round"], json.dumps(mixed))
    unrelated = documentary(case)
    unrelated['priority_basis'][0]['excerpt'] = 'This sentence does not exist in the corroborating source snapshot.'
    with direct_vm.expect_revert('corroborated priority evidence'):
        c.attest_case(key, c.get_case(key)["round"], json.dumps(unrelated))

    author, _ = attest(c, key)['author_ids']
    assert key in c.list_review_cases()
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('authorship must cite the registered source author'):
        request('authorship', author, c, sources=[source(REVISED_PAPER)])
    wrong_name = request('authorship', author, c, sources=[source(PAPER, 'Another Mathematician')])
    valid = request('authorship', author, c)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert('author claim conflicts with verified source identity'):
        attest(c, wrong_name)
    with direct_vm.expect_revert('identity must bind the registered source author'):
        attest(c, valid, identity_author_id='different-author')
    with direct_vm.expect_revert('author claim conflicts with verified source identity'):
        attest(c, valid, identity_subject='different-public-subject')
    attest(c, valid)
    assert c.get_case(valid)['status'] == 'verified'


def test_first_documentary_attestation_pins_the_verified_author_subject(direct_vm, direct_deploy, direct_alice):
    c = setup(direct_vm, direct_deploy, direct_alice)
    accept(c, direct_vm, direct_alice, direct_alice, 'lemma', 'd' * 64, 30)
    first = request('attribution', 'lemma', c)
    author, = attest(c, first)['author_ids']
    pinned = author_record(c, author)
    assert pinned['verified_subject'] == subject(source()['authors'][0])
    assert pinned['claimed_wallet'] is None

    second = request('attribution', 'lemma', c, component='Reassessment of the same source')
    edited = documentary(c.get_case(second))
    edited['sources'][0]['verified_authors'][0]['subject'] = 'author-registry:unrelated-profile'
    with direct_vm.expect_revert('verified source identity cannot silently change'):
        c.attest_case(second, 0, json.dumps(edited))
    assert c.get_case(second)['status'] == 'submitted'
    assert author_record(c, author) == pinned
    assert second not in c.list_review_cases()
    assert attest(c, second)['author_ids'] == [author]


def test_authorship_challenge_is_required_on_the_registered_identity_snapshot(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = setup(direct_vm, direct_deploy, direct_alice)
    accept(c, direct_vm, direct_alice, direct_alice, 'lemma', 'd' * 64, 30)
    attribution = request('attribution', 'lemma', c)
    author, = attest(c, attribution)['author_ids']
    direct_vm.sender = direct_bob
    claim = request('authorship', author, c, sources=[source(), source(REVISED_PAPER)])
    direct_vm.sender = direct_alice
    case = c.get_case(claim)

    misplaced = documentary(case)
    misplaced['sources'][0]['excerpt'] = EXCERPT
    misplaced['sources'][1]['excerpt'] += '\n' + case['identity_challenge']
    with direct_vm.expect_revert('wallet challenge must be on the verified author identity source'):
        c.attest_case(claim, 0, json.dumps(misplaced))

    wrong_subject = documentary(case)
    wrong_subject['sources'][0]['verified_authors'][0]['subject'] = 'author-registry:unrelated-profile'
    with direct_vm.expect_revert('identity must bind the registered source author'):
        c.attest_case(claim, 0, json.dumps(wrong_subject))
    assert author_record(c, author)['claimed_wallet'] is None
    assert attest(c, claim)['status'] == 'verified'


def test_case_window_attestation_round_and_concrete_consensus(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = setup(direct_vm, direct_deploy, direct_alice)
    accept(c, direct_vm, direct_alice, direct_alice, 'lemma', 'd' * 64, 30)
    key = request('attribution', 'lemma', c)
    case = attest(c, key)
    author, = case['author_ids']
    approved = correction(100, [{'author_id': author, 'points': 100}])
    verdict = review_provenance(c, direct_vm, key, **approved)
    assert direct_vm.run_validator() is True
    assert direct_vm.run_validator(leader_result={**verdict, 'retain_initial_points': 200}) is False
    assert direct_vm.run_validator(leader_result={**verdict, 'external_allocations': []}) is False
    with direct_vm.expect_revert('window open'):
        c.settle_case(key, 0, case['attestation_hash'])
    with direct_vm.expect_revert('stale provenance settlement'):
        c.settle_case(key, 0, '0' * 64)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('consensus executor'):
        c.settle_case(key, 0, case['attestation_hash'])
    c.challenge_case(key, 'A second archive needs review before the decision is applied.')
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert('stale provenance settlement'):
        c.settle_case(key, 0, case['attestation_hash'])
    with direct_vm.expect_revert('exact verified case and round'):
        c.review_case(key, 1, '0' * 64)
    with direct_vm.expect_revert('bounded documentary verification'):
        c.attest_case(key, 0, json.dumps(case['attestation']))
    with direct_vm.expect_revert('bounded documentary verification'):
        c.attest_case(key, True, json.dumps(case['attestation']))
    assert c.get_case(key)['status'] == 'challenged'
    attestation = attest(c, key, priority_basis=[], priority_verified=False)
    assert attestation['attestation_hash'] != case['attestation_hash']
    with direct_vm.expect_revert('exact verified case and round'):
        c.review_case(key, 1, case['attestation_hash'])
    with direct_vm.expect_revert('corroborated attribution and priority'):
        review_provenance(c, direct_vm, key, **approved)
    review_provenance(c, direct_vm, key, **correction(400))
    settled = settle(c, direct_vm, key)
    assert [event['round'] for event in settled['history'] if event['event'] == 'review'] == [0, 1]
    assert c.get_points(wallet(direct_alice))['initial_points'] == '400'


@pytest.mark.parametrize('corrected', ['upstream', 'downstream'])
@pytest.mark.parametrize('already_reviewed', [False, True])
def test_correction_blocks_new_or_provisional_impact(direct_vm, direct_deploy, direct_alice, direct_bob, corrected, already_reviewed):
    c = setup(direct_vm, direct_deploy, direct_alice)
    pair(c, direct_vm, direct_alice, direct_bob)
    if already_reviewed:
        review(direct_vm)
        c.review_impact('downstream', 0)
    prior_impact = c.get_impact('downstream')

    key = request('attribution', corrected, c)
    attest(c, key)
    review_provenance(c, direct_vm, key, **correction(400))
    settle(c, direct_vm, key)
    assert c.get_provenance(corrected)['version'] == 1
    with direct_vm.expect_revert('corrected attribution requires a separately reviewed impact routing policy'):
        c.review_impact('downstream', 0)
    if already_reviewed:
        with direct_vm.expect_revert('attribution changed before impact settlement'):
            c.settle_impact('downstream', 0)
    assert c.get_impact('downstream') == prior_impact
    for account in [direct_alice, direct_bob]:
        assert c.get_points(wallet(account))['impact_points'] == '0'


def test_publication_alone_cannot_resolve_unenrolled_problem(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = setup(direct_vm, direct_deploy, direct_alice)
    direct_vm.sender = direct_bob
    key = request('external-solution', 'p-vs-np', c)
    assert c.get_problem()['status'] == 'open'
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert('exact enrolled full target'):
        attest(c, key, formal_verified=True, statement_hash='a' * 64, artifact_hash='b' * 64, policy='policy')
    attest(c, key)
    assert c.get_problem()['status'] == 'external-solution-under-review'
    with direct_vm.expect_revert('smaller lemma cannot resolve full problem'):
        review_provenance(c, direct_vm, key, resolve=True, external_allocations=[])
    review_provenance(c, direct_vm, key, resolve=False, external_allocations=[])
    settle(c, direct_vm, key)
    assert c.get_problem()['status'] == 'open'
    assert c.get_case(key)['verdict']['resolve'] is False
    assert c.get_points(wallet(direct_alice))['total_awarded'] == '0'


def test_exact_full_target_requires_checked_policy_and_preserves_earlier_record(direct_vm, direct_deploy, direct_alice):
    # Install the pinned runner before deploying the fixture with a synthetic full target.
    from pathlib import Path
    from gltest.direct.sdk_loader import setup_sdk_paths

    setup_sdk_paths(Path('contracts/research.py'), 'v0.2.16')
    direct_vm.sender = direct_alice
    address = wallet(direct_alice)
    target_hash = 'a' * 64
    c = direct_deploy('contracts/research.py', address, address, 'p-vs-np', 'policy', 10, False, target_hash, sdk_version='v0.2.16')
    accept(c, direct_vm, direct_alice, direct_alice, 'lemma', 'd' * 64, 30)
    original = c.get('lemma')
    key = request('external-solution', 'p-vs-np', c)
    checked = {'formal_verified': True, 'statement_hash': target_hash, 'artifact_hash': 'b' * 64, 'policy': 'policy'}
    for bad in [{'statement_hash': 'd' * 64}, {'policy': 'other-policy'}, {'artifact_hash': 'partial'}]:
        with direct_vm.expect_revert('exact enrolled full target'):
            attest(c, key, **{**checked, **bad})
    attest(c, key, **checked)
    review_provenance(c, direct_vm, key, resolve=True, external_allocations=[])
    competing = request('external-solution', 'p-vs-np', c, component='A distinct external resolution report')
    attest(c, competing, **checked)
    review_provenance(c, direct_vm, competing, resolve=True, external_allocations=[])
    finished = settle(c, direct_vm, key)
    c.settle_case(key, finished['round'], finished['attestation_hash'])
    stale = c.get_case(competing)
    with direct_vm.expect_revert('problem already resolved'):
        c.settle_case(competing, stale['round'], stale['attestation_hash'])
    c.expire_case(competing, 'The exact full target resolved through the earlier settled case.')
    assert c.get_case(competing)['status'] == 'expired'
    problem = c.get_problem()
    assert problem['status'] == 'resolved'
    assert problem['resolution']['case'] == key
    assert problem['resolution']['statement_hash'] == target_hash
    assert problem['resolution']['artifact_hash'] == checked['artifact_hash']
    with direct_vm.expect_revert('already resolved problem'):
        request('external-solution', 'p-vs-np', c)
    assert c.get('lemma') == original
    assert c.get_points(address)['total_awarded'] == '400'


def test_affiliation_is_caller_owned_and_historical(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = setup(direct_vm, direct_deploy, direct_alice)
    c.set_affiliation('p-equals-np')
    c.set_affiliation('p-equals-np')
    direct_vm.sender = direct_bob
    c.set_affiliation('p-not-equals-np')
    with direct_vm.expect_revert('unknown research side'):
        c.set_affiliation('forecast')
    direct_vm.sender = direct_alice
    c.set_affiliation('shared')
    affiliations = {item['wallet'].lower(): item for item in c.get_affiliations()}
    assert [entry['side'] for entry in affiliations[wallet(direct_alice)]['history']] == ['p-equals-np', 'shared']
    assert [entry['side'] for entry in affiliations[wallet(direct_bob)]['history']] == ['p-not-equals-np']
    assert c.get_points(wallet(direct_alice))['points'] == '0'


def test_restoring_revoked_credit_respects_global_issuance_cap(direct_vm,direct_deploy,direct_alice):
    c=setup(direct_vm,direct_deploy,direct_alice)
    accept(c,direct_vm,direct_alice,direct_alice,'upstream','1'*64,30)
    first=request('attribution','upstream',c)
    attest(c,first);review_provenance(c,direct_vm,first,**correction(0));settle(c,direct_vm,first)
    second=request('attribution','upstream',c,sources=[source(REVISED_PAPER)])
    attest(c,second);review_provenance(c,direct_vm,second,**correction(400))
    # Represent intervening valid issuance filling the global cap; the correction
    # cannot restore its original budget above that cap.
    from genlayer import u256
    c.total_points=u256(1000000)
    with direct_vm.expect_revert('restored allocation exceeds issuance cap'):settle(c,direct_vm,second)
    assert c.get_provenance('upstream')['current_initial_points']==0


def test_external_credit_cannot_borrow_another_sources_priority(direct_vm,direct_deploy,direct_alice):
    c=setup(direct_vm,direct_deploy,direct_alice)
    accept(c,direct_vm,direct_alice,direct_alice,'upstream','1'*64,30)
    key=request('attribution','upstream',c,sources=[source(),source(REVISED_PAPER,'Uncorroborated Importer')])
    case=c.get_case(key);e=documentary(case);e['priority_basis']=e['priority_basis'][:1]
    c.attest_case(key,0,json.dumps(e));case=c.get_case(key)
    assert len(case['author_ids'])==2 and len(case['priority_author_ids'])==1
    uncorroborated=next(a for a in case['author_ids'] if a not in case['priority_author_ids'])
    decision(direct_vm,case,**correction(0,[{'author_id':uncorroborated,'points':400}]))
    with direct_vm.expect_revert('priority for its own source author'):c.review_case(key,0,case['attestation_hash'])
    review_provenance(c,direct_vm,key,**correction(100,[{'author_id':case['priority_author_ids'][0],'points':300}]))
    settle(c,direct_vm,key)
    assert author_record(c,uncorroborated)['unclaimed_points']=='0'


def test_reporter_can_withdraw_only_unadmitted_cases_and_reuse_slot(direct_vm,direct_deploy,direct_alice,direct_bob):
    c=setup(direct_vm,direct_deploy,direct_alice)
    keys=[request('external-solution','p-vs-np',c,component='Component '+str(i)) for i in range(4)]
    with direct_vm.expect_revert('four unresolved'):request('external-solution','p-vs-np',c)
    direct_vm.sender=direct_bob
    with direct_vm.expect_revert('original reporter'):c.withdraw_case(keys[0],'Withdraw unsupported evidence.')
    direct_vm.sender=direct_alice;c.withdraw_case(keys[0],'Withdraw unsupported evidence.');c.withdraw_case(keys[0],'Repeat must be idempotent.')
    assert c.get_case(keys[0])['status']=='withdrawn'
    assert len(c.list_cases())==4
    fresh=request('external-solution','p-vs-np',c)
    attest(c,fresh)
    with direct_vm.expect_revert('unadmitted'):c.withdraw_case(fresh,'Cannot suppress admitted review.')


def test_author_capacity_is_reserved_before_any_merge(direct_vm,direct_deploy,direct_alice):
    c=setup(direct_vm,direct_deploy,direct_alice)
    e=json.loads(evidence(direct_alice));e['provenance']={'mode':'integration','sources':[source()],'discovery_basis':''}
    c.register(json.dumps(e))
    assert len(c.get_external_authors())==1
    # Concurrent documentary admissions can fill remaining capacity, but the
    # already registered proof has its exact source node reserved for merge.
    for i in range(1023):c.external_order.append('reserved-capacity-'+str(i))
    from test_contract import decision as merit
    merit(direct_vm);c.adjudicate('lemma',0);after_deadline(direct_vm,c.get('lemma'));c.finalize('lemma',0);c.confirm_merge('lemma','a'*40,'c'*40)
    assert c.get('lemma')['status']=='credited'
    e['id']='new';e['statement_hash']='9'*64;e['provenance']['sources']=[source(REVISED_PAPER)]
    with direct_vm.expect_revert('external author capacity'):c.register(json.dumps(e))
