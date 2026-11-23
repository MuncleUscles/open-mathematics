"""Companion logic with finalized source calls and web responses mocked.
Direct mode executes the leader; it does not establish live validator agreement.
"""
import copy
import hashlib
import json
import os
from pathlib import Path

import pytest

SOURCE = "contracts/github_accounts.py"
LEDGER = "0x" + "7" * 40
PREDECESSOR = "0x" + "6" * 40
POLICY = "a" * 64


def digest(value):
    def normalize(item):
        if type(item) is int:
            return str(item)
        if isinstance(item, list):
            return [normalize(x) for x in item]
        if isinstance(item, dict):
            return {k: normalize(v) for k, v in item.items()}
        return item
    return hashlib.sha256(json.dumps(normalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def record(key, author=2372232, wallet="0x" + "a" * 40, status="credited", note=False):
    evidence = {"id": key, "github_author_id": author, "github_account_type": "User", "wallet": wallet,
                "problem": "p-vs-np", "repository": "Owner/problem", "policy": POLICY, "branch": "research", "contract": LEDGER,
                "evidence_kind": "research-note" if note else "formal", "artifact_hash": digest(key), "verified_dependencies": []}
    r = {"evidence": evidence, "digest": digest(evidence), "status": status, "credited_points": "400" if status == "credited" else "0"}
    if status == "credited":
        r.update(award_budget="400", initial_paid="400" if note else "320", impact_reserve="0" if note else "80",
                 reserve_returned="0" if note else "80", reserve_settled=True)
    return r


def impact(r):
    key = r["evidence"]["id"]
    if r["status"] != "credited" or r["evidence"]["evidence_kind"] == "research-note":
        return {"downstream": key, "status": "not-requested"}
    return {"downstream": key, "source_digest": r["digest"], "status": "settled", "budget": 80, "band_points": 26,
            "allocations": [], "paid_points": "0", "returned_points": "80"}


def source_state(records=None):
    records = records or [record("a"), record("b", status="rejected"), record("c", status="expired"), record("d", wallet="0x" + "b" * 40)]
    return {"config": {"version": 5, "problem": "p-vs-np", "repository": "Owner/problem", "branch": "research", "policy": POLICY,
                       "predecessor": {"address": PREDECESSOR, "snapshot_hash": "1" * 64}},
            "records": {r["evidence"]["id"]: r for r in records}, "impacts": {r["evidence"]["id"]: impact(r) for r in records}, "calls": []}


def global_points(state):
    credited = [r for r in state["records"].values() if r["status"] == "credited"]
    author = sum(int(r["credited_points"]) for r in credited)
    paid = sum(int(i.get("paid_points", 0)) for i in state["impacts"].values() if i["status"] == "settled")
    reserved = sum(int(r["impact_reserve"]) for r in credited if not r["reserve_settled"])
    return {"total_initial_points": str(author), "total_impact_points": str(paid), "total_awarded": str(author + paid),
            "total_returned_points": str(sum(int(r["reserve_returned"]) for r in credited)),
            "total_note_points": str(sum(int(r["credited_points"]) for r in credited if r["evidence"]["evidence_kind"] == "research-note")),
            "total_reserved_points": str(reserved), "total_award_budgets": str(sum(int(r["award_budget"]) for r in credited))}


def deploy(vm, direct_deploy, state, **changes):
    def hook(_vm, request):
        from genlayer.py import calldata
        call = request["CallContract"]
        assert str(call["address"]).lower() == LEDGER.lower()
        assert call["state"] == 1, "all reads must use LATEST_FINAL"
        method, args = call["calldata"]["method"], call["calldata"].get("args", [])
        state["calls"].append((method, args))
        values = {"get_config": lambda: state["config"], "get": lambda: state["records"][args[0]],
                  "get_impact": lambda: state["impacts"][args[0]], "get_points": lambda: global_points(state),
                  "count_contributions": lambda: len(state["records"])}
        assert method in values, "companion never calls source writes"
        return b"\x00" + calldata.encode(copy.deepcopy(values[method]()))
    vm._gl_call_hook = hook
    c = {"version": 1, "source_contract": LEDGER, "source_config_hash": digest(state["config"]), "problem": "p-vs-np", "repository": "Owner/problem", "policy": POLICY, **changes}
    return direct_deploy(SOURCE, json.dumps(c), sdk_version="v0.2.16")


def sync(c, state, key):
    return c.sync_contribution(key, digest({"record": state["records"][key], "impact": state["impacts"][key]}))


def add_dependency(state, downstream, upstream, settled):
    d, p = state["records"][downstream], state["records"][upstream]
    d["evidence"]["verified_dependencies"] = [{"id": upstream, "artifact_hash": p["evidence"]["artifact_hash"], "proof_body_use": True}]
    d["digest"] = digest(d["evidence"])
    d.update(credited_points="374" if settled else "320", reserve_returned="54" if settled else "0", reserve_settled=settled)
    state["impacts"][downstream] = {"downstream": downstream, "source_digest": d["digest"], "status": "settled" if settled else "provisional",
        "budget": 80, "band_points": 26, "allocations": [{"id": upstream, "band": 1, "points": "26"}],
        "paid_points": "26" if settled else "0", "returned_points": "54" if settled else "0"}


def test_permissionless_existing_800_and_original_history_are_indexed_once(direct_vm, direct_deploy, direct_bob):
    state = source_state()
    # Already imported A keeps its original contract address, never a new award.
    state["records"]["a"]["evidence"]["contract"] = PREDECESSOR
    state["records"]["a"]["digest"] = digest(state["records"]["a"]["evidence"])
    state["impacts"]["a"] = impact(state["records"]["a"])
    c = deploy(direct_vm, direct_deploy, state)
    direct_vm.sender = direct_bob
    assert c.get_record("a") == {"indexed": False, "id": "a"}
    assert c.get_state()["complete"] is False
    for key in state["records"]:
        first = sync(c, state, key)
        assert sync(c, state, key) == first
    a = c.get_account("2372232")
    assert a["points"] == a["author_points"] == "800"
    assert a["impact_points"] == "0" and a["returned_points"] == "160"
    assert a["contribution_count"] == 4 and a["credited_count"] == a["formal_count"] == 2 and a["wallet_count"] == 2
    assert a["login"] is None and a["username_checked_at"] == 0
    assert c.get_state()["complete"] is True
    assert c.get_state()["indexed_count"] == 4
    assert c.count_accounts() == 1
    assert c.list_accounts(0, 64) == {"items": ["2372232"], "total": 1, "next_offset": None}


def test_shared_wallet_distinct_accounts_and_upstream_attribution(direct_vm, direct_deploy):
    state = source_state([record("a", author=17), record("d", author=18)])
    add_dependency(state, "d", "a", True)
    c = deploy(direct_vm, direct_deploy, state)
    sync(c, state, "d")  # Source A need not have been indexed first.
    assert c.get_account("17")["impact_points"] == "26"
    assert c.get_account("17")["contribution_count"] == 0
    assert c.get_state()["complete"] is False
    sync(c, state, "a")
    assert c.get_account("17")["points"] == "426"
    assert c.get_account("18")["points"] == "374"
    assert c.get_state()["complete"] is True
    for key in ["d", "a", "d"]:
        sync(c, state, key)
    assert c.get_state()["indexed_totals"]["points"] == "800"


def test_pending_reserve_then_incremental_settlement_and_unique_intent_hash(direct_vm, direct_deploy):
    state = source_state([record("a", author=17), record("d", author=18)])
    add_dependency(state, "d", "a", False)
    c = deploy(direct_vm, direct_deploy, state)
    sync(c, state, "a")
    pending = sync(c, state, "d")
    assert c.get_account("18")["points"] == "320"
    assert c.get_account("17")["impact_points"] == "0"
    assert c.get_state()["complete"] is True
    add_dependency(state, "d", "a", True)
    assert c.get_state()["complete"] is False
    with direct_vm.expect_revert("source changed"):
        c.sync_contribution("d", pending["source_hash"])
    settled = sync(c, state, "d")
    assert settled["source_hash"] != pending["source_hash"]
    assert settled["settled_impact_hash"] is not None
    assert c.get_account("18")["points"] == "374"
    assert c.get_account("17")["points"] == "426"
    assert c.get_state()["complete"] is True
    sync(c, state, "d")
    assert c.get_state()["indexed_totals"]["points"] == "800"


def test_same_account_upstream_and_downstream_do_not_overwrite_credit(direct_vm, direct_deploy):
    state = source_state([record("a"), record("d", wallet="0x" + "b" * 40)])
    add_dependency(state, "d", "a", True)
    c = deploy(direct_vm, direct_deploy, state)
    sync(c, state, "d"); sync(c, state, "a")
    assert c.get_account("2372232")["points"] == "800"
    assert c.get_account("2372232")["impact_points"] == "26"
    assert c.get_account("2372232")["author_points"] == "774"


def test_two_upstream_records_for_same_account_accumulate_both_allocations(direct_vm, direct_deploy):
    state = source_state([record("a", author=17), record("b", author=17, wallet="0x" + "b" * 40), record("d", author=18)])
    add_dependency(state, "d", "a", True)
    d = state["records"]["d"]
    d["evidence"]["verified_dependencies"].append({"id": "b", "artifact_hash": state["records"]["b"]["evidence"]["artifact_hash"], "proof_body_use": True})
    d["digest"] = digest(d["evidence"])
    d.update(credited_points="348", reserve_returned="28")
    i = state["impacts"]["d"]
    i.update(source_digest=d["digest"], paid_points="52", returned_points="28")
    i["allocations"].append({"id": "b", "band": 1, "points": "26"})
    c = deploy(direct_vm, direct_deploy, state)
    sync(c, state, "d")
    assert c.get_account("17")["impact_points"] == "52"
    assert c.get_account("17")["wallet_count"] == 2
    sync(c, state, "b"); sync(c, state, "a"); sync(c, state, "d")
    assert c.get_account("17")["points"] == "852"
    assert c.get_account("18")["points"] == "348"
    assert c.get_state()["indexed_totals"]["points"] == "1200"
    assert c.get_state()["complete"]


def test_source_reference_without_verified_use_cannot_create_impact(direct_vm, direct_deploy):
    state = source_state([record("a", author=17), record("d", author=18)])
    add_dependency(state, "d", "a", True)
    state["records"]["d"]["evidence"]["verified_dependencies"] = []
    state["records"]["d"]["evidence"]["dependencies"] = ["a"]
    c = deploy(direct_vm, direct_deploy, state)
    with direct_vm.expect_revert("verified upstream source"):
        sync(c, state, "d")
    assert c.count_accounts() == 0
    assert c.get_record("d")["indexed"] is False


def test_source_credit_cannot_decrease_after_indexing(direct_vm, direct_deploy):
    state = source_state([record("a")]); c = deploy(direct_vm, direct_deploy, state); sync(c, state, "a")
    state["records"]["a"].update(credited_points="320", reserve_returned="0", reserve_settled=False)
    state["impacts"]["a"] = {"downstream": "a", "status": "not-requested"}
    with direct_vm.expect_revert("source credit cannot decrease"):
        sync(c, state, "a")
    assert c.get_account("2372232")["points"] == "400"


def test_increasing_registration_count_or_unsynced_credit_marks_index_incomplete(direct_vm, direct_deploy):
    state = source_state([record("a")])
    c = deploy(direct_vm, direct_deploy, state); sync(c, state, "a")
    assert c.get_state()["complete"]
    state["records"]["b"] = record("b", status="submitted"); state["impacts"]["b"] = impact(state["records"]["b"])
    assert not c.get_state()["complete"]
    sync(c, state, "b"); assert c.get_state()["complete"]
    old = c.get_record("b")
    state["records"]["b"] = record("b"); state["impacts"]["b"] = impact(state["records"]["b"])
    assert not c.get_state()["complete"]
    sync(c, state, "b")
    assert c.get_record("b")["source_hash"] != old["source_hash"]
    assert c.get_account("2372232")["credited_count"] == 2
    assert c.get_state()["complete"]


@pytest.mark.parametrize("mutation,error", [
    (lambda s: s["records"]["a"]["evidence"].update(github_author_id=True), "source GitHub"),
    (lambda s: s["records"]["a"]["evidence"].update(contract="0x" + "5" * 40), "scope mismatch"),
    (lambda s: s["records"]["a"].update(credited_points="401"), "accounting mismatch"),
    (lambda s: s["impacts"]["a"].update(paid_points="1"), "impact total mismatch"),
    (lambda s: s["impacts"]["a"].update(source_digest="f" * 64), "settled impact mismatch"),
])
def test_inconsistent_source_cannot_be_indexed(direct_vm, direct_deploy, mutation, error):
    state = source_state([record("a")]); c = deploy(direct_vm, direct_deploy, state)
    mutation(state)
    with direct_vm.expect_revert(error):
        sync(c, state, "a")
    assert c.count_accounts() == 0


def test_source_configuration_and_same_record_attribution_cannot_change(direct_vm, direct_deploy):
    state = source_state([record("a")])
    with direct_vm.expect_revert("configuration commitment"):
        deploy(direct_vm, direct_deploy, state, source_config_hash="0" * 64)


def test_post_index_identity_and_settled_allocation_rewrites_fail(direct_vm, direct_deploy):
    state = source_state([record("a")]); c = deploy(direct_vm, direct_deploy, state); sync(c, state, "a")
    state["records"]["a"]["evidence"]["github_author_id"] = 18
    with direct_vm.expect_revert("attribution changed"):
        sync(c, state, "a")
    state["records"]["a"]["evidence"]["github_author_id"] = 2372232
    state["impacts"]["a"]["reason"] = "Changed settled source metadata"
    with direct_vm.expect_revert("settled source attribution changed"):
        sync(c, state, "a")
    assert c.get_account("2372232")["points"] == "400"


def profile(vm, login="MuncleUscles", author=2372232, kind="User", status=200, body=None):
    vm.clear_mocks()
    vm.mock_web(r"^https://api\.github\.com/user/2372232$", {"status": status,
        "body": json.dumps({"id": author, "login": login, "type": kind}) if body is None else body})


def test_native_username_refresh_uses_id_and_cas_without_affecting_800_points(direct_vm, direct_deploy):
    state = source_state(); c = deploy(direct_vm, direct_deploy, state)
    for key in state["records"]: sync(c, state, key)
    profile(direct_vm)
    first = c.refresh_username("2372232", "0")
    assert first["login"] == "MuncleUscles" and first["username_checked_at"] > 0
    with direct_vm.expect_revert("stale username refresh"):
        c.refresh_username("2372232", "0")
    direct_vm.warp("2030-01-01T00:00:00Z")
    profile(direct_vm, login="RenamedAccount")
    after = c.refresh_username("2372232", str(first["username_checked_at"]))
    assert after["login"] == "RenamedAccount"
    assert after["username_checked_at"] > first["username_checked_at"]
    assert after["points"] == "800" and c.count_accounts() == 1


@pytest.mark.parametrize("options,error", [
    ({"author": 987}, "identity mismatch"),  # Old login reassigned to another ID.
    ({"author": "2372232"}, "identity mismatch"),
    ({"kind": "Organization"}, "identity mismatch"),
    ({"login": "<script>"}, "identity mismatch"),
    ({"login": "bad--login"}, "identity mismatch"),
    ({"status": 404}, "unavailable"),
    ({"status": 429}, "unavailable"),
    ({"body": "x" * 65537}, "unavailable"),
    ({"body": "invalid json"}, "profile JSON"),
    ({"body": '{"id":2372232,"id":987,"login":"MuncleUscles","type":"User"}'}, "duplicate JSON"),
])
def test_bad_or_unavailable_profile_preserves_existing_native_name(direct_vm, direct_deploy, options, error):
    state = source_state([record("a")]); c = deploy(direct_vm, direct_deploy, state); sync(c, state, "a")
    profile(direct_vm); before = c.refresh_username("2372232", "0")
    direct_vm.warp("2030-01-01T00:00:00Z"); profile(direct_vm, **options)
    with direct_vm.expect_revert(error):
        c.refresh_username("2372232", str(before["username_checked_at"]))
    assert c.get_account("2372232") == before


def test_unknown_accounts_cannot_self_enroll_and_pagination_is_bounded(direct_vm, direct_deploy):
    state = source_state(); c = deploy(direct_vm, direct_deploy, state)
    with direct_vm.expect_revert("unknown GitHub account"):
        c.refresh_username("2372232", "0")
    for args in [(-1, 1), (0, 65), (True, 1), (0, 0)]:
        with direct_vm.expect_revert("bounded account page"):
            c.list_accounts(*args)
    assert c.count_accounts() == 0


@pytest.mark.skipif(not os.environ.get("OPEN_MATH_ACCOUNTS_SOURCE_SNAPSHOT"), reason="Optional real finalized source fixture")
def test_actual_four_record_source_is_exactly_800(direct_vm, direct_deploy):
    def native(value):
        if isinstance(value, str) and value.isdecimal(): return int(value)
        if isinstance(value, list): return [native(x) for x in value]
        if isinstance(value, dict): return {k: native(v) for k, v in value.items()}
        return value
    raw = native(json.loads(Path(os.environ["OPEN_MATH_ACCOUNTS_SOURCE_SNAPSHOT"]).read_text()))
    state = {"config": raw["config"], "records": {r["evidence"]["id"]: r for r in raw["records"]},
             "impacts": {r["downstream"]: r for r in raw["impacts"]}, "calls": []}
    # The mock source address must match this captured ledger's actual identity.
    global LEDGER, PREDECESSOR, POLICY
    previous = LEDGER, PREDECESSOR, POLICY
    LEDGER = raw["identity"]["contract"]; PREDECESSOR = raw["config"]["predecessor"]["address"]; POLICY = raw["config"]["policy"]
    try:
        c = deploy(direct_vm, direct_deploy, state, repository=raw["config"]["repository"])
        for key in state["records"]: sync(c, state, key)
        assert c.get_account("2372232")["points"] == "800"
        assert c.get_account("2372232")["credited_count"] == 2
        assert c.get_state()["complete"]
    finally:
        LEDGER, PREDECESSOR, POLICY = previous
