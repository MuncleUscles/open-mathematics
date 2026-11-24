"""Federation accounting/state-machine tests. Web/LLM responses are mocked, not native E2E."""
from datetime import datetime, timezone
import copy
import hashlib
import json

import pytest

from test_open_research import (
    open_protocol, address, credited, submit, settle_initial, impact_review,
    settle_impact, use, digest,
)


def hashed(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def source(**changes):
    value = {"repository": "upstream/proofs", "repository_id": 123, "pr": 17, "commit": "a" * 40,
             "path": "Proofs/Component.lean", "blob_sha": "b" * 40, "content_sha256": "c" * 64,
             "theorem": "Component.transport", "statement": "A precisely pinned theorem about a finite Boolean encoding.",
             "license": "Apache-2.0", "source_url": "https://github.com/upstream/proofs/blob/" + "a" * 40 + "/Proofs/Component.lean",
             "github_author_id": 777, "origin": "formalization",
             "attribution_basis": "The upstream accepted pull request identifies this GitHub contributor as formalizer; original mathematical discovery is unknown."}
    value.update(changes)
    return value


def provenance(*sources):
    return {"mode": "integration", "discovery_basis": "", "sources": [
        {"reference": item["source_url"], "title": "An external formalized mathematical component",
         "authors": ["Verified upstream formalizer"],
         "relationship": "The local result adapts this exact upstream mathematical component to the current environment.",
         "priority_evidence": "The immutable source records formalization; original discovery priority is unknown."} for item in sources]}


def prepared(c, vm, verifier, executor, owner, *, key="local", external=None, settle=True, github_author_id=1):
    external = source() if external is None else external
    vm.sender = verifier
    external_id = c.register_external_result(json.dumps(external))
    data = credited(c, vm, verifier, executor, owner, key, provenance=provenance(external), github_author_id=github_author_id)
    if settle:
        c.review_impact(key, 0)
    return external_id, data


def request(c, vm, reporter, key, external_id, *, claim=None, revision=None):
    vm.sender = reporter
    revision = c.get_attribution(key)["revision"] if revision is None else revision
    return c.request_attribution(key, revision, json.dumps({"claim": claim or "The exact upstream formalization deserves documented attribution alongside the local integration work.",
        "sources": [{"id": external_id, "source_hash": c.get_external_result(external_id)["source_hash"]}]}))


def admit(c, vm, verifier, case_id):
    vm.sender = verifier
    case = c.get_attribution_case(case_id)
    c.attest_attribution(case_id, 0, json.dumps({"case_id": case_id, "revision": case["revision"], "request_hash": case["request_hash"],
        "sources": case["request"]["sources"], "basis": "The exact retrieved source and PR support this formalizer's contribution; no discovery-priority assertion is made."}))
    return c.get_attribution_case(case_id)


def band(local, external, subject="github:777"):
    return ([{"subject": "contributor", "band": local}] if local else []) + ([{"subject": subject, "band": external}] if external else [])


def verdict(c, case_id, *, initial=None, future=None, apply=True, upheld=None):
    case = c.get_attribution_case(case_id)
    value = {"apply": apply, "initial_bands": initial or band(5, 5), "impact_bands": future or band(2, 8),
             "reason": "The source demonstrates upstream formalization while the importer adds useful integration; allocate the two distinct pools explicitly.",
             "evidence_refs": [case_id, case["target"]] + [x["id"] for x in case["request"]["sources"]]}
    if not apply:
        value["initial_bands"] = value["impact_bands"] = []
    if upheld is not None:
        value["challenge_upheld"] = upheld
        value["evidence_refs"].append("challenge:" + str(case["round"] - 1))
    return value


def review(c, vm, executor, case_id, value=None):
    vm.sender = executor
    case = c.get_attribution_case(case_id)
    c.begin_attribution_review(case_id, case["round"], case["attestation_hash"])
    vm.clear_mocks()
    vm.mock_llm(".*", json.dumps(value or verdict(c, case_id)))
    return c.review_attribution(case_id, case["round"], case["attestation_hash"])


def after(vm, stamp):
    vm.warp(datetime.fromtimestamp(stamp + 1, timezone.utc).isoformat())


def settle(c, vm, executor, case_id):
    vm.sender = executor
    case = c.get_attribution_case(case_id)
    after(vm, case["deadline"])
    c.settle_attribution(case_id, case["round"], case["attestation_hash"])


def correction(c, vm, verifier, executor, reporter, key, external_id, *, initial=None, future=None, claim=None):
    case_id = request(c, vm, reporter, key, external_id, claim=claim)
    admit(c, vm, verifier, case_id)
    review(c, vm, executor, case_id, verdict(c, case_id, initial=initial, future=future))
    settle(c, vm, executor, case_id)
    return case_id


def claim(c, vm, claimant, *, subject="github:777", nonce="f" * 64):
    vm._chain_id = 61999
    vm.sender = claimant
    # Create a fixed valid test time, later than contribution settlement.
    vm.warp("2031-01-01T12:00:00Z")
    return c.request_author_claim(subject, nonce, int(datetime(2031, 1, 2, 12, tzinfo=timezone.utc).timestamp()))


def mock_comment(c, vm, claim_id, *, actor=777, comment_id=1234, edit=False, body=None, issue=None, status=200, repository_id=123):
    current = c.get_author_claim(claim_id)
    stamp = datetime.fromtimestamp(current["created_at"], timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    value = {"id": comment_id, "user": {"id": actor, "type": "User"},
             "issue_url": issue or "https://api.github.com/repos/upstream/proofs/issues/17",
             "body": current["challenge"] if body is None else body,
             "created_at": stamp, "updated_at": "2031-01-01T12:00:01Z" if edit else stamp}
    vm.clear_mocks()
    vm.mock_web(r"^https://api\.github\.com/repos/upstream/proofs$", {"status": 200, "body": json.dumps({"id": repository_id})})
    vm.mock_web(r"^https://api\.github\.com/repos/upstream/proofs/issues/comments/1234$", {"status": status, "body": json.dumps(value)})
    return value


def claim_and_settle(c, vm, executor, claimant, external_id):
    claim_id = claim(c, vm, claimant)
    mock_comment(c, vm, claim_id)
    vm.sender = executor
    checked = c.verify_author_claim(claim_id, external_id, 1234)
    after(vm, checked["deadline"])
    c.settle_author_claim(claim_id)
    return claim_id


def conserved(c, wallets):
    state = c.get_federation_state()
    balances = sum(int(c.get_points(address(w))["points"]) for w in wallets)
    assert balances + int(state["unclaimed_points"]) == int(state["total_points"])
    assert int(state["total_points"]) + int(state["total_reserved_points"]) == int(state["total_award_budgets"])
    accounts = c.list_attribution_accounts(0, 64)["items"]
    assert sum(int(c.get_account_attribution(i)["points"]) for i in accounts) == int(state["total_points"])
    for w in wallets:
        p = c.get_federation_points(address(w))
        assert int(p["current_points"]) == int(p["earned_initial_points"]) + int(p["earned_impact_points"]) + int(p["attribution_delta"])


def test_source_registration_is_immutable_zero_award_and_has_stable_subject(open_protocol, direct_vm, direct_alice, direct_owner):
    c = open_protocol
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("trusted verifier"):
        c.register_external_result(json.dumps(source()))
    direct_vm.sender = direct_alice
    original = source()
    key = c.register_external_result(json.dumps(original))
    expected = "external-" + hashed({k: original[k] for k in ["repository_id", "commit", "path", "theorem"]})[:32]
    assert key == expected == c.register_external_result(json.dumps(original))
    entry = c.get_external_result(key)
    assert entry["source_hash"] == hashed(original)
    assert entry["subject"] == "github:777" and entry["verification"] == "not-locally-verified"
    assert c.get_federation_state()["total_points"] == "0"
    assert c.get_external_author("github:777")["claimed_wallet"] is None
    with direct_vm.expect_revert("cannot change"):
        c.register_external_result(json.dumps(source(attribution_basis="A different claimant asks to change the recorded source attribution without reviewed evidence.")))
    with direct_vm.expect_revert("no wallet field"):
        c.register_external_result(json.dumps(source(wallet=address(direct_owner))))


@pytest.mark.parametrize("changes", [
    {"repository_id": True}, {"github_author_id": 9007199254740992}, {"pr": 0},
    {"path": "../secret"}, {"source_url": "https://evil.example/source"}, {"origin": "proved"},
    {"content_sha256": "A" * 64}, {"license": ""},
])
def test_external_source_rejects_ambiguous_identity_and_mutable_links(open_protocol, direct_vm, direct_alice, changes):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert():
        open_protocol.register_external_result(json.dumps(source(**changes)))
    assert open_protocol.list_external_results(0, 64)["total"] == 0


def test_correction_conserves_initial_pool_and_original_earned_history(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    external_id, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    original, impact = c.get("local"), c.get_impact("local")
    key = correction(c, direct_vm, direct_alice, direct_bob, direct_charlie, "local", external_id)
    assert c.get("local") == original and c.get_impact("local") == impact
    assert c.get_points(address(direct_owner))["initial_points"] == "400"
    assert c.get_points(address(direct_owner))["points"] == "200"
    assert c.get_external_author("github:777")["unclaimed_points"] == "200"
    assert c.get_attribution("local")["impact_bands"] == band(2, 8)
    conserved(c, [direct_owner, direct_charlie])
    before = c.get_federation_state()
    case = c.get_attribution_case(key)
    c.settle_attribution(key, case["round"], case["attestation_hash"])
    assert c.get_federation_state() == before
    with direct_vm.expect_revert("exact current attribution revision"):
        request(c, direct_vm, direct_charlie, "local", external_id, revision=0)
    assert c.get_federation_state() == before


def test_settled_reserve_and_matching_declared_source_are_required(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    c = open_protocol
    external_id, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner, settle=False)
    with direct_vm.expect_revert("settled reserve"):
        request(c, direct_vm, direct_owner, "local", external_id)
    direct_vm.sender = direct_bob
    c.review_impact("local", 0)
    direct_vm.sender = direct_alice
    other = source(theorem="Component.different", commit="d" * 40, source_url="https://github.com/upstream/proofs/blob/" + "d" * 40 + "/Proofs/Component.lean")
    wrong = c.register_external_result(json.dumps(other))
    with direct_vm.expect_revert("exact declared provenance URL"):
        request(c, direct_vm, direct_owner, "local", wrong)


def test_native_case_fence_blocks_duplicate_wallet_and_failed_review_reroll(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    key = request(c, direct_vm, direct_owner, "local", ext)
    assert request(c, direct_vm, direct_charlie, "local", ext) == key
    original = admit(c, direct_vm, direct_alice, key)
    direct_vm.sender = direct_bob
    c.begin_attribution_review(key, 0, original["attestation_hash"])
    direct_vm.clear_mocks(); direct_vm.mock_llm(".*", json.dumps({"accept": True}))
    with direct_vm.expect_revert("exact attribution verdict"):
        c.review_attribution(key, 0, original["attestation_hash"])
    fenced = c.get_attribution_case(key)
    assert fenced["started_round"] == 0 and fenced["finished_round"] == -1
    assert request(c, direct_vm, direct_charlie, "local", ext) == key
    another = request(c, direct_vm, direct_charlie, "local", ext, claim="Different prose cannot bypass an unresolved admitted case for this same mathematical component.")
    assert another == key
    assert c.get_federation_state()["unclaimed_points"] == "0"


def test_rejected_case_cannot_get_fresh_review_by_paraphrasing(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    key = request(c, direct_vm, direct_owner, "local", ext)
    admit(c, direct_vm, direct_alice, key)
    review(c, direct_vm, direct_bob, key, verdict(c, key, apply=False))
    settle(c, direct_vm, direct_bob, key)
    assert c.get_attribution("local")["revision"] == 0
    assert request(c, direct_vm, direct_charlie, "local", ext, claim="A longer paraphrase of the same documentary case must not create a favorable second judgment.") == key
    with direct_vm.expect_revert("only original submitted"):
        admit(c, direct_vm, direct_alice, key)


@pytest.mark.parametrize("mutation", [
    lambda v: v.update(initial_bands=band(5, 6)),
    lambda v: v.update(impact_bands=band(1, 1)),
    lambda v: v["initial_bands"][0].update(wallet="0x" + "1" * 40),
    lambda v: v["initial_bands"][1].update(subject="github:999"),
    lambda v: v["impact_bands"][0].update(band=True),
    lambda v: v.update(evidence_refs=v["evidence_refs"][:-1]),
])
def test_consensus_cannot_inflate_or_choose_unverified_recipients(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, mutation):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    key = request(c, direct_vm, direct_owner, "local", ext)
    admit(c, direct_vm, direct_alice, key)
    value = verdict(c, key); mutation(value)
    with direct_vm.expect_revert():
        review(c, direct_vm, direct_bob, key, value)
    assert c.get_points(address(direct_owner))["points"] == "400"
    assert c.get_external_author("github:777")["unclaimed_points"] == "0"


@pytest.mark.parametrize("mutation, expected", [
    (lambda v: None, True),
    (lambda v: v.update(supported=False), False),
    (lambda v: v.update(supported="true"), False),
    (lambda v: v.update(reason="yes"), False),
    (lambda v: v.update(initial_bands=band(3, 7)), False),
    (lambda v: v.update(evidence_refs=v["evidence_refs"][:-1]), False),
    (lambda v: v.update(evidence_refs=v["evidence_refs"][1:]), False),
    (lambda v: v["evidence_refs"].append("invented-source"), False),
])
def test_independent_validator_audits_proposal_instead_of_inventing_vectors(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, mutation, expected):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    key = request(c, direct_vm, direct_owner, "local", ext)
    admit(c, direct_vm, direct_alice, key)
    proposal = verdict(c, key)
    review(c, direct_vm, direct_bob, key, proposal)
    check = {"supported": True, "reason": "The documentary linkage supports both proposed distributions; local integration and upstream formalization receive proportionate credit.", "evidence_refs": proposal["evidence_refs"]}
    mutation(check)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(".*Independently audit the proposed verdict.*", json.dumps(check))
    assert direct_vm.run_validator() is expected


@pytest.mark.parametrize("phase", ["admitted", "started", "challenged"])
def test_expiry_preserves_accounting_releases_routes_and_fences_source_variants(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie, phase):
    c = open_protocol
    ext, upstream = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    credited(c, direct_vm, direct_alice, direct_bob, direct_charlie, "downstream", github_author_id=2, dependencies=["local"], verified_dependencies=[use(upstream)])
    route_before = c.get_impact_route_proposal("downstream")
    key = request(c, direct_vm, direct_owner, "local", ext)
    admitted = admit(c, direct_vm, direct_alice, key)
    direct_vm.sender = direct_bob
    if phase == "challenged":
        review(c, direct_vm, direct_bob, key)
        c.challenge_attribution(key, "The upstream share may overstate the source's role in the target; independently inspect the exact reuse.")
    if phase != "admitted":
        case = c.get_attribution_case(key)
        c.begin_attribution_review(key, case["round"], case["attestation_hash"])
    case = c.get_attribution_case(key)
    before = c.get_attribution("local")
    total = c.get_federation_state()
    balances = [c.get_points(address(direct_owner)), c.get_external_author("github:777"), c.get_account_attribution("1")]
    with direct_vm.expect_revert("active attribution case"):
        c.get_impact_route_proposal("downstream")
    with direct_vm.expect_revert("deadline must elapse"):
        c.expire_attribution(key, case["round"], case["attestation_hash"])
    # Repeated begin cannot extend the deadline.
    if phase != "admitted":
        c.begin_attribution_review(key, case["round"], case["attestation_hash"])
        assert c.get_attribution_case(key)["review_deadline"] == case["review_deadline"]
    direct_vm.warp(datetime.fromtimestamp(case["review_deadline"], timezone.utc).isoformat())
    direct_vm.clear_mocks()
    with direct_vm.expect_revert("exact attribution expiry"):
        c.expire_attribution(key, case["round"] + 1, case["attestation_hash"])
    with direct_vm.expect_revert("exact attribution expiry"):
        c.expire_attribution(key, case["round"], "f" * 64)
    # Permissionless expiry at the exact deadline. No model call is possible.
    direct_vm.sender = direct_charlie
    c.expire_attribution(key, case["round"], case["attestation_hash"])
    expired = c.get_attribution_case(key)
    assert expired["status"] == "expired" and expired["history"][:-1] == case["history"]
    c.expire_attribution(key, case["round"], case["attestation_hash"])
    assert c.get_attribution_case(key) == expired
    assert c.get_attribution("local") == before
    assert [c.get_points(address(direct_owner)), c.get_external_author("github:777"), c.get_account_attribution("1")] == balances
    assert {k:v for k,v in c.get_federation_state().items() if k != "state_revision"} == {k:v for k,v in total.items() if k != "state_revision"}
    assert c.get_impact_route_proposal("downstream") == route_before
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert():
        c.review_attribution(key, case["round"], case["attestation_hash"])
    with direct_vm.expect_revert():
        c.begin_attribution_review(key, case["round"], case["attestation_hash"])
    with direct_vm.expect_revert():
        c.settle_attribution(key, case["round"], case["attestation_hash"])
    assert request(c, direct_vm, direct_charlie, "local", ext) == key
    direct_vm.sender = direct_alice
    alternate = c.register_external_result(json.dumps(source(theorem="Component.other")))
    alternative = request(c, direct_vm, direct_charlie, "local", alternate)
    assert alternative != key
    with direct_vm.expect_revert("active attribution case"):
        admit(c, direct_vm, direct_alice, alternative)
    impact_review(direct_vm, "downstream", [("local", 3)])
    direct_vm.sender = direct_bob
    c.review_impact("downstream", 0)
    after(direct_vm, c.get_impact("downstream")["deadline"])
    c.settle_impact("downstream", 0)
    conserved(c, [direct_owner, direct_charlie])


def test_successful_review_wins_expiry_race_and_late_review_cannot_begin(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    key = request(c, direct_vm, direct_owner, "local", ext)
    case = admit(c, direct_vm, direct_alice, key)
    direct_vm.warp(datetime.fromtimestamp(case["review_deadline"] - 1, timezone.utc).isoformat())
    review(c, direct_vm, direct_bob, key)
    after(direct_vm, case["review_deadline"])
    with direct_vm.expect_revert("unfinished attribution"):
        c.expire_attribution(key, 0, case["attestation_hash"])
    settle(c, direct_vm, direct_bob, key)
    with direct_vm.expect_revert():
        c.expire_attribution(key, 0, case["attestation_hash"])
    key2 = request(c, direct_vm, direct_owner, "local", ext)
    case2 = admit(c, direct_vm, direct_alice, key2)
    direct_vm.sender = direct_bob
    c.begin_attribution_review(key2, 0, case2["attestation_hash"])
    after(direct_vm, case2["review_deadline"])
    with direct_vm.expect_revert("deadline closed"):
        c.begin_attribution_review(key2, 0, case2["attestation_hash"])
    with direct_vm.expect_revert("deadline closed"):
        c.review_attribution(key2, 0, case2["attestation_hash"])


def test_challenge_preserves_unupheld_allocations_and_settles_exact_round(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    key = request(c, direct_vm, direct_owner, "local", ext)
    admit(c, direct_vm, direct_alice, key)
    review(c, direct_vm, direct_bob, key)
    direct_vm.sender = direct_charlie
    c.challenge_attribution(key, "The source's verified formalization scope may not justify the proposed allocation; inspect the exact statement.")
    with direct_vm.expect_revert("preserve exact allocation"):
        review(c, direct_vm, direct_bob, key, verdict(c, key, initial=band(4, 6), upheld=False))
    review(c, direct_vm, direct_bob, key, verdict(c, key, upheld=False))
    case = c.get_attribution_case(key)
    with direct_vm.expect_revert("exact attribution settlement"):
        c.settle_attribution(key, 0, case["attestation_hash"])
    settle(c, direct_vm, direct_bob, key)
    assert c.get_attribution("local")["revision"] == 1
    conserved(c, [direct_owner, direct_charlie])


@pytest.mark.parametrize("options", [{"actor": 999}, {"edit": True}, {"body": "Copied wallet address only"},
    {"issue": "https://api.github.com/repos/upstream/proofs/issues/999"}, {"status": 404}, {"repository_id": 999}])
def test_author_claim_rejects_copied_edited_wrong_source_or_wrong_account_comment(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie, options):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    key = claim(c, direct_vm, direct_charlie)
    mock_comment(c, direct_vm, key, **options)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert():
        c.verify_author_claim(key, ext, 1234)
    assert c.get_external_author("github:777")["claimed_wallet"] is None


def test_claim_and_superseding_correction_reverse_actual_wallet_without_new_points(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    correction(c, direct_vm, direct_alice, direct_bob, direct_owner, "local", ext)
    before = c.get_federation_state()["total_points"]
    claimed = claim_and_settle(c, direct_vm, direct_bob, direct_charlie, ext)
    assert c.get_points(address(direct_charlie))["points"] == "200"
    assert c.get_external_author("github:777")["claimed_wallet"].lower() == address(direct_charlie).lower()
    c.settle_author_claim(claimed)
    correction(c, direct_vm, direct_alice, direct_bob, direct_owner, "local", ext, initial=band(8, 2), future=band(6, 4))
    assert c.get_points(address(direct_charlie))["points"] == "80"
    assert c.get_points(address(direct_owner))["points"] == "320"
    assert c.get_federation_state()["total_points"] == before == "400"
    assert c.get_account_attribution("777")["points"] == "80"
    conserved(c, [direct_owner, direct_charlie])
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("already has a wallet"):
        c.request_author_claim("github:777", "e" * 64, 9999999999)


def test_competing_claims_expiry_and_deleted_comment_fail_closed(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    first = claim(c, direct_vm, direct_charlie)
    original = c.get_author_claim(first)
    assert original["domain"] == {"chain_id": 61999, "contract": address(direct_vm._contract_address).lower(), "policy": "a" * 64,
        "author": "github:777", "wallet": address(direct_charlie).lower(), "nonce": "f" * 64, "expiry": original["expiry"]}
    with direct_vm.expect_revert("nonce already used"):
        c.request_author_claim("github:777", "f" * 64, original["expiry"])
    second = claim(c, direct_vm, direct_owner, nonce="e" * 64)
    mock_comment(c, direct_vm, first)
    direct_vm.sender = direct_bob
    before = c.verify_author_claim(first, ext, 1234)
    mock_comment(c, direct_vm, second)
    c.verify_author_claim(second, ext, 1234)
    after(direct_vm, before["deadline"])
    mock_comment(c, direct_vm, first, status=404)
    with direct_vm.expect_revert("unavailable"):
        c.settle_author_claim(first)
    mock_comment(c, direct_vm, first)
    c.settle_author_claim(first)
    with direct_vm.expect_revert("already bound"):
        c.settle_author_claim(second)
    assert c.get_external_author("github:777")["claimed_wallet"].lower() == address(direct_charlie).lower()


def test_author_claim_cannot_verify_after_expiry(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    key = claim(c, direct_vm, direct_charlie)
    after(direct_vm, c.get_author_claim(key)["expiry"])
    mock_comment(c, direct_vm, key)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("expired"):
        c.verify_author_claim(key, ext, 1234)


def test_corrected_impact_uses_explicit_route_and_largest_remainder(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    ext, upstream = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    correction(c, direct_vm, direct_alice, direct_bob, direct_owner, "local", ext, initial=band(5, 5), future=band(2, 8))
    credited(c, direct_vm, direct_alice, direct_bob, direct_charlie, "downstream", github_author_id=2, dependencies=["local"], verified_dependencies=[use(upstream)])
    result = settle_impact(c, direct_vm, direct_bob, "downstream", [("local", 3)])
    assert result["paid_points"] == "78" and result["returned_points"] == "2"
    shares = {x["subject"]: x["points"] for x in result["recipient_allocations"]}
    assert shares == {"contributor": "16", "github:777": "62"}
    assert c.get_external_author("github:777")["unclaimed_points"] == "262"
    assert c.get_account_attribution("777")["impact_points"] == "62"
    conserved(c, [direct_owner, direct_charlie])
    historical = c.get_impact("downstream")
    correction(c, direct_vm, direct_alice, direct_bob, direct_owner, "local", ext, initial=band(10, 0), future=band(10, 0))
    assert c.get_impact("downstream") == historical
    assert c.get_external_author("github:777")["unclaimed_points"] == "62"
    conserved(c, [direct_owner, direct_charlie])


def test_pending_impact_requires_explicit_route_reconciliation_without_reroll(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    ext, upstream = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    credited(c, direct_vm, direct_alice, direct_bob, direct_charlie, "downstream", github_author_id=2, dependencies=["local"], verified_dependencies=[use(upstream)])
    impact_review(direct_vm, "downstream", [("local", 3)])
    original = c.review_impact("downstream", 0)
    case_id = request(c, direct_vm, direct_owner, "local", ext)
    admit(c, direct_vm, direct_alice, case_id)
    direct_vm.sender = direct_bob
    after(direct_vm, original["deadline"])
    with direct_vm.expect_revert("active attribution case"):
        c.settle_impact("downstream", 0)
    review(c, direct_vm, direct_bob, case_id)
    settle(c, direct_vm, direct_bob, case_id)
    with direct_vm.expect_revert("route changed"):
        c.settle_impact("downstream", 0)
    direct_vm.clear_mocks()  # Reconciliation must never invoke the LLM.
    proposal = c.get_impact_route_proposal("downstream")
    changed = c.reconcile_impact_routes("downstream", 0, proposal["routing_revision"], proposal["route_commitments_hash"])
    assert c.reconcile_impact_routes("downstream", 0, proposal["routing_revision"], proposal["route_commitments_hash"]) == changed
    assert changed["allocations"] == original["allocations"] and changed["budget"] == original["budget"]
    assert changed["routing_revision"] == 1
    with direct_vm.expect_revert("routing challenge window"):
        c.settle_impact_routed("downstream", 0, 1, changed["route_commitments_hash"])
    after(direct_vm, changed["deadline"])
    with direct_vm.expect_revert("exact reconciled"):
        c.settle_impact("downstream", 0)
    with direct_vm.expect_revert("exact impact and routing"):
        c.settle_impact_routed("downstream", 0, 0, original["route_commitments_hash"])
    c.settle_impact_routed("downstream", 0, 1, changed["route_commitments_hash"])
    assert c.get_external_author("github:777")["unclaimed_points"] == "262"
    conserved(c, [direct_owner, direct_charlie])


def test_local_and_external_same_account_collapse_without_extra_budget(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner, github_author_id=777)
    correction(c, direct_vm, direct_alice, direct_bob, direct_owner, "local", ext)
    assert c.list_attribution_accounts(0, 64)["items"] == ["777"]
    assert c.get_account_attribution("777") == {"github_author_id": "777", "initial_points": "400", "impact_points": "0", "points": "400", "unclaimed_points": "200"}
    conserved(c, [direct_owner])


def test_challenged_impact_route_can_reconcile_without_erasing_challenge(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    ext, upstream = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    credited(c, direct_vm, direct_alice, direct_bob, direct_charlie, "downstream", github_author_id=2, dependencies=["local"], verified_dependencies=[use(upstream)])
    impact_review(direct_vm, "downstream", [("local", 3)])
    c.review_impact("downstream", 0)
    c.challenge_impact("downstream", "The exact dependency is more replaceable than claimed and the mathematical band should be reviewed.")
    original = c.get_impact("downstream")
    correction(c, direct_vm, direct_alice, direct_bob, direct_owner, "local", ext)
    direct_vm.clear_mocks()
    proposal = c.get_impact_route_proposal("downstream")
    changed = c.reconcile_impact_routes("downstream", 1, proposal["routing_revision"], proposal["route_commitments_hash"])
    assert changed["status"] == "challenged" and changed["challenges"] == original["challenges"]
    assert changed["allocations"] == original["allocations"]
    impact_review(direct_vm, "downstream", [("local", 2)], upheld=True)
    reviewed = c.review_impact("downstream", 1)
    after(direct_vm, reviewed["deadline"])
    c.settle_impact_routed("downstream", 1, 1, reviewed["route_commitments_hash"])
    assert c.get_impact("downstream")["paid_points"] == "52"
    conserved(c, [direct_owner, direct_charlie])


def test_two_route_changes_have_distinct_journal_calls_and_stale_proposals_fail(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    ext, upstream = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    credited(c, direct_vm, direct_alice, direct_bob, direct_charlie, "downstream", github_author_id=2, dependencies=["local"], verified_dependencies=[use(upstream)])
    impact_review(direct_vm, "downstream", [("local", 3)])
    original = c.review_impact("downstream", 0)
    noop = c.get_impact_route_proposal("downstream")
    c.reconcile_impact_routes("downstream", 0, 0, noop["route_commitments_hash"])
    correction(c, direct_vm, direct_alice, direct_bob, direct_owner, "local", ext)
    first = c.get_impact_route_proposal("downstream")
    assert first["route_commitments_hash"] != noop["route_commitments_hash"]
    one = c.reconcile_impact_routes("downstream", 0, 0, first["route_commitments_hash"])
    correction(c, direct_vm, direct_alice, direct_bob, direct_owner, "local", ext, initial=band(8, 2), future=band(6, 4))
    with direct_vm.expect_revert("routes changed"):
        c.reconcile_impact_routes("downstream", 0, 0, first["route_commitments_hash"])
    second = c.get_impact_route_proposal("downstream")
    assert second["routing_revision"] == 1
    with direct_vm.expect_revert("stale routing"):
        c.reconcile_impact_routes("downstream", 0, 0, second["route_commitments_hash"])
    two = c.reconcile_impact_routes("downstream", 0, 1, second["route_commitments_hash"])
    assert two["routing_revision"] == 2 and two["allocations"] == one["allocations"] == original["allocations"]
    after(direct_vm, two["deadline"])
    c.settle_impact_routed("downstream", 0, 2, two["route_commitments_hash"])
    conserved(c, [direct_owner, direct_charlie])


def test_route_preflight_before_first_review_detects_active_case_without_poisoning_write(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    c = open_protocol
    ext, upstream = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    credited(c, direct_vm, direct_alice, direct_bob, direct_charlie, "downstream", github_author_id=2, dependencies=["local"], verified_dependencies=[use(upstream)])
    ready = c.get_impact_route_proposal("downstream")
    assert ready["round"] == ready["routing_revision"] == 0
    key = request(c, direct_vm, direct_owner, "local", ext)
    admit(c, direct_vm, direct_alice, key)
    with direct_vm.expect_revert("active attribution"):
        c.get_impact_route_proposal("downstream")
    assert c.get_impact("downstream") == {"downstream": "downstream", "status": "not-requested"}
    review(c, direct_vm, direct_bob, key)
    settle(c, direct_vm, direct_bob, key)
    ready = c.get_impact_route_proposal("downstream")
    assert ready["route_commitments"][1]["revision"] == 1
    impact_review(direct_vm, "downstream", [("local", 3)])
    actual = c.review_impact("downstream", 0)
    assert actual["route_commitments"] == ready["route_commitments"]


def test_semantic_validator_requires_latest_challenge_support(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    c = open_protocol
    ext, _ = prepared(c, direct_vm, direct_alice, direct_bob, direct_owner)
    key = request(c, direct_vm, direct_owner, "local", ext)
    admit(c, direct_vm, direct_alice, key)
    review(c, direct_vm, direct_bob, key)
    c.challenge_attribution(key, "The separate future-impact vector needs a better evidence-based justification of the upstream formalizer's contribution.")
    proposal = verdict(c, key, upheld=False)
    review(c, direct_vm, direct_bob, key, proposal)
    check = {"supported": True, "reason": "Both complete vectors remain supported by the source and local integration evidence; the challenge supplies no reason to change them.", "evidence_refs": proposal["evidence_refs"][:-1]}
    direct_vm.clear_mocks()
    direct_vm.mock_llm(".*Independently audit the proposed verdict.*", json.dumps(check))
    assert direct_vm.run_validator() is False
    check["evidence_refs"] = proposal["evidence_refs"]
    direct_vm.clear_mocks()
    direct_vm.mock_llm(".*Independently audit the proposed verdict.*", json.dumps(check))
    assert direct_vm.run_validator() is True
