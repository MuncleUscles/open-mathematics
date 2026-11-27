"""Native v5 state-machine tests; verifier and LLM evidence are mocked, not E2E."""
from datetime import datetime, timezone
from hashlib import sha256
import json
import copy
import os
import sys
from pathlib import Path

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


def mock_audit(vm, refs, **changes):
    vm.clear_mocks()
    audit = {"supported": True, "reason": "The cited contribution supports the proposed decision and its credit under the stated research rubric.",
             "evidence_refs": refs, **changes}
    vm.mock_llm(r"(?s).*Independently audit the leader's proposed decision.*", json.dumps(audit))


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


def adjudicate(protocol, key, expected_round):
    protocol.begin_adjudication(key, expected_round)
    return protocol.adjudicate(key, expected_round)


def settle_initial(protocol, vm, executor, key, *, accept=True):
    vm.sender = executor
    initial_review(vm, key, accept=accept, upheld=True if protocol.get(key)["status"] == "challenged" else None)
    adjudicate(protocol, key, protocol.get(key)["round"])
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
    assert problem["post_settlement_corrections"] is True
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
    verdict = adjudicate(open_protocol, data["id"], 0)
    assert verdict["award"] == "400"
    mock_audit(direct_vm, [data["id"]])
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
    for method in [lambda: adjudicate(open_protocol, data["id"], 0), lambda: open_protocol.finalize(data["id"], 0), lambda: open_protocol.confirm_merge(data["id"], data["head"], "5" * 40), lambda: open_protocol.review_impact(data["id"], 0), lambda: open_protocol.settle_impact(data["id"], 0)]:
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
    assert open_protocol.get_provenance(data["id"])["post_settlement_corrections"] is True


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
    mock_audit(direct_vm, [later["id"]])
    assert direct_vm.run_validator() is False
    mock_audit(direct_vm, [later["id"], prior["id"]], supported=False)
    assert direct_vm.run_validator() is False
    mock_audit(direct_vm, [later["id"], prior["id"]])
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
    adjudicate(open_protocol, "later", 0)
    direct_vm.sender = direct_owner
    open_protocol.challenge("later", "Check whether the contribution adds more than a trivial restatement.")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("stale adjudication"):
        adjudicate(open_protocol, "later", 0)
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


@pytest.mark.parametrize("accept,note,award", [(True, False, "400"), (True, True, "300"), (False, False, "0")])
def test_merit_validator_audits_exact_proposal_and_award(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, monkeypatch, accept, note, award):
    data = submit(open_protocol, direct_vm, direct_alice, direct_owner, note=note)
    direct_vm.sender = direct_bob
    initial_review(direct_vm, "open-result", accept=accept)
    decision = adjudicate(open_protocol, "open-result", 0)
    prompts = []

    def auditor(prompt):
        instructions, payload = prompt.split("\nUNTRUSTED_DATA=", 1)
        assert "Independently audit the leader's proposed decision" in instructions
        packet = json.loads(payload)
        assert packet["proposed_verdict"] == decision
        assert packet["proposed_verdict"]["award"] == award
        assert packet["evidence"]["submission"]["artifact_hash"] == data["artifact_hash"]
        assert packet["required_audit_refs"] == ["open-result"]
        prompts.append(prompt)
        return json.dumps({"supported": True, "reason": "The evidence independently supports this decision, including the proposed credit.", "evidence_refs": ["open-result"]})

    with monkeypatch.context() as m:
        m.setattr(direct_vm, "_match_llm_mock", auditor)
        assert direct_vm.run_validator() is True
    assert len(prompts) == 1
    for change in [{"supported": False}, {"supported": "yes"}, {"reason": "yes"}, {"novelty": 2}, {"evidence_refs": ["invented"]}]:
        mock_audit(direct_vm, ["open-result"], **change)
        assert direct_vm.run_validator() is False
    with direct_vm.expect_revert("evidence references"):
        direct_vm.run_validator(leader_result={k: v for k, v in {**decision, "evidence_refs": ["invented"]}.items() if k != "award"})
    assert direct_vm.run_validator(leader_error=Exception("leader failed")) is False


