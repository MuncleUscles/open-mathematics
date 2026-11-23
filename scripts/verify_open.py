#!/usr/bin/env python3
"""Isolated open-research bundle checker. Local/syntax modes never attest truth."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import signal
import time
import subprocess
import sys
import tempfile
ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'lean'))
from problem_check import COMMIT, REPOSITORY, SLUG, require, sha, parse_policy
from open_check import MAX_BUNDLE, bounded_file, assemble_checked, namespace, statement_hash, assembly_hash
from verify_problem import docker_command, VERSION, MAX_LOG


def policy_input(args):
    data = bounded_file(args.policy, 65536)
    require(sha(data) == args.policy_hash, 'Open policy hash mismatch')
    policy = parse_policy(data)
    require(set(policy) == {'version', 'problem', 'repository', 'branch', 'objective', 'toolchain', 'allowed_axioms', 'admission', 'notes'} and type(policy['version']) is int and policy['version'] == 5, 'Exact v5 open policy required')
    require(SLUG.fullmatch(policy['problem']) and REPOSITORY.fullmatch(policy['repository']) and policy['branch'] == 'research' and policy['admission'] == 'open', 'Open policy identity required')
    require(policy['toolchain'] == 'lean4:4.19.0' and policy['allowed_axioms'] == ['propext', 'Quot.sound'], 'Pinned toolchain and restricted axioms required')
    require(isinstance(policy['objective'], str) and 20 <= len(policy['objective']) <= 2000 and isinstance(policy['notes'], str) and len(policy['notes']) <= 2000, 'Bounded policy description required')
    require(policy['repository'] == args.repository, 'Repository binding mismatch')
    return data, policy


def bounded_process(command, timeout=45, env=None, cwd=None):
    """Bound both streams separately: an audit can never be supplied on stderr."""
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True, env=env, cwd=cwd)
    deadline, streams, size = time.monotonic() + timeout, {1: [], 2: []}, 0
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, 1)
            selector.register(process.stderr, selectors.EVENT_READ, 2)
            while selector.get_map():
                require(time.monotonic() < deadline, 'Verifier process timed out')
                for key, _ in selector.select(min(0.1, max(0, deadline - time.monotonic()))):
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        selector.unregister(key.fileobj); continue
                    size += len(chunk); require(size <= MAX_LOG, 'Verifier output exceeded bound')
                    streams[key.data].append(chunk)
        status = process.wait(timeout=max(0.01, deadline - time.monotonic()))
        return status, b''.join(streams[1]).decode('utf-8', errors='strict'), b''.join(streams[2]).decode('utf-8', errors='strict')
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=5)
        process.stdout.close(); process.stderr.close()


def audit(log, root, artifacts, order, allowed, nonce):
    prefix = 'OPEN_RESEARCH_AUDIT:' + nonce + ':'
    lines = log.splitlines()
    require(len(lines) == 1 and lines[0].startswith(prefix), 'Exactly one nonce-bound machine audit required')
    def pairs(items):
        out = {}
        for key, value in items:
            require(key not in out, 'Duplicate machine audit key'); out[key] = value
        return out
    report = json.loads(lines[0][len(prefix):], object_pairs_hook=pairs)
    require(isinstance(report, dict) and set(report) == {'declarations', 'used'} and isinstance(report['declarations'], list), 'Exact machine audit required')
    expected = [namespace(item['bundle_hash']) + '.' + name
                for item in [artifacts[key] for key in order] + [root]
                for name in [d['name'] for d in item['bundle']['definitions']] + ['result']]
    reports = {}
    for row in report['declarations']:
        require(isinstance(row, dict) and set(row) == {'constant', 'axioms'} and row['constant'] in expected and row['constant'] not in reports, 'Unexpected or repeated declaration audit')
        axioms = row['axioms']
        require(isinstance(axioms, list) and all(isinstance(a, str) for a in axioms) and len(axioms) == len(set(axioms)) and set(axioms) <= set(allowed), 'Unauthorized axiom in bundle closure')
        reports[row['constant']] = axioms
    require(set(reports) == set(expected), 'Every declaration must be audited')
    used = report['used']; direct = [d['id'] for d in root['bundle']['dependencies']]
    require(isinstance(used, list) and all(isinstance(key, str) and key in direct for key in used) and len(used) == len(set(used)), 'Invalid direct dependency inspection output')
    return reports, used


def verify(args):
    for key in ['head', 'base', 'protocol_commit']:
        require(COMMIT.fullmatch(getattr(args, key)), 'Exact commit bindings required')
    require(REPOSITORY.fullmatch(args.repository), 'Repository binding required')
    policy_bytes, policy = policy_input(args)
    raw = bounded_file(args.bundle, MAX_BUNDLE)
    manifest = bounded_file(args.dependencies, 32768) if args.dependencies else b'{\n  "version": 1,\n  "artifacts": []\n}\n'
    nonce = secrets.token_hex(16)
    sources, root, artifacts, order = assemble_checked(raw, manifest, nonce)
    isolated = not args.lean and not args.syntax_only
    image = os.environ.get('TRUSTED_LEAN_IMAGE', '') if isolated else None
    log, reports, used = '', {}, []
    if not args.syntax_only:
        with tempfile.TemporaryDirectory(prefix='open-math-bundle-') as directory:
            directory = Path(directory); directory.chmod(0o755)
            for name, data in sources.items():
                file = directory / name; file.write_bytes(data); file.chmod(0o644)
            if isolated:
                command = docker_command(directory, directory.name, image)
                command.insert(2, '--platform=linux/amd64')
                command[-1] = 'lean --version && lean --root=/input --trust=0 -DmaxHeartbeats=100000 -o /tmp/Candidate.olean /input/Candidate.lean && LEAN_PATH=/tmp exec lean --root=/input --trust=0 -DmaxHeartbeats=100000 /input/Check.lean'
                try:
                    code, log, errors = bounded_process(command)
                finally:
                    try:
                        subprocess.run(['docker', 'rm', '--force', directory.name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)
                    except (OSError, subprocess.SubprocessError): pass
                version, separator, log = log.partition('\n')
                require(separator and VERSION.match(version), 'Isolated toolchain mismatch')
            else:
                code, version, errors = bounded_process([args.lean, '--version'], timeout=10)
                require(code == 0 and not errors and VERSION.match(version.strip()), 'Exact Lean4.19.0 required')
                local_env = {**os.environ, 'LEAN_PATH': str(directory)}
                code, log, errors = bounded_process([args.lean, '--trust=0', '-DmaxHeartbeats=100000', '-o', str(directory / 'Candidate.olean'), str(directory / 'Candidate.lean')], env=local_env, cwd=directory)
                require(code == 0 and not log and not errors, 'Lean rejected candidate: ' + (log + errors)[:2400])
                code, log, errors = bounded_process([args.lean, '--trust=0', '-DmaxHeartbeats=100000', str(directory / 'Check.lean')], env=local_env, cwd=directory)
            require(code == 0 and not errors and not any(word in log for word in ['warning:', 'error:', 'sorry']), 'Lean rejected bundle audit: ' + (log + errors)[:2400])
            reports, used = audit(log, root, artifacts, order, policy['allowed_axioms'], nonce)

    verified = [{'id': key, 'artifact_hash': artifacts[key]['artifact_hash'], 'proof_body_use': True,
                 'constant': namespace(artifacts[key]['bundle_hash']) + '.result'} for key in used]
    return {'result': 'syntax-pass' if args.syntax_only else 'pass',
            'mode': 'syntax-only' if args.syntax_only else ('isolated' if isolated else 'local-diagnostic'),
            'verified': isolated, 'production_verified': isolated,
            'verification': 'syntax-only' if args.syntax_only else ('verified' if isolated else 'diagnostic-only'),
            'checker': 'open-mathematics-v5', 'problem': policy['problem'], 'repository': args.repository,
            'head': args.head, 'base': args.base, 'protocol_commit': args.protocol_commit, 'policy': sha(policy_bytes),
            'toolchain': policy['toolchain'], 'image': image, 'bundle_hash': root['bundle_hash'],
            'statement_hash': statement_hash(root['bundle']), 'proposition_hash': sha(root['bundle']['statement'].strip().encode()),
            'artifact_hash': root['bundle_hash'], 'assembly_hash': assembly_hash(sources), 'formal_statement': root['bundle']['statement'],
            'proof_hash': sha(root['bundle']['proof'].encode()), 'theorem': namespace(root['bundle_hash']) + '.result',
            'axioms': reports.get(namespace(root['bundle_hash']) + '.result', []), 'declaration_axioms': reports,
            'sorry': False, 'proof_body_uses': used, 'verified_dependencies': verified,
            'dependency_bundle_hashes': {key: artifacts[key]['bundle_hash'] for key in order},
            'dependency_artifact_hashes': {key: artifacts[key]['artifact_hash'] for key in order},
            'log': log, 'reuse_limit': 'Direct theorem references surviving implemented reductions only; not complete dead-branch elimination, necessity, novelty, independence or a point allocation.',
            'commit_binding': 'Trusted caller resolves immutable accepted records and Git commits; this checker binds their identifiers and exact bytes.'}


def arguments():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('bundle_positional', nargs='?'); p.add_argument('--bundle', dest='bundle_option')
    for flag in ['policy', 'policy-hash', 'head', 'base', 'protocol-commit', 'repository']:
        p.add_argument('--' + flag, required=True)
    p.add_argument('--dependencies'); p.add_argument('--output')
    mode = p.add_mutually_exclusive_group(); mode.add_argument('--lean', metavar='EXECUTABLE'); mode.add_argument('--syntax-only', action='store_true')
    args = p.parse_args()
    p.error('Provide one positional BUNDLE or --bundle FILE') if bool(args.bundle_positional) == bool(args.bundle_option) else None
    args.bundle = args.bundle_positional or args.bundle_option
    return args


def main():
    args, output = arguments(), None
    try:
        if args.output:
            output = Path(args.output).absolute()
            require(output.suffix == '.json' and output.parent.is_dir() and not output.is_symlink() and (not output.exists() or output.is_file()), 'Regular result JSON path required')
            inputs = [args.bundle, args.policy] + ([args.dependencies] if args.dependencies else [])
            require(output.resolve() not in [Path(p).resolve() for p in inputs], 'Result cannot replace an input')
            require(not output.resolve().is_relative_to(ROOT) or output.resolve().is_relative_to(ROOT / '.data'), 'Protocol results must stay under .data')
            output.unlink(missing_ok=True)
        result = verify(args); encoded = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
        if output:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', prefix='.open-result-', dir=output.parent, delete=False) as file:
                file.write(encoded); file.flush(); os.fsync(file.fileno()); temporary = Path(file.name)
            temporary.replace(output)
        print(encoded, end=''); return 0
    except (OSError, ValueError, TypeError, KeyError, RecursionError, subprocess.SubprocessError) as error:
        print(json.dumps({'result': 'fail', 'checker': 'open-mathematics-v5', 'verified': False, 'production_verified': False, 'verification': 'failed', 'error': str(error)[:2800]})); return 1

if __name__ == '__main__':
    raise SystemExit(main())
