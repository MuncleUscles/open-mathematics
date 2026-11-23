#!/usr/bin/env python3
"""Verify full Lean/Mathlib bundles using separate hostile and trusted containers.

No candidate compiled object, process output claiming success, or PR build script
is trusted. Only bounded serialized proofs cross from compilation into fresh
kernel containers and the data-only semantic audit. There is no unsandboxed mode.
"""
import hashlib
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
from problem_check import COMMIT, REPOSITORY, SLUG, require, sha, parse_policy, stable_json
from open_check import bounded_file, MAX_BUNDLE
from full_lean.bundle import TOOLCHAIN, MATHLIB_COMMIT, ALLOWED_AXIOMS, load_closure, assemble, theorem
from full_lean.export import MAX_EXPORT, unique

LEAN_COMMIT = '611c117bfaf7b7ae1cfcf246ce6fba31e8f509e9'
CHECKERS = ['leanchecker', 'leanchecker-paranoid', 'lean4lean', 'nanoda', 'con-leche', 'con-ron']
PRIMITIVES = ['Nat.add', 'Nat.sub', 'Nat.mul', 'Nat.pow', 'Nat.gcd', 'Nat.div', 'Nat.mod',
              'Nat.beq', 'Nat.ble', 'Nat.land', 'Nat.lor', 'Nat.xor', 'Nat.shiftLeft',
              'Nat.shiftRight', 'String.ofList', 'Char.ofNat', 'List', 'eagerReduce',
              'Nat', 'String', 'String.mk', 'Char', 'optParam', 'autoParam', 'semiOutParam',
              'outParam', 'Quot', 'Quot.mk', 'Quot.lift', 'Quot.ind']
MAX_LOG = 32768
TOTAL_TIMEOUT = 1100
MAX_TOTAL_EXPORT = 512 * 1024 * 1024


def policy_input(args):
    raw = bounded_file(args.policy, 65536)
    require(sha(raw) == args.policy_hash, 'Full Lean policy hash mismatch')
    policy = parse_policy(raw)
    require(set(policy) == {'version', 'problem', 'repository', 'branch', 'objective', 'toolchain',
                           'allowed_axioms', 'admission', 'notes', 'mathlib', 'checker'}
            and type(policy['version']) is int and policy['version'] == 6, 'Exact v6 policy required')
    require(isinstance(policy['problem'], str) and SLUG.fullmatch(policy['problem'])
            and policy['repository'] == args.repository and policy['branch'] == 'research'
            and policy['admission'] == 'open', 'Open policy identity mismatch')
    require(policy['toolchain'] == TOOLCHAIN and policy['allowed_axioms'] == ALLOWED_AXIOMS
            and policy['checker'] == 'serialized-kernels-v1'
            and policy['mathlib'] == {'repository': 'leanprover-community/mathlib4', 'commit': MATHLIB_COMMIT},
            'Pinned compiler, Mathlib, axioms and kernel pipeline required')
    require(isinstance(policy['objective'], str) and 20 <= len(policy['objective']) <= 2000
            and isinstance(policy['notes'], str) and len(policy['notes']) <= 2000, 'Bounded policy text required')
    return raw, policy


def docker_command(directory, image, name, command, writable=False, trusted_code=False):
    require(isinstance(image, str) and re.fullmatch(r'(?:[A-Za-z0-9][A-Za-z0-9./:_-]*@)?sha256:[a-f0-9]{64}', image),
            'Pinned full Lean Docker image required')
    result = ['docker', 'run', '--rm', '--pull=never', '--platform=linux/amd64', '--name', name,
              '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
              '--cpus=2', '--memory=4g', '--memory-swap=4g', '--pids-limit=128',
              '--ulimit=nofile=1024:1024', '--ulimit=fsize=268435456:268435456', '--user=65534:65534',
              '--env=LEAN_ABORT_ON_PANIC=1', '--env=HOME=/tmp',
              # All repositories visible here belong to this reviewed read-only
              # image; input mounts contain only proof data/source, never .git.
              '--env=GIT_CONFIG_COUNT=1', '--env=GIT_CONFIG_KEY_0=safe.directory',
              '--env=GIT_CONFIG_VALUE_0=*',
              '--tmpfs=/tmp:rw,noexec,nosuid,size=256m', '-v', str(directory) + ':/input:ro']
    if writable: result += ['--tmpfs=/workspace:rw,noexec,nosuid,size=2g,mode=1777']
    if trusted_code: result += ['-v', str(ROOT / 'lean') + ':/trusted:ro']
    return result + [image] + command


