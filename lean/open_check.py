"""Bounded open research bundles; expression grammar is not a sandbox.

Core Nat/Bool/List/Option/Prod logic only, sequential nonrecursive definitions;
no commands, imports, custom syntax/inductives, IO, strings or metaprogramming.
The trusted worker resolves accepted artifacts. This module never fetches URLs.
"""
import json
from pathlib import Path
import re
from problem_check import WORDS, NAMESPACES, FORBIDDEN, TOKEN, PUNCT, local_names, require, sha, stable_json, parse_policy

FORBIDDEN = FORBIDDEN | {'native', 'by_elab', 'lcProof', 'lcAny', 'lcCast', 'lcUnreachable', 'Classical'}

MAX_BUNDLE, MAX_CLOSURE, MAX_DIRECT, MAX_IMPORTED, MAX_DEPTH = 32768, 262144, 4, 8, 4
HASH = re.compile(r'[a-f0-9]{64}')
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}')
NAME = re.compile(r'[A-Za-z][A-Za-z0-9_]{0,47}')
RESERVED = WORDS | FORBIDDEN | NAMESPACES | {'result', 'candidate', 'Fin', 'Int'}

def exact(x, fields):
    return isinstance(x, dict) and set(x) == set(fields)

def bounded_file(path, maximum):
    file = Path(path)
    require(file.is_file() and not file.is_symlink() and file.stat().st_size <= maximum, 'Bounded regular input required')
    data = file.read_bytes()
    require(len(data) <= maximum, 'Input byte bound')
    data.decode('utf-8', errors='strict')
    return data

def namespace(digest):
    require(isinstance(digest, str) and HASH.fullmatch(digest), 'Bundle hash required')
    return 'B_' + digest

def parse_bundle(data):
    require(len(data) <= MAX_BUNDLE, 'Bundle byte bound')
    b = parse_policy(data)
    require(exact(b, ['version', 'definitions', 'statement', 'proof', 'dependencies']) and type(b['version']) is int and b['version'] == 1, 'Exact version-one bundle required')
    require(isinstance(b['definitions'], list) and len(b['definitions']) <= 8, 'At most eight sequential definitions')
    names = set()
    for d in b['definitions']:
        require(exact(d, ['name', 'type', 'value']), 'Exact definition fields required')
        require(isinstance(d['name'], str) and NAME.fullmatch(d['name']) and d['name'] not in RESERVED and not d['name'].startswith('B_') and not re.match(r'(?:run_|eval_|native|unsafe|elab|meta)', d['name'], re.I) and d['name'] not in names, 'Unique nonreserved definition name required')
        names.add(d['name'])
        for key, limit in [('type', 2048), ('value', 4096)]:
            require(isinstance(d[key], str) and 0 < len(d[key].encode()) <= limit, 'Definition expression bound')
    require(isinstance(b['statement'], str) and b['statement'] == b['statement'].strip() and 0 < len(b['statement'].encode()) <= 4000, 'Bounded trimmed statement required')
    require(isinstance(b['proof'], str) and b['proof'].startswith('by\n') and len(b['proof'].encode()) <= 12000, 'Bounded tactic proof required')
    require(isinstance(b['dependencies'], list) and len(b['dependencies']) <= MAX_DIRECT, 'At most four direct dependencies')
    ids, hashes = set(), set()
    for d in b['dependencies']:
        require(exact(d, ['id', 'bundle_hash']) and isinstance(d['id'], str) and ID.fullmatch(d['id']) and isinstance(d['bundle_hash'], str) and HASH.fullmatch(d['bundle_hash']), 'Dependency ID/hash required')
        require(d['id'] not in ids and d['bundle_hash'] not in hashes, 'Repeated dependency')
        ids.add(d['id']); hashes.add(d['bundle_hash'])
    return b

def statement_hash(bundle):
    return sha(stable_json({key: bundle[key] for key in ['definitions', 'statement', 'dependencies']}).encode())

def validate_expression(text, known, imported):
    require(all(ord(c) >= 32 or c in '\n\t' for c in text), 'Control character forbidden')
    require(not any(x in text for x in ['--', '/-', '-/', '"', "'", '`', '#', '$', '\\']), 'Commands, comments, strings and quotation forbidden')
    locals_ = local_names(text)
    for m in re.finditer(r'[∀∃]\s+([^,:\n]+)(?:\s*:|,)', text):
        locals_.update(re.findall(r'[A-Za-z][A-Za-z_0-9]*', m.group(1)))
    tokens = TOKEN.findall(text)
    require(len(tokens) <= 6000, 'Expression token bound')
    stack, closing = [], {')': '(', ']': '[', '}': '{', '⟩': '⟨'}
    for t in tokens:
        if t in '([{⟨':
            stack.append(t); require(len(stack) <= 64, 'Expression nesting bound')
        elif t in closing:
            require(stack and stack.pop() == closing[t], 'Unbalanced expression')
        if t in PUNCT | {'×', '&'} or t == '_': continue
        if t.isdecimal():
            require(len(t) <= 80, 'Numeric literal bound'); continue
        require(re.fullmatch(r'[A-Za-z][A-Za-z_0-9]*(?:\.(?:[A-Za-z][A-Za-z_0-9]*|[0-9]+))*', t), 'Unsupported expression token')
        if t in imported: continue
        parts = t.split('.')
        require(not any(p in FORBIDDEN | {'result', 'candidate'} or p.startswith('__') for p in parts), 'Forbidden expression identifier')
        require(not any(re.match(r'(?:run_|eval_|native|unsafe|elab|meta)', p, re.I) for p in parts), 'Metaprogramming identifier forbidden')
        if len(parts) == 1:
            require(t in WORDS or t in known or t in locals_, 'Unapproved expression identifier: ' + t)
        elif parts[0] in NAMESPACES: pass
        else:
            require(parts[0] in locals_ and all(p in {'1', '2', 'mp', 'mpr', 'symm', 'trans'} for p in parts[1:]), 'Undeclared dependency namespace or projection')
    require(not stack, 'Unbalanced expression')

