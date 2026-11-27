import json


def test_wallet_requests_are_scoped_to_sender_claim_comment_and_attempt(direct_deploy, direct_vm, direct_alice, direct_bob):
    config = {"version": "wallet-intake-v1", "problem": "test", "repository": "owner/test", "ledger": "0x"+direct_bob.hex(), "policy": "a"*64}
    intake = direct_deploy("contracts/wallet_intake.py", json.dumps(config), sdk_version="v0.2.16")
    assert intake.get_config() == config
    claim, prior = "b"*64, "0x"+"c"*64
    direct_vm.sender = direct_alice
    intake.submit(claim, 3, 4)
    assert intake.has_request("0x"+direct_alice.hex(), claim, 3, 4, "")
    assert not intake.has_request("0x"+direct_bob.hex(), claim, 3, 4, "")
    assert not intake.has_request("0x"+direct_alice.hex(), claim, 3, 5, "")
    assert not intake.has_request("0x"+direct_alice.hex(), claim, 3, 4, prior)
    intake.request_retry(claim, 3, 4, prior)
    assert intake.has_request("0x"+direct_alice.hex(), claim, 3, 4, prior)
    assert not intake.has_request("0x"+direct_alice.hex(), claim, 3, 4, "0x"+"d"*64)
    with direct_vm.expect_revert("Exact prior Studio review hash required"):
        intake.request_retry(claim, 3, 4, "")