def process(command, output, deadline, maximum=MAX_LOG):
    """Stream bounded stdout to a new file; stderr can never become proof data."""
    require(time.monotonic() < deadline, 'Full verifier timed out')
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    size, errors, error_size = 0, [], 0
    try:
        with open(output, 'xb') as destination, selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ, 'out')
            selector.register(child.stderr, selectors.EVENT_READ, 'err')
            while selector.get_map():
                require(time.monotonic() < deadline, 'Full verifier timed out')
                for key, _ in selector.select(0.1):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk: selector.unregister(key.fileobj); continue
                    if key.data == 'out':
                        size += len(chunk); require(size <= maximum, 'Verifier stdout exceeds bound'); destination.write(chunk)
                    else:
                        error_size += len(chunk); require(error_size <= MAX_LOG, 'Verifier stderr exceeds bound'); errors.append(chunk)
            status = child.wait(timeout=max(.01, deadline - time.monotonic()))
        require(status == 0, 'Isolated stage rejected input: ' + b''.join(errors).decode('utf-8', 'replace')[:1800])
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=5)
        child.stdout.close(); child.stderr.close()


def run_container(directory, image, command, output, deadline, maximum=MAX_LOG, writable=False, trusted_code=False):
    name = 'open-full-' + os.urandom(8).hex()
    try:
        process(docker_command(directory, image, name, command, writable, trusted_code), output, deadline, maximum)
    finally:
        try:
            subprocess.run(['docker', 'rm', '--force', name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=10, check=False)
        except (OSError, subprocess.SubprocessError): pass


def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''): h.update(chunk)
    return h.hexdigest()


def write_input(directory, name, data):
    path = directory / name
    path.write_bytes(data); path.chmod(0o444)
    return path


def link_readonly(source, destination):
    # All stages use this one private temporary filesystem. Read-only hardlinks
    # avoid multiplying a hostile export's bounded disk consumption per checker.
    source.chmod(0o444)
    os.link(source, destination)


def verify_kernels(export_path, image, directory, deadline):
    # Only serialized data/config enters these containers. There is no Candidate
    # source, .olean, .so, Lake configuration or attacker-writable shared volume.
    inputs = directory / 'kernel-input'; inputs.mkdir(mode=0o755)
    proof = inputs / 'proof.ndjson'; link_readonly(export_path, proof)
    config = {'use_stdin': False, 'export_file_path': '/input/proof.ndjson',
              'permitted_axioms': ALLOWED_AXIOMS, 'unpermitted_axiom_hard_error': True,
              'num_threads': 2, 'nat_extension': True, 'string_extension': True}
    write_input(inputs, 'nanoda.json', stable_json(config).encode())
    commands = [
        ['leanchecker', '--silent', '--from-export', '/input/proof.ndjson'],
        ['leanchecker-paranoid', '--silent', '--from-export', '/input/proof.ndjson'],
        ['lean4lean', '--import', '/input/proof.ndjson'],
        ['nanoda_bin', '/input/nanoda.json'],
        ['con-leche', '/input/proof.ndjson'], ['con-ron', '/input/proof.ndjson'],
    ]
    for index, command in enumerate(commands):
        try:
            run_container(inputs, image, ['/opt/lean/bin/' + command[0]] + command[1:],
                          directory / ('kernel-' + str(index) + '.log'), deadline)
        except ValueError as error:
            raise ValueError('Kernel ' + CHECKERS[index] + ' rejected serialized proof: ' + str(error)) from error


def export_candidate(items, image, directory, deadline, maximum=MAX_EXPORT):
    source, imports = assemble(items)
    inputs = directory / 'source-input'; inputs.mkdir(mode=0o755)
    write_input(inputs, 'Candidate.lean', source)
    targets = [theorem(item) for item in items] + PRIMITIVES + ALLOWED_AXIOMS
    # Every interpolated argument is generated from strict identifier/hash data.
    script = ('cd /opt/full-lean\n'
              'lake env lean --root=/input --trust=0 -DmaxHeartbeats=2000000 '
              '-o /workspace/Candidate.olean /input/Candidate.lean >&2\n'
              'lake env sh -eu -c \'export LEAN_PATH="/workspace:$LEAN_PATH"; '
              'exec /opt/lean/bin/leanexport Candidate -- ' + ' '.join(targets) + "'\n")
    output = directory / 'proof.ndjson'
    try:
        run_container(inputs, image, ['sh', '-eu', '-c', script], output, deadline, min(MAX_EXPORT, maximum), writable=True)
    except ValueError as error:
        raise ValueError('Compiler/exporter rejected source: ' + str(error)) from error
    verify_kernels(output, image, directory, deadline)
    return output, source, imports