def validate_bundle_expressions(bundle, artifacts):
    imported = set()
    for pin in bundle['dependencies']:
        dep, prefix = artifacts[pin['id']]['bundle'], namespace(pin['bundle_hash'])
        imported.update(prefix + '.' + name for name in ['result'] + [d['name'] for d in dep['definitions']])
    known = set()
    for d in bundle['definitions']:
        validate_expression(d['type'], known, imported)
        validate_expression(d['value'], known, imported)
        known.add(d['name'])
    validate_expression(bundle['statement'], known, imported)
    validate_expression(bundle['proof'], known, imported)

def load_closure(root_bytes, manifest_bytes):
    root = {'bundle': parse_bundle(root_bytes), 'bytes': root_bytes, 'bundle_hash': sha(root_bytes)}
    manifest = parse_policy(manifest_bytes)
    require(exact(manifest, ['version', 'artifacts']) and type(manifest['version']) is int and manifest['version'] == 1 and isinstance(manifest['artifacts'], list) and len(manifest['artifacts']) <= MAX_IMPORTED, 'Bounded trusted manifest required')
    artifacts, hashes = {}, set()
    for item in manifest['artifacts']:
        require(exact(item, ['id', 'bundle_hash', 'artifact_hash', 'path']) and isinstance(item['id'], str) and ID.fullmatch(item['id']) and isinstance(item['bundle_hash'], str) and HASH.fullmatch(item['bundle_hash']) and isinstance(item['artifact_hash'], str) and HASH.fullmatch(item['artifact_hash']) and isinstance(item['path'], str) and len(item['path']) <= 2048, 'Exact trusted dependency metadata required')
        require(item['artifact_hash'] == item['bundle_hash'], 'Accepted artifact identity must be raw bundle hash')
        require(item['id'] not in artifacts and item['bundle_hash'] not in hashes and item['bundle_hash'] != root['bundle_hash'], 'Duplicate or self dependency')
        data = bounded_file(item['path'], MAX_BUNDLE)
        require(sha(data) == item['bundle_hash'], 'Accepted bundle bytes changed')
        artifacts[item['id']] = {**item, 'bytes': data, 'bundle': parse_bundle(data)}
        hashes.add(item['bundle_hash'])
    require(len(root_bytes) + sum(len(a['bytes']) for a in artifacts.values()) <= MAX_CLOSURE, 'Dependency closure byte bound')
    visiting, visited, order = set(), set(), []
    def visit(item, depth):
        require(depth <= MAX_DEPTH, 'Dependency depth bound')
        for pin in sorted(item['bundle']['dependencies'], key=lambda d: d['id']):
            key = pin['id']
            require(key in artifacts and artifacts[key]['bundle_hash'] == pin['bundle_hash'], 'Missing or mismatched accepted dependency')
            require(key not in visiting, 'Circular dependency')
            if key not in visited:
                visiting.add(key); visit(artifacts[key], depth + 1); visiting.remove(key)
                visited.add(key); order.append(key)
        validate_bundle_expressions(item['bundle'], artifacts)
    visit(root, 0)
    heights = {}
    for key in order:
        heights[key] = 1 + max([heights[d['id']] for d in artifacts[key]['bundle']['dependencies']], default=0)
    require(max([heights[d['id']] for d in root['bundle']['dependencies']], default=0) <= MAX_DEPTH, 'Dependency longest-path depth bound')
    require(visited == set(artifacts), 'Extraneous manifest artifacts')
    return root, artifacts, order

def expression(text):
    return '(\n' + '\n'.join('  ' + line for line in text.split('\n')) + '\n)'

def declarations(item):
    prefix, bundle = namespace(item['bundle_hash']), item['bundle']
    text = 'namespace ' + prefix + '\n'
    for d in bundle['definitions']:
        text += 'def ' + d['name'] + ' : ' + expression(d['type']) + ' := ' + expression(d['value']) + '\n'
    return text + 'theorem result : ' + expression(bundle['statement']) + ' := ' + expression(bundle['proof']) + '\nend ' + prefix + '\n'