def test_concurrent_duplicates_and_stale_reservations(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    first = submit(open_protocol, direct_vm, direct_alice, direct_owner, "first")
    with direct_vm.expect_revert("same content already has an active"):
        submit(open_protocol, direct_vm, direct_alice, direct_charlie, "second", github_author_id=2, statement_hash=first["statement_hash"])
    direct_vm.sender = direct_bob
    initial_review(direct_vm, "first")
    adjudicate(open_protocol, "first", 0)
    direct_vm.warp(datetime.fromtimestamp(open_protocol.get("first")["deadline"] + 1, timezone.utc).isoformat())
    open_protocol.finalize("first", 0)
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
    adjudicate(open_protocol, "current", 0)
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
    previous = adjudicate(protocol, data["id"], 0)
    vm.sender = owner
    protocol.challenge(data["id"], "The review missed the explicitly stated boundary condition in the supplied artifact.")
    vm.sender = executor
    return data, previous


def test_unupheld_challenge_restores_verdict_verbatim_and_bool_requires_consensus(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    data, previous = challenged_initial(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner)
    initial_review(direct_vm, data["id"], upheld=False, reason="The objection establishes no factual error and supplies no new supporting evidence.")
    assert adjudicate(open_protocol, data["id"], 1) == previous
    mock_audit(direct_vm, [data["id"], "challenge:0"])
    assert direct_vm.run_validator() is True
    record = open_protocol.get(data["id"])
    assert record["verdict"] == previous and record["challenge_reviews"][0]["challenge_upheld"] is False
    mock_audit(direct_vm, [data["id"]])
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
        adjudicate(open_protocol, data["id"], 1)
    assert open_protocol.get(data["id"])["verdict"] == previous
    initial_review(direct_vm, data["id"], upheld=True, scores=(1, 1, 1))
    assert adjudicate(open_protocol, data["id"], 1)["award"] == "300"


def test_rejected_appeal_requires_upheld_evidence_and_a_defensible_proposal(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    data, previous = challenged_initial(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, accepted=False)
    initial_review(direct_vm, data["id"], upheld=True, reason="Please increase this award because it deserves points.")
    with direct_vm.expect_revert("substantive factual correction"):
        adjudicate(open_protocol, data["id"], 1)
    initial_review(direct_vm, data["id"], upheld=True, reason="The original rejection overlooked the explicitly restricted domain of the construction; the cited boundary example now resolves that specific factual error without changing the proved statement.")
    assert adjudicate(open_protocol, data["id"], 1)["accept"] is True
    mock_audit(direct_vm, [data["id"], "challenge:0"])
    assert direct_vm.run_validator() is True
    mock_audit(direct_vm, [data["id"], "challenge:0"], supported=False)
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
    mock_audit(direct_vm, ["first", "later", "challenge:0"])
    assert direct_vm.run_validator() is True
    mock_audit(direct_vm, ["first", "later"])
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


def test_one_active_github_claim_remains_but_fourth_same_day_registration_is_allowed(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    first = submit(open_protocol, direct_vm, direct_alice, direct_owner, "first")
    with direct_vm.expect_revert("one active contribution"):
        submit(open_protocol, direct_vm, direct_alice, direct_charlie, "same-controller")
    direct_vm.sender = direct_bob
    initial_review(direct_vm, "first")
    adjudicate(open_protocol, "first", 0)
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
    submit(open_protocol, direct_vm, direct_alice, direct_owner, "fourth")
    assert open_protocol.count_contributions() == 4
    assert open_protocol.get_problem()["admission_limits"]["registrations_per_rolling_24h"] is None


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
    assert adjudicate(open_protocol, "note", 0)["award"] == "300"
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
    assert adjudicate(open_protocol, "result", 0)["award"] == str(budget)
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


def same_content(original, *, proof_edit=False, **changes):
    proof = original['proof'] + ('\n' if proof_edit else '')
    return {field: original[field] for field in ['statement_hash', 'proposition_hash', 'formal_statement']} | {
        'proof': proof, 'bundle_hash': digest(proof), 'artifact_hash': digest('closure:' + proof), **changes,
    }


def expire(protocol, vm, executor, key):
    vm.sender = executor
    protocol.release_unmerged(key, 'The exact canonical PR moved or closed before protected merge confirmation.')


def test_begin_adjudication_is_separate_persistent_and_exactly_scoped(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    data = submit(open_protocol, direct_vm, direct_alice, direct_owner)
    direct_vm.sender = direct_bob
    initial_review(direct_vm, data['id'])
    with direct_vm.expect_revert('persisted begin_adjudication'):
        open_protocol.adjudicate(data['id'], 0)
    assert open_protocol.get(data['id'])['adjudication_started_round'] == -1
    fence = open_protocol.begin_adjudication(data['id'], 0)
    assert fence == {'id': data['id'], 'round': 0, 'content_fenced': True}
    assert open_protocol.begin_adjudication(data['id'], 0) == fence
    assert open_protocol.get(data['id'])['adjudication_started_round'] == 0
    assert open_protocol.get(data['id'])['adjudication_finished_round'] == -1
    with direct_vm.expect_revert('stale adjudication'):
        open_protocol.begin_adjudication(data['id'], 1)
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert('executor'):
        open_protocol.begin_adjudication(data['id'], 0)
    direct_vm.sender = direct_bob
    open_protocol.adjudicate(data['id'], 0)
    assert open_protocol.get(data['id'])['adjudication_finished_round'] == 0
    assert open_protocol.begin_adjudication(data['id'], 0) == fence
    assert open_protocol.get(data['id'])['status'] == 'provisional'


@pytest.mark.parametrize('failed_call', [False, True])
@pytest.mark.parametrize('proof_edit', [False, True])
def test_unknown_or_failed_draw_stays_fenced_after_expiry_and_identity_change(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie, failed_call, proof_edit):
    first = submit(open_protocol, direct_vm, direct_alice, direct_owner, 'attempt')
    direct_vm.sender = direct_bob
    open_protocol.begin_adjudication('attempt', 0)
    if failed_call:
        direct_vm.mock_llm('.*', '{}')
        with direct_vm.expect_revert('malformed adjudication'):
            open_protocol.adjudicate('attempt', 0)
    expire(open_protocol, direct_vm, direct_bob, 'attempt')
    record = open_protocol.get('attempt')
    assert record['status'] == 'expired' and record['adjudication_finished_round'] == -1
    with direct_vm.expect_revert('unresolved adjudication'):
        submit(open_protocol, direct_vm, direct_alice, direct_charlie, 'new-account', github_author_id=2, **same_content(first, proof_edit=proof_edit))
    assert open_protocol.count_contributions() == 1


@pytest.mark.parametrize('proof_edit', [False, True])
def test_cancelled_accepted_verdict_is_a_global_ceiling_on_rebased_content(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie, proof_edit):
    first = submit(open_protocol, direct_vm, direct_alice, direct_owner, 'original')
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'original', scores=(1, 2, 3))
    assert adjudicate(open_protocol, 'original', 0)['award'] == '600'
    expire(open_protocol, direct_vm, direct_bob, 'original')
    submit(open_protocol, direct_vm, direct_alice, direct_charlie, 'rebased', github_author_id=2, **same_content(first, proof_edit=proof_edit))
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'rebased', scores=(3, 3, 3))
    verdict = adjudicate(open_protocol, 'rebased', 0)
    assert tuple(verdict[x] for x in ['novelty', 'significance', 'reusability']) == (1, 2, 3)
    assert verdict['award'] == '600'
    expire(open_protocol, direct_vm, direct_bob, 'rebased')
    submit(open_protocol, direct_vm, direct_alice, direct_owner, 'lowered', github_author_id=3, **same_content(first))
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'lowered', scores=(1, 1, 1))
    assert adjudicate(open_protocol, 'lowered', 0)['award'] == '300'
    expire(open_protocol, direct_vm, direct_bob, 'lowered')
    submit(open_protocol, direct_vm, direct_alice, direct_charlie, 'last', github_author_id=4, **same_content(first, proof_edit=True))
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'last', scores=(3, 3, 3))
    assert adjudicate(open_protocol, 'last', 0)['award'] == '300'


@pytest.mark.parametrize('finalized', [False, True])
def test_known_rejection_cannot_be_retried_by_proof_byte_or_account_change(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie, finalized):
    first = submit(open_protocol, direct_vm, direct_alice, direct_owner, 'rejected-content')
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'rejected-content', accept=False)
    adjudicate(open_protocol, 'rejected-content', 0)
    if finalized:
        direct_vm.warp(datetime.fromtimestamp(open_protocol.get('rejected-content')['deadline'] + 1, timezone.utc).isoformat())
        open_protocol.finalize('rejected-content', 0)
    else:
        expire(open_protocol, direct_vm, direct_bob, 'rejected-content')
    with direct_vm.expect_revert('previously rejected content'):
        submit(open_protocol, direct_vm, direct_alice, direct_charlie, 'one-byte-retry', github_author_id=2, **same_content(first, proof_edit=True))


