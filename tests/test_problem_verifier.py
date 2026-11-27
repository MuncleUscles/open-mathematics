"""Offline generic verifier checks using the disclosed nonrewardable reference."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lean'))
from problem_check import assemble, goal_commitment, load_policy, proposition_text, sha, statement_fingerprint, validate_expression
spec = importlib.util.spec_from_file_location('verify_problem', ROOT / 'scripts/verify_problem.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
LEAN = os.environ.get('LEAN_BIN', 'lean')
# Disclosed reference from open-mathematics commit 27373fa, not a reward submission.
REFERENCE_SOURCE = '-- Trusted foundations. Core Lean only: no Mathlib dependency in this component.\ndef Clause := List (Nat × Bool)\ndef CNF := List Clause\ndef evalLiteral (a : Nat → Bool) (l : Nat × Bool) : Bool := a l.1 == l.2\ndef evalClause (a : Nat → Bool) (c : Clause) : Bool := c.any (evalLiteral a)\ndef evalCNF (a : Nat → Bool) (f : CNF) : Bool := f.all (evalClause a)\n-- Goal: variable renaming commutes with CNF evaluation for every assignment.\n-- This supports future reductions. It proves no complexity lower bound.\ndef renameClause (r : Nat → Nat) (c : Clause) : Clause := c.map (fun l => (r l.1, l.2))\ndef renameCNF (r : Nat → Nat) (f : CNF) : CNF := f.map (renameClause r)\ndef RenamingSound : Prop := ∀ (r : Nat → Nat) (a : Nat → Bool) (f : CNF),\n  evalCNF a (renameCNF r f) = evalCNF (fun n => a (r n)) f\n\ndef Satisfiable (f : CNF) : Prop := ∃ a : Nat → Bool, evalCNF a f = true\n\n-- Repeated variables are deliberately retained; membership is the only use.\ndef cnfVars (f : CNF) : List Nat := f.flatMap (fun c => c.map Prod.fst)\ndef DisjointCNFVars (f g : CNF) : Prop :=\n  ∀ n : Nat, n ∈ cnfVars f → n ∈ cnfVars g → False\n\ndef DisjointSAT : Prop := ∀ (f g : CNF), DisjointCNFVars f g →\n  (Satisfiable (List.append f g) ↔ Satisfiable f ∧ Satisfiable g)\n'
REFERENCE_PROOF = 'by\n  have transport (f : CNF) (a b : Nat → Bool)\n      (same : ∀ n, n ∈ cnfVars f → a n = b n) :\n      evalCNF a f = true → evalCNF b f = true := by\n    intro ha\n    apply List.all_eq_true.mpr\n    intro c hc\n    obtain ⟨l, hl, hla⟩ := List.any_eq_true.mp ((List.all_eq_true.mp ha) c hc)\n    apply List.any_eq_true.mpr\n    refine ⟨l, hl, ?_⟩\n    have member : l.1 ∈ cnfVars f :=\n      List.mem_flatMap.mpr ⟨c, hc, List.mem_map.mpr ⟨l, hl, rfl⟩⟩\n    simpa [evalLiteral, ← same l.1 member] using hla\n  intro f g disjoint\n  constructor\n  · intro combined\n    obtain ⟨a, ha⟩ := combined\n    have both : evalCNF a f = true ∧ evalCNF a g = true := by\n      simpa [evalCNF, List.all_append] using ha\n    exact ⟨⟨a, both.1⟩, ⟨a, both.2⟩⟩\n  · intro separate\n    obtain ⟨⟨a, ha⟩, ⟨b, hb⟩⟩ := separate\n    let joined : Nat → Bool := fun n => if n ∈ cnfVars f then a n else b n\n    have left : evalCNF joined f = true := transport f a joined (by\n      intro n hn\n      simp [joined, hn]) ha\n    have right : evalCNF joined g = true := transport g b joined (by\n      intro n hn\n      have absent : n ∉ cnfVars f := fun hf => disjoint n hf hn\n      simp [joined, absent]) hb\n    refine ⟨joined, ?_⟩\n    simpa [evalCNF, List.all_append] using And.intro left right\n\n'


class ProblemVerifier(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='problem-verifier-test-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.problem = self.directory / 'problem'
        (self.problem / 'lean').mkdir(parents=True)
        (self.problem / '.open-math/policies').mkdir(parents=True)
        source = REFERENCE_SOURCE
        definitions, statement = source.split('def DisjointSAT', 1)
        self.inputs = {'Definitions.lean': definitions.encode(), 'Statement.lean': ('def DisjointSAT' + statement).encode()}
        for name, data in self.inputs.items():
            (self.problem / 'lean' / name).write_bytes(data)
        self.proof = self.directory / 'candidate.proof'
        self.proof.write_text(REFERENCE_PROOF)
        goal = {'path': 'research/proofs/disjoint_sat.proof', 'theorem': 'candidate : DisjointSAT',
                'statement': self.inputs['Statement.lean'].decode().strip(), 'statement_hash': '', 'goal_hash': '',
                'definition_files': list(self.inputs), 'dependency': None, 'rewardable': False}
        self.policy = {'version': 4, 'name': 'cnf-test-v4', 'problem': 'p-vs-np', 'repository': 'fixture/problem',
                       'branch': 'research', 'toolchain': 'lean4:4.19.0', 'allowed_axioms': ['propext', 'Quot.sound'],
                       'files': {name: sha(data) for name, data in self.inputs.items()}, 'goals': {'disjoint_sat': goal}}
        self.policy_path = '.open-math/policies/cnf-test-v4.json'
        self.write_policy()
        self.output = self.directory / 'result.json'

    def write_policy(self):
        for name, goal in self.policy['goals'].items():
            goal['statement_hash'] = statement_fingerprint(goal, self.policy['files'])
            goal['goal_hash'] = goal_commitment(name, goal, self.policy['files'])
        self.policy_bytes = (json.dumps(self.policy, ensure_ascii=False, indent=2) + '\n').encode()
        (self.problem / self.policy_path).write_bytes(self.policy_bytes)

    def command(self, *, local=True):
        command = [sys.executable, '-B', str(ROOT / 'scripts/verify_problem.py'), str(self.proof),
                   '--problem-root', str(self.problem), '--policy', self.policy_path, '--policy-hash', sha(self.policy_bytes),
                   '--goal', 'disjoint_sat', '--head', 'a' * 40, '--base', 'b' * 40,
                   '--problem-commit', 'c' * 40, '--protocol-commit', 'd' * 40, '--repository', 'fixture/problem',
                   '--output', str(self.output)]
        return command + (['--lean', LEAN] if local else [])

    def invoke(self, *, local=True):
        return subprocess.run(self.command(local=local), capture_output=True, text=True, timeout=55)

    def test_actual_reference_is_diagnostic_and_bound_to_exact_bytes(self):
        run = self.invoke()
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        result = json.loads(run.stdout)
        self.assertEqual(result['result'], 'pass')
        self.assertFalse(result['verified'])
        self.assertFalse(result['production_verified'])
        self.assertFalse(result['rewardable'])
        self.assertEqual(result['verification'], 'diagnostic-only')
        self.assertEqual(result['mode'], 'local-diagnostic')
        self.assertEqual(result['toolchain'], 'lean4:4.19.0')
        self.assertEqual(result['problem_commit'], 'c' * 40)
        self.assertEqual(result['protocol_commit'], 'd' * 40)
        self.assertEqual(result['policy'], sha(self.policy_bytes))
        goal = self.policy['goals']['disjoint_sat']
        self.assertEqual(result['goal_hash'], goal['goal_hash'])
        self.assertEqual(result['statement_hash'], goal['statement_hash'])
        self.assertEqual(result['formal_statement'], goal['statement'])
        self.assertEqual(result['source_hashes'], self.policy['files'])
        self.assertEqual(result['proof_hash'], sha(self.proof.read_bytes()))
        self.assertEqual(result['artifact_hash'], sha(assemble(self.policy, goal, self.inputs, self.proof.read_bytes())))
        self.assertEqual(set(result['axioms']), {'propext', 'Quot.sound'})
        self.assertEqual(json.loads(self.output.read_text()), result)

    @unittest.skipUnless(os.environ.get('RUN_DOCKER_TESTS') == '1', 'Explicit pinned Linux Docker validation')
    def test_real_isolated_production_reference_and_false_proof(self):
        run = self.invoke(local=False)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result['production_verified'])
        self.assertTrue(result['verified'])
        self.assertFalse(result['rewardable'])
        self.assertEqual(result['mode'], 'isolated')
        self.assertEqual(result['image'], os.environ['TRUSTED_LEAN_IMAGE'])
        self.proof.write_text('by\n  exact True.intro\n')
        rejected = self.invoke(local=False)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertFalse(json.loads(rejected.stdout)['verified'])
        self.assertFalse(self.output.exists())

    def test_false_proof_removes_stale_success(self):
        self.output.write_text('{"result":"pass","verified":true}')
        self.proof.write_text('by\n  exact True.intro\n')
        run = self.invoke()
        self.assertNotEqual(run.returncode, 0)
        self.assertEqual(json.loads(run.stdout)['result'], 'fail')
        self.assertFalse(self.output.exists())

    def test_wrong_definitions_fail_before_lean(self):
        (self.problem / 'lean/Definitions.lean').write_text('def CNF := False\n')
        run = self.invoke()
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('Trusted definition hash mismatch', run.stdout)
        self.assertFalse(self.output.exists())

    def test_duplicate_json_is_rejected_even_with_matching_bytes_hash(self):
        self.policy_bytes = self.policy_bytes.replace(b'  "version": 4,', b'  "version": 4,\n  "version": 4,')
        (self.problem / self.policy_path).write_bytes(self.policy_bytes)
        run = self.invoke()
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('Duplicate JSON key', run.stdout)

    def test_goal_fingerprint_excludes_name_but_includes_definition_bytes(self):
        goal = dict(self.policy['goals']['disjoint_sat'])
        original = goal['statement_hash']
        goal['statement'] = goal['statement'].replace('DisjointSAT', 'OtherName')
        goal['theorem'] = 'candidate : OtherName'
        self.assertEqual(statement_fingerprint(goal, self.policy['files']), original)
        changed = {**self.policy['files'], 'Definitions.lean': 'e' * 64}
        self.assertNotEqual(statement_fingerprint(goal, changed), original)

    def test_goal_commitment_and_display_must_match(self):
        self.policy['goals']['disjoint_sat']['goal_hash'] = '0' * 64
        self.policy_bytes = (json.dumps(self.policy, ensure_ascii=False, indent=2) + '\n').encode()
        (self.problem / self.policy_path).write_bytes(self.policy_bytes)
        with self.assertRaisesRegex(ValueError, 'Goal commitment'):
            load_policy(self.problem, self.policy_path, sha(self.policy_bytes), 'disjoint_sat')
        self.write_policy()
        goal = self.policy['goals']['disjoint_sat']
        goal['statement'] += '\n-- changed display'
        self.write_policy()
        with self.assertRaisesRegex(ValueError, 'Final statement'):
            load_policy(self.problem, self.policy_path, sha(self.policy_bytes), 'disjoint_sat')

    def test_candidate_escapes_and_unapproved_identifiers_are_refused(self):
        trusted = '\n'.join(data.decode() for data in self.inputs.values())
        cases = [
            'by\n  exact sorry\n', 'by\n  native_decide\n', 'by\n  run_tac pure ()\n', 'by\n  have run_meta := True.intro\n  run_meta pure ()\n',
            'by\n  let run_tac := 0\n  run_tac pure ()\n', 'by\n  exact Classical.choice _\n',
            'by\n  exact Lean.ofReduceBool _\n', 'by\n  exact True.intro\nend\naxiom bad : False\n',
            'by\n  exact (by\n    run_elab pure ())\n', 'by\n  exact "text"\n',
            'by\n  /- hidden -/ exact True.intro\n', 'by\n  exact True.intro -- hidden\n',
            'by\n  exact True.intro\n)\n#eval 1\n(', 'by\n  exact _root_.False.elim _\n',
            'by\n  exact unknownGlobal\n', 'by\r\n  exact True.intro\n',
        ]
        for proof in cases:
            with self.subTest(proof=proof), self.assertRaises(ValueError):
                validate_expression(proof, trusted)

    def test_symlink_closure_and_path_escape_refused(self):
        file = self.problem / 'lean/Definitions.lean'
        file.unlink()
        file.symlink_to(self.proof)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            load_policy(self.problem, self.policy_path, sha(self.policy_bytes), 'disjoint_sat')
        with self.assertRaisesRegex(ValueError, 'Contained'):
            load_policy(self.problem, '../outside.json', sha(self.policy_bytes), 'disjoint_sat')

    def test_shared_unicode_and_legacy_commitment_vectors(self):
        fixture = json.loads((ROOT / 'tests/fixtures/problem-commitments.json').read_text())
        vector = fixture['unicode']
        self.assertEqual(goal_commitment(vector['id'], vector['goal'], vector['files']), vector['goal']['goal_hash'])
        self.assertEqual(statement_fingerprint(vector['goal'], vector['files']), vector['goal']['statement_hash'])
        self.assertEqual(sha(proposition_text(vector['goal']).encode()), vector['propositionHash'])
        for legacy in fixture['legacy']['statements']:
            goal = {'statement': legacy['statement'], 'theorem': 'candidate : ' + legacy['declaration']}
            self.assertEqual(sha(proposition_text(goal).encode()), legacy['propositionHash'])

    def test_production_command_has_isolation_and_no_automatic_pull(self):
        command = verifier.docker_command('/tmp/read-only-input', 'bounded-test', 'sha256:' + 'e' * 64)
        for flag in ['--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
                     '--cpus=1', '--memory=1g', '--memory-swap=1g', '--pids-limit=32', '--user=65534:65534']:
            self.assertIn(flag, command)
        self.assertIn('/tmp/read-only-input:/input:ro', command)
        with self.assertRaises(ValueError):
            verifier.docker_command('/tmp/input', 'test', 'latest')

    def test_missing_production_image_cannot_fall_back_to_local_lean(self):
        environment = dict(os.environ)
        environment.pop('TRUSTED_LEAN_IMAGE', None)
        run = subprocess.run(self.command(local=False), env=environment, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(run.returncode, 0)
        result = json.loads(run.stdout)
        self.assertFalse(result['verified'])
        self.assertIn('Pinned isolated verifier image required', result['error'])

    def test_bounded_process_and_axiom_audit_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'output exceeded'):
            verifier.bounded_process([sys.executable, '-c', 'print("x" * 70000)'])
        with self.assertRaisesRegex(ValueError, 'Unauthorized'):
            verifier.axiom_report("'candidate' depends on axioms: [sorryAx]\n", ['propext'])
        with self.assertRaisesRegex(ValueError, 'Exactly one'):
            verifier.axiom_report("'candidate' does not depend on any axioms\n" * 2, [])
        self.assertFalse(verifier.VERSION.match('Lean (version 4.19.01, fake)'))
        self.assertFalse(verifier.VERSION.match('Lean (version 4.19.0-rc1, fake)'))


if __name__ == '__main__':
    unittest.main()
