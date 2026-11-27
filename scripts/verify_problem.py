#!/usr/bin/env python3
"""Generic pinned-problem verifier; production uses isolated Lean, never PR scripts.

--lean is explicitly unisolated diagnostics and cannot produce verified evidence.
The trusted caller resolves immutable Git/PR commits; this process binds their
identifiers and verifies actual policy, closure, theorem and proof byte hashes.
"""
import argparse
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'lean'))
from problem_check import COMMIT, REPOSITORY, MAX_PROOF, assemble, load_policy, proposition_text, require, sha

MAX_LOG = 65536
VERSION = re.compile(r'^Lean \(version 4\.19\.0(?:,|\))')


def bounded_process(command, timeout=45):
    """Drain both pipes without unbounded subprocess capture_output allocation."""
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    deadline, chunks, size = time.monotonic() + timeout, [], 0
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            selector.register(process.stderr, selectors.EVENT_READ)
            while selector.get_map():
                require(time.monotonic() < deadline, 'Verifier process timed out')
                for key, _ in selector.select(min(0.1, max(0, deadline - time.monotonic()))):
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    size += len(chunk)
                    require(size <= MAX_LOG, 'Verifier output exceeded bound')
                    chunks.append(chunk)
        status = process.wait(timeout=max(0.01, deadline - time.monotonic()))
        return status, b''.join(chunks).decode('utf-8', errors='strict')
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
        process.stdout.close()
        process.stderr.close()


def axiom_report(log, allowed):
    reports = list(re.finditer(r"^'candidate' (?:depends on axioms: \[(.*?)\]|does not depend on any axioms)$", log, re.M))
    require(len(reports) == 1, 'Exactly one candidate axiom report required')
    values = [x.strip() for x in (reports[0].group(1) or '').split(',') if x.strip()]
    require(set(values) <= set(allowed), 'Unauthorized candidate axiom')
    return values


def docker_command(directory, name, image):
    require(re.fullmatch(r'(?:[A-Za-z0-9][A-Za-z0-9./:_-]*@)?sha256:[a-f0-9]{64}', image), 'Pinned isolated verifier image required')
    return ['docker', 'run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only',
            '--cap-drop=ALL', '--security-opt=no-new-privileges', '--cpus=1', '--memory=1g', '--memory-swap=1g',
            '--pids-limit=32', '--ulimit=nofile=64:64', '--ulimit=fsize=1048576:1048576', '--user=65534:65534',
            '--tmpfs=/tmp:rw,noexec,nosuid,size=32m', '-v', str(directory) + ':/input:ro', image,
            'sh', '-c', 'lean --version && exec lean --trust=0 -DmaxHeartbeats=100000 /input/Check.lean']


