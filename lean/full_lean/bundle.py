"""Strict data-only submission and accepted-dependency assembly.

This module never executes Lean. The resulting source is hostile input and must
only be handed to the isolated compiler/exporter stage.
"""
import re
from open_check import (MAX_BUNDLE, MAX_CLOSURE, MAX_DIRECT, MAX_IMPORTED, MAX_DEPTH,
                        HASH, ID, bounded_file, namespace, declarations,
                        parse_bundle as legacy_bundle, validate_bundle_expressions)
from problem_check import require, sha, parse_policy

MODULE = re.compile(r'Mathlib(?:\.[A-Za-z][A-Za-z0-9_]*)+')
DECL = re.compile(r'[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*')
TOOLCHAIN = 'lean4:4.36.0'
MATHLIB_COMMIT = 'fc4f59e577feb1a4956671bc04ac18aaaf8cd842'
ALLOWED_AXIOMS = ['propext', 'Classical.choice', 'Quot.sound']


def parse_bundle(raw):
    require(len(raw) <= MAX_BUNDLE, 'Bundle exceeds 32768 UTF-8 bytes')
    bundle = parse_policy(raw)
    if bundle.get('version') == 1:
        return legacy_bundle(raw)
    require(set(bundle) == {'version', 'imports', 'source', 'theorem', 'dependencies'}
            and type(bundle['version']) is int and bundle['version'] == 2,
            'Exact version-two full Lean bundle required')
    imports = bundle['imports']
    require(isinstance(imports, list) and len(imports) <= 8 and
            all(isinstance(x, str) and len(x) <= 160 and MODULE.fullmatch(x) for x in imports)
            and len(imports) == len(set(imports)), 'At most eight specific Mathlib module imports')
    require(isinstance(bundle['source'], str) and bundle['source'].strip() and len(bundle['source'].encode()) <= 30000
            and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', bundle['source']), 'Nonempty UTF-8 Lean source required')
    require(isinstance(bundle['theorem'], str) and len(bundle['theorem']) <= 160
            and DECL.fullmatch(bundle['theorem']) and not bundle['theorem'].startswith('B_'),
            'Relative theorem name required')
    require(isinstance(bundle['dependencies'], list) and len(bundle['dependencies']) <= MAX_DIRECT,
            'At most four direct dependencies')
    ids, hashes = set(), set()
    for pin in bundle['dependencies']:
        require(isinstance(pin, dict) and set(pin) == {'id', 'bundle_hash'}
                and isinstance(pin['id'], str) and len(pin['id']) <= 100 and ID.fullmatch(pin['id'])
                and isinstance(pin['bundle_hash'], str) and HASH.fullmatch(pin['bundle_hash']),
                'Exact dependency ID and bundle hash required')
        require(pin['id'] not in ids and pin['bundle_hash'] not in hashes, 'Repeated dependency')
        ids.add(pin['id']); hashes.add(pin['bundle_hash'])
    return bundle


def theorem(item):
    return namespace(item['bundle_hash']) + '.' + (
        item['bundle']['theorem'] if item['bundle']['version'] == 2 else 'result')


def load_closure(raw, manifest_raw):
    root = {'bytes': raw, 'bundle_hash': sha(raw), 'bundle': parse_bundle(raw)}
    manifest = parse_policy(manifest_raw)
    require(set(manifest) == {'version', 'artifacts'} and type(manifest['version']) is int
            and manifest['version'] == 1 and isinstance(manifest['artifacts'], list)
            and len(manifest['artifacts']) <= MAX_IMPORTED, 'Bounded trusted manifest required')
    artifacts, hashes = {}, set()
    for item in manifest['artifacts']:
        require(isinstance(item, dict) and set(item) == {'id', 'bundle_hash', 'artifact_hash', 'path'}
                and isinstance(item['id'], str) and ID.fullmatch(item['id'])
                and isinstance(item['bundle_hash'], str) and HASH.fullmatch(item['bundle_hash'])
                and item['artifact_hash'] == item['bundle_hash']
                and isinstance(item['path'], str) and len(item['path']) <= 2048,
                'Exact accepted artifact metadata required')
        require(item['id'] not in artifacts and item['bundle_hash'] not in hashes
                and item['bundle_hash'] != root['bundle_hash'], 'Duplicate or self dependency')
        data = bounded_file(item['path'], MAX_BUNDLE)
        require(sha(data) == item['bundle_hash'], 'Accepted dependency bytes changed')
        artifacts[item['id']] = {**item, 'bytes': data, 'bundle': parse_bundle(data)}
        hashes.add(item['bundle_hash'])
    require(len(raw) + sum(len(a['bytes']) for a in artifacts.values()) <= MAX_CLOSURE,
            'Dependency closure exceeds byte bound')
    visiting, visited, order, heights = set(), set(), [], {}

    def visit(item, depth):
        require(depth <= MAX_DEPTH, 'Dependency depth bound')
        for pin in sorted(item['bundle']['dependencies'], key=lambda p: p['id']):
            key = pin['id']
            require(key in artifacts and artifacts[key]['bundle_hash'] == pin['bundle_hash'],
                    'Missing or mismatched accepted dependency')
            require(key not in visiting, 'Circular dependency')
            if key not in visited:
                visiting.add(key); visit(artifacts[key], depth + 1); visiting.remove(key)
                visited.add(key); order.append(key)
                heights[key] = 1 + max([heights[p['id']] for p in artifacts[key]['bundle']['dependencies']], default=0)
        if item['bundle']['version'] == 1:
            require(all(artifacts[p['id']]['bundle']['version'] == 1 for p in item['bundle']['dependencies']),
                    'Legacy bundle cannot import modern source')
            validate_bundle_expressions(item['bundle'], artifacts)

    visit(root, 0)
    require(visited == set(artifacts), 'Extraneous accepted dependency')
    require(max([heights[p['id']] for p in root['bundle']['dependencies']], default=0) <= MAX_DEPTH,
            'Dependency longest path bound')
    return root, artifacts, order


def assemble(items):
    imports = sorted({module for item in items for module in item['bundle'].get('imports', [])})
    require(len(imports) <= 32, 'Closure import bound')
    source = 'import Init\n' + ''.join('import ' + module + '\n' for module in imports)
    for item in items:
        if item['bundle']['version'] == 1:
            source += '\n' + declarations(item)
        else:
            prefix = namespace(item['bundle_hash'])
            source += '\nnamespace ' + prefix + '\n' + item['bundle']['source'] + '\nend ' + prefix + '\n'
    return source.encode('utf-8'), ['Init'] + imports
