#!/usr/bin/env python3
"""Verify reviewed local proposal inputs; never a production PR admission gate."""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
EVIDENCE = ROOT / 'evidence.json'
INPUTS = ('Trusted.lean', 'ProposedStatement.lean', 'candidate.proof', 'BoundaryChecks.lean')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def assemble_proposal(statement, proof, boundaries):
    # These exact byte buffers are both executed and hashed. A former standalone
    # ReferenceCheck.lean is deliberately not read or trusted as a substitute.
    return (statement + b'\n\ntheorem candidate : DisjointSAT := ' + proof +
            b'\nexample : DisjointSAT := candidate\n#print axioms candidate\n\n' + boundaries)


def repository_revision():
    try:
        root = subprocess.run(['git', '-C', str(REPO), 'rev-parse', '--show-toplevel'],
                              capture_output=True, text=True, check=True, timeout=10)
        if Path(root.stdout.strip()).resolve() != REPO:
            return None
        return subprocess.run(['git', '-C', str(REPO), 'rev-parse', 'HEAD'],
                              capture_output=True, text=True, check=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None  # A source archive need not contain Git metadata.


def verify():
    lean = os.environ.get('LEAN_BIN') or 'lean'
    version_run = subprocess.run([lean, '--version'], text=True, capture_output=True,
                                 check=True, timeout=10)
    version = version_run.stdout.strip()
    require(re.match(r'^Lean \(version 4\.19\.0(?:,|\))', version) is not None,
            'Exact Lean 4.19.0 required; received: ' + version)
    inputs = {name: (ROOT / name).read_bytes() for name in INPUTS}
    for name, data in inputs.items():
        data.decode('utf-8', errors='strict')
        require(len(data) <= 16000, 'Oversized local proposal input: ' + name)
    production_trusted = (REPO / 'lean/Trusted.lean').read_bytes()
    require(inputs['Trusted.lean'] == production_trusted, 'Copied trusted foundations differ from repository')
    require(inputs['ProposedStatement.lean'].startswith(production_trusted + b'\n'),
            'Proposed statement must start with unchanged trusted foundations')
    source = assemble_proposal(inputs['ProposedStatement.lean'], inputs['candidate.proof'],
                               inputs['BoundaryChecks.lean'])
    # This is a reviewed local reference, not a sandbox for untrusted Lean code.
    with tempfile.TemporaryDirectory(prefix='.lean-check-', dir=ROOT) as temporary:
        file = Path(temporary) / 'Check.lean'
        file.write_bytes(source)
        run = subprocess.run([lean, '--trust=0', '-DmaxHeartbeats=100000', str(file)],
                             text=True, capture_output=True, timeout=45)
    log = run.stdout + run.stderr
    require(run.returncode == 0 and not any(x in log for x in ['warning:', 'error:', 'sorryAx']),
            'Lean rejected the assembled proposal:\n' + log[:4000])
    reports = re.findall(r"^'candidate' depends on axioms: \[(.*?)\]$", log, re.M)
    require(len(reports) == 1, 'Exactly one candidate axiom report is required')
    axioms = [item.strip() for item in reports[0].split(',') if item.strip()]
    require(set(axioms) <= {'propext', 'Quot.sound'}, 'Unauthorized candidate axioms: ' + repr(axioms))
    sys.path.insert(0, str(REPO / 'lean'))
    from check import assemble, validate_expression
    proof = inputs['candidate.proof'].decode('utf-8')
    policy_bytes = (REPO / 'lean/policy.json').read_bytes()
    policy = json.loads(policy_bytes)
    require('disjoint_sat' not in policy['goals'], 'Goal is already enrolled; this proposal check must be reviewed')
    try:
        assemble(proof, 'disjoint_sat')
    except ValueError as error:
        goal_rejection = str(error)
    else:
        raise ValueError('Production assembler unexpectedly admitted an unenrolled goal')
    try:
        validate_expression(proof)
    except ValueError as error:
        syntax_rejection = str(error)
    else:
        raise ValueError('Production grammar unexpectedly admitted the proposed proof; review this check')
    return {
        'status': 'pass',
        'scope': 'reviewed local statement, proof and boundary checks only; not isolated CI, adjudication or enrollment',
        'reviewed_repository_commit': repository_revision(),
        'toolchain': version, 'kernel_trust': 0, 'max_heartbeats': 100000,
        'assembled_source_sha256': sha(source), 'assembled_source_bytes': len(source),
        'reference_exit_code': run.returncode, 'axioms': axioms, 'log': log,
        'checks': ['exact candidate : DisjointSAT', 'empty CNF satisfiable', 'empty clause unsatisfiable',
                   'opposite unit clauses individually satisfiable', 'their concatenation unsatisfiable',
                   'same-sign overlap satisfiable and not variable-disjoint'],
        'current_goal_rejection': goal_rejection, 'current_syntax_rejection': syntax_rejection,
        'files': {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in inputs.items()},
        'active_policy_sha256': sha(policy_bytes),
    }


def main():
    # A failure must never leave an earlier success looking like current evidence.
    EVIDENCE.unlink(missing_ok=True)
    try:
        evidence = verify()
        encoded = json.dumps(evidence, indent=2) + '\n'
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', prefix='.evidence-',
                                         dir=ROOT, delete=False) as temporary:
            temporary.write(encoded)
            temporary_path = Path(temporary.name)
        temporary_path.replace(EVIDENCE)
        print(encoded, end='')
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print('Proposal verification failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
