"""Native v5 state-machine tests; verifier and LLM evidence are mocked, not E2E."""
from datetime import datetime, timezone
from hashlib import sha256
import json

import pytest


SOURCE = "contracts/research_v5.py"
POLICY = "a" * 64


def digest(value):
    return sha256(value.encode()).hexdigest()


def address(value):
    return "0x" + (value if isinstance(value, bytes) else value.as_bytes).hex()


def config(verifier, executor, /, **changes):
    return {
        "version": 5, "problem": "p-vs-np", "repository": "fixture/open-research", "branch": "research",
        "verifier": address(verifier), "executor": address(executor), "window": 10, "policy": POLICY, "minimum_account_age_days": 30,
        "objective": "Resolve P versus NP; useful work toward either outcome is welcome.",
        "legacy_ledgers": [{"chain_id": 61999, "address": "0x" + "9" * 40,
                            "reserved_statement_hashes": ["c" * 64], "reserved_proposition_hashes": ["d" * 64],
                            "description": "Earlier point ledger, retained separately without an import."}],
        **changes,
    }


@pytest.fixture
def open_protocol(direct_deploy, direct_alice, direct_bob):
    return direct_deploy(SOURCE, json.dumps(config(direct_alice, direct_bob)), sdk_version="v0.2.16")


def evidence(vm, contributor, key="open-result", *, note=False, **changes):
    offset = int(digest(key)[:8], 16)
    statement = f"∀ n : Nat, n + {offset} = n + {offset}"
    bundle = json.dumps({"version": 1, "definitions": "", "statement": statement, "proof": "by intro n; rfl", "dependencies": []}, indent=2) + "\n"
    proof = f"Research note {key}: this partial argument is not a kernel-verified theorem. Its limitations are declared." if note else bundle
    data = {
        "id": key, "problem": "p-vs-np", "policy": POLICY, "protocol_commit": "1" * 40, "worker_commit": "2" * 40,
        "contract": address(vm._contract_address), "repository": "fixture/open-research", "branch": "research",
        "pr": offset + 1, "head": digest("head:" + key)[:40], "base": "3" * 40, "wallet": address(contributor),
        "claim_digest": digest("claim:" + key), "submission_hash": digest("record:" + key), "github_author_id": 1,
        "github_account_created_at": int(datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp()), "github_account_type": "User",
        "claim_comment_id": offset + 2, "claim_comment_created_at": "2026-11-23T12:00:00Z",
        "statement_hash": digest("note:" + proof if note else "statement:" + statement),
        "proposition_hash": digest("note:" + proof if note else statement), "artifact_hash": digest("closure:" + proof),
        "verification": "not-formal" if note else "verified", "claim": "A bounded contribution whose relevance and nontrivial value must be assessed by consensus.",
        "kind": "research-note" if note else "lemma", "research_direction": "Explore a contributor-selected route through complexity theory.",
        "provenance": {"mode": "extension", "sources": [], "discovery_basis": "A known component is being formalized; no exhaustive search or discovery priority is asserted."},
        "dependencies": [], "verified_dependencies": [], "formal_statement": "" if note else statement, "proof": proof,
        "context": "Read the actual definitions and limitations; a true statement may be irrelevant or vacuous.",
        "evidence_kind": "research-note" if note else "formal", "artifact_path": f"research/notes/{key}.md" if note else f"research/artifacts/{key}.json",
        "bundle_hash": digest(proof), "related_contributions": [],
    }
    data.update(changes)
    return data


def submit(protocol, vm, verifier, contributor, key="open-result", **changes):
    data = evidence(vm, contributor, key, **changes)
    vm.sender = verifier
    protocol.register(json.dumps(data))
    return data


def initial_review(vm, key, *, accept=True, refs=None, scores=(1, 1, 2), upheld=None, reason=None):
    vm.clear_mocks()
    value = {"accept": accept, "novelty": scores[0] if accept else 0, "significance": scores[1], "reusability": scores[2],
             "reason": "Useful known infrastructure contributes only incremental value under the fixed research objective.",
             "evidence_refs": [key] if refs is None else refs}
    if upheld is not None:
        value["challenge_upheld"] = upheld
        if refs is None:
            value["evidence_refs"].append("challenge:0")
    if reason is not None:
        value["reason"] = reason
    vm.mock_llm(".*", json.dumps(value))
    return value


def settle_initial(protocol, vm, executor, key, *, accept=True):
    vm.sender = executor
    initial_review(vm, key, accept=accept, upheld=True if protocol.get(key)["status"] == "challenged" else None)
    protocol.adjudicate(key, protocol.get(key)["round"])
    state = protocol.get(key)
    vm.warp(datetime.fromtimestamp(state["deadline"] + 1, timezone.utc).isoformat())
    protocol.finalize(key, state["round"])
    if accept:
        protocol.confirm_merge(key, state["evidence"]["head"], digest("merge:" + key)[:40])


def credited(protocol, vm, verifier, executor, contributor, key, **changes):
    data = submit(protocol, vm, verifier, contributor, key, **changes)
    settle_initial(protocol, vm, executor, key)
    return data


def use(data):
    return {"id": data["id"], "artifact_hash": data["artifact_hash"], "proof_body_use": True}