def verify(args):
    for name in ['head', 'base', 'problem_commit', 'protocol_commit']:
        require(COMMIT.fullmatch(getattr(args, name)), 'Exact commit identifiers required')
    require(REPOSITORY.fullmatch(args.repository), 'Repository binding required')
    policy, goal, policy_bytes, inputs = load_policy(args.problem_root, args.policy, args.policy_hash, args.goal)
    require(args.repository == policy['repository'], 'Repository differs from selected policy')
    proof_file = Path(args.proof)
    require(proof_file.is_file() and not proof_file.is_symlink() and proof_file.stat().st_size <= MAX_PROOF, 'Bounded regular proof file required')
    proof = proof_file.read_bytes()
    require(len(proof) <= MAX_PROOF, 'Proof grew beyond bound')
    source = assemble(policy, goal, inputs, proof)
    isolated = args.lean is None
    image = os.environ.get('TRUSTED_LEAN_IMAGE', '') if isolated else None
    with tempfile.TemporaryDirectory(prefix='open-math-problem-') as directory:
        directory = Path(directory)
        file = directory / 'Check.lean'
        file.write_bytes(source)
        directory.chmod(0o755)
        file.chmod(0o644)
        name = directory.name
        if isolated:
            command = docker_command(directory, name, image)
        else:
            version_status, version = bounded_process([args.lean, '--version'], timeout=10)
            require(version_status == 0 and VERSION.match(version.strip()), 'Exact Lean4.19.0 required')
            command = [args.lean, '--trust=0', '-DmaxHeartbeats=100000', str(file)]
        try:
            status, log = bounded_process(command)
        finally:
            if isolated:
                # A timed-out Docker client must not leave the verifier container alive.
                try:
                    subprocess.run(['docker', 'rm', '--force', name], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=10, check=False)
                except (OSError, subprocess.SubprocessError):
                    pass
        if isolated:
            first = log.splitlines()[0] if log.splitlines() else ''
            require(VERSION.match(first), 'Isolated toolchain version mismatch')
        require(status == 0 and not any(x in log for x in ['warning:', 'error:', 'sorry']), 'Lean rejected candidate: ' + log[:2000])
        axioms = axiom_report(log, policy['allowed_axioms'])
    return {'result': 'pass', 'mode': 'isolated' if isolated else 'local-diagnostic',
            'production_verified': isolated, 'verified': isolated, 'verification': 'verified' if isolated else 'diagnostic-only',
            'checker': 'open-mathematics-v4', 'repository': args.repository, 'head': args.head, 'base': args.base,
            'problem': policy['problem'], 'problem_commit': args.problem_commit, 'protocol_commit': args.protocol_commit,
            'policy': sha(policy_bytes), 'goal': args.goal, 'goal_hash': goal['goal_hash'], 'statement_hash': goal['statement_hash'],
            'proposition_hash': sha(proposition_text(goal).encode()), 'formal_statement': goal['statement'], 'toolchain': policy['toolchain'], 'theorem': goal['theorem'],
            'theorems': [goal['theorem']], 'proof_hash': sha(proof), 'artifact_hash': sha(source),
            'source_hashes': {file: sha(inputs[file]) for file in goal['definition_files']},
            'policy_source_hashes': {file: sha(data) for file, data in inputs.items()},
            'rewardable': goal['rewardable'], 'axioms': axioms, 'sorry': False, 'proof_body_uses': [],
            'dependency_artifact': None, 'image': image, 'log': log,
            'commit_binding': 'Identifiers supplied by trusted caller; immutable Git/PR resolution is external to this checker.'}


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('proof')
    p.add_argument('--problem-root', required=True)
    p.add_argument('--policy', required=True)
    p.add_argument('--policy-hash', required=True)
    p.add_argument('--goal', required=True)
    for name in ['head', 'base', 'problem-commit', 'protocol-commit', 'repository']:
        p.add_argument('--' + name, required=True)
    p.add_argument('--lean', metavar='EXECUTABLE', help='Explicit unisolated local diagnostic only; never verified evidence')
    p.add_argument('--output', help='Optional result JSON outside the problem checkout; replaced only on success')
    return p


def prepare_output(args):
    if not args.output:
        return None
    file = Path(args.output).absolute()
    require(file.suffix == '.json' and not file.is_symlink() and file.parent.is_dir(), 'Regular JSON output path required')
    destination = file.resolve()
    require(not destination.is_relative_to(Path(args.problem_root).resolve()), 'Result must be outside trusted problem checkout')
    require(destination != Path(args.proof).resolve(), 'Result cannot overwrite proof input')
    require(not destination.is_relative_to(ROOT) or destination.is_relative_to(ROOT / '.data'), 'Protocol results must stay under .data')
    require(not file.exists() or file.is_file(), 'Regular output file required')
    file.unlink(missing_ok=True)  # Never leave stale successful evidence after failure.
    return file


def main():
    args = parser().parse_args()
    try:
        output = prepare_output(args)
        evidence = verify(args)
        encoded = json.dumps(evidence, ensure_ascii=False, indent=2) + '\n'
        if output:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=output.parent, prefix='.problem-result-', delete=False) as file:
                file.write(encoded)
                file.flush()
                os.fsync(file.fileno())
                temporary = Path(file.name)
            temporary.replace(output)
        print(encoded, end='')
        return 0
    except (OSError, ValueError, TypeError, KeyError, RecursionError, subprocess.SubprocessError) as error:
        print(json.dumps({'result': 'fail', 'mode': 'local-diagnostic' if args.lean else 'isolated',
                          'verified': False, 'production_verified': False, 'verification': 'failed',
                          'checker': 'open-mathematics-v4', 'error': str(error)[:2400]}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
