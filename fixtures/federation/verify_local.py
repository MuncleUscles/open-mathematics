#!/usr/bin/env python3
"""Run the reviewed isolated verifier; never execute submitted Lean on host.

The resulting wrapper is explicitly local, unpublished verification evidence.
It does not attest a PR, accepted dependency, ledger award, or identity claim.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import types

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.dont_write_bytecode = True
sys.path[:0] = [str(ROOT / 'scripts'), str(ROOT / 'lean')]
from verify_full_lean import verify


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('case', choices=['A', 'B', 'C.local'])
    args = p.parse_args()
    policy = HERE / 'verification/policy.local.json'
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    v = types.SimpleNamespace(
        policy=str(policy), policy_hash=hashlib.sha256(policy.read_bytes()).hexdigest(),
        bundle=str(HERE / 'bundles' / (args.case + '.json')),
        dependencies=str(HERE / 'verification/dependencies.local.json') if args.case == 'C.local' else None,
        repository='MuncleUscles/p-vs-np', head=revision, base=revision,
        protocol_commit=revision, lean=None, syntax_only=False,
    )
    status = 0
    try:
        result = verify(v)
    except Exception as error:
        result = {'result': 'fail', 'verified': False, 'error': str(error)}
        status = 1
    wrapped = {
        'scope': 'LOCAL UNPUBLISHED PROOF FIXTURE',
        'ledger_accepted': False,
        'external_wallet_bound': False,
        'native_consensus_observed': False,
        'commit_binding_note': 'head/base identify the verifier checkout only; candidate bytes are uncommitted fixture inputs.',
        'dependency_note': 'C uses an explicit local fixture ID. Bind the actual accepted B ID and reverify before submission.',
        'case': args.case,
        'verifier_checkout_commit': revision,
        'trusted_image': os.environ.get('TRUSTED_LEAN_IMAGE'),
        'verifier_report': result,
    }
    output = HERE / 'verification' / (args.case.split('.')[0] + '.local-verification.json')
    output.write_text(json.dumps(wrapped, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'case': args.case, 'result': result.get('result'),
                      'error': result.get('error'), 'report': str(output)}, indent=2))
    return status


if __name__ == '__main__':
    raise SystemExit(main())