def impact_review(vm, downstream, allocations, refs=None, upheld=None):
    vm.clear_mocks()
    value = {"allocations": [{"id": key, "band": band, "reason": "The normalized proof uses this exact settled artifact in a substantive construction."} for key, band in allocations],
             "reason": "Verified direct reuse warrants bounded nonrecursive retrospective credit only.",
             "evidence_refs": refs if refs is not None else [downstream] + [key for key, _ in allocations]}
    if upheld is not None:
        value["challenge_upheld"] = upheld
        if refs is None:
            value["evidence_refs"].append("challenge:0")
    vm.mock_llm(".*", json.dumps(value))
    return value


def settle_impact(protocol, vm, executor, downstream, allocations):
    vm.sender = executor
    impact_review(vm, downstream, allocations)
    value = protocol.review_impact(downstream, protocol.get_impact(downstream).get("round", 0))
    if value["status"] == "provisional":
        vm.warp(datetime.fromtimestamp(value["deadline"] + 1, timezone.utc).isoformat())
        protocol.settle_impact(downstream, value["round"])
    return protocol.get_impact(downstream)


def test_fixed_policy_has_no_task_gate_and_no_balance_import(open_protocol, direct_alice, direct_bob, direct_owner):
    assert open_protocol.get_config() == config(direct_alice, direct_bob)
    assert open_protocol.count_contributions() == 0
    assert open_protocol.list_contributions(0, 10) == {"items": [], "total": 0, "next_offset": None}
    assert open_protocol.get_points(address(direct_owner))["total_awarded"] == "0"
    problem = open_protocol.get_problem()
    assert problem["admission"] == "open" and problem["status"] == "open"
    assert problem["post_settlement_corrections"] is False
    for removed in ["enroll_policy", "get_goal", "list_goals", "close_goal", "import_snapshot", "transfer", "report_case"]:
        assert not hasattr(open_protocol, removed)


@pytest.mark.parametrize("change,error", [
    ({"version": True}, "version 5"), ({"curator": "0x" + "8" * 40}, "version 5"),
    ({"directions": ["shared"]}, "version 5"), ({"policy": "bad"}, "evaluation policy"),
    ({"objective": "anything"}, "evaluation policy"), ({"window": False}, "dispute window"),
    ({"minimum_account_age_days": 0}, "age threshold"), ({"minimum_account_age_days": 3651}, "age threshold"), ({"minimum_account_age_days": True}, "age threshold"),
    ({"branch": "main"}, "research branch"), ({"verifier": "0x" + "0" * 40}, "nonzero"),
    ({"legacy_ledgers": [{"address": "0x" + "9" * 40}]}, "historical ledger fields"),
])
def test_invalid_constructor(direct_vm, direct_deploy, direct_alice, direct_bob, change, error):
    with direct_vm.expect_revert(error):
        direct_deploy(SOURCE, json.dumps(config(direct_alice, direct_bob, **change)), sdk_version="v0.2.16")


