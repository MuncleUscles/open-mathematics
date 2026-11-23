"""Trusted bounded-container entry point. Never import candidate Python/Lean code."""
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from problem_check import require, stable_json
from full_lean.bundle import ALLOWED_AXIOMS
from full_lean.export import Export, audit, semantics, proof_references, qualified


def run(plan):
    base = Path('/input')
    baseline = Export.read(base / 'baseline.ndjson')
    for name in plan['primitives'] + ALLOWED_AXIOMS:
        require(qualified(name) in baseline.constants, 'Trusted baseline missing primitive or axiom')
    dependencies, reports = {}, {}
    for item in plan['dependencies']:
        require(item['file'].startswith('dependency-') and '/' not in item['file'], 'Invalid dependency export path')
        env = Export.read(base / item['file'])
        _, _, axioms = audit(env, baseline, item['theorem'], ALLOWED_AXIOMS,
                             [dependencies[key] for key in item['ancestors']])
        dependencies[item['id']] = env
        reports[item['theorem']] = axioms
    candidate = Export.read(base / 'candidate.ndjson')
    for name in plan['primitives'] + ALLOWED_AXIOMS:
        require(qualified(name) in candidate.constants, 'Candidate export missing primitive or axiom')
    trusted, _, axioms = audit(candidate, baseline, plan['theorem'], ALLOWED_AXIOMS, list(dependencies.values()))
    statement, statement_hash, definition_hash, canonical = semantics(candidate, plan['theorem'], trusted)
    # No declared dependency can receive reuse credit. Avoid reducing an entire
    # large proof just to intersect its references with an empty target set.
    references = proof_references(candidate, plan['theorem'], trusted) if plan['direct'] else set()
    used = [item['id'] for item in plan['direct'] if qualified(item['theorem']) in references]
    return {'formal_statement': statement, 'statement_hash': statement_hash, 'definition_closure_hash': definition_hash,
            'canonical_semantics': canonical, 'axioms': axioms, 'proof_body_uses': used,
            'declaration_axioms': {**reports, plan['theorem']: axioms}}


if __name__ == '__main__':
    try:
        plan = json.loads(Path(sys.argv[1]).read_text())
        print(stable_json(run(plan)))
    except (OSError, ValueError, TypeError, KeyError, RecursionError) as error:
        print(str(error)[:2400], file=sys.stderr)
        raise SystemExit(1)