def verify(args):
    for key in ('head', 'base', 'protocol_commit'):
        require(isinstance(getattr(args, key), str) and COMMIT.fullmatch(getattr(args, key)), 'Exact commit bindings required')
    require(isinstance(args.repository, str) and REPOSITORY.fullmatch(args.repository), 'Repository binding required')
    require(not getattr(args, 'lean', None), 'Full Lean has no unsandboxed execution mode')
    policy_bytes, policy = policy_input(args)
    raw = bounded_file(args.bundle, MAX_BUNDLE)
    manifest = bounded_file(args.dependencies, 32768) if args.dependencies else b'{\n  "version": 1,\n  "artifacts": []\n}\n'
    root, artifacts, order = load_closure(raw, manifest)
    source, imports = assemble([artifacts[key] for key in order] + [root])
    if getattr(args, 'syntax_only', False):
        return {'result': 'syntax-pass', 'mode': 'syntax-only', 'checker': 'open-mathematics-v5',
                'verified': False, 'production_verified': False, 'verification': 'syntax-only',
                'bundle_hash': root['bundle_hash'], 'toolchain': TOOLCHAIN,
                'note': 'Envelope validation only; no Lean source has been executed or proved.'}
    image = os.environ.get('TRUSTED_LEAN_IMAGE', '')
    deadline = time.monotonic() + TOTAL_TIMEOUT
    with tempfile.TemporaryDirectory(prefix='open-full-lean-') as temp:
        directory = Path(temp); directory.chmod(0o755)
        audit_inputs = directory / 'audit-input'; audit_inputs.mkdir(mode=0o755)
        dependency_plans, export_bytes = [], 0
        for index, key in enumerate(order):
            item = artifacts[key]
            ancestors = set()
            def collect(record):
                for pin in record['bundle']['dependencies']:
                    if pin['id'] not in ancestors:
                        ancestors.add(pin['id']); collect(artifacts[pin['id']])
            collect(item)
            items = [artifacts[k] for k in order if k in ancestors] + [item]
            stage = directory / ('dependency-' + str(index)); stage.mkdir(mode=0o755)
            path, _, _ = export_candidate(items, image, stage, deadline, MAX_TOTAL_EXPORT - export_bytes)
            export_bytes += path.stat().st_size
            filename = 'dependency-' + str(index) + '.ndjson'
            link_readonly(path, audit_inputs / filename)
            dependency_plans.append({'id': key, 'theorem': theorem(item), 'file': filename,
                                     'ancestors': [k for k in order if k in ancestors]})
        stage = directory / 'candidate'; stage.mkdir(mode=0o755)
        export_path, actual_source, _ = export_candidate([artifacts[key] for key in order] + [root], image, stage, deadline,
                                                       MAX_TOTAL_EXPORT - export_bytes)
        require(actual_source == source, 'Source assembly changed')
        link_readonly(export_path, audit_inputs / 'candidate.ndjson')
        # Select official baseline declarations using structured Names read from
        # kernel-checked exports in a fresh bounded process. Full Init export is
        # much larger than a proof's actual closure, so it is never exported whole.
        baseline_plan = {'imports': imports, 'exports': ['/input/candidate.ndjson'] +
                         ['/input/' + item['file'] for item in dependency_plans]}
        write_input(audit_inputs, 'baseline-plan.json', stable_json(baseline_plan).encode())
        baseline_path = directory / 'baseline.ndjson'
        run_container(audit_inputs, image, ['sh', '-eu', '-c',
                      'cd /opt/full-lean; exec lake env lean --run /trusted/full_lean/ExportBaseline.lean /input/baseline-plan.json'],
                      baseline_path, deadline, MAX_EXPORT, trusted_code=True)
        link_readonly(baseline_path, audit_inputs / 'baseline.ndjson')
        direct = root['bundle']['dependencies']
        audit_plan = {'theorem': theorem(root), 'primitives': PRIMITIVES, 'dependencies': dependency_plans,
                      'direct': [{'id': pin['id'], 'theorem': theorem(artifacts[pin['id']])} for pin in direct]}
        write_input(audit_inputs, 'audit-plan.json', stable_json(audit_plan).encode())
        report_path = directory / 'audit.json'
        run_container(audit_inputs, image, ['python3', '/trusted/full_lean/audit_driver.py', '/input/audit-plan.json'],
                      report_path, deadline, maximum=131072, trusted_code=True)
        # This bounded output is produced by our fresh trusted auditor, not by
        # candidate execution. The large hostile export is never parsed on host.
        report = json.loads(report_path.read_text(), object_pairs_hook=unique)
        require(set(report) == {'formal_statement', 'statement_hash', 'definition_closure_hash', 'canonical_semantics',
                               'axioms', 'proof_body_uses', 'declaration_axioms'}, 'Exact trusted audit output required')
        formal_statement, statement_hash = report['formal_statement'], report['statement_hash']
        definition_hash, canonical = report['definition_closure_hash'], report['canonical_semantics']
        axioms, used = report['axioms'], report['proof_body_uses']
        verified_dependencies = [{'id': key, 'artifact_hash': artifacts[key]['artifact_hash'],
                                  'proof_body_use': True, 'constant': theorem(artifacts[key])} for key in used]
        full_kernel = {'version': 1, 'lean_commit': LEAN_COMMIT, 'mathlib_commit': MATHLIB_COMMIT,
                       'export_hash': file_hash(export_path), 'baseline_hash': file_hash(baseline_path),
                       'checker_set': CHECKERS}
    proof = root['bundle']['source'] if root['bundle']['version'] == 2 else root['bundle']['proof']
    return {'result': 'pass', 'mode': 'isolated', 'verified': True, 'production_verified': True,
            'verification': 'verified', 'checker': 'open-mathematics-v5', 'problem': policy['problem'],
            'repository': args.repository, 'head': args.head, 'base': args.base, 'protocol_commit': args.protocol_commit,
            'policy': sha(policy_bytes), 'toolchain': TOOLCHAIN, 'image': image, 'bundle_hash': root['bundle_hash'],
            'artifact_hash': root['bundle_hash'], 'assembly_hash': sha(source), 'proof_hash': sha(proof.encode()),
            'statement_hash': statement_hash, 'proposition_hash': sha(formal_statement.encode()),
            'formal_statement': formal_statement, 'canonical_semantics': canonical, 'theorem': theorem(root),
            'axioms': axioms, 'declaration_axioms': report['declaration_axioms'], 'sorry': False,
            'proof_body_uses': used, 'verified_dependencies': verified_dependencies,
            'dependency_bundle_hashes': {key: artifacts[key]['bundle_hash'] for key in order},
            'dependency_artifact_hashes': {key: artifacts[key]['artifact_hash'] for key in order},
            'dependency_theorems': {key: theorem(artifacts[key]) for key in order},
            'definition_closure_hash': definition_hash, 'full_kernel': full_kernel, 'log': '',
            'reuse_limit': 'Direct references after bounded beta/zeta/constructor-projection reduction; not necessity, novelty, independence or allocation.',
            'commit_binding': 'Trusted caller resolves immutable accepted records and exact Git commits; checker binds identifiers and bytes.'}