def test_exact_content_can_rebase_before_adjudication_begins(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    first = submit(open_protocol, direct_vm, direct_alice, direct_owner, 'not-attempted')
    assert open_protocol.get('not-attempted')['adjudication_started_round'] == -1
    expire(open_protocol, direct_vm, direct_bob, 'not-attempted')
    submit(open_protocol, direct_vm, direct_alice, direct_charlie, 'fresh-base', github_author_id=2, **same_content(first))
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'fresh-base', scores=(2, 2, 2))
    assert adjudicate(open_protocol, 'fresh-base', 0)['award'] == '600'


@pytest.mark.parametrize('has_prior_ceiling', [False, True])
def test_upheld_same_claim_rejection_appeal_can_rebase_without_erasing_prior_ceiling(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie, has_prior_ceiling):
    original = None
    if has_prior_ceiling:
        original = submit(open_protocol, direct_vm, direct_alice, direct_owner, 'earlier')
        direct_vm.sender = direct_bob
        initial_review(direct_vm, 'earlier', scores=(1, 1, 1))
        adjudicate(open_protocol, 'earlier', 0)
        expire(open_protocol, direct_vm, direct_bob, 'earlier')
    current = submit(open_protocol, direct_vm, direct_alice, direct_charlie, 'appealed', github_author_id=2, **(same_content(original) if original else {}))
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'appealed', accept=False)
    adjudicate(open_protocol, 'appealed', 0)
    direct_vm.sender = direct_charlie
    open_protocol.challenge('appealed', 'The reviewer overlooked the explicitly restricted domain and the supplied boundary evidence.')
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'appealed', upheld=True, scores=(3, 3, 3), reason='The initial rejection overlooked the explicitly restricted domain. The cited boundary construction resolves that specific factual error without changing the submitted theorem.')
    expected = '300' if has_prior_ceiling else '900'
    assert adjudicate(open_protocol, 'appealed', 1)['award'] == expected
    expire(open_protocol, direct_vm, direct_bob, 'appealed')
    submit(open_protocol, direct_vm, direct_alice, direct_owner, 'after-correction', github_author_id=3, **same_content(current, proof_edit=True))
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'after-correction', scores=(3, 3, 3))
    assert adjudicate(open_protocol, 'after-correction', 0)['award'] == expected