def test_open_formal_admission_and_wallet_bound_initial_credit(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    data = submit(open_protocol, direct_vm, direct_alice, direct_owner)
    assert open_protocol.get(data["id"])["evidence"] == data
    direct_vm.sender = direct_bob
    initial_review(direct_vm, data["id"])
    verdict = open_protocol.adjudicate(data["id"], 0)
    assert verdict["award"] == "400"
    assert direct_vm.run_validator() is True
    with direct_vm.expect_revert("dispute window"):
        open_protocol.finalize(data["id"], 0)
    direct_vm.warp(datetime.fromtimestamp(open_protocol.get(data["id"])["deadline"] + 1, timezone.utc).isoformat())
    open_protocol.finalize(data["id"], 0)
    assert open_protocol.get_points(address(direct_owner))["points"] == "0"
    with direct_vm.expect_revert("stale head"):
        open_protocol.confirm_merge(data["id"], "4" * 40, "5" * 40)
    open_protocol.confirm_merge(data["id"], data["head"], "5" * 40)
    open_protocol.confirm_merge(data["id"], data["head"], "5" * 40)
    points = open_protocol.get_points(address(direct_owner))
    assert points["points"] == points["initial_points"] == points["total_initial_points"] == "320"
    assert points["total_award_budgets"] == "400" and points["total_reserved_points"] == "80"
    record = open_protocol.get(data["id"])
    assert record["award_budget"] == "400" and record["initial_paid"] == "320" and record["impact_reserve"] == "80"
    assert record["reserve_settled"] is False
    assert points["impact_points"] == "0"
    assert open_protocol.count_contributions() == 1
    with direct_vm.expect_revert("conflicting replay"):
        open_protocol.confirm_merge(data["id"], data["head"], "6" * 40)


@pytest.mark.parametrize("field,value,error", [
    ("policy", "b" * 64, "objective verification"), ("repository", "other/repo", "objective verification"),
    ("branch", "main", "objective verification"), ("contract", "0x" + "8" * 40, "bind this contract"),
    ("worker_commit", "0" * 40, "immutable commit"), ("protocol_commit", "x" * 40, "immutable commit"),
    ("bundle_hash", "0" * 64, "artifact bytes"), ("github_author_id", True, "comment identity"),
    ("claim_comment_id", 0, "comment identity"), ("claim_comment_created_at", "today", "creation timestamp"),
    ("research_direction", "", "contributor chosen direction"), ("verification", "green badge", "submitted statement"),
    ("artifact_path", "../definitions.lean", "submitted statement"), ("goal", "old-task", "exact open research"),
])
def test_exact_native_evidence_binding(open_protocol, direct_vm, direct_alice, direct_owner, field, value, error):
    data = evidence(direct_vm, direct_owner)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert(error):
        open_protocol.register(json.dumps({**data, field: value}))
    assert open_protocol.count_contributions() == 0


def test_authorities_claim_replay_and_historical_exclusions(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    data = evidence(direct_vm, direct_owner)
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("trusted verifier"):
        open_protocol.register(json.dumps(data))
    direct_vm.sender = direct_alice
    for field, value in [("statement_hash", "c" * 64), ("proposition_hash", "d" * 64)]:
        with direct_vm.expect_revert("historical"):
            open_protocol.register(json.dumps({**data, field: value}))
    open_protocol.register(json.dumps(data))
    with direct_vm.expect_revert("signed claim already registered"):
        open_protocol.register(json.dumps({**data, "id": "replayed-claim"}))
    for method in [lambda: open_protocol.adjudicate(data["id"], 0), lambda: open_protocol.finalize(data["id"], 0), lambda: open_protocol.confirm_merge(data["id"], data["head"], "5" * 40), lambda: open_protocol.review_impact(data["id"], 0), lambda: open_protocol.settle_impact(data["id"], 0)]:
        with direct_vm.expect_revert("executor"):
            method()


@pytest.mark.parametrize("kind", ["research-note", "counterexample", "failed-approach", "infrastructure"])
def test_notes_are_admitted_as_arguments_and_never_formal_proof(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, kind):
    data = submit(open_protocol, direct_vm, direct_alice, direct_owner, note=True, kind=kind)
    assert data["formal_statement"] == "" and data["verification"] == "not-formal"
    settle_initial(open_protocol, direct_vm, direct_bob, data["id"])
    direct_vm.clear_mocks()
    impact = open_protocol.review_impact(data["id"], 0)
    assert impact["status"] == "settled" and impact["paid_points"] == "0"
    assert open_protocol.get_provenance(data["id"])["post_settlement_corrections"] is False


@pytest.mark.parametrize("change", [
    {"verification": "verified"}, {"formal_statement": "This note asserts the whole problem is solved."},
    {"verified_dependencies": [{"id": "phantom", "artifact_hash": "a" * 64, "proof_body_use": True}]},
    {"artifact_path": "research/artifacts/note.json"},
])
def test_notes_cannot_claim_kernel_validity_or_verified_reuse(open_protocol, direct_vm, direct_alice, direct_owner, change):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("explicitly nonformal"):
        open_protocol.register(json.dumps(evidence(direct_vm, direct_owner, note=True, **change)))


def test_prior_graph_is_settled_acyclic_and_artifact_bound(open_protocol, direct_vm, direct_alice, direct_bob, direct_charlie, direct_owner):
    before = submit(open_protocol, direct_vm, direct_alice, direct_owner, "prior")
    for change, error in [({"dependencies": ["prior"]}, "already be settled"), ({"related_contributions": ["prior"]}, "already be settled"), ({"dependencies": ["later"]}, "prior contribution IDs"), ({"dependencies": ["missing"]}, "unknown contribution")]:
        direct_vm.sender = direct_alice
        with direct_vm.expect_revert(error):
            open_protocol.register(json.dumps(evidence(direct_vm, direct_charlie, "later", **change)))
    settle_initial(open_protocol, direct_vm, direct_bob, "prior")
    direct_vm.sender = direct_alice
    for usage, error in [({**use(before), "artifact_hash": "0" * 64}, "formal artifact reuse"), ({**use(before), "proof_body_use": False}, "direct proof use"), ({**use(before), "wallet": address(direct_owner)}, "direct proof use")]:
        with direct_vm.expect_revert(error):
            open_protocol.register(json.dumps(evidence(direct_vm, direct_charlie, "later", dependencies=["prior"], verified_dependencies=[usage])))
    after = submit(open_protocol, direct_vm, direct_alice, direct_charlie, "later", dependencies=["prior"], verified_dependencies=[use(before)], related_contributions=["prior"])
    assert open_protocol.get(after["id"])["evidence"]["verified_dependencies"] == [use(before)]


def test_two_contributions_pay_retrospective_reuse_once(open_protocol, direct_vm, direct_alice, direct_bob, direct_charlie, direct_owner):
    prior = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "upstream")
    empty = open_protocol.review_impact("upstream", 0)
    assert empty["paid_points"] == "0" and empty["returned_points"] == "80"
    later = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_charlie, "downstream", dependencies=["upstream"], verified_dependencies=[use(prior)])
    direct_vm.sender = direct_bob
    impact_review(direct_vm, later["id"], [(prior["id"], 1)])
    provisional = open_protocol.review_impact(later["id"], 0)
    assert direct_vm.run_validator() is True
    assert provisional["budget"] == 80 and provisional["band_points"] == 26
    assert provisional["eligible"][0]["id"] == "upstream" and provisional["allocations"][0]["points"] == "26"
    with direct_vm.expect_revert("window open"):
        open_protocol.settle_impact(later["id"], 0)
    direct_vm.warp(datetime.fromtimestamp(provisional["deadline"] + 1, timezone.utc).isoformat())
    open_protocol.settle_impact(later["id"], 0)
    open_protocol.settle_impact(later["id"], 0)
    upstream_points = open_protocol.get_points(address(direct_owner))
    assert upstream_points["initial_points"] == "400" and upstream_points["impact_points"] == "26" and upstream_points["points"] == "426"
    assert upstream_points["total_awarded"] == upstream_points["total_award_budgets"] == "800"
    assert upstream_points["total_reserved_points"] == "0"
    assert open_protocol.get("upstream")["credited_points"] == "400"
    assert open_protocol.get("downstream")["credited_points"] == "374"
    assert open_protocol.get("downstream")["reserve_returned"] == "54"
    with direct_vm.expect_revert("already exists"):
        open_protocol.review_impact("downstream", 0)