# Reuse the reviewed beta/zeta/projection reducer, not its v2 command/target.
# Its exact bytes are part of each generated artifact commitment.
def inspector():
    source = Path(__file__).with_name('Inspect.lean').read_text()
    marker = '-- Inspect the surviving expression'
    require(source.count(marker) == 1, 'Trusted inspector layout changed')
    return source.split(marker)[0] + r'''
open Lean in
private partial def reduceOpenHead (env : Environment) (owned : Name) (fuel : Nat) (expr : Expr) : Expr :=
  if fuel == 0 then expr else
  let expr := reduceProofHead env expr
  match expr with
  | .const name _ =>
    if owned.isPrefixOf name || name == `letFun || name == `Function.const then
      match env.find? name with
      | some (.defnInfo info) => reduceOpenHead env owned (fuel - 1) info.value
      | _ => expr
    else expr
  | .app .. =>
    let fn := reduceOpenHead env owned (fuel - 1) expr.getAppFn
    if fn.isLambda then reduceOpenHead env owned (fuel - 1) (fn.beta expr.getAppArgs)
    else mkAppN fn expr.getAppArgs
  | .proj structureName index major =>
    let major := reduceOpenHead env owned (fuel - 1) major
    match proofConstructorField? env structureName index major with
    | some field => reduceOpenHead env owned (fuel - 1) field
    | none => .proj structureName index major
  | _ => expr

open Lean in
private partial def openUses (env : Environment) (owned target : Name) (fuel : Nat) (expr : Expr) : Bool :=
  if fuel == 0 then false else
  let expr := reduceOpenHead env owned fuel expr
  match expr with
  | .const name _ =>
    if name == target then true
    else if owned.isPrefixOf name || name == `letFun || name == `Function.const then
      match env.find? name with
      | some (.defnInfo info) => openUses env owned target (fuel - 1) info.value
      | _ => false
    else false
  | .app .. => openUses env owned target (fuel - 1) expr.getAppFn || expr.getAppArgs.any (openUses env owned target (fuel - 1))
  | .lam _ _ body _ | .forallE _ _ body _ | .proj _ _ body => openUses env owned target (fuel - 1) body
  | _ => false
'''

def assembly_hash(sources):
    return sha(stable_json({name: sha(data) for name, data in sources.items()}).encode())

def assemble(root, artifacts, order, nonce='0' * 32):
    require(re.fullmatch(r'[a-f0-9]{32}', nonce), 'Audit nonce required')
    items = [artifacts[key] for key in order] + [root]
    candidate = 'import Init\nset_option autoImplicit false\n'
    candidate += ''.join(declarations(item) for item in items)
    parts = ['import Lean\nimport Candidate\n', inspector(), 'open Lean Elab Command in\nrun_cmd do\n  let env ← getEnv\n']
    for name in sorted({d['name'] for item in items for d in item['bundle']['definitions']}):
        parts.append('  if env.contains `' + name + ' then throwError "Contributor definition collides with a root constant"\n')
    parts.append('  let mut reports : Array Json := #[]\n')
    for item in items:
        for name in [d['name'] for d in item['bundle']['definitions']] + ['result']:
            full = namespace(item['bundle_hash']) + '.' + name
            parts.append('  if (env.checked.get.find? `' + full + ').isNone then throwError "Declaration missing from checked kernel environment"\n')
            parts.append('  let axioms ← collectAxioms `' + full + '\n')
            parts.append('  if axioms.any (fun name => name != `propext && name != `Quot.sound) then throwError "Unauthorized axiom in bundle closure"\n')
            parts.append('  reports := reports.push (Json.mkObj [("constant", toJson ' + json.dumps(full) + '), ("axioms", toJson (axioms.map Name.toString))])\n')
    prefix = namespace(root['bundle_hash'])
    parts.append('  let mut used : Array String := #[]\n  match env.find? `' + prefix + '.result with\n  | some (.thmInfo ' + ('info' if root['bundle']['dependencies'] else '_info') + ') =>\n')
    for dep in root['bundle']['dependencies']:
        parts.append('    if openUses env `' + prefix + ' `' + namespace(dep['bundle_hash']) + '.result 20000 info.value then\n      used := used.push ' + json.dumps(dep['id']) + '\n')
    parts.append('    pure ()\n  | _ => throwError "root result must be a theorem"\n')
    parts.append('  let report := Json.mkObj [("declarations", toJson reports), ("used", toJson used)]\n')
    parts.append('  liftIO (IO.println (' + json.dumps('OPEN_RESEARCH_AUDIT:' + nonce + ':') + ' ++ report.compress))\n')
    return {'Candidate.lean': candidate.encode(), 'Check.lean': ''.join(parts).encode()}

def assemble_checked(root_bytes, manifest_bytes, nonce='0' * 32):
    root, artifacts, order = load_closure(root_bytes, manifest_bytes)
    # Stable accepted identity is the raw bundle, not a historical checker source.
    # Every dependency declaration is compiled and audited afresh below.
    return assemble(root, artifacts, order, nonce), root, artifacts, order