def test_rejection_correction_cannot_erase_earlier_accepted_bands_of_same_claim(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    submit(open_protocol, direct_vm, direct_alice, direct_owner, 'oscillation')
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'oscillation', scores=(1, 1, 1))
    adjudicate(open_protocol, 'oscillation', 0)
    direct_vm.sender = direct_owner
    open_protocol.challenge('oscillation', 'A bounded factual objection requests reconsideration of the stated domain.')
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'oscillation', accept=False, upheld=True, scores=(1, 1, 1))
    adjudicate(open_protocol, 'oscillation', 1)
    direct_vm.sender = direct_owner
    open_protocol.challenge('oscillation', 'The second objection corrects the concrete factual misunderstanding in the rejection.')
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'oscillation', scores=(3, 3, 3), upheld=True, refs=['oscillation', 'challenge:1'], reason='The preceding rejection made a concrete factual mistake about the restricted domain. The original evidence resolves that mistake and supports restoring acceptance, without adding new work.')
    assert adjudicate(open_protocol, 'oscillation', 2)['award'] == '300'


def test_identical_statement_text_with_different_definitions_is_not_exact_duplicate(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    statement = 'Value = Value'
    def content(value):
        bundle = {'version': 1, 'definitions': [{'name': 'Value', 'type': 'Nat', 'value': str(value)}], 'statement': statement, 'proof': 'by\n  rfl', 'dependencies': []}
        proof = json.dumps(bundle, indent=2) + '\n'
        return {'formal_statement': statement, 'proof': proof, 'bundle_hash': digest(proof), 'artifact_hash': digest('closure:' + proof), 'proposition_hash': digest(statement), 'statement_hash': digest(json.dumps({k: bundle[k] for k in ['definitions', 'statement', 'dependencies']}, sort_keys=True))}
    credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, 'value-zero', **content(0))
    second = submit(open_protocol, direct_vm, direct_alice, direct_charlie, 'value-one', github_author_id=2, **content(1))
    assert open_protocol.get(second['id'])['status'] == 'submitted'
    assert open_protocol.get('value-zero')['evidence']['proposition_hash'] == second['proposition_hash']
    assert open_protocol.get('value-zero')['evidence']['statement_hash'] != second['statement_hash']


