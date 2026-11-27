# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json
import re


class ResearchIntake(gl.Contract):
    binding: str
    requests: TreeMap[str, bool]

    def __init__(self, config_json: str):
        config = json.loads(config_json)
        if set(config) != {"version", "problem", "repository", "ledger", "policy"} or config["version"] != "wallet-intake-v1":
            raise gl.vm.UserError("Invalid research ledger binding")
        Address(config["ledger"])
        if not re.fullmatch("[a-f0-9]{64}", config["policy"]):
            raise gl.vm.UserError("Invalid research policy")
        self.binding = config_json

    @gl.public.view
    def get_config(self) -> dict:
        return json.loads(self.binding)

    def _key(self, wallet: Address, claim: str, pr: int, comment: int, prior: str) -> str:
        if not re.fullmatch("[a-f0-9]{64}", claim) or not (0 < pr < 2**53 and 0 < comment < 2**53):
            raise gl.vm.UserError("Exact claim digest, PR and signed comment required")
        return f"{str(wallet).lower()}/{claim}/{pr}/{comment}/{prior}"

    @gl.public.write
    def submit(self, claim: str, pr: int, comment: int):
        key = self._key(gl.message.sender_address, claim, pr, comment, "")
        self.requests[key] = True

    @gl.public.write
    def request_retry(self, claim: str, pr: int, comment: int, prior: str):
        if not re.fullmatch("0x[a-f0-9]{64}", prior):
            raise gl.vm.UserError("Exact prior Studio review hash required")
        key = self._key(gl.message.sender_address, claim, pr, comment, prior)
        self.requests[key] = True

    @gl.public.view
    def has_request(self, wallet: str, claim: str, pr: int, comment: int, prior: str) -> bool:
        return self._key(Address(wallet), claim, pr, comment, prior) in self.requests
