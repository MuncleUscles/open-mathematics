"""Real Lean regression checks for the local proposal bundle, not production CI."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent


class ProposalVerification(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='.regression-', dir=ROOT)
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name) / 'repo'
        self.bundle = self.repo / 'proposals/disjoint-cnf'
        self.bundle.mkdir(parents=True)
        for name in ['verify-proposal.py', 'Trusted.lean', 'ProposedStatement.lean',
                     'candidate.proof', 'BoundaryChecks.lean']:
            shutil.copyfile(ROOT / name, self.bundle / name)
        shutil.copytree(REPO / 'lean', self.repo / 'lean', ignore=shutil.ignore_patterns('__pycache__'))
        self.env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')

    def run_verifier(self):
        # Optimized Python must not disable validation by stripping assertions.
        return subprocess.run([sys.executable, '-O', '-B', str(self.bundle / 'verify-proposal.py')],
                              cwd=self.temporary.name, env=self.env, text=True,
                              capture_output=True, timeout=60)

    def successful_evidence(self):
        result = self.run_verifier()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evidence = json.loads((self.bundle / 'evidence.json').read_text())
        self.assertEqual(evidence['status'], 'pass')
        return evidence

    def test_actual_proposal_bytes_are_compiled_and_hashed_from_an_unrelated_cwd(self):
        evidence = self.successful_evidence()
        statement = (self.bundle / 'ProposedStatement.lean').read_bytes()
        proof = (self.bundle / 'candidate.proof').read_bytes()
        boundaries = (self.bundle / 'BoundaryChecks.lean').read_bytes()
        assembled = (statement + b'\n\ntheorem candidate : DisjointSAT := ' + proof +
                     b'\nexample : DisjointSAT := candidate\n#print axioms candidate\n\n' + boundaries)
        self.assertEqual(evidence['assembled_source_sha256'], hashlib.sha256(assembled).hexdigest())
        self.assertEqual(evidence['files']['candidate.proof']['sha256'], hashlib.sha256(proof).hexdigest())
        self.assertEqual(set(evidence['axioms']), {'propext', 'Quot.sound'})
        self.assertEqual(evidence['current_goal_rejection'], 'enrolled goal and dependency required')
        self.assertEqual(evidence['current_syntax_rejection'], 'unsupported proof syntax')

    def test_false_changed_proof_cannot_reuse_old_reference_or_success_evidence(self):
        old_evidence = self.successful_evidence()
        old_reference = ((self.bundle / 'ProposedStatement.lean').read_bytes() +
                         b'\ntheorem candidate : DisjointSAT := ' +
                         (self.bundle / 'candidate.proof').read_bytes())
        (self.bundle / 'ReferenceCheck.lean').write_bytes(old_reference)
        (self.bundle / 'candidate.proof').write_text('by\n  intro f g disjoint\n  exact Iff.rfl\n')
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Lean rejected the assembled proposal', result.stderr)
        self.assertFalse((self.bundle / 'evidence.json').exists(), 'Old success must not survive a failed run')
        self.assertEqual((self.bundle / 'ReferenceCheck.lean').read_bytes(), old_reference)
        self.assertNotEqual(old_evidence['files']['candidate.proof']['sha256'],
                            hashlib.sha256((self.bundle / 'candidate.proof').read_bytes()).hexdigest())

    def test_changed_statement_is_executed_not_just_hashed(self):
        self.successful_evidence()
        statement = self.bundle / 'ProposedStatement.lean'
        statement.write_text(statement.read_text().replace(
            '(Satisfiable (List.append f g) ↔ Satisfiable f ∧ Satisfiable g)', 'False'))
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Lean rejected the assembled proposal', result.stderr)
        self.assertFalse((self.bundle / 'evidence.json').exists())

    def test_boundary_checks_are_part_of_the_executed_source(self):
        self.successful_evidence()
        boundaries = self.bundle / 'BoundaryChecks.lean'
        boundaries.write_text(boundaries.read_text() + '\nexample : False := by\n  exact True.intro\n')
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Lean rejected the assembled proposal', result.stderr)
        self.assertFalse((self.bundle / 'evidence.json').exists())

    def test_nonexact_lean_version_is_rejected_and_removes_old_evidence(self):
        fake = Path(self.temporary.name) / 'fake-lean'
        fake.write_text('#!' + sys.executable + '\nprint("Lean (version 4.19.01, test)")\n')
        fake.chmod(0o755)
        self.env['LEAN_BIN'] = str(fake)
        (self.bundle / 'evidence.json').write_text('{"status":"pass"}\n')
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Exact Lean 4.19.0 required', result.stderr)
        self.assertFalse((self.bundle / 'evidence.json').exists())


if __name__ == '__main__':
    unittest.main()
