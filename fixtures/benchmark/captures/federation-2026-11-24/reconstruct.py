"""Reconstruct contract-level first-round prompt strings; never invoke a model.

Uses the original registration JSON (checked against native calldata and digest),
the deployed contract's exact AST expressions, and proven empty initial context.
Outcome-bearing provenance must not be passed to a baseline evaluator.
"""
import ast
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
PROVENANCE = ROOT / "provenance"
sha = lambda b: hashlib.sha256(b).hexdigest()
source = (PROVENANCE / "deployment-contract-source.py").read_bytes()
assert source == (PROVENANCE / "native-contract-source.py").read_bytes()
assert sha(source) == "429da6bb99951cfb2da1db693e5b164df54f2b22082148722c411917b818ac27"
module = ast.parse(source)
contract = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == "Research")
method = next(n for n in contract.body if isinstance(n, ast.FunctionDef) and n.name == "adjudicate")
assignments = {
    n.targets[0].id: n
    for n in method.body
    if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name)
}
names = ["identity_fields", "merit_evidence", "allowed", "data", "prompt"]
selected = ast.Module(body=[assignments[n] for n in names], type_ignores=[])
compiled = compile(ast.fix_missing_locations(selected), "deployed-adjudicate-prompt-expressions", "exec")
snapshot = json.loads((PROVENANCE / "native-context-snapshot.json").read_text())
validation = json.loads((PROVENANCE / "registration-validation.json").read_text())
readback = json.loads((PROVENANCE / "native-register-receipt-readback.json").read_text())
assert readback["chainId"] == 61999 and readback["readOnly"] is True
assert {c["case"] for c in readback["checks"]} == {"A", "B"}
assert all(c["calldataVerifiedAgainstOriginalJSON"] and c["finalizedSuccessVerified"] for c in readback["checks"])
config = snapshot["config"]
assert "predecessor" not in config and config["legacy_ledgers"] == []
assert config == validation["deployment"]["constructor"]
case_ids = ["pr-27-dfe76b37c950-d08c386809b2", "pr-29-574730b7e55c-9f1a7872c261"]
assert snapshot["order"] == {"items": case_ids, "total": 2, "next_offset": None}
rows = {r["id"]: r for r in snapshot["rows"]}
assert rows[case_ids[0]]["status"] == "rejected"
assert all(r["round"] == 0 and r["challenges"] == [] for r in rows.values())
assert all(r["adjudication_started_round"] == 0 for r in rows.values())
assert all(r["adjudication_finished_round"] == 0 for r in rows.values())
evidence = [json.loads((PROVENANCE / (c + ".registration-source.json")).read_text()) for c in ["A", "B"]]
parsed = [json.loads(e["evidenceJSON"]) for e in evidence]
assert len({e["statement_hash"] for e in parsed}) == 2
assert len({e["bundle_hash"] for e in parsed}) == 2
assert all(e["dependencies"] == [] and e["related_contributions"] == [] for e in parsed)
assert all(e["protocol_commit"] in ["421740e654a18f730a07abb6bb3ed3112f5fef7a", "7669a2cdd54dee1f828f02f86723b4d5ff526075"] for e in parsed)

results = []
for case, original, e in zip(["A", "B"], evidence, parsed):
    key = e["id"]
    check = next(c for c in validation["checks"] if c["case"] == case)
    assert check["originalEvidenceMatchesCalldata"] and check["evidenceMatchesNativeRecord"]
    assert sha(original["evidenceJSON"].encode()) == rows[key]["digest"] == check["evidenceSha256"]
    assert e == rows[key]["evidence"]
    for field in ["pr", "github_author_id", "github_account_created_at", "claim_comment_id"]:
        assert type(e[field]) is int
    env = {
        "json": json,
        "self": SimpleNamespace(get_config=lambda: config, policy=config["policy"]),
        "e": e,
        "key": key,
        "r": {"challenges": []},
        "prior": [],
        "challenged": False,
        "previous_verdict": None,
        "content_ceiling": None,
    }
    exec(compiled, env)
    prompt = env["prompt"]
    data = json.loads(env["data"])
    assert type(data["submission"]["pr"]) is int
    assert all(field not in data["submission"] for field in env["identity_fields"])
    assert data["previous_verdict"] is None and data["content_merit_ceiling"] is None
    assert data["allowed_evidence_refs"] == [key, "historical-ledger"]
    out = ROOT / "inputs" / (case + ".prompt.txt")
    out.parent.mkdir(exist_ok=True)
    out.write_bytes(prompt.encode("utf-8"))
    (ROOT / "inputs" / (case + ".data.json")).write_bytes(env["data"].encode("utf-8"))
    results.append({
        "case": case,
        "id": key,
        "prompt_file": "inputs/" + case + ".prompt.txt",
        "data_file": "inputs/" + case + ".data.json",
        "prompt_utf8_bytes": len(prompt.encode()),
        "prompt_sha256": sha(prompt.encode()),
        "data_sha256": sha(env["data"].encode()),
        "registration_evidence_sha256": check["evidenceSha256"],
        "numeric_type_check": "Original registration JSON integers preserved; submission.pr is an integer in the prompt JSON.",
        "identity_fields_removed": env["identity_fields"],
        "prompt_expression_source_lines": {name: assignments[name].lineno for name in names},
    })
