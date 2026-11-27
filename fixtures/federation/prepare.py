#!/usr/bin/env python3
"""Package reviewed source as proof data; never execute contributed Lean.

Without --accepted-b-id, C is explicitly a local dependency fixture. After B
has an actual accepted ledger ID, pass it to create C.bound.json for a new
verification run. Supplying an ID here does not prove ledger acceptance.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOCAL_ID = 'local-fixture:B-not-accepted'
GRAPH_IMPORTS = ['Mathlib.Combinatorics.SimpleGraph.Basic',
                 'Mathlib.Data.Fintype.Prod', 'Mathlib.Data.Fintype.Fin',
                 'Mathlib.Tactic']


def write_json(path, value):
    data = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--accepted-b-id')
    args = parser.parse_args()
    out = ROOT / 'bundles'
    out.mkdir(exist_ok=True)
    hashes = {}
    for case, imports, theorem in [
        ('A', ['Mathlib.Tactic.Ring'], 'PEqualNP.Outside.L_gct_126'),
        ('B', GRAPH_IMPORTS, 'Federation.graphCNF_delete_vertex'),
    ]:
        hashes[case] = write_json(out / (case + '.json'), {
            'version': 2, 'imports': imports,
            'source': (ROOT / 'sources' / (case + '.lean')).read_text(),
            'theorem': theorem, 'dependencies': [],
        })
    source = (ROOT / 'sources/C.lean.template').read_text().replace(
        '__B_NAMESPACE__', 'B_' + hashes['B'])
    template = {'version': 2, 'imports': GRAPH_IMPORTS, 'source': source,
                'theorem': 'FederationDownstream.forced_vertex_reduction',
                'dependencies': [{'id': '__ACCEPTED_B_ID_REQUIRED__', 'bundle_hash': hashes['B']}]}
    write_json(out / 'C.template.json', template)
    local = json.loads(json.dumps(template))
    local['dependencies'][0]['id'] = args.accepted_b_id or LOCAL_ID
    mode = 'bound' if args.accepted_b_id else 'local'
    hashes['C.' + mode] = write_json(out / ('C.' + mode + '.json'), local)
    write_json(ROOT / 'verification' / ('dependencies.' + mode + '.json'), {
        'version': 1,
        'artifacts': [{'id': local['dependencies'][0]['id'],
                       'bundle_hash': hashes['B'], 'artifact_hash': hashes['B'],
                       'path': str(out / 'B.json')}],
    })
    write_json(ROOT / 'bundles/hashes.json', hashes)
    print(json.dumps({'mode': mode, 'hashes': hashes,
                      'ledger_acceptance_checked': False}, indent=2))


if __name__ == '__main__':
    main()