def test_model_challenge_payloads_omit_wallet_but_public_evidence_keeps_it(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie, monkeypatch):
    prior = credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, 'prior')
    submit(open_protocol, direct_vm, direct_alice, direct_charlie, 'later', github_author_id=2, dependencies=['prior'], verified_dependencies=[use(prior)])
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'later')
    adjudicate(open_protocol, 'later', 0)
    direct_vm.sender = direct_owner
    open_protocol.challenge('later', 'The semantic contribution should be compared carefully with the already credited source.')
    captured = []
    original = direct_vm._match_llm_mock
    def capture(prompt):
        captured.append(json.loads(prompt.split('\nUNTRUSTED_DATA=', 1)[1]))
        return original(prompt)
    monkeypatch.setattr(direct_vm, '_match_llm_mock', capture)
    direct_vm.sender = direct_bob
    initial_review(direct_vm, 'later', upheld=False)
    adjudicate(open_protocol, 'later', 1)
    assert all(set(item) == {'evidence'} for item in captured[-1]['challenges'])
    assert 'wallet' in open_protocol.get('later')['challenges'][0]
    direct_vm.warp(datetime.fromtimestamp(open_protocol.get('later')['deadline'] + 1, timezone.utc).isoformat())
    open_protocol.finalize('later', 1)
    open_protocol.confirm_merge('later', open_protocol.get('later')['evidence']['head'], '5' * 40)
    impact_review(direct_vm, 'later', [('prior', 1)])
    open_protocol.review_impact('later', 0)
    direct_vm.sender = direct_owner
    open_protocol.challenge_impact('later', 'The prior proof is replaceable infrastructure; the review should check the concrete use.')
    direct_vm.sender = direct_bob
    impact_review(direct_vm, 'later', [('prior', 1)], upheld=False)
    open_protocol.review_impact('later', 1)
    assert all(set(item) == {'evidence'} for item in captured[-1]['challenges'])
    assert 'wallet' in open_protocol.get_impact('later')['challenges'][0]
    assert all(set(item) == {'evidence'} for item in captured[-1]['downstream']['challenges'])


# Cross-contract reads are mocked at the actual SDK CallContract boundary.
# These fixtures test deterministic migration, not network finality/consensus.
def migration_hash(value):
    def normalize(item):
        if type(item) is int:
            return str(item)
        if isinstance(item, list):
            return [normalize(value) for value in item]
        if isinstance(item, dict):
            return {key: normalize(value) for key, value in item.items()}
        return item
    return digest(json.dumps(normalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False))