def test_self_reuse_is_eligible_but_citations_cannot_divert_a_reserve(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    prior = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "upstream")
    credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "self-reuse", dependencies=["upstream"], verified_dependencies=[use(prior)])
    impact_review(direct_vm, "self-reuse", [])
    provisional = open_protocol.review_impact("self-reuse", 0)
    assert provisional["status"] == "provisional" and [x["id"] for x in provisional["eligible"]] == ["upstream"]
    direct_vm.warp(datetime.fromtimestamp(provisional["deadline"] + 1, timezone.utc).isoformat())
    open_protocol.settle_impact("self-reuse", 0)
    assert open_protocol.get_impact("self-reuse")["paid_points"] == "0"
    assert open_protocol.get_impact("self-reuse")["returned_points"] == "80"
    credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_charlie, "citation", dependencies=["upstream"])
    direct_vm.clear_mocks()
    citation = open_protocol.review_impact("citation", 0)
    assert citation["paid_points"] == "0" and citation["returned_points"] == "80"
    assert open_protocol.get("citation")["credited_points"] == "400"


def test_global_three_band_budget_and_recipient_validation(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    first = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "first")
    second = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_alice, "second")
    credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_charlie, "downstream", dependencies=["first", "second"], verified_dependencies=[use(first), use(second)])
    for allocations, error in [([("first", 4)], "impact band"), ([("first", 2), ("second", 2)], "total band budget"), ([("stranger", 1)], "recipient")]:
        impact_review(direct_vm, "downstream", allocations)
        with direct_vm.expect_revert(error):
            open_protocol.review_impact("downstream", 0)
    impact_review(direct_vm, "downstream", [("first", 1)], refs=["first"])
    with direct_vm.expect_revert("impact references"):
        open_protocol.review_impact("downstream", 0)
    assert open_protocol.get_points(address(direct_owner))["impact_points"] == "0"


def test_distinct_controllers_budget_and_nonrecursive_credit(open_protocol, direct_vm, direct_alice, direct_bob, direct_charlie, direct_owner):
    first = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "first", github_author_id=1)
    middle = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_charlie, "middle", github_author_id=2, dependencies=["first"], verified_dependencies=[use(first)])
    assert settle_impact(open_protocol, direct_vm, direct_bob, "middle", [("first", 3)])["paid_points"] == "78"
    credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_alice, "last", github_author_id=3, dependencies=["middle"], verified_dependencies=[use(middle)])
    assert settle_impact(open_protocol, direct_vm, direct_bob, "last", [("middle", 2)])["paid_points"] == "52"
    assert open_protocol.get_points(address(direct_owner))["impact_points"] == "78"
    assert open_protocol.get_points(address(direct_charlie))["impact_points"] == "52"
    assert open_protocol.get("middle")["credited_points"] == "322"


def test_challenges_block_each_settlement_and_stale_rounds(open_protocol, direct_vm, direct_alice, direct_bob, direct_charlie, direct_owner):
    prior = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "first")
    current = submit(open_protocol, direct_vm, direct_alice, direct_charlie, "later", dependencies=["first"], verified_dependencies=[use(prior)])
    direct_vm.sender = direct_bob
    initial_review(direct_vm, "later")
    open_protocol.adjudicate("later", 0)
    direct_vm.sender = direct_owner
    open_protocol.challenge("later", "Check whether the contribution adds more than a trivial restatement.")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("stale adjudication"):
        open_protocol.adjudicate("later", 0)
    with direct_vm.expect_revert("unresolved"):
        open_protocol.finalize("later", 1)
    settle_initial(open_protocol, direct_vm, direct_bob, "later")
    impact_review(direct_vm, "later", [("first", 1)])
    open_protocol.review_impact("later", 0)
    direct_vm.sender = direct_owner
    open_protocol.challenge_impact("later", "The dependency is replaceable and the claimed impact may be artificial.")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("unresolved"):
        open_protocol.settle_impact("later", 1)
    impact_review(direct_vm, "later", [], upheld=True)
    with direct_vm.expect_revert("stale impact round"):
        open_protocol.review_impact("later", 0)
    state = open_protocol.review_impact("later", 1)
    direct_vm.warp(datetime.fromtimestamp(state["deadline"] + 1, timezone.utc).isoformat())
    open_protocol.settle_impact("later", 1)
    assert open_protocol.get_impact("later")["paid_points"] == "0"


