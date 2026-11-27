"""Offline open-bundle regression suite. All kernel evidence is diagnostic only."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lean'))
from open_check import assemble_checked, load_closure, parse_bundle, statement_hash, validate_expression
sys.path.insert(0, str(ROOT / 'scripts'))
from verify_open import audit, bounded_process
from problem_check import sha
LEAN = os.environ.get('LEAN_BIN', 'lean')
FIXTURES = ROOT / 'fixtures/open-research'
def encoded(value): return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
def empty(): return {'version': 1, 'artifacts': []}
def simple(statement='True', proof='by\n  exact True.intro\n', dependencies=None, definitions=None):
    return {'version': 1, 'definitions': definitions or [], 'statement': statement, 'proof': proof, 'dependencies': dependencies or []}

class OpenVerifier(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='open-verifier-test-'); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.policy = {'version': 5, 'problem': 'p-vs-np', 'repository': 'fixture/open-research', 'branch': 'research',
                       'objective': 'Resolve P versus NP; useful work toward either outcome is welcome.', 'toolchain': 'lean4:4.19.0',
                       'allowed_axioms': ['propext', 'Quot.sound'], 'admission': 'open',
                       'notes': 'Research notes are reviewed arguments, not kernel-verified results.'}
        self.policy_path = self.root / 'policy.json'; self.policy_path.write_bytes(encoded(self.policy))
        self.counter = 0
    def artifact(self, identifier, bundle, manifest=None):
        raw = encoded(bundle); source, *_ = assemble_checked(raw, encoded(manifest or empty()))
        file = self.root / (identifier + '.json'); file.write_bytes(raw)
        return {'id': identifier, 'bundle_hash': sha(raw), 'artifact_hash': sha(raw), 'path': str(file)}
    def run_bundle(self, bundle, manifest=None, syntax=False, named=False, output=None, production=False):
        self.counter += 1
        file, deps = self.root / ('bundle-' + str(self.counter) + '.json'), self.root / ('manifest-' + str(self.counter) + '.json')
        file.write_bytes(encoded(bundle)); deps.write_bytes(encoded(manifest or empty()))
        command = [sys.executable, '-B', str(ROOT / 'scripts/verify_open.py')]
        command += ['--bundle', str(file)] if named else [str(file)]
        command += ['--policy', str(self.policy_path), '--policy-hash', sha(encoded(self.policy)), '--dependencies', str(deps),
                    '--repository', self.policy['repository'], '--head', 'a' * 40, '--base', 'b' * 40, '--protocol-commit', 'c' * 40]
        command += [] if production else (['--syntax-only'] if syntax else ['--lean', LEAN])
        if output: command += ['--output', str(output)]
        run = subprocess.run(command, capture_output=True, text=True, timeout=55)
        return run.returncode, json.loads(run.stdout)
    def assert_used(self, bundle, manifest, expected):
        code, result = self.run_bundle(bundle, manifest)
        self.assertEqual(code, 0, result); self.assertEqual(result['proof_body_uses'], expected)
        self.assertFalse(result['verified']); self.assertFalse(result['production_verified'])
        return result
    def test_substantive_sat_pair_and_exact_imported_commitment(self):
        a = json.loads((FIXTURES / 'locality.json').read_text())
        b = json.loads((FIXTURES / 'finite-support.json').read_text())
        entry = self.artifact('pilot-locality', a)
        first = self.assert_used(a, empty(), [])
        second = self.assert_used(b, {'version': 1, 'artifacts': [entry]}, ['pilot-locality'])
        self.assertEqual(first['bundle_hash'], b['dependencies'][0]['bundle_hash'])
        self.assertEqual(first['artifact_hash'], entry['artifact_hash']); self.assertEqual(first['artifact_hash'], first['bundle_hash'])
        self.assertRegex(first['assembly_hash'], r'^[a-f0-9]{64}$')
        self.assertEqual(second['verified_dependencies'], [{'id': 'pilot-locality', 'artifact_hash': entry['artifact_hash'], 'proof_body_use': True, 'constant': 'B_' + entry['bundle_hash'] + '.result'}])
        self.assertEqual(second['statement_hash'], statement_hash(b)); self.assertEqual(second['proposition_hash'], sha(b['statement'].encode()))
    @unittest.skipUnless(os.environ.get('RUN_DOCKER_TESTS') == '1', 'Real production Docker check requires RUN_DOCKER_TESTS=1 and pinned image')
    def test_actual_production_container_pair_and_false_rejection(self):
        self.assertRegex(os.environ.get('TRUSTED_LEAN_IMAGE', ''), r'(?:[A-Za-z0-9][A-Za-z0-9./:_-]*@)?sha256:[a-f0-9]{64}$')
        a = json.loads((FIXTURES / 'locality.json').read_text())
        b = json.loads((FIXTURES / 'finite-support.json').read_text())
        entry = self.artifact('pilot-locality', a)
        for bundle, manifest, uses in [(a, empty(), []), (b, {'version':1,'artifacts':[entry]}, ['pilot-locality'])]:
            code, result = self.run_bundle(bundle, manifest, production=True)
            self.assertEqual(code, 0, result); self.assertEqual(result['mode'], 'isolated')
            self.assertTrue(result['verified']); self.assertTrue(result['production_verified'])
            self.assertEqual(result['verification'], 'verified'); self.assertEqual(result['proof_body_uses'], uses)
            self.assertEqual(result['image'], os.environ['TRUSTED_LEAN_IMAGE'])
            self.assertTrue(result['declaration_axioms']); self.assertRegex(result['assembly_hash'], r'^[a-f0-9]{64}$')
        code, result = self.run_bundle(simple('False'), production=True)
        self.assertNotEqual(code, 0); self.assertFalse(result['verified']); self.assertFalse(result['production_verified'])

    def test_dead_lets_beta_arguments_and_projected_fields_do_not_count(self):
        entry = self.artifact('upstream', simple()); dep = {'id': entry['id'], 'bundle_hash': entry['bundle_hash']}
        term = 'B_' + entry['bundle_hash'] + '.result'; manifest = {'version': 1, 'artifacts': [entry]}
        for proof in ['by\n  have unused := '+term+'\n  exact True.intro\n',
                      'by\n  exact (fun _ : True => True.intro) '+term+'\n',
                      'by\n  exact Function.const True True.intro '+term+'\n',
                      'by\n  let pair : True ∧ True := ⟨'+term+', True.intro⟩\n  exact pair.2\n']:
            with self.subTest(proof=proof): self.assert_used(simple(proof=proof, dependencies=[dep]), manifest, [])
    def test_owned_alias_is_followed_but_discarding_owned_function_is_reduced(self):
        entry = self.artifact('upstream', simple()); dep = {'id': entry['id'], 'bundle_hash': entry['bundle_hash']}
        term = 'B_' + entry['bundle_hash'] + '.result'; manifest = {'version': 1, 'artifacts': [entry]}
        alias = [{'name': 'witness', 'type': 'True', 'value': term}]
        self.assert_used(simple(proof='by\n  exact witness\n', definitions=alias, dependencies=[dep]), manifest, ['upstream'])
        discard = [{'name': 'discard', 'type': 'True → True', 'value': 'fun _ => True.intro'}]
        self.assert_used(simple(proof='by\n  exact discard '+term+'\n', definitions=discard, dependencies=[dep]), manifest, [])
    def test_transitive_artifacts_compile_but_only_direct_use_is_exported(self):
        a = self.artifact('a', simple()); da = {'id': 'a', 'bundle_hash': a['bundle_hash']}
        mb = {'version': 1, 'artifacts': [a]}
        b = self.artifact('b', simple(proof='by\n  exact B_'+a['bundle_hash']+'.result\n', dependencies=[da]), mb)
        db = {'id': 'b', 'bundle_hash': b['bundle_hash']}
        result = self.assert_used(simple(proof='by\n  exact B_'+b['bundle_hash']+'.result\n', dependencies=[db]), {'version': 1, 'artifacts': [b, a]}, ['b'])
        self.assertEqual(set(result['dependency_bundle_hashes']), {'a', 'b'})
    def test_longer_path_to_cached_subtree_still_enforces_depth_bound(self):
        items = {}
        for identifier, children in [('leaf', []), ('a', ['leaf']), ('z', ['a']), ('y', ['z']), ('x', ['y'])]:
            b = simple(dependencies=[{'id': child, 'bundle_hash': items[child]['bundle_hash']} for child in children])
            file = self.root / (identifier + '.json'); file.write_bytes(encoded(b))
            items[identifier] = {'id': identifier, 'bundle_hash': sha(encoded(b)), 'artifact_hash': sha(encoded(b)), 'path': str(file)}
        root = simple(dependencies=[{'id': name, 'bundle_hash': items[name]['bundle_hash']} for name in ['a', 'x']])
        with self.assertRaisesRegex(ValueError, 'longest-path'):
            load_closure(encoded(root), encoded({'version': 1, 'artifacts': list(items.values())}))
    def test_source_hash_prior_artifact_missing_and_extra_dependencies_fail(self):
        entry = self.artifact('a', simple()); dep = {'id': 'a', 'bundle_hash': entry['bundle_hash']}; root = simple(dependencies=[dep])
        bad = {**entry, 'artifact_hash': '0' * 64}
        with self.assertRaisesRegex(ValueError, 'artifact identity'):
            assemble_checked(encoded(root), encoded({'version': 1, 'artifacts': [bad]}))
        with self.assertRaisesRegex(ValueError, 'Missing'):
            assemble_checked(encoded(root), encoded(empty()))
        with self.assertRaisesRegex(ValueError, 'Extraneous'):
            assemble_checked(encoded(simple('True ∧ True', 'by\n  exact ⟨True.intro, True.intro⟩\n')), encoded({'version': 1, 'artifacts': [entry]}))
        Path(entry['path']).write_bytes(encoded(simple('False')))
        with self.assertRaisesRegex(ValueError, 'bytes changed'):
            assemble_checked(encoded(root), encoded({'version': 1, 'artifacts': [entry]}))
    def test_commands_meta_escapes_in_each_expression_field_and_forward_definitions_fail(self):
        attacks = ['True\n)\nend\naxiom bad : False\n(', 'by\n  run_tac pure ()', 'by\n  native_decide',
                   'by\n  exact sorry', 'by\n  exact (lcProof : False)', 'by\n  decide +native', 'by_elab pure ()', 'Classical.choice', '"text"', 'True /- hidden -/', 'Lean.Expr', 'IO Unit', '`True']
        for attack in attacks:
            with self.subTest(attack=attack), self.assertRaises(ValueError): validate_expression(attack, set(), set())
        bundle = simple(definitions=[{'name':'One','type':'Type','value':'Two'}, {'name':'Two','type':'Type','value':'Nat'}])
        with self.assertRaisesRegex(ValueError, 'Unapproved'): assemble_checked(encoded(bundle), encoded(empty()))
    def test_definition_and_statement_are_not_assumed_and_stale_output_is_removed(self):
        output = self.root / 'result.json'; output.write_text('{"verified":true}')
        code, result = self.run_bundle(simple('False'), output=output)
        self.assertNotEqual(code, 0); self.assertFalse(result['verified']); self.assertFalse(output.exists())
        code, result = self.run_bundle(simple(definitions=[{'name':'bad','type':'Nat','value':'True.intro'}]))
        self.assertNotEqual(code, 0); self.assertFalse(result['verified'])
    def test_syntax_mode_has_no_kernel_or_use_claim_and_both_cli_aliases_work(self):
        code, result = self.run_bundle(simple('False'), syntax=True, named=True)
        self.assertEqual(code, 0, result); self.assertEqual(result['result'], 'syntax-pass')
        self.assertEqual(result['verification'], 'syntax-only'); self.assertFalse(result['verified']); self.assertEqual(result['proof_body_uses'], [])
    def test_duplicate_json_unknown_fields_and_size_limits_fail(self):
        raw = encoded(simple()).replace(b'  "version": 1,', b'  "version": 1,\n  "version": 1,')
        with self.assertRaisesRegex(ValueError, 'Duplicate'): parse_bundle(raw)
        with self.assertRaises(ValueError): parse_bundle(encoded({**simple(), 'script':'evil'}))
        with self.assertRaises(ValueError): parse_bundle(encoded(simple(proof='by\n'+' '*12001)))
        with self.assertRaises(ValueError): parse_bundle(encoded(simple(definitions=[{'name':'result','type':'Prop','value':'True'}])))

    def test_reserved_native_prefix_and_root_names_are_rejected(self):
        for name in ['native', 'by_elab', 'lcProof', 'eval_custom', 'unsafeThing', 'Fin', 'Int']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                parse_bundle(encoded(simple(definitions=[{'name': name, 'type': 'Nat', 'value': '0'}])))
        code, result = self.run_bundle(simple(definitions=[{'name':'Unit','type':'Prop','value':'True'}]))
        self.assertNotEqual(code, 0); self.assertIn('collides with a root constant', result['error'])

    def test_trusted_footer_independently_rejects_forbidden_axioms(self):
        bundle = simple(definitions=[{'name':'witness','type':'True','value':'True.intro'}])
        sources, *_ = assemble_checked(encoded(bundle), encoded(empty()))
        # Deliberately bypass the lexical gate in this test to exercise the trusted
        # footer independently. Classical choice remains forbidden to contributors.
        sources['Candidate.lean'] = sources['Candidate.lean'].replace(b'  True.intro', b'  Classical.byContradiction (fun h => h True.intro)', 1)
        for name, raw in sources.items(): (self.root / name).write_bytes(raw)
        env = {**os.environ, 'LEAN_PATH': str(self.root)}
        code, stdout, stderr = bounded_process([LEAN, '--trust=0', '-o', str(self.root/'Candidate.olean'), str(self.root/'Candidate.lean')], env=env, cwd=self.root)
        self.assertEqual((code, stdout, stderr), (0, '', ''))
        code, stdout, stderr = bounded_process([LEAN, '--trust=0', str(self.root/'Check.lean')], env=env, cwd=self.root)
        self.assertNotEqual(code, 0); self.assertIn('Unauthorized axiom', stdout + stderr)
        self.assertNotIn('OPEN_RESEARCH_AUDIT:', stdout)

    def test_machine_audit_cannot_be_forged_by_human_log_or_stderr(self):
        sources, root, artifacts, order = assemble_checked(encoded(simple()), encoded(empty()))
        nonce = '0' * 32
        for log in ["'candidate' does not depend on any axioms\n", 'OPEN_RESEARCH_AUDIT:'+'1'*32+':{}\n',
                    'OPEN_RESEARCH_AUDIT:'+nonce+':{"declarations":[],"used":[]}\n',
                    'OPEN_RESEARCH_AUDIT:'+nonce+':{"declarations":[],"used":[],"used":[]}\n']:
            with self.subTest(log=log), self.assertRaises(ValueError): audit(log, root, artifacts, order, ['propext','Quot.sound'], nonce)
        code, out, err = bounded_process([sys.executable, '-c', 'import sys; sys.stderr.write("forged audit\\n")'])
        self.assertEqual(code, 0); self.assertEqual(out, ''); self.assertIn('forged audit', err)

    def test_long_names_machine_axioms_and_stable_identity_across_assembly_nonces(self):
        a = json.loads((FIXTURES / 'locality.json').read_text())
        long_name = 'Locality' + 'x' * 40
        a['definitions'].append({'name': long_name, 'type': a['statement'], 'value': a['proof']})
        a['proof'] = 'by\n  exact ' + long_name + '\n'
        result = self.assert_used(a, empty(), [])
        full = 'B_' + result['bundle_hash'] + '.' + long_name
        self.assertEqual(set(result['declaration_axioms'][full]), {'propext', 'Quot.sound'})
        second = self.assert_used(a, empty(), [])
        self.assertEqual(result['artifact_hash'], second['artifact_hash'])
        self.assertNotEqual(result['assembly_hash'], second['assembly_hash'])

if __name__ == '__main__': unittest.main()
