from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

import pytest

from test_contract import evidence
from test_impact import review as impact_review
from test_provenance import (
    attest,
    correction,
    request,
    review_provenance,
    settle,
    source,
)


SOURCE = "contracts/research_v4.py"
PROBLEM_COMMIT = "1" * 40
PROTOCOL_COMMIT = "2" * 40
WORKER_COMMIT = "9" * 40
OLD_POLICY = json.loads(Path("lean/policy.json").read_text())
GOLDEN = json.loads(Path("tests/fixtures/problem-commitments.json").read_text())
LEGACY_PROPOSITIONS = {
    key: value["statement"].rsplit("def " + value["theorem"].split(" : ")[1] + " : Prop :=", 1)[1].strip()
    for key, value in OLD_POLICY["goals"].items()
}
LEGACY = {
    "chain_id": 61999,
    "address": "0x6acF1e29790B2eE45c01184fFaa8F84f06ba9AAc",
    "reserved_statement_hashes": [
        "a1c9f09b2f83e97ca50c0f7c0849e3743fb27127c8d07cc11694582c8ca85893",
        "ca48fc7bcbb37f52d5e12d5048243cd3ce8dd423c8e80447041d85acab17b67c",
    ],
    "reserved_proposition_hashes": [sha256(text.encode()).hexdigest() for text in LEGACY_PROPOSITIONS.values()],
}
FILES = {"Foundation.lean": "4" * 64, "Goal.lean": "5" * 64}


def hash_text(text):
    return sha256(text.encode("utf-8")).hexdigest()


def wallet(address):
    return "0x" + (address if isinstance(address, bytes) else address.as_bytes).hex()


def config(curator, verifier, executor, /, **changes):
    return {
        "version": 4,
        "problem": "sample-problem",
        "repository": "fixture/sample-problem",
        "branch": "research",
        "curator": wallet(curator),
        "verifier": wallet(verifier),
        "executor": wallet(executor),
        "window": 10,
        "directions": ["theory", "shared"],
        "legacy_ledger": LEGACY,
        **changes,
    }


@pytest.fixture
def registry(direct_deploy, direct_alice, direct_bob, direct_charlie):
    settings = config(direct_alice, direct_bob, direct_charlie)
    return direct_deploy(SOURCE, json.dumps(settings), sdk_version="v0.2.16")