run = verify


def main():
    # Reuse argument and atomic-output hygiene without its v1 verification path.
    from verify_open import arguments
    args = arguments(); output = None
    try:
        if args.output:
            output = Path(args.output).absolute()
            require(output.suffix == '.json' and output.parent.is_dir() and not output.is_symlink()
                    and (not output.exists() or output.is_file()), 'Regular output JSON required')
            inputs = [args.bundle, args.policy] + ([args.dependencies] if args.dependencies else [])
            require(output.resolve() not in [Path(p).resolve() for p in inputs], 'Result cannot replace input')
            require(not output.resolve().is_relative_to(ROOT) or output.resolve().is_relative_to(ROOT / '.data'),
                    'Protocol results must stay under .data')
            output.unlink(missing_ok=True)
        evidence = verify(args); encoded = json.dumps(evidence, ensure_ascii=False, indent=2) + '\n'
        if output:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=output.parent, prefix='.full-result-', delete=False) as file:
                file.write(encoded); file.flush(); os.fsync(file.fileno()); temporary = Path(file.name)
            temporary.replace(output)
        print(encoded, end=''); return 0
    except (OSError, ValueError, TypeError, KeyError, RecursionError, subprocess.SubprocessError) as error:
        print(json.dumps({'result': 'fail', 'checker': 'open-mathematics-v5', 'verified': False,
                          'production_verified': False, 'verification': 'failed', 'error': str(error)[:2800]}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