@pytest.fixture
def pilot_snapshot(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, direct_charlie):
    credited(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner, "credited")
    settle_impact(open_protocol, direct_vm, direct_bob, "credited", [])
    submit(open_protocol, direct_vm, direct_alice, direct_charlie, "rejected")
    settle_initial(open_protocol, direct_vm, direct_bob, "rejected", accept=False)
    submit(open_protocol, direct_vm, direct_alice, direct_charlie, "pending")
    direct_vm.sender = direct_bob
    open_protocol.begin_adjudication("pending", 0)
    ids = open_protocol.list_contributions(0, 16)["items"]
    records = [open_protocol.get(key) for key in ids]
    snapshot = {"config": open_protocol.get_config(), "records": records,
                "impacts": [open_protocol.get_impact(key) for key in ids],
                "balances": [{"wallet": recipient, "value": open_protocol.get_points(recipient)}
                             for recipient in sorted(set(r["evidence"]["wallet"].lower() for r in records))]}
    # Direct mode has one storage namespace. Project these native records to a
    # distinct predecessor address before replacing that namespace for the child.
    for record, impact in zip(snapshot["records"], snapshot["impacts"]):
        record["evidence"]["contract"] = "0x" + "7" * 40
        record["digest"] = digest(json.dumps(record["evidence"]))
        if "source_digest" in impact:
            impact["source_digest"] = record["digest"]
    return snapshot


def deploy_successor(vm, deploy, snapshot, *, commitment=None, constructor=None, count=None, page=None):
    from gltest.direct.vm import InmemManager
    vm._storage = InmemManager()
    # Direct mode supports one loaded contract class; preserve the captured
    # predecessor responses, then allocate a fresh child class/storage context.
    if contracts := sys.modules.get("genlayer.gl.genvm_contracts"):
        contracts.__known_contract__ = None
    source_address = snapshot["records"][0]["evidence"]["contract"]
    calls = []
    def hook(_vm, request):
        from genlayer.py import calldata
        call = request["CallContract"]
        assert str(call["address"]).lower() == source_address.lower()
        assert call["state"] == 1, "migration must read finalized predecessor state"
        method, args = call["calldata"]["method"], call["calldata"].get("args", [])
        calls.append((method, args))
        records = {r["evidence"]["id"]: r for r in snapshot["records"]}
        values = {
            "get_config": lambda: snapshot["config"],
            "count_contributions": lambda: len(records) if count is None else count,
            "list_contributions": lambda: page if page is not None else {"items": list(records), "total": len(records), "next_offset": None},
            "get": lambda: records[args[0]],
            "get_impact": lambda: next(i for i in snapshot["impacts"] if i["downstream"] == args[0]),
            "get_points": lambda: next(b["value"] for b in snapshot["balances"] if b["wallet"] == args[0]),
        }
        if method == "list_contributions":
            assert args == [0, 16]
        return b"\x00" + calldata.encode(copy.deepcopy(values[method]()))
    vm._gl_call_hook = hook
    setup = copy.deepcopy(snapshot["config"] if constructor is None else constructor)
    setup["predecessor"] = {"address": source_address, "snapshot_hash": commitment or migration_hash(snapshot)}
    return deploy(SOURCE, json.dumps(setup), sdk_version="v0.2.16"), calls


def test_four_serial_resolved_same_day_claims_have_no_daily_quota(open_protocol, direct_vm, direct_alice, direct_bob, direct_owner):
    start = datetime.now(timezone.utc).timestamp()
    for index in range(4):
        key = f"serial-{index}"
        submit(open_protocol, direct_vm, direct_alice, direct_owner, key)
        settle_initial(open_protocol, direct_vm, direct_bob, key, accept=False)
    assert datetime.now(timezone.utc).timestamp() - start < 86400
    assert open_protocol.count_contributions() == 4
    assert open_protocol.get_points(address(direct_owner))["total_awarded"] == "0"


