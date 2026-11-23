"""Reviewed, exact-hash historical proof ports; never alter mathematical claims.

The submitted bytes, bundle identity and reported proof_hash remain original.
Only the compiler's copied proof text changes, and the evidence discloses both
proof hashes plus this manifest's hash. Every port still passes all six kernels.
"""
import json
from pathlib import Path
from problem_check import require, sha, parse_policy

MANIFEST_BYTES = Path(__file__).with_suffix('.json').read_bytes()
MANIFEST_HASH = sha(MANIFEST_BYTES)
MANIFEST = json.loads(MANIFEST_BYTES)
require(set(MANIFEST) == {'version', 'adapters'} and MANIFEST['version'] == 1, 'Legacy adapter manifest version')
ADAPTERS = {entry['bundle_hash']: entry for entry in MANIFEST['adapters']}
require(len(ADAPTERS) == len(MANIFEST['adapters']), 'Duplicate historical adapter')


def compilation_bundle(item):
    bundle = item['bundle']
    adapter = ADAPTERS.get(item['bundle_hash']) if bundle['version'] == 1 else None
    if adapter is None:
        return bundle, None
    require(sha(item['bytes']) == item['bundle_hash'] and parse_policy(item['bytes']) == bundle,
            'Historical port requires exact original bundle bytes')
    require(adapter['original_toolchain'] == 'lean4:4.19.0' and adapter['target_toolchain'] == 'lean4:4.36.0',
            'Historical port toolchain mismatch')
    require(sha(bundle['proof'].encode()) == adapter['original_proof_hash'], 'Historical proof hash mismatch')
    proof = bundle['proof']
    for replacement in adapter['replacements']:
        require(proof.count(replacement['old']) == 1, 'Historical proof port patch mismatch')
        proof = proof.replace(replacement['old'], replacement['new'])
    require(sha(proof.encode()) == adapter['compiled_proof_hash'], 'Compiled historical proof hash mismatch')
    compiled = {**bundle, 'proof': proof}
    require({k: v for k, v in compiled.items() if k != 'proof'} ==
            {k: v for k, v in bundle.items() if k != 'proof'}, 'Historical mathematical claim changed')
    report = {key: adapter[key] for key in ['original_proof_hash', 'compiled_proof_hash', 'reason']}
    return compiled, {'version': 1, **report, 'manifest_hash': MANIFEST_HASH}


def applied_adapters(items):
    reports = {}
    for item in items:
        _, report = compilation_bundle(item)
        if report is not None: reports[item['bundle_hash']] = report
    return reports
