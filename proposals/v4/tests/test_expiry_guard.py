from datetime import datetime, timezone
from pathlib import Path
import shutil
import subprocess

import pytest

from test_impact import accept
from test_provenance import attest, request, review_provenance, settle, wallet


PROPOSAL = Path(__file__).resolve().parents[1]
REPOSITORY = PROPOSAL.parents[1]
CONTRACT_PATH = Path("contracts/research.py")
EXPIRATION = "The authorship challenge expired at the end of its native deadline."
WITHDRAWAL = "The reporter withdrew this unadmitted authorship request."
REPEAT = "A repeated operation must preserve the original terminal history."


@pytest.fixture(scope="module")
def patched_contract(tmp_path_factory):
    scratch = tmp_path_factory.mktemp("expiry-guard")
    candidate = scratch / CONTRACT_PATH
    candidate.parent.mkdir()
    shutil.copyfile(REPOSITORY / CONTRACT_PATH, candidate)
    patch = PROPOSAL / "expiry-guard.patch"
    subprocess.run(["git", "apply", "--check", str(patch)], cwd=scratch, check=True)
    subprocess.run(["git", "apply", str(patch)], cwd=scratch, check=True)
    return candidate


@pytest.fixture
def ledger(patched_contract, direct_vm, direct_deploy, direct_alice, direct_bob):
    from gltest.direct.sdk_loader import setup_sdk_paths

    setup_sdk_paths(patched_contract, "v0.2.16")
    direct_vm.sender = direct_alice
    operator = wallet(direct_alice)
    contract = direct_deploy(
        str(patched_contract), operator, operator, "p-vs-np", "policy", 10, False, "",
        sdk_version="v0.2.16",
    )
    accept(contract, direct_vm, direct_alice, direct_bob, "credited", "1" * 64, 30)
    assert contract.get_points(wallet(direct_bob))["points"] == "400"
    return contract


def report_authorship(contract, vm, operator, reporter):
    vm.sender = operator
    source = request("external-solution", "p-vs-np", contract)
    (author_id,) = attest(contract, source)["author_ids"]
    vm.sender = reporter
    return request("authorship", author_id, contract)


def pass_identity_deadline(contract, vm, key):
    deadline = contract.get_case(key)["identity_expiry"]
    vm.warp(datetime.fromtimestamp(deadline + 1, timezone.utc).isoformat())


def assert_capacity(contract, reporter, active):
    assert contract.get_case_capacity(wallet(reporter)) == {
        "active": active, "maximum": 4, "available": 4 - active,
    }


def point_state(contract, operator, reporter):
    return (
        contract.get_points(wallet(operator)),
        contract.get_points(wallet(reporter)),
        contract.get_external_authors(),
    )


@pytest.mark.parametrize("other_active", [0, 1])
def test_delayed_expiry_preserves_withdrawn_history_and_other_slots(
    ledger, direct_vm, direct_alice, direct_bob, other_active,
):
    key = report_authorship(ledger, direct_vm, direct_alice, direct_bob)
    other = request("external-solution", "p-vs-np", ledger) if other_active else None
    other_case = ledger.get_case(other) if other else None
    assert_capacity(ledger, direct_bob, 1 + other_active)
    pass_identity_deadline(ledger, direct_vm, key)
    before_points = point_state(ledger, direct_alice, direct_bob)

    ledger.withdraw_case(key, WITHDRAWAL)
    withdrawn = ledger.get_case(key)
    assert withdrawn["status"] == "withdrawn"
    assert [(event["event"], event["reason"]) for event in withdrawn["history"]] == [
        ("withdrawal", WITHDRAWAL),
    ]
    assert_capacity(ledger, direct_bob, other_active)

    direct_vm.sender = direct_alice
    ledger.expire_case(key, EXPIRATION)
    ledger.expire_case(key, REPEAT)
    direct_vm.sender = direct_bob
    ledger.withdraw_case(key, REPEAT)

    assert ledger.get_case(key) == withdrawn
    assert_capacity(ledger, direct_bob, other_active)
    if other:
        assert ledger.get_case(other) == other_case
    assert point_state(ledger, direct_alice, direct_bob) == before_points


def test_objectively_stale_active_authorship_expires_once(
    ledger, direct_vm, direct_alice, direct_bob,
):
    key = report_authorship(ledger, direct_vm, direct_alice, direct_bob)
    submitted = ledger.get_case(key)
    before_points = point_state(ledger, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("only objectively stale cases can expire"):
        ledger.expire_case(key, EXPIRATION)
    assert ledger.get_case(key) == submitted
    assert_capacity(ledger, direct_bob, 1)

    pass_identity_deadline(ledger, direct_vm, key)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("consensus executor required"):
        ledger.expire_case(key, EXPIRATION)
    direct_vm.sender = direct_alice
    ledger.expire_case(key, EXPIRATION)
    expired = ledger.get_case(key)
    assert expired["status"] == "expired"
    assert [(event["event"], event["reason"]) for event in expired["history"]] == [
        ("expired", EXPIRATION),
    ]
    assert_capacity(ledger, direct_bob, 0)

    ledger.expire_case(key, REPEAT)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only an unadmitted case"):
        ledger.withdraw_case(key, REPEAT)
    assert ledger.get_case(key) == expired
    assert_capacity(ledger, direct_bob, 0)
    assert point_state(ledger, direct_alice, direct_bob) == before_points


def test_expiry_rejects_a_settled_case(
    ledger, direct_vm, direct_alice, direct_bob,
):
    direct_vm.sender = direct_bob
    key = request("external-solution", "p-vs-np", ledger)
    direct_vm.sender = direct_alice
    attest(ledger, key)
    review_provenance(ledger, direct_vm, key, resolve=False, external_allocations=[])
    settled = settle(ledger, direct_vm, key)
    before_points = point_state(ledger, direct_alice, direct_bob)
    assert settled["status"] == "settled"
    assert [event["event"] for event in settled["history"]] == [
        "documentary-verification", "review", "settlement",
    ]
    assert_capacity(ledger, direct_bob, 0)

    with direct_vm.expect_revert("settled case or invalid expiration reason"):
        ledger.expire_case(key, EXPIRATION)
    assert ledger.get_case(key) == settled
    assert_capacity(ledger, direct_bob, 0)
    assert point_state(ledger, direct_alice, direct_bob) == before_points