def test_successor_preserves_400_history_and_pending_fence_then_rewards_inherited_dependency(pilot_snapshot, direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    snapshot = pilot_snapshot
    child, calls = deploy_successor(direct_vm, direct_deploy, snapshot)
    vector = {"z": True, "a": [4, -1, False, None, {"α": "∀ n, n = n", "count": 400}], "numeric_string": "400"}
    assert sys.modules[child.__class__.__module__].migration_digest(vector) == "63713c1301338e9ea85cef15250dcd4faa20c306e3330d1d82f8d8ac5f92674b"
    assert [method for method, _ in calls[:3]] == ["get_config", "count_contributions", "list_contributions"]
    assert [args[0] for method, args in calls if method == "get_points"] == sorted(b["wallet"] for b in snapshot["balances"])
    assert child.list_contributions(0, 16)["items"] == ["credited", "rejected", "pending"]
    for record in snapshot["records"]:
        key = record["evidence"]["id"]
        assert child.get(key) == record
        info = child.get_inheritance(key)
        assert info == {"inherited": True, "predecessor": "0x" + "7" * 40,
                        "snapshot_hash": migration_hash(snapshot), "record_hash": migration_hash(record),
                        "original_record_hash": migration_hash(record)}
    for balance in snapshot["balances"]:
        assert child.get_points(balance["wallet"]) == balance["value"]
    with direct_vm.expect_revert("signed claim already registered"):
        submit(child, direct_vm, direct_alice, direct_owner, "replayed-claim", claim_digest=snapshot["records"][0]["evidence"]["claim_digest"])
    direct_vm.sender = direct_bob
    for key in ["credited", "rejected", "pending"]:
        with direct_vm.expect_revert("inherited adjudication"):
            child.begin_adjudication(key, 0)
        with direct_vm.expect_revert("inherited adjudication"):
            child.adjudicate(key, 0)
    with direct_vm.expect_revert("one active contribution"):
        submit(child, direct_vm, direct_alice, direct_owner, "fourth")
    before = child.get_inheritance("pending")
    expire(child, direct_vm, direct_bob, "pending")
    after = child.get_inheritance("pending")
    assert before["original_record_hash"] == after["original_record_hash"]
    assert before["record_hash"] != after["record_hash"] == migration_hash(child.get("pending"))
    with direct_vm.expect_revert("unresolved adjudication"):
        submit(child, direct_vm, direct_alice, direct_owner, "retry-pending", github_author_id=2,
               **same_content(snapshot["records"][2]["evidence"], proof_edit=True))
    with direct_vm.expect_revert("previously rejected"):
        submit(child, direct_vm, direct_alice, direct_owner, "retry-rejection", github_author_id=2,
               **same_content(snapshot["records"][1]["evidence"], proof_edit=True))
    prior = snapshot["records"][0]
    direct_vm.sender = direct_bob
    child.confirm_merge("credited", prior["evidence"]["head"], prior["merge_commit"])
    assert child.get_points(address(direct_owner))["total_awarded"] == "400"
    later = credited(child, direct_vm, direct_alice, direct_bob, direct_charlie, "later", dependencies=["credited"],
                     verified_dependencies=[use(prior["evidence"])])
    assert child.get_inheritance(later["id"]) == {"inherited": False}
    settle_impact(child, direct_vm, direct_bob, "later", [("credited", 1)])
    assert child.get_points(address(direct_owner))["points"] == "426"
    assert child.get_points(address(direct_charlie))["points"] == "374"
    assert child.get_points(address(direct_owner))["total_awarded"] == "800"
    assert child.get_points(address(direct_owner))["total_reserved_points"] == "0"
    assert child.get("credited") == prior


@pytest.mark.parametrize("mutation,error", [
    (lambda s: s["records"][0].update(credited_points="401"), "settled reserve"),
    (lambda s: s["balances"][0]["value"].update(points="999"), "accounting"),
    (lambda s: s["impacts"][0].update(paid_points="1"), "without upstream awards"),
    (lambda s: s["records"][2].update(adjudication_started_round=-1), "unsupported predecessor"),
    (lambda s: s["records"][2].update(adjudication_finished_round=0), "adjudication fence"),
    (lambda s: s["records"][2].update(verdict={"accept": True}), "no completed judgment"),
    (lambda s: s["records"][1].update(status="provisional"), "unsupported predecessor"),
    (lambda s: s["records"][1].update(round=1), "unsupported predecessor"),
    (lambda s: s["records"][2].update(challenges=[{"evidence": "earlier challenge"}]), "unsupported predecessor"),
    (lambda s: s["records"][0]["evidence"].update(proof="changed bytes"), "content commitments"),
])
def test_successor_rejects_unsupported_or_inconsistent_committed_histories(pilot_snapshot, direct_vm, direct_deploy, mutation, error):
    mutation(pilot_snapshot)
    with direct_vm.expect_revert(error):
        deploy_successor(direct_vm, direct_deploy, pilot_snapshot)


def test_successor_rejects_snapshot_drift_and_wrong_configuration(pilot_snapshot, direct_vm, direct_deploy):
    with direct_vm.expect_revert("snapshot commitment"):
        deploy_successor(direct_vm, direct_deploy, pilot_snapshot, commitment="0" * 64)
    changed = copy.deepcopy(pilot_snapshot["config"])
    changed["objective"] += " An altered objective must not inherit automatically."
    with direct_vm.expect_revert("identical configuration"):
        deploy_successor(direct_vm, direct_deploy, pilot_snapshot, constructor=changed)
    original = copy.deepcopy(pilot_snapshot["config"])
    pilot_snapshot["config"]["predecessor"] = {"address": "0x" + "6" * 40, "snapshot_hash": "1" * 64}
    with direct_vm.expect_revert("one hop"):
        deploy_successor(direct_vm, direct_deploy, pilot_snapshot, constructor=original)


def test_successor_rejects_unbounded_or_incomplete_registry(pilot_snapshot, direct_vm, direct_deploy):
    for count in [0, 17, True]:
        with direct_vm.expect_revert("one to sixteen"):
            deploy_successor(direct_vm, direct_deploy, pilot_snapshot, count=count)
    with direct_vm.expect_revert("complete bounded predecessor"):
        deploy_successor(direct_vm, direct_deploy, pilot_snapshot, page={"items": ["credited"], "total": 3, "next_offset": 1})
    duplicate = copy.deepcopy(pilot_snapshot["records"][0])
    duplicate["evidence"]["id"] = "second-credit"
    pilot_snapshot["records"].append(duplicate)
    pilot_snapshot["impacts"].append({**pilot_snapshot["impacts"][0], "downstream": "second-credit"})
    with direct_vm.expect_revert("at most one credited"):
        deploy_successor(direct_vm, direct_deploy, pilot_snapshot)


@pytest.mark.skipif(not os.environ.get("OPEN_MATH_PREDECESSOR_SNAPSHOT"), reason="Optional exact live predecessor fixture is supplied by the release audit")
def test_exact_captured_live_predecessor_is_supported(direct_vm, direct_deploy):
    snapshot = json.loads(Path(os.environ["OPEN_MATH_PREDECESSOR_SNAPSHOT"]).read_text())
    assert migration_hash(snapshot) == "3d91b53dbf4bf783c9abce91a1ece3fc8ec6f28315bcfbb765af615ebb5d8a88"
    child, _ = deploy_successor(direct_vm, direct_deploy, snapshot)
    for record in snapshot["records"]:
        assert child.get(record["evidence"]["id"]) == record
    for balance in snapshot["balances"]:
        assert child.get_points(balance["wallet"]) == balance["value"]
    assert child.get_points(snapshot["balances"][0]["wallet"])["total_awarded"] == "400"


def test_complete_mathlib_semantics_fit_without_truncation(open_protocol, direct_vm, direct_alice, direct_owner):
    # Kernel validity is the trusted verifier's boundary; this checks storage
    # bounds and exact preservation of its full semantic statement.
    direct_vm.sender = direct_alice
    text = "theorem : " + "T" * 32758
    data = evidence(direct_vm, direct_owner, formal_statement=text)
    assert len(text.encode()) == 32768
    for oversized in [text + "T", "é" * 16385]:
        with direct_vm.expect_revert("submitted statement"):
            open_protocol.register(json.dumps({**data, "formal_statement": oversized}, ensure_ascii=False))
    open_protocol.register(json.dumps(data))
    assert open_protocol.get(data["id"])["evidence"]["formal_statement"] == text
