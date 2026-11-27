from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lean'))
from check import assemble

UPSTREAM = ROOT / 'fixtures/renaming.proof'
DOWNSTREAM = ROOT / 'fixtures/renaming_sat.proof'
TRUSTED_FILES = ('Trusted.lean', 'Downstream.lean', 'Inspect.lean', 'check.py', 'legacy_check.py')
DISALLOWED_PROOFS = (
    pytest.param('by\n  sorry', id='sorry'),
    pytest.param('by\n  exact Classical.choice (sorry)', id='unapproved-axiom'),
    pytest.param('by\n  axiom fake : False', id='axiom-command'),
    pytest.param('by\n  rfl\n#print axioms candidate', id='diagnostic-command'),
    pytest.param('by\n  run_tac unsafeIO (IO.println "success")', id='unsafe-tactic'),
    pytest.param('by\n  native_decide', id='native-evaluation'),
    pytest.param('by\n  simp\nend\ntheorem candidate : True := by trivial', id='statement-replacement'),
    pytest.param('by\n  -- hide\n  sorry', id='comment-and-sorry'),
)


@pytest.mark.parametrize('goal', ('renaming', 'renaming_sat'))
@pytest.mark.parametrize('proof', DISALLOWED_PROOFS)
def test_restricted_syntax_rejects_unapproved_proof_input(goal, proof):
    dependency = UPSTREAM.read_text() if goal == 'renaming_sat' else None
    with pytest.raises(ValueError, match='unsupported proof syntax'):
        assemble(proof, goal, dependency)


def test_upstream_retains_its_legacy_ascii_grammar():
    with pytest.raises(ValueError, match='proof input bound or encoding'):
        assemble('by\n  exact ⟨⟩')


def test_assembly_keeps_both_pinned_statements_and_checks_the_dependency():
    upstream = UPSTREAM.read_text()
    base = assemble(upstream)
    assert 'theorem candidate : RenamingSound :=' in base
    assert 'example : RenamingSound := candidate' in base

    downstream = assemble(DOWNSTREAM.read_text(), 'renaming_sat', upstream)
    assert 'theorem renaming_sound : RenamingSound :=' in downstream
    assert 'theorem candidate : RenamingSAT :=' in downstream
    assert 'example : RenamingSAT := candidate' in downstream
    assert 'usesProofConstant' in downstream

    with pytest.raises(ValueError, match='unsupported proof syntax'):
        assemble(DOWNSTREAM.read_text(), 'renaming_sat', 'by\n  sorry')


def run_verifier(*args, root=ROOT):
    return subprocess.run(
        [sys.executable, '-B', str(root / 'scripts/verify_lean.py'), *map(str, args)],
        cwd=root, capture_output=True, text=True, timeout=20, check=False,
    )


@pytest.mark.parametrize('dependency_args', (
    pytest.param((), id='neither'),
    pytest.param(('--dependency-file', UPSTREAM), id='file-only'),
    pytest.param(('--dependency-artifact', 'a' * 64), id='commitment-only'),
))
def test_sat_requires_a_file_and_artifact_commitment(dependency_args):
    result = run_verifier(DOWNSTREAM, '--goal', 'renaming_sat', *dependency_args)
    assert result.returncode != 0
    assert 'exact credited dependency required' in result.stderr


def test_sat_rejects_a_different_credited_artifact():
    result = run_verifier(
        DOWNSTREAM, '--goal', 'renaming_sat', '--dependency-file', UPSTREAM,
        '--dependency-artifact', '0' * 64,
    )
    assert result.returncode != 0
    assert 'credited dependency artifact mismatch' in result.stderr


def test_sat_rejects_different_dependency_bytes(tmp_path):
    upstream = UPSTREAM.read_text()
    artifact = sha256(assemble(upstream).encode()).hexdigest()
    changed = tmp_path / 'different.proof'
    changed.write_text(upstream + '\n', encoding='utf-8')

    result = run_verifier(
        DOWNSTREAM, '--goal', 'renaming_sat', '--dependency-file', changed,
        '--dependency-artifact', artifact,
    )
    assert result.returncode != 0
    assert 'credited dependency artifact mismatch' in result.stderr


def test_upstream_rejects_unexpected_dependency():
    result = run_verifier(UPSTREAM, '--goal', 'renaming', '--dependency-file', UPSTREAM)
    assert result.returncode != 0
    assert 'unexpected dependency' in result.stderr


def test_policy_fingerprints_all_trusted_assembly_inputs():
    pins = json.loads((ROOT / 'lean/policy.json').read_text())['files']
    assert set(TRUSTED_FILES) <= pins.keys()
    for name, expected in pins.items():
        assert sha256((ROOT / 'lean' / name).read_bytes()).hexdigest() == expected, name


@pytest.mark.parametrize('name', TRUSTED_FILES)
def test_verifier_rejects_each_modified_trusted_input(tmp_path, name):
    lean = tmp_path / 'lean'
    lean.mkdir()
    for trusted_name in (*TRUSTED_FILES, 'policy.json'):
        shutil.copyfile(ROOT / 'lean' / trusted_name, lean / trusted_name)
    scripts = tmp_path / 'scripts'
    scripts.mkdir()
    shutil.copyfile(ROOT / 'scripts/verify_lean.py', scripts / 'verify_lean.py')
    modified = lean / name
    modified.write_bytes(modified.read_bytes() + b'\n')

    result = run_verifier(root=tmp_path)
    assert result.returncode != 0
    assert f'trusted foundation changed: {name}' in result.stderr


def check_with_lean(source, tmp_path):
    configured = os.environ.get('LEAN_BIN')
    lean = shutil.which(configured) if configured else None
    if not lean:
        pytest.skip('Set LEAN_BIN to an installed Lean 4.19.0 binary')
    version = subprocess.run(
        [lean, '--version'], capture_output=True, text=True, timeout=15, check=True,
    )
    assert 'version 4.19.0' in version.stdout, version.stdout + version.stderr
    path = tmp_path / 'Check.lean'
    path.write_text(source, encoding='utf-8')
    return subprocess.run(
        [lean, '--trust=0', '-DmaxHeartbeats=100000', str(path)],
        capture_output=True, text=True, timeout=45, check=False,
    )


def test_sat_proof_and_inspector_reductions(tmp_path):
    source = assemble(DOWNSTREAM.read_text(), 'renaming_sat', UPSTREAM.read_text())
    regression = (ROOT / 'tests/InspectRegression.lean').read_text()
    result = check_with_lean(source + '\n' + regression, tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.splitlines().count('OPEN_MATH_PROOF_USE:renaming_sound') == 1


def test_sat_grammar_leaves_incomplete_terms_to_lean(tmp_path):
    source = assemble('by\n  exact ⟨⟩', 'renaming_sat', UPSTREAM.read_text())
    result = check_with_lean(source, tmp_path)
    assert result.returncode != 0
    assert 'error:' in result.stdout + result.stderr
