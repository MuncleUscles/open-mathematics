# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from genlayer.py.public_abi import StorageType
import hashlib
import json
import re
from datetime import datetime, timezone


def fail(message: str):
    raise gl.vm.UserError(message)


def require(ok: bool, message: str):
    if not ok:
        fail(message)


def match(value, pattern: str) -> bool:
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def address(value) -> bool:
    return match(value, r"0x[a-fA-F0-9]{40}") and value.lower() != "0x" + "0" * 40


def uint(value) -> int:
    require(type(value) is int or match(value, r"0|[1-9][0-9]{0,77}"), "canonical nonnegative integer required")
    result = int(value)
    require(0 <= result < 2 ** 256, "integer outside uint256")
    return result


def account_id(value: str) -> str:
    require(isinstance(value, str) and uint(value) > 0, "positive GitHub account ID string required")
    return value


def normalize(value):
    if type(value) is int:
        return str(value)
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    return value


def source_hash(value) -> str:
    encoded = json.dumps(normalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    require(len(encoded) <= 1048576, "bounded source response required")
    return hashlib.sha256(encoded).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


class GitHubAccounts(gl.Contract):
    """Permissionless account index of one immutable research ledger.
    Never adjudicates, issues research points, migrates or calls source writes.
    """
    config: str
    source: Address
    predecessor: str
    predecessor_config: str
    accounts: TreeMap[str, str]
    account_order: DynArray[str]
    account_wallets: TreeMap[str, bool]
    records: TreeMap[str, str]
    record_order: DynArray[str]
    totals: TreeMap[str, u256]

    def __init__(self, config_json: str):
        require(isinstance(config_json, str) and len(config_json.encode("utf-8")) <= 32768, "bounded configuration required")
        try:
            c = json.loads(config_json, object_pairs_hook=unique_object)
        except (ValueError, RecursionError):
            fail("valid configuration JSON required")
        require(isinstance(c, dict) and set(c) == {"version", "source_contract", "source_config_hash", "problem", "repository", "policy"}, "exact account configuration required")
        require(type(c["version"]) is int and c["version"] == 1 and address(c["source_contract"]) and Address(c["source_contract"]) != gl.message.contract_address,
                "version 1 and nonself source required")
        require(match(c["source_config_hash"], r"[a-f0-9]{64}") and match(c["policy"], r"[a-f0-9]{64}") and c["problem"] == "p-vs-np" and
                match(c["repository"], r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"), "exact research source scope required")
        self.source = Address(c["source_contract"])
        self.config = json.dumps(c, sort_keys=True)
        original = self._source().get_config()
        require(isinstance(original, dict) and original.get("version") == 5 and original.get("problem") == c["problem"] and
                original.get("repository") == c["repository"] and original.get("policy") == c["policy"] and original.get("branch") == "research" and
                source_hash(original) == c["source_config_hash"], "source configuration commitment mismatch")
        self.predecessor_config = json.dumps(original.get("predecessor", {}), sort_keys=True)
        self.predecessor = original.get("predecessor", {}).get("address", "")
        require(self.predecessor == "" or address(self.predecessor), "invalid predecessor reference")

    def _source(self):
        return gl.get_contract_at(self.source).view(state=StorageType.LATEST_FINAL)

    def _read_record(self, key: str) -> dict:
        require(match(key, r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}"), "bounded contribution ID required")
        r = self._source().get(key)
        require(isinstance(r, dict) and isinstance(r.get("evidence"), dict), "source contribution required")
        e = r["evidence"]
        c = json.loads(self.config)
        require(e.get("id") == key and e.get("problem") == c["problem"] and e.get("repository") == c["repository"] and
                e.get("branch") == "research" and address(e.get("contract")), "source contribution scope mismatch")
        p = json.loads(self.predecessor_config)
        if e["contract"].lower() == str(self.source).lower():
            require(e.get("policy") == c["policy"], "source contribution policy mismatch")
        elif p.get("version") == 2:
            entries = [item for item in p.get("records", []) if item.get("id") == key]
            require(len(entries) == 1 and entries[0].get("origin_contract", "").lower() == e["contract"].lower() and entries[0].get("origin_policy") == e.get("policy"), "reviewed source origin required")
            entry = entries[0]
            inherited = self._source().get_inheritance(key)
            require(isinstance(inherited, dict) and set(inherited) == {"inherited", "version", "predecessor", "snapshot_hash", "source_config_hash", "source_code_hash", "source_policy", "original_record_hash", "record_hash", "origin_chain"} and inherited.get("inherited") is True and inherited.get("version") == 2 and inherited.get("predecessor", "").lower() == self.predecessor.lower() and all(inherited.get(k) == p.get(k) for k in ["snapshot_hash", "source_config_hash", "source_code_hash", "source_policy"]) and inherited.get("record_hash") == source_hash(r) and inherited.get("original_record_hash") == entry.get("record_hash"), "authenticated source inheritance required")
            chain = inherited.get("origin_chain")
            require(isinstance(chain, list) and 1 <= len(chain) <= 4, "bounded source origin chain required")
            seen = set()
            for hop in chain:
                require(isinstance(hop, dict) and set(hop) == {"contract", "policy", "snapshot_hash", "record_hash", "original_record_hash"} and address(hop.get("contract")) and hop["contract"].lower() not in seen and all(match(hop.get(k), r"[a-f0-9]{64}") for k in ["policy", "snapshot_hash", "record_hash", "original_record_hash"]), "invalid source origin chain")
                seen.add(hop["contract"].lower())
            require(chain[0]["contract"].lower() == self.predecessor.lower() and chain[0]["policy"] == p["source_policy"] and chain[0]["snapshot_hash"] == p["snapshot_hash"] and chain[0]["record_hash"] == entry["record_hash"] and chain[0]["original_record_hash"] == entry["record_hash"] and chain[-1]["contract"].lower() == e["contract"].lower() and chain[-1]["policy"] == e["policy"], "source chain does not reach original evidence")
        else:
            require(e.get("policy") == c["policy"] and e["contract"].lower() == self.predecessor.lower(), "source contribution scope mismatch")
        require(type(e.get("github_author_id")) is int and 0 < e["github_author_id"] < 2 ** 256 and e.get("github_account_type") == "User" and address(e.get("wallet")),
                "source GitHub author and wallet required")
        require(match(r.get("digest"), r"[a-f0-9]{64}") and r.get("status") in ["submitted", "provisional", "challenged", "approved", "credited", "rejected", "expired"] and
                e.get("evidence_kind") in ["formal", "research-note"], "invalid source record")
        return r

    def _account(self, e: dict) -> dict:
        key = str(e["github_author_id"])
        if key not in self.accounts:
            self.accounts[key] = json.dumps({"github_author_id": key, "login": None, "username_checked_at": 0,
                "contribution_count": 0, "credited_count": 0, "formal_count": 0, "wallet_count": 0,
                "author_points": "0", "impact_points": "0", "returned_points": "0", "note_points": "0", "points": "0"}, sort_keys=True)
            self.account_order.append(key)
        row = json.loads(self.accounts[key])
        wallet_key = key + ":" + e["wallet"].lower()
        if wallet_key not in self.account_wallets:
            self.account_wallets[wallet_key] = True
            row["wallet_count"] += 1
            self._save_account(row)
        return row

    def _save_account(self, row: dict):
        row["points"] = str(uint(row["author_points"]) + uint(row["impact_points"]))
        uint(row["points"])
        self.accounts[row["github_author_id"]] = json.dumps(row, sort_keys=True)

    def _add(self, row: dict, field: str, value: int):
        require(value >= 0, "source credit cannot decrease")
        row[field] = str(uint(row[field]) + value)
        uint(row[field])
        total = int(self.totals.get(field, u256(0))) + value
        require(total < 2 ** 256, "accounting overflow")
        self.totals[field] = u256(total)

    @gl.public.write
    def sync_contribution(self, key: str, expected_source_hash: str) -> dict:
        require(match(expected_source_hash, r"[a-f0-9]{64}"), "exact source hash required")
        r = self._read_record(key)
        impact = self._source().get_impact(key)
        require(isinstance(impact, dict) and impact.get("downstream") == key and impact.get("status") in ["not-requested", "provisional", "challenged", "settled"], "source impact required")
        current_hash = source_hash({"record": r, "impact": impact})
        require(current_hash == expected_source_hash, "source changed before synchronization")
        old = json.loads(self.records[key]) if key in self.records else None
        if old is not None and old["source_hash"] == current_hash:
            return old
        e = r["evidence"]
        if old is not None:
            require(old["evidence_digest"] == r["digest"] and old["github_author_id"] == str(e["github_author_id"]) and old["wallet"] == e["wallet"].lower(), "source attribution changed")
        credited = r["status"] == "credited"
        author = uint(r["credited_points"])
        returned = uint(r["reserve_returned"]) if credited else 0
        note = author if credited and e["evidence_kind"] == "research-note" else 0
        paid = 0
        settled_hash = None
        recipients = []
        if not credited:
            require(author == 0 and impact == {"downstream": key, "status": "not-requested"}, "uncredited source cannot have awards")
        else:
            reserve, initial, budget = uint(r["impact_reserve"]), uint(r["initial_paid"]), uint(r["award_budget"])
            require(type(r.get("reserve_settled")) is bool and initial + reserve == budget and author == initial + returned and returned <= reserve and
                    (r["reserve_settled"] or returned == 0) and (e["evidence_kind"] == "formal" or reserve == 0), "source award accounting mismatch")
            if impact["status"] == "settled":
                require(r["reserve_settled"] and impact.get("source_digest") == r["digest"] and uint(impact.get("budget")) == reserve and
                        uint(impact.get("band_points")) == reserve // 3 and uint(impact.get("returned_points")) == returned and
                        isinstance(impact.get("allocations"), list) and len(impact["allocations"]) <= 8, "source settled impact mismatch")
                uses = e.get("verified_dependencies")
                require(isinstance(uses, list) and len(uses) <= 8 and all(isinstance(use, dict) for use in uses), "bounded verified dependencies required")
                seen = set()
                bands = 0
                for allocation in impact["allocations"]:
                    require(isinstance(allocation, dict) and isinstance(allocation.get("id"), str) and allocation["id"] not in seen and allocation["id"] != key,
                            "unique source impact recipient required")
                    prior_id = allocation["id"]
                    seen.add(prior_id)
                    band = allocation.get("band")
                    require(type(band) is int and 0 <= band <= 3 and uint(allocation.get("points")) == band * (reserve // 3), "source impact band mismatch")
                    prior = self._read_record(prior_id)
                    require(prior["status"] == "credited" and prior["evidence"]["evidence_kind"] == "formal" and
                            any(use.get("id") == prior_id and use.get("artifact_hash") == prior["evidence"].get("artifact_hash") and use.get("proof_body_use") is True for use in uses),
                            "settled verified upstream source required")
                    amount = uint(allocation["points"])
                    recipients.append({"evidence": prior["evidence"], "points": amount})
                    paid += amount
                    bands += band
                require(bands <= 3 and paid == uint(impact.get("paid_points")) and paid + returned == reserve, "source impact total mismatch")
                settled_hash = source_hash(impact)
            else:
                require(not r["reserve_settled"] or reserve == 0, "settled reserve missing source attribution")
                if impact["status"] != "not-requested":
                    require(impact.get("source_digest") == r["digest"] and uint(impact.get("budget")) == reserve and
                            uint(impact.get("paid_points")) == 0 and uint(impact.get("returned_points")) == 0, "pending attribution has paid points")
        if old is not None:
            require(author >= uint(old["author_points"]) and returned >= uint(old["returned_points"]) and note >= uint(old["note_points"]), "source credit cannot decrease")
            require(old["settled_impact_hash"] is None or old["settled_impact_hash"] == settled_hash, "settled source attribution changed")
        row = self._account(e)
        if old is None:
            row["contribution_count"] += 1
            self.record_order.append(key)
        if credited and (old is None or old["status"] != "credited"):
            row["credited_count"] += 1
            if e["evidence_kind"] == "formal":
                row["formal_count"] += 1
        for field, value in [("author_points", author), ("returned_points", returned), ("note_points", note)]:
            self._add(row, field, value - (uint(old[field]) if old is not None else 0))
        self._save_account(row)
        if settled_hash is not None and (old is None or old["settled_impact_hash"] is None):
            for recipient in recipients:
                upstream = self._account(recipient["evidence"])
                self._add(upstream, "impact_points", recipient["points"])
                self._save_account(upstream)
        saved = {"indexed": True, "id": key, "source_hash": current_hash, "evidence_digest": r["digest"], "github_author_id": str(e["github_author_id"]),
                 "wallet": e["wallet"].lower(), "status": r["status"], "author_points": str(author), "returned_points": str(returned), "note_points": str(note),
                 "impact_points": str(paid), "settled_impact_hash": settled_hash}
        self.records[key] = json.dumps(saved, sort_keys=True)
        return saved

    @gl.public.write
    def refresh_username(self, github_author_id: str, expected_checked_at: str) -> dict:
        key = account_id(github_author_id)
        require(key in self.accounts, "unknown GitHub account")
        row = json.loads(self.accounts[key])
        require(isinstance(expected_checked_at, str) and str(uint(expected_checked_at)) == expected_checked_at and expected_checked_at == str(row["username_checked_at"]), "stale username refresh")
        checked_at = int(datetime.now(timezone.utc).timestamp())
        require(checked_at > row["username_checked_at"], "username refresh timestamp has not advanced")

        def fetch():
            response = gl.nondet.web.get("https://api.github.com/user/" + key,
                headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pnp-fun-github-accounts"})
            require(response.status == 200 and isinstance(response.body, bytes) and len(response.body) <= 65536, "GitHub public profile unavailable")
            try:
                profile = json.loads(response.body.decode("utf-8"), object_pairs_hook=unique_object)
            except (ValueError, UnicodeError, RecursionError):
                fail("invalid GitHub profile JSON")
            require(isinstance(profile, dict) and type(profile.get("id")) is int and str(profile["id"]) == key and profile.get("type") == "User" and
                    match(profile.get("login"), r"[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}"), "GitHub profile identity mismatch")
            return {"id": key, "login": profile["login"], "type": "User"}

        profile = gl.eq_principle.strict_eq(fetch)
        row["login"] = profile["login"]
        row["username_checked_at"] = checked_at
        self._save_account(row)
        return row

    @gl.public.view
    def get_config(self) -> dict:
        return json.loads(self.config)

    @gl.public.view
    def get_record(self, key: str) -> dict:
        require(match(key, r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}"), "bounded contribution ID required")
        return json.loads(self.records[key]) if key in self.records else {"indexed": False, "id": key}

    @gl.public.view
    def get_account(self, github_author_id: str) -> dict:
        key = account_id(github_author_id)
        require(key in self.accounts, "unknown GitHub account")
        return json.loads(self.accounts[key])

    @gl.public.view
    def count_accounts(self) -> int:
        return len(self.account_order)

    @gl.public.view
    def list_accounts(self, offset: int, limit: int) -> dict:
        require(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 64, "bounded account page required")
        total = len(self.account_order)
        end = min(total, offset + limit)
        return {"items": [self.account_order[index] for index in range(offset, end)], "total": total, "next_offset": end if end < total else None}

    @gl.public.view
    def get_state(self) -> dict:
        source = self._source()
        before = source.count_contributions()
        points = source.get_points("0x" + "0" * 40)
        count = source.count_contributions()
        require(type(before) is int and before >= 0 and type(count) is int and count >= 0 and isinstance(points, dict), "source accounting required")
        indexed = {field: str(self.totals.get(field, u256(0))) for field in ["author_points", "impact_points", "returned_points", "note_points"]}
        indexed["points"] = str(uint(indexed["author_points"]) + uint(indexed["impact_points"]))
        original = {field: str(uint(points[source_field])) for field, source_field in [
            ("author_points", "total_initial_points"), ("impact_points", "total_impact_points"), ("returned_points", "total_returned_points"),
            ("note_points", "total_note_points"), ("points", "total_awarded"), ("reserved_points", "total_reserved_points"), ("award_budgets", "total_award_budgets")]}
        require(uint(original["author_points"]) + uint(original["impact_points"]) == uint(original["points"]) and
                uint(original["points"]) + uint(original["reserved_points"]) == uint(original["award_budgets"]), "source accounting inconsistent")
        c = json.loads(self.config)
        return {**c, "indexed_count": len(self.record_order), "source_count": count, "account_count": len(self.account_order),
                "source_consistent": before == count, "indexed_totals": indexed, "source_totals": original,
                "complete": before == count and len(self.record_order) == count and all(indexed[field] == original[field] for field in indexed)}