def goal(key, variant="a" * 64, *, files=FILES, **changes):
    offset = int(variant[0], 16)
    fields = {
        "path": f"research/proofs/{key}.proof",
        "theorem": "candidate : Component",
        "statement": f"def Component : Prop := ∀ n : Nat, (n = {offset} → n = {offset}) ↔ True",
        "definition_files": ["Foundation.lean", "Goal.lean"],
        "dependency": None,
        "rewardable": True,
        **changes,
    }
    proposition = fields["statement"].split(" : Prop :=", 1)[-1].strip()
    fingerprint_value = {"definitions": [{"sha256": files.get(path)} for path in fields["definition_files"][:-1]], "proposition": proposition}
    fields.setdefault("statement_hash", hash_text(json.dumps(fingerprint_value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)))
    commitment = {
        **fields,
        "id": key,
        "files": {path: files[path] for path in fields["definition_files"] if path in files},
    }
    canonical = json.dumps(commitment, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return dict(fields, goal_hash=hash_text(canonical))


def policy(**goals):
    return {
        "version": 4,
        "name": "fixture-release",
        "problem": "sample-problem",
        "repository": "fixture/sample-problem",
        "branch": "research",
        "toolchain": "lean4:4.19.0",
        "allowed_axioms": ["propext", "Quot.sound"],
        "files": dict(FILES),
        "goals": goals,
    }


def enrollment(vm, registry, curator, manifest, problem_commit=PROBLEM_COMMIT, protocol_commit=PROTOCOL_COMMIT):
    vm.sender = curator
    raw = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    assert registry.enroll_policy(raw, problem_commit, protocol_commit) == hash_text(raw)
    return hash_text(raw)


def artifact(vm, contributor, goal_row, contribution_id="lemma", **changes):
    e = json.loads(evidence(bytes.fromhex(wallet(contributor)[2:]), contribution_id, goal_row["statement_hash"]))
    e.update(
        problem="sample-problem",
        repository="fixture/sample-problem",
        branch="research",
        contract=wallet(vm._contract_address),
        goal=goal_row["id"],
        goal_hash=goal_row["goal_hash"],
        policy=goal_row["policy_hash"],
        problem_commit=goal_row["problem_commit"],
        protocol_commit=goal_row["protocol_commit"],
        worker_commit=WORKER_COMMIT,
        formal_statement=goal_row["statement"],
        artifact_hash=hash_text(contribution_id),
        research_direction="theory",
    )
    e.update(changes)
    return e


def approval(vm, registry, executor, contribution_id):
    vm.sender = executor
    vm.clear_mocks()
    vm.mock_llm(".*", json.dumps({
        "accept": True,
        "novelty": 1,
        "significance": 1,
        "reusability": 2,
        "reason": "A verified component useful to future mathematical contributions.",
        "evidence_refs": [contribution_id],
    }))
    registry.adjudicate(contribution_id, 0)
    deadline = registry.get(contribution_id)["deadline"]
    vm.warp(datetime.fromtimestamp(deadline + 1, timezone.utc).isoformat())
    registry.finalize(contribution_id, 0)


def test_configuration_is_immutable_generic_and_non_issuing(
    registry, direct_alice, direct_bob, direct_charlie, direct_owner
):
    original = config(direct_alice, direct_bob, direct_charlie)
    assert registry.get_config() == original
    assert registry.list_goals() == []
    assert registry.list_contributions() == []
    assert registry.get_points(wallet(direct_owner))["total_awarded"] == "0"
    assert not hasattr(registry, "import_snapshot")


def test_problem_can_start_without_historical_ledger(
    direct_deploy, direct_alice, direct_bob, direct_charlie
):
    empty = {"chain_id": 61999, "address": "", "reserved_statement_hashes": [], "reserved_proposition_hashes": []}
    separate = config(direct_alice, direct_bob, direct_charlie, legacy_ledger=empty)
    other = direct_deploy(SOURCE, json.dumps(separate), sdk_version="v0.2.16")
    assert other.get_config() == separate


@pytest.mark.parametrize("change,message", [
    ({"version": True}, "exact version 4"),
    ({"snapshot": "historical"}, "exact version 4"),
    ({"curator": "0x" + "0" * 40}, "distinct nonzero"),
    ({"window": True}, "dispute window"),
    ({"directions": ["shared", "shared"]}, "unique research"),
    ({"legacy_ledger": {**LEGACY, "address": ""}}, "historical ledger address"),
    ({"legacy_ledger": {**LEGACY, "chain_id": "61999"}}, "historical ledger reference"),
])
def test_malformed_bootstrap(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, change, message
):
    settings = config(direct_alice, direct_bob, direct_charlie, **change)
    with direct_vm.expect_revert(message):
        direct_deploy(SOURCE, json.dumps(settings), sdk_version="v0.2.16")


def test_colliding_roles_are_rejected_even_with_address_case_changes(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    settings = config(direct_alice, direct_bob, direct_charlie, executor="0x" + direct_bob.hex().upper())
    with direct_vm.expect_revert("distinct nonzero"):
        direct_deploy(SOURCE, json.dumps(settings), sdk_version="v0.2.16")


def test_only_curator_enrolls_and_raw_policy_bytes_are_bound(
    direct_vm, registry, direct_alice, direct_bob, direct_charlie, direct_owner
):
    manifest = policy(component=goal("component"))
    raw = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    for sender in [direct_bob, direct_charlie, direct_owner]:
        direct_vm.sender = sender
        with direct_vm.expect_revert("trusted curator"):
            registry.enroll_policy(raw, PROBLEM_COMMIT, PROTOCOL_COMMIT)
    policy_hash = enrollment(direct_vm, registry, direct_alice, manifest)
    assert registry.get_policy(policy_hash) == {
        "policy_hash": policy_hash,
        "policy": manifest,
        "problem_commit": PROBLEM_COMMIT,
        "protocol_commit": PROTOCOL_COMMIT,
    }
    assert registry.list_goals() == [registry.get_goal("component")]
    assert registry.get_goal("component")["status"] == "open"
    assert registry.get_points(wallet(direct_alice))["total_awarded"] == "0"
    with direct_vm.expect_revert("policy already enrolled"):
        registry.enroll_policy(raw, "3" * 40, PROTOCOL_COMMIT)
    with direct_vm.expect_revert("duplicate or invalid goal id"):
        registry.enroll_policy(json.dumps(manifest), PROBLEM_COMMIT, PROTOCOL_COMMIT)
    assert registry.get_policy(policy_hash)["problem_commit"] == PROBLEM_COMMIT


@pytest.mark.parametrize("fingerprint", LEGACY["reserved_statement_hashes"])
def test_historical_award_cannot_be_enrolled_under_new_name(
    direct_vm, registry, direct_alice, direct_owner, fingerprint
):
    with direct_vm.expect_revert("statement fingerprint mismatch"):
        enrollment(direct_vm, registry, direct_alice, policy(alias=goal("alias", statement_hash=fingerprint)))
    assert registry.list_goals() == []
    assert registry.get_points(wallet(direct_owner))["total_awarded"] == "0"


def test_shared_unicode_commitment_vector_matches_native_computation(
    direct_vm, registry, direct_alice
):
    vector = GOLDEN["unicode"]
    manifest = policy(**{vector["id"]: vector["goal"]})
    manifest["files"] = vector["files"]
    enrollment(direct_vm, registry, direct_alice, manifest)
    enrolled = registry.get_goal(vector["id"])
    assert enrolled["statement_hash"] == vector["goal"]["statement_hash"]
    assert enrolled["goal_hash"] == vector["goal"]["goal_hash"]
    assert enrolled["proposition_hash"] == vector["propositionHash"]


@pytest.mark.parametrize("old", GOLDEN["legacy"]["statements"], ids=lambda row: row["id"])
def test_actual_paid_propositions_are_blocked_after_renaming_and_definition_churn(
    direct_vm, registry, direct_alice, old
):
    # Check the vector against the untouched v3 artifact, then use the new
    # commitment format rather than injecting an old opaque hash label.
    original = OLD_POLICY["goals"][old["id"]]
    assert original["statement_hash"] == old["legacyStatementHash"]
    assert hash_text(LEGACY_PROPOSITIONS[old["id"]]) == old["propositionHash"]
    assert old["propositionHash"] in registry.get_config()["legacy_ledger"]["reserved_proposition_hashes"]
    changed_files = {"Foundation.lean": "6" * 64, "Goal.lean": "7" * 64}
    alias = goal("alias", files=changed_files, statement=old["statement"].replace("def " + old["declaration"], "def Component", 1))
    assert alias["statement_hash"] != old["legacyStatementHash"]
    manifest = policy(alias=alias)
    manifest["files"] = changed_files
    with direct_vm.expect_revert("duplicate or historical proposition"):
        enrollment(direct_vm, registry, direct_alice, manifest)
    assert registry.list_goals() == []


def test_prop_duplicate_tripwire_survives_foundation_and_declaration_name_changes(
    direct_vm, registry, direct_alice
):
    first = goal("first")
    enrollment(direct_vm, registry, direct_alice, policy(first=first))
    changed_files = {"Foundation.lean": "6" * 64, "Goal.lean": "7" * 64}
    alias = goal("alias", files=changed_files, theorem="candidate : AnotherName", statement=first["statement"].replace("def Component", "def AnotherName", 1))
    manifest = policy(alias=alias)
    manifest["files"] = changed_files
    assert first["statement_hash"] != alias["statement_hash"]
    with direct_vm.expect_revert("duplicate or historical proposition"):
        enrollment(direct_vm, registry, direct_alice, manifest)
    assert len(registry.list_goals()) == 1


def test_forged_fingerprint_and_wrong_theorem_declaration_are_rejected(
    direct_vm, registry, direct_alice
):
    for candidate, reason in [
        (goal("component", statement_hash="a" * 64), "statement fingerprint mismatch"),
        (goal("component", theorem="candidate : AWeakerStatement"), "statement declaration must match"),
        (goal("component", statement="def Component : Prop :=  \n\t"), "nonempty proposition"),
        (goal("component", statement="-- Not an accepted display prefix\ndef Component : Prop := True"), "statement declaration must match"),
    ]:
        with direct_vm.expect_revert(reason):
            enrollment(direct_vm, registry, direct_alice, policy(component=candidate))
    assert registry.list_goals() == []


def test_policy_rejects_duplicate_keys_traversal_malformed_and_oversized_input(
    direct_vm, registry, direct_alice
):
    direct_vm.sender = direct_alice
    manifest = policy(component=goal("component"))
    raw = json.dumps(manifest)
    for text, reason in [
        (raw.replace('"rewardable": true', '"rewardable": false, "rewardable": true'), "duplicate JSON"),
        ('{"files": NaN}', "invalid JSON constant"),
        ("[]", "JSON object"),
        (raw + " " * 40000, "bounded JSON"),
    ]:
        with direct_vm.expect_revert(reason):
            registry.enroll_policy(text, PROBLEM_COMMIT, PROTOCOL_COMMIT)
    with direct_vm.expect_revert("invalid immutable policy commits"):
        registry.enroll_policy(raw, "0" * 40, PROTOCOL_COMMIT)
    wrong_file = policy(component=goal("component"))
    wrong_file["files"]["../Outside.lean"] = "1" * 64
    with direct_vm.expect_revert("invalid trusted Lean file"):
        enrollment(direct_vm, registry, direct_alice, wrong_file)
    invalid_unicode = policy(component={**goal("component"), "statement": "malformed Unicode \ud800"})
    with direct_vm.expect_revert("valid UTF-8 required"):
        registry.enroll_policy(json.dumps(invalid_unicode), PROBLEM_COMMIT, PROTOCOL_COMMIT)
    assert registry.list_goals() == []


def test_duplicate_and_mutated_goals_do_not_partially_enroll(
    direct_vm, registry, direct_alice
):
    with direct_vm.expect_revert("duplicate, historical or invalid statement fingerprint"):
        enrollment(direct_vm, registry, direct_alice, policy(first=goal("first"), alias=goal("alias")))
    assert registry.list_goals() == []
    enroll_hash = enrollment(direct_vm, registry, direct_alice, policy(first=goal("first")))
    before = registry.get_goal("first")
    for manifest, reason in [
        (policy(alias=goal("alias")), "duplicate, historical or invalid statement fingerprint"),
        (policy(alias=goal("alias", "b" * 64, path=before["path"])), "invalid goal proof path"),
        (policy(first=goal("first", "b" * 64, rewardable=False)), "duplicate or invalid goal id"),
        (policy(alias=goal("alias", "b" * 64, dependency={"id": "first"})), "invalid goal rewardability"),
        (policy(alias=goal("alias", "b" * 64, definition_files=["Missing.lean"])), "exact trusted goal definition"),
        (policy(alias=goal("alias", "b" * 64, definition_files=["Goal.lean", "Goal.lean"])), "exact trusted goal definition"),
    ]:
        with direct_vm.expect_revert(reason):
            enrollment(direct_vm, registry, direct_alice, manifest)
    tampered = policy(alias=goal("alias", "b" * 64))
    tampered["files"]["Foundation.lean"] = "6" * 64
    with direct_vm.expect_revert("statement fingerprint mismatch"):
        enrollment(direct_vm, registry, direct_alice, tampered)
    assert registry.list_goals() == [before]
    assert before["policy_hash"] == enroll_hash


def test_native_registration_requires_every_immutable_binding(
    direct_vm, registry, direct_alice, direct_bob, direct_charlie, direct_owner
):
    enrollment(direct_vm, registry, direct_alice, policy(component=goal("component"), reference=goal("reference", "b" * 64, rewardable=False)))
    submitted = artifact(direct_vm, direct_owner, registry.get_goal("component"))
    reference = artifact(direct_vm, direct_owner, registry.get_goal("reference"))
    assert registry.get_goal("reference")["status"] == "reference-only"
    for sender in [direct_alice, direct_charlie, direct_owner]:
        direct_vm.sender = sender
        with direct_vm.expect_revert("trusted verifier"):
            registry.register(json.dumps(submitted))
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("reference-only goal"):
        registry.register(json.dumps(reference))
    for field, value, reason in [
        ("problem", "another-problem", "objective verification"),
        ("repository", "other/sample-problem", "objective verification"),
        ("branch", "main", "objective verification"),
        ("contract", wallet(direct_charlie), "bind this contract"),
        ("goal", "future", "unknown goal"),
        ("policy", "e" * 64, "match enrolled goal"),
        ("goal_hash", "f" * 64, "match enrolled goal"),
        ("statement_hash", "b" * 64, "match enrolled goal"),
        ("formal_statement", "This is a different statement.", "match enrolled goal"),
        ("problem_commit", "3" * 40, "match enrolled goal"),
        ("protocol_commit", "4" * 40, "match enrolled goal"),
        ("worker_commit", "0" * 40, "invalid commit"),
        ("worker_commit", "x" * 40, "invalid commit"),
        ("research_direction", "p-equals-np", "invalid research direction"),
    ]:
        with direct_vm.expect_revert(reason):
            registry.register(json.dumps({**submitted, field: value}))
    for field in ["branch", "goal", "policy", "goal_hash", "problem_commit", "protocol_commit", "worker_commit", "contract"]:
        incomplete = {key: value for key, value in submitted.items() if key != field}
        with direct_vm.expect_revert("incomplete evidence"):
            registry.register(json.dumps(incomplete))
    assert registry.list_contributions() == []
    assert registry.get_goal("component")["status"] == "open"
    raw = json.dumps(submitted, ensure_ascii=False)
    assert registry.register(raw) == hash_text(raw)
    assert registry.get("lemma")["evidence"] == submitted


def test_append_preserves_earlier_configuration_and_merge_credit(
    direct_vm, registry, direct_alice, direct_bob, direct_charlie, direct_owner
):
    first_hash = enrollment(direct_vm, registry, direct_alice, policy(first=goal("first")))
    first = registry.get_goal("first")
    pending = artifact(direct_vm, direct_owner, first)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("unknown goal"):
        registry.register(json.dumps({**pending, "goal": "later"}))
    second_hash = enrollment(direct_vm, registry, direct_alice, policy(later=goal("later", "b" * 64)), "3" * 40, "4" * 40)
    assert second_hash != first_hash
    assert registry.get_goal("first") == first
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("match enrolled goal"):
        registry.register(json.dumps({**pending, "policy": second_hash}))
    registry.register(json.dumps(pending))
    approval(direct_vm, registry, direct_charlie, "lemma")
    assert registry.get_goal("first")["status"] == "reserved"
    assert registry.get_points(wallet(direct_owner))["total_awarded"] == "0"
    registry.release_unmerged("lemma", "The approved pull request was closed before merge.")
    assert registry.get_goal("first")["status"] == "open"
    direct_vm.sender = direct_bob
    registry.register(json.dumps(artifact(direct_vm, direct_owner, first, "replacement")))
    approval(direct_vm, registry, direct_charlie, "replacement")
    registry.confirm_merge("replacement", pending["head"], "5" * 40)
    registry.confirm_merge("replacement", pending["head"], "5" * 40)
    assert registry.get_goal("first")["status"] == "credited"
    assert registry.get_goal("later")["status"] == "open"
    assert registry.get_points(wallet(direct_owner))["points"] == "400"
    assert registry.get_points(wallet(direct_owner))["total_awarded"] == "400"
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("statement already reserved or credited"):
        registry.register(json.dumps({**pending, "id": "third"}))


def test_curator_closure_is_permanent_non_issuing_and_does_not_change_old_policy(
    direct_vm, registry, direct_alice, direct_bob, direct_charlie, direct_owner
):
    manifest = policy(component=goal("component"))
    policy_hash = enrollment(direct_vm, registry, direct_alice, manifest)
    original = registry.get_goal("component")
    reason = "The enrolled formal statement needs a separately reviewed correction."
    for sender in [direct_bob, direct_charlie, direct_owner]:
        direct_vm.sender = sender
        with direct_vm.expect_revert("trusted curator"):
            registry.close_goal("component", reason)
    direct_vm.sender = direct_alice
    for invalid in ["too short", " " * 1020 + reason]:
        with direct_vm.expect_revert("bounded goal closure reason"):
            registry.close_goal("component", invalid)
    with direct_vm.expect_revert("unknown goal"):
        registry.close_goal("unknown", reason)
    closed = registry.close_goal("component", reason)
    assert closed["status"] == "closed"
    assert closed["closure"]["reason"] == reason
    assert closed["closure"]["curator"].lower() == wallet(direct_alice).lower()
    assert {k: v for k, v in closed.items() if k not in ["status", "closure"]} == {k: v for k, v in original.items() if k != "status"}
    assert registry.get_policy(policy_hash)["policy"] == manifest
    assert not hasattr(registry, "reopen_goal")
    with direct_vm.expect_revert("goal already closed"):
        registry.close_goal("component", reason)
    with direct_vm.expect_revert("policy already enrolled"):
        enrollment(direct_vm, registry, direct_alice, manifest, "3" * 40)
    with direct_vm.expect_revert("duplicate or invalid goal id"):
        enrollment(direct_vm, registry, direct_alice, policy(component=goal("component", rewardable=False)), "3" * 40)
    with direct_vm.expect_revert("duplicate, historical or invalid statement fingerprint"):
        enrollment(direct_vm, registry, direct_alice, policy(alias=goal("alias")))
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("permanently closed"):
        registry.register(json.dumps(artifact(direct_vm, direct_owner, original)))
    assert registry.list_contributions() == []
    assert registry.get_points(wallet(direct_owner))["total_awarded"] == "0"


@pytest.mark.parametrize("phase", ["submitted", "approved", "credited"])
def test_closure_preserves_existing_contribution_decisions_and_credit(
    direct_vm, registry, direct_alice, direct_bob, direct_charlie, direct_owner, phase
):
    enrollment(direct_vm, registry, direct_alice, policy(component=goal("component")))
    original = registry.get_goal("component")
    submitted = artifact(direct_vm, direct_owner, original)
    direct_vm.sender = direct_bob
    registry.register(json.dumps(submitted))
    if phase != "submitted":
        approval(direct_vm, registry, direct_charlie, "lemma")
    if phase == "credited":
        registry.confirm_merge("lemma", submitted["head"], "5" * 40)
    before = registry.get("lemma")
    points = registry.get_points(wallet(direct_owner))
    direct_vm.sender = direct_alice
    registry.close_goal("component", "No further contributions will be admitted to this retired goal.")
    assert registry.get("lemma") == before
    assert registry.get_points(wallet(direct_owner)) == points
    assert registry.get_goal("component")["status"] == "closed"
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("permanently closed"):
        registry.register(json.dumps(artifact(direct_vm, direct_owner, original, "second")))
    # Closing admission is not a hidden veto over an existing decision. Its
    # ordinary consensus/challenge/merge path remains authoritative.
    if phase == "submitted":
        approval(direct_vm, registry, direct_charlie, "lemma")
    direct_vm.sender = direct_charlie
    registry.confirm_merge("lemma", submitted["head"], "5" * 40)
    assert registry.get("lemma")["status"] == "credited"
    assert registry.get_points(wallet(direct_owner))["points"] == "400"
    assert registry.get_goal("component")["status"] == "closed"


def test_new_worker_commit_can_process_old_enrollment_without_rebinding_it(
    direct_vm, registry, direct_alice, direct_bob, direct_owner
):
    enrollment(direct_vm, registry, direct_alice, policy(component=goal("component")))
    prior = registry.get_goal("component")
    submitted = artifact(direct_vm, direct_owner, prior, worker_commit="8" * 40)
    assert submitted["protocol_commit"] == PROTOCOL_COMMIT
    assert submitted["worker_commit"] != PROTOCOL_COMMIT
    direct_vm.sender = direct_bob
    registry.register(json.dumps(submitted))
    assert registry.get("lemma")["evidence"]["worker_commit"] == "8" * 40
    assert registry.get_goal("component") == prior


def test_impact_and_provenance_survive_append_without_issuing_history(
    direct_vm, registry, direct_alice, direct_bob, direct_charlie, direct_owner
):
    enrollment(direct_vm, registry, direct_alice, policy(first=goal("first")))
    upstream = artifact(direct_vm, direct_owner, registry.get_goal("first"), "upstream")
    direct_vm.sender = direct_bob
    registry.register(json.dumps(upstream))
    approval(direct_vm, registry, direct_charlie, "upstream")
    registry.confirm_merge("upstream", upstream["head"], "5" * 40)
    enrollment(direct_vm, registry, direct_alice, policy(later=goal("later", "b" * 64)), "3" * 40)
    used = {"id": "upstream", "artifact_hash": upstream["artifact_hash"], "proof_body_use": True}
    downstream = artifact(
        direct_vm, direct_alice, registry.get_goal("later"), "downstream",
        dependencies=["upstream"], verified_dependencies=[used],
    )
    direct_vm.sender = direct_bob
    registry.register(json.dumps(downstream))
    approval(direct_vm, registry, direct_charlie, "downstream")
    registry.confirm_merge("downstream", downstream["head"], "6" * 40)
    impact_review(direct_vm)
    impact = registry.review_impact("downstream", 0)
    direct_vm.warp(datetime.fromtimestamp(impact["deadline"] + 1, timezone.utc).isoformat())
    registry.settle_impact("downstream", 0)
    assert registry.get_points(wallet(direct_owner))["impact_points"] == "100"
    case = request("attribution", "upstream", registry)
    direct_vm.sender = direct_bob
    author_id, = attest(registry, case)["author_ids"]
    direct_vm.sender = direct_charlie
    review_provenance(registry, direct_vm, case, **correction(100, [{"author_id": author_id, "points": 200}]))
    settle(registry, direct_vm, case)
    assert registry.get_points(wallet(direct_owner))["initial_points"] == "100"
    assert registry.get_points(wallet(direct_owner))["impact_points"] == "100"
    assert registry.get_points(wallet(direct_owner))["total_awarded"] == "800"
    assert registry.get_goal("first")["status"] == "credited"
    assert registry.get("upstream")["credited_points"] == "400"


def test_affiliation_uses_problem_directions(direct_vm, registry, direct_owner):
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("unknown research side"):
        registry.set_affiliation("p-equals-np")
    registry.set_affiliation("theory")
    registry.set_affiliation("shared")
    affiliation, = registry.get_affiliations()
    assert [entry["side"] for entry in affiliation["history"]] == ["theory", "shared"]


def test_enrolled_components_cannot_be_used_as_full_problem_targets(
    direct_vm, registry, direct_alice, direct_bob, direct_charlie, direct_owner
):
    policy_hash = enrollment(direct_vm, registry, direct_alice, policy(component=goal("component")))
    direct_vm.sender = direct_owner
    case = request("external-solution", "sample-problem", registry)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("full problem target is not enrolled"):
        attest(registry, case, formal_verified=True, statement_hash="a" * 64, artifact_hash="f" * 64, policy=policy_hash)
    assert registry.get_case(case)["status"] == "submitted"
    attest(registry, case)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("full problem target is not enrolled"):
        review_provenance(registry, direct_vm, case, resolve=True, external_allocations=[])
    review_provenance(registry, direct_vm, case, resolve=False, external_allocations=[])
    assert settle(registry, direct_vm, case)["status"] == "settled"
    assert registry.get_problem()["status"] == "open"
    assert registry.get_points(wallet(direct_owner))["total_awarded"] == "0"


def test_expiring_withdrawn_identity_claim_preserves_an_unrelated_active_case(
    direct_vm, registry, direct_alice, direct_bob, direct_charlie, direct_owner
):
    enrollment(direct_vm, registry, direct_alice, policy(component=goal("component")))
    prior = artifact(direct_vm, direct_alice, registry.get_goal("component"))
    prior["provenance"] = {
        "mode": "formalization",
        "sources": [source()],
        "discovery_basis": "",
    }
    direct_vm.sender = direct_bob
    registry.register(json.dumps(prior))
    author, = registry.get_external_authors()
    direct_vm.sender = direct_owner
    withdrawn = request("authorship", author["id"], registry)
    registry.withdraw_case(withdrawn, "The reporter withdrew this unadmitted claim.")
    remaining = request("authorship", author["id"], registry)
    reporter = wallet(direct_owner)
    original_history = registry.get_case(withdrawn)["history"]
    direct_vm.sender = direct_charlie
    expired_at = registry.get_case(remaining)["identity_expiry"] + 1
    direct_vm.warp(datetime.fromtimestamp(expired_at, timezone.utc).isoformat())
    reason = "The recorded native wallet challenge exceeded its expiration time."
    registry.expire_case(withdrawn, reason)
    registry.expire_case(withdrawn, reason)
    assert registry.get_case(withdrawn)["status"] == "withdrawn"
    assert registry.get_case(withdrawn)["history"] == original_history
    assert registry.get_case_capacity(reporter)["active"] == 1
    registry.expire_case(remaining, reason)
    registry.expire_case(remaining, reason)
    assert registry.get_case(remaining)["status"] == "expired"
    assert registry.get_case_capacity(reporter)["active"] == 0
    assert registry.get_points(reporter)["total_awarded"] == "0"