def test_exact_consensus_band_disagreement_does_not_validate(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    submit(open_protocol, direct_vm, direct_alice, direct_owner)
    direct_vm.sender = direct_bob
    initial_review(direct_vm, "open-result")
    decision = open_protocol.adjudicate("open-result", 0)
    assert direct_vm.run_validator() is True
    initial_review(direct_vm, "open-result", scores=(1, 1, 1))
    assert direct_vm.run_validator() is False
    with direct_vm.expect_revert("evidence references"):
        direct_vm.run_validator(leader_result={k: v for k, v in {**decision, "evidence_refs": ["invented"]}.items() if k != "award"})
    assert direct_vm.run_validator(leader_error=Exception("leader failed")) is False


def test_concurrent_duplicates_and_stale_reservations(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    first = submit(open_protocol, direct_vm, direct_alice, direct_owner, "first")
    second = evidence(direct_vm, direct_charlie, "second", github_author_id=2, statement_hash=first["statement_hash"], proposition_hash=first["proposition_hash"])
    direct_vm.sender = direct_alice
    open_protocol.register(json.dumps(second))
    direct_vm.sender = direct_bob
    for key in ["first", "second"]:
        initial_review(direct_vm, key)
        open_protocol.adjudicate(key, 0)
    deadline = max(open_protocol.get(key)["deadline"] for key in ["first", "second"])
    direct_vm.warp(datetime.fromtimestamp(deadline + 1, timezone.utc).isoformat())
    open_protocol.finalize("first", 0)
    open_protocol.finalize("second", 0)
    assert open_protocol.get("second")["status"] == "rejected"
    assert open_protocol.get("second")["verdict"]["award"] == "0"
    open_protocol.release_unmerged("first", "The approved PR was closed before canonical merge confirmation.")
    replacement = submit(open_protocol, direct_vm, direct_alice, direct_owner, "replacement", statement_hash=first["statement_hash"], proposition_hash=first["proposition_hash"], artifact_hash=first["artifact_hash"], proof=first["proof"], bundle_hash=first["bundle_hash"])
    settle_initial(open_protocol, direct_vm, direct_bob, replacement["id"])
    with direct_vm.expect_revert("only unmerged"):
        open_protocol.release_unmerged(replacement["id"], "This cannot reverse an already credited mathematical contribution.")


def test_registry_exceeds_100_and_pages_without_unbounded_returns(open_protocol, direct_vm, direct_alice, direct_owner):
    for index in range(105):
        submit(open_protocol, direct_vm, direct_alice, direct_owner, f"note-{index}", note=True, github_author_id=index+1)
    assert open_protocol.count_contributions() == 105
    first = open_protocol.list_contributions(0, 100)
    assert first["items"] == [f"note-{i}" for i in range(100)] and first["next_offset"] == 100
    last = open_protocol.list_contributions(first["next_offset"], 100)
    assert last == {"items": [f"note-{i}" for i in range(100, 105)], "total": 105, "next_offset": None}
    assert open_protocol.list_contributions(999, 10)["items"] == []
    for offset, limit in [(-1, 10), (0, 101), (0, 0), (True, 10), (0, True)]:
        with direct_vm.expect_revert("bounded contribution page"):
            open_protocol.list_contributions(offset, limit)


def test_duplicate_context_is_recent50_plus_exact_old_related_records(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, monkeypatch):
    for index in range(52):
        credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, f"result-{index}", github_author_id=index+1)
    submit(open_protocol, direct_vm, direct_alice, direct_owner, "current", related_contributions=["result-0"], dependencies=["result-1"])
    captured = []

    def response(prompt):
        captured.append(json.loads(prompt.split("\nUNTRUSTED_DATA=", 1)[1]))
        return json.dumps({"accept": False, "novelty": 0, "significance": 0, "reusability": 0,
                           "reason": "The exact earlier records establish that this adds no substantive incremental value.", "evidence_refs": ["current", "result-0", "result-1"]})

    monkeypatch.setattr(direct_vm, "_match_llm_mock", response)
    direct_vm.sender = direct_bob
    open_protocol.adjudicate("current", 0)
    assert captured
    assert [p["id"] for p in captured[0]["prior"]] == [f"result-{i}" for i in range(2, 52)] + ["result-1", "result-0"]
    assert captured[0]["required_submission_reference"] == "current"
    assert captured[0]["objective"] == open_protocol.get_config()["objective"]
    assert not {"wallet", "github_author_id", "github_account_created_at", "github_account_type"}.intersection(captured[0]["submission"])


def test_no_global_point_total_stops_new_credit(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    # Seed only the accumulated counter to exercise the removed lifetime stop;
    # this is a direct-test state injection, never an import API.
    open_protocol.total_points = 1000000
    open_protocol.total_award_budgets = 1000000
    open_protocol.total_initial_points = 1000000
    credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "beyond-old-cap")
    open_protocol.review_impact("beyond-old-cap", 0)
    assert open_protocol.get_points(address(direct_owner))["total_awarded"] == "1000400"


def challenged_initial(protocol, vm, verifier, executor, owner, *, accepted=True):
    data = submit(protocol, vm, verifier, owner)
    vm.sender = executor
    initial_review(vm, data["id"], accept=accepted)
    previous = protocol.adjudicate(data["id"], 0)
    vm.sender = owner
    protocol.challenge(data["id"], "The review missed the explicitly stated boundary condition in the supplied artifact.")
    vm.sender = executor
    return data, previous


def test_unupheld_challenge_restores_verdict_verbatim_and_bool_requires_consensus(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    data, previous = challenged_initial(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner)
    initial_review(direct_vm, data["id"], upheld=False, reason="The objection establishes no factual error and supplies no new supporting evidence.")
    assert open_protocol.adjudicate(data["id"], 1) == previous
    assert direct_vm.run_validator() is True
    record = open_protocol.get(data["id"])
    assert record["verdict"] == previous and record["challenge_reviews"][0]["challenge_upheld"] is False
    initial_review(direct_vm, data["id"], upheld=True)
    assert direct_vm.run_validator() is False


@pytest.mark.parametrize("changes,error", [
    ({}, "malformed adjudication"),
    ({"upheld": True, "scores": (3, 3, 3)}, "cannot increase"),
    ({"upheld": False, "scores": (1, 1, 1)}, "must preserve"),
    ({"upheld": True, "refs": ["open-result"]}, "latest evidence"),
])
def test_challenges_cannot_reroll_accepted_bands(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, changes, error):
    data, previous = challenged_initial(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner)
    initial_review(direct_vm, data["id"], **changes)
    with direct_vm.expect_revert(error):
        open_protocol.adjudicate(data["id"], 1)
    assert open_protocol.get(data["id"])["verdict"] == previous
    initial_review(direct_vm, data["id"], upheld=True, scores=(1, 1, 1))
    assert open_protocol.adjudicate(data["id"], 1)["award"] == "300"


def test_rejected_appeal_requires_upheld_evidence_and_preserves_independent_band_agreement(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    data, previous = challenged_initial(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, accepted=False)
    initial_review(direct_vm, data["id"], upheld=True, reason="Please increase this award because it deserves points.")
    with direct_vm.expect_revert("substantive factual correction"):
        open_protocol.adjudicate(data["id"], 1)
    initial_review(direct_vm, data["id"], upheld=True, reason="The original rejection overlooked the explicitly restricted domain of the construction; the cited boundary example now resolves that specific factual error without changing the proved statement.")
    assert open_protocol.adjudicate(data["id"], 1)["accept"] is True
    assert direct_vm.run_validator() is True
    initial_review(direct_vm, data["id"], upheld=True, scores=(1, 1, 1))
    assert direct_vm.run_validator() is False
    assert previous["award"] == "0" and open_protocol.get_points(address(direct_owner))["points"] == "0"


def test_impact_challenge_preserves_or_reduces_existing_recipients_only(open_protocol, direct_vm, direct_alice, direct_bob, direct_charlie, direct_owner):
    first = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "first", github_author_id=1)
    second = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_alice, "second", github_author_id=2)
    credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_charlie, "later", github_author_id=3, dependencies=["first", "second"], verified_dependencies=[use(first), use(second)])
    impact_review(direct_vm, "later", [("first", 2)])
    previous = open_protocol.review_impact("later", 0)
    direct_vm.sender = direct_owner
    open_protocol.challenge_impact("later", "Review whether this dependency really merits the claimed impact allocation.")
    direct_vm.sender = direct_bob
    for allocation, upheld, error in [([("first", 3)], True, "cannot increase"), ([("second", 2)], True, "cannot increase"), ([], False, "must preserve")]:
        impact_review(direct_vm, "later", allocation, upheld=upheld)
        with direct_vm.expect_revert(error):
            open_protocol.review_impact("later", 1)
    impact_review(direct_vm, "later", [("first", 2)], upheld=False)
    restored = open_protocol.review_impact("later", 1)
    assert all(restored[k] == previous[k] for k in ["allocations", "reason", "evidence_refs"])
    assert direct_vm.run_validator() is True
    impact_review(direct_vm, "later", [("first", 2)], upheld=True)
    assert direct_vm.run_validator() is False
    direct_vm.sender = direct_owner
    open_protocol.challenge_impact("later", "A concrete omitted replacement argument reduces this dependency's demonstrated value.")
    direct_vm.sender = direct_bob
    impact_review(direct_vm, "later", [("first", 1)], upheld=True, refs=["later", "first", "challenge:1"])
    reduced = open_protocol.review_impact("later", 2)
    direct_vm.warp(datetime.fromtimestamp(reduced["deadline"] + 1, timezone.utc).isoformat())
    open_protocol.settle_impact("later", 2)
    assert open_protocol.get_impact("later")["paid_points"] == "26"
    assert open_protocol.get_impact("later")["returned_points"] == "54"
    assert open_protocol.get_points(address(direct_alice))["impact_points"] == "0"