manifest = {
    "capture_kind": "exact reconstructed contract-level first-round prompt string",
    "raw_provider_wire_capture": False,
    "provider_system_messages_or_wrapping_captured": False,
    "model_called_by_reconstruction": False,
    "response_format_argument": "json",
    "chain_id": readback["chainId"],
    "native_registration_receipts_checked_directly": True,
    "provenance_files": ["provenance/native-context-snapshot.json", "provenance/native-register-receipt-readback.json", "provenance/registration-validation.json", "provenance/A.registration-source.json", "provenance/B.registration-source.json", "provenance/A.register-receipt-verification.json", "provenance/B.register-receipt-verification.json", "provenance/deployment-contract-source.py", "provenance/native-contract-source.py"],
    "source_sha256": sha(source),
    "source_same_at_protocol_commits": ["421740e654a18f730a07abb6bb3ed3112f5fef7a", "7669a2cdd54dee1f828f02f86723b4d5ff526075"],
    "serializer": "Python json.dumps(sort_keys=True), all other arguments at defaults, as executed by the deployed contract expression; UTF-8 output, no added trailing newline.",
    "cases": results,
    "baseline_input_rule": "Give each baseline evaluator only its inputs/<case>.prompt.txt; never include this manifest, provenance, current ledger status, previous evaluations or native outcomes.",
    "field_proofs": {
        "objective": "Exact constructor calldata parsed from deploy.json matches immutable native get_config.objective.",
        "policy": "Exact constructor calldata policy matches native get_config.policy and each original registration policy.",
        "submission": "Exact original register calldata string equals archived evidenceJSON, its SHA-256 equals native record.digest, and parsed values equal native record.evidence. The deployed AST removes exactly six identity fields.",
        "prior": "The complete append-only registration order contains A then B only. A has never been credited: its terminal round-zero rejected state cannot follow credited under this contract. Each submission has empty dependencies and related_contributions. Therefore no credited prior record exists at either initial adjudication.",
        "historical_ledger_references": "Constructor legacy_ledgers is the empty list; config has no predecessor and matches native get_config.",
        "allowed_evidence_refs": "Executed original AST expression using proved empty prior and challenges yields [submission ID, historical-ledger]. The historical-ledger label is preserved even with empty history.",
        "required_submission_reference": "Exact registration ID bound by native evidence digest and calldata.",
        "challenges": "Native records remain in round zero with empty append-only challenge lists; register initializes them empty and challenge only appends and increments round.",
        "challenged": "False for the first adjudication: register sets status=submitted, begin_adjudication preserves it, and no round-zero challenge exists.",
        "previous_verdict": "Null at the first adjudication: register initializes verdict=None and successful adjudication is the first code path that assigns its verdict. No challenges or prior round exist.",
        "content_merit_ceiling": "Null: fresh constructor has no predecessor; A and B are the only registered records and have distinct bundle and statement hashes. _claim_content creates prior=None and accepted=None for each new content key; begin_adjudication changes only round/pending before the first prompt.",
    },
    "limits": [
        "This reconstructs the exact string passed to gl.nondet.exec_prompt; it does not claim to recover provider request bytes, hidden system messages, model settings or runtime-injected wrapping.",
        "Native snapshot reads are sequential latest-final reads, not an atomic historical snapshot. Constructor invariants, append-only order, terminal status and round-zero history establish the needed pre-verdict values.",
        "This is an engineering reconstruction, not an independent mathematical evaluation and not a new consensus attempt.",
    ],
}
(ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"capture_kind": manifest["capture_kind"], "cases": results}, indent=2))