def test_github_admission_quota_cannot_be_evaded_with_wallets_or_expiration(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    first = submit(open_protocol, direct_vm, direct_alice, direct_owner, "first")
    with direct_vm.expect_revert("one active contribution"):
        submit(open_protocol, direct_vm, direct_alice, direct_charlie, "same-controller")
    direct_vm.sender = direct_bob
    initial_review(direct_vm, "first")
    open_protocol.adjudicate("first", 0)
    direct_vm.warp(datetime.fromtimestamp(open_protocol.get("first")["deadline"] + 1, timezone.utc).isoformat())
    open_protocol.finalize("first", 0)
    with direct_vm.expect_revert("one active contribution"):
        submit(open_protocol, direct_vm, direct_alice, direct_charlie, "still-active")
    direct_vm.sender = direct_bob
    open_protocol.confirm_merge("first", first["head"], "5" * 40)
    for key in ["second", "third"]:
        submit(open_protocol, direct_vm, direct_alice, direct_charlie, key)
        direct_vm.sender = direct_bob
        open_protocol.release_unmerged(key, "The contributor closed this exact PR before a canonical merge.")
    with direct_vm.expect_revert("rolling 24 hours"):
        submit(open_protocol, direct_vm, direct_alice, direct_owner, "fourth")
    # Native registration timestamps, not caller-supplied comment timestamps, set the rolling limit.
    deadline = open_protocol.get("first")["deadline"]
    direct_vm.warp(datetime.fromtimestamp(deadline + 86401, timezone.utc).isoformat())
    submit(open_protocol, direct_vm, direct_alice, direct_owner, "fourth")
    assert open_protocol.count_contributions() == 4


def test_final_rejection_remembers_exact_bundle_but_stale_expiration_does_not(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    bad = submit(open_protocol, direct_vm, direct_alice, direct_owner, "rejected")
    settle_initial(open_protocol, direct_vm, direct_bob, "rejected", accept=False)
    with direct_vm.expect_revert("reserved credited or historical"):
        submit(open_protocol, direct_vm, direct_alice, direct_owner, "rejected-again", github_author_id=2, proof=bad["proof"], bundle_hash=bad["bundle_hash"])
    stale = submit(open_protocol, direct_vm, direct_alice, direct_owner, "stale")
    direct_vm.sender = direct_bob
    open_protocol.release_unmerged("stale", "Canonical base moved before this exact claim could be adjudicated.")
    submit(open_protocol, direct_vm, direct_alice, direct_owner, "fresh-claim", proof=stale["proof"], bundle_hash=stale["bundle_hash"])
    assert open_protocol.get("fresh-claim")["status"] == "submitted"


def test_notes_have_separate_capped_initial_accounting_and_short_formal_claims_reach_merit_review(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    note = submit(open_protocol, direct_vm, direct_alice, direct_owner, "note", note=True)
    direct_vm.sender = direct_bob
    initial_review(direct_vm, "note", scores=(3, 3, 3))
    assert open_protocol.adjudicate("note", 0)["award"] == "300"
    direct_vm.warp(datetime.fromtimestamp(open_protocol.get("note")["deadline"] + 1, timezone.utc).isoformat())
    open_protocol.finalize("note", 0)
    open_protocol.confirm_merge("note", note["head"], "5" * 40)
    open_protocol.confirm_merge("note", note["head"], "5" * 40)
    points = open_protocol.get_points(address(direct_owner))
    assert points["note_points"] == points["total_note_points"] == points["initial_points"] == points["points"] == "300"
    submit(open_protocol, direct_vm, direct_alice, direct_owner, "short", formal_statement="True")
    settle_initial(open_protocol, direct_vm, direct_bob, "short", accept=False)
    assert open_protocol.get("short")["status"] == "rejected"


def test_account_age_is_measured_at_original_claim_not_later_worker_time(open_protocol, direct_vm, direct_alice, direct_owner):
    claimed = int(datetime(2026, 11, 23, 12, tzinfo=timezone.utc).timestamp())
    direct_vm.warp("2027-01-01T00:00:00+00:00")
    with direct_vm.expect_revert("minimum age at original signed claim"):
        submit(open_protocol, direct_vm, direct_alice, direct_owner, "young", github_account_created_at=claimed-29*86400)
    with direct_vm.expect_revert("minimum age at original signed claim"):
        submit(open_protocol, direct_vm, direct_alice, direct_owner, "one-second-young", github_account_created_at=claimed-30*86400+1)
    data = submit(open_protocol, direct_vm, direct_alice, direct_owner, "exactly-thirty", github_account_created_at=claimed-30*86400)
    assert open_protocol.get(data["id"])["evidence"]["github_account_created_at"] == claimed-30*86400
    assert open_protocol.get_problem()["admission_limits"]["minimum_account_age_days"] == 30


@pytest.mark.parametrize("changes,error", [
    ({"github_account_type": "Bot"}, "normal GitHub account"),
    ({"github_account_type": "Organization"}, "normal GitHub account"),
    ({"github_account_created_at": True}, "creation time"),
    ({"github_account_created_at": -1}, "creation time"),
    ({"github_account_created_at": "1577836800"}, "creation time"),
    ({"github_account_created_at": 99999999999}, "creation time"),
    ({"claim_comment_created_at": "2026-02-30T12:00:00Z"}, "valid original UTC"),
    ({"claim_comment_created_at": "2026-11-23T12:00:00+00:00"}, "creation timestamp"),
])
def test_account_metadata_is_exact_trusted_evidence(open_protocol, direct_vm, direct_alice, direct_owner, changes, error):
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("trusted verifier"):
        open_protocol.register(json.dumps(evidence(direct_vm, direct_owner, **changes)))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert(error):
        open_protocol.register(json.dumps(evidence(direct_vm, direct_owner, **changes)))
    assert open_protocol.count_contributions() == 0


def assert_fixed_budget_totals(protocol, account, *, budgets, issued, reserved):
    points = protocol.get_points(address(account))
    assert int(points["total_award_budgets"]) == budgets
    assert int(points["total_awarded"]) == issued
    assert int(points["total_reserved_points"]) == reserved
    assert issued + reserved == budgets
    assert int(points["total_initial_points"]) + int(points["total_impact_points"]) == issued


@pytest.mark.parametrize("split_wallet,split_github", [(False, False), (True, False), (True, True)])
def test_identical_work_has_identical_coalition_total_for_every_identity_arrangement(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie, split_wallet, split_github):
    # Fixed graph, artifacts and merit/reuse verdicts. This proves the accounting
    # invariant, not that semantic splitting/novelty judgment is solved.
    upstream = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "component", github_author_id=1)
    empty = open_protocol.review_impact("component", 0)
    assert empty["status"] == "settled" and empty["budget"] == 80 and empty["returned_points"] == "80"
    assert empty["source_digest"] == open_protocol.get("component")["digest"]
    contributor = direct_charlie if split_wallet else direct_owner
    downstream = credited(open_protocol, direct_vm, direct_alice, direct_bob, contributor, "result", github_author_id=2 if split_github else 1, dependencies=["component"], verified_dependencies=[use(upstream)])
    assert_fixed_budget_totals(open_protocol, direct_owner, budgets=800, issued=720, reserved=80)
    state = settle_impact(open_protocol, direct_vm, direct_bob, "result", [("component", 3)])
    assert state["paid_points"] == "78" and state["returned_points"] == "2"
    assert state["allocations"][0]["points"] == "78"
    assert len(state["eligible"]) == 1  # Self reuse and both split cases are equal.
    record = open_protocol.get("result")
    assert record["award_budget"] == "400" and record["initial_paid"] == "320"
    assert record["credited_points"] == "322" and record["reserve_returned"] == "2" and record["reserve_settled"] is True
    assert record["verdict"]["award"] == "400"
    assert_fixed_budget_totals(open_protocol, direct_owner, budgets=800, issued=800, reserved=0)
    coalition = int(open_protocol.get_points(address(direct_owner))["points"])
    if split_wallet:
        coalition += int(open_protocol.get_points(address(direct_charlie))["points"])
    assert coalition == 800
    before = open_protocol.get_points(address(direct_owner))
    open_protocol.settle_impact("result", 0)
    open_protocol.settle_impact("component", 0)
    open_protocol.confirm_merge("result", downstream["head"], digest("merge:result")[:40])
    assert open_protocol.get_points(address(direct_owner)) == before
    with direct_vm.expect_revert("already exists"):
        open_protocol.review_impact("result", 0)


@pytest.mark.parametrize("scores,budget,upfront,reserve,band,refund", [
    ((1, 1, 1), 300, 240, 60, 20, 0), ((1, 1, 2), 400, 320, 80, 26, 2),
    ((1, 1, 3), 500, 400, 100, 33, 1), ((1, 2, 3), 600, 480, 120, 40, 0),
    ((1, 3, 3), 700, 560, 140, 46, 2), ((2, 3, 3), 800, 640, 160, 53, 1),
    ((3, 3, 3), 900, 720, 180, 60, 0),
])
def test_every_merit_budget_pays_only_its_reserve_and_returns_rounding_once(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie, scores, budget, upfront, reserve, band, refund):
    prior = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "prior")
    open_protocol.review_impact("prior", 0)
    data = submit(open_protocol, direct_vm, direct_alice, direct_charlie, "result", dependencies=["prior"], verified_dependencies=[use(prior)])
    direct_vm.sender = direct_bob
    initial_review(direct_vm, "result", scores=scores)
    assert open_protocol.adjudicate("result", 0)["award"] == str(budget)
    direct_vm.warp(datetime.fromtimestamp(open_protocol.get("result")["deadline"] + 1, timezone.utc).isoformat())
    open_protocol.finalize("result", 0)
    open_protocol.confirm_merge("result", data["head"], "5" * 40)
    assert open_protocol.get("result")["credited_points"] == str(upfront)
    assert_fixed_budget_totals(open_protocol, direct_owner, budgets=400+budget, issued=400+upfront, reserved=reserve)
    outcome = settle_impact(open_protocol, direct_vm, direct_bob, "result", [("prior", 3)])
    assert outcome["band_points"] == band and outcome["paid_points"] == str(3*band)
    assert outcome["returned_points"] == str(refund)
    assert open_protocol.get("result")["credited_points"] == str(upfront+refund)
    assert_fixed_budget_totals(open_protocol, direct_owner, budgets=400+budget, issued=400+budget, reserved=0)


def test_zero_allocation_refunds_full_reserve_and_notes_never_create_one(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    first = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "first")
    open_protocol.review_impact("first", 0)
    credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_charlie, "second", dependencies=["first"], verified_dependencies=[use(first)])
    result = settle_impact(open_protocol, direct_vm, direct_bob, "second", [])
    assert result["paid_points"] == "0" and result["returned_points"] == "80"
    assert open_protocol.get("second")["credited_points"] == "400"
    credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "note", note=True)
    note = open_protocol.get("note")
    assert note["award_budget"] == note["initial_paid"] == note["credited_points"] == "300"
    assert note["impact_reserve"] == note["reserve_returned"] == "0" and note["reserve_settled"] is True
    outcome = open_protocol.review_impact("note", 0)
    assert outcome["status"] == "settled" and outcome["budget"] == outcome["band_points"] == 0
    assert outcome["paid_points"] == outcome["returned_points"] == "0"
    open_protocol.settle_impact("note", 0)
    assert_fixed_budget_totals(open_protocol, direct_owner, budgets=1100, issued=1100, reserved=0)
