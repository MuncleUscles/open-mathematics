"""Data-only reader for Lean's pinned NDJSON 3.1 export format.

This is NOT a kernel. Fresh, isolated kernels must validate the same bytes before
an attestation is issued. It reconstructs structural commitments, compares all
imported declarations, and renders statements without executing PR code, loading
its compiled objects, or consulting its notation/pretty-printer extensions.
"""
import hashlib
import json
import re
from pathlib import Path
from problem_check import require, stable_json, sha

MAX_EXPORT = 256 * 1024 * 1024
MAX_LINE = 8 * 1024 * 1024
MAX_NODES = 2_000_000
MAX_STATEMENT = 4000


def encode(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


def unique(items):
    result = {}
    for key, value in items:
        require(key not in result, 'Duplicate JSON key in serialized proof')
        result[key] = value
    return result


def exact(value, fields):
    require(isinstance(value, dict) and set(value) == set(fields), 'Unexpected serialized proof fields')
    return value


def nat(value):
    require(type(value) is int and 0 <= value < 2**64, 'Bounded natural number required')
    return value


def qualified(text):
    return tuple(text.split('.'))


def display_name(name):
    if all(isinstance(p, str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', p) for p in name):
        return '.'.join(name)
    # Quoted components cannot impersonate a dotted name or inject a new line.
    return 'Name' + encode(name)


class Export:
    def __init__(self):
        self.names = {0: ()}
        self.levels = {0: digest(['zero'])}
        self.exprs = {}
        self.nodes = {self.levels[0]: ('zero',)}
        self.constants = {}
        self.metadata = None

    def ref(self, table, index):
        require(nat(index) in table, 'Unknown serialized proof reference')
        return table[index]

    def name(self, index):
        return self.ref(self.names, index)

    def expr(self, index):
        return self.ref(self.exprs, index)

    def level(self, index):
        return self.ref(self.levels, index)

    def intern(self, node):
        key = digest(node)
        self.nodes[key] = tuple(node)
        require(len(self.nodes) <= MAX_NODES, 'Serialized proof node bound')
        return key

    def add(self, table, index, value):
        nat(index)
        require(index not in table, 'Duplicate serialized proof index')
        table[index] = value

    def item(self, row):
        require(isinstance(row, dict), 'Serialized proof object required')
        if 'in' in row:
            require(len(row) == 2, 'Invalid name record')
            kind = next(k for k in row if k != 'in'); data = row[kind]
            if kind == 'str':
                exact(data, ['pre', 'str'])
                require(isinstance(data['str'], str) and len(data['str']) <= 8192, 'Bounded name required')
                value = self.name(data['pre']) + (data['str'],)
            else:
                require(kind == 'num', 'Unknown name constructor'); exact(data, ['pre', 'i'])
                value = self.name(data['pre']) + (nat(data['i']),)
            require(len(value) <= 128, 'Name nesting bound')
            self.add(self.names, row['in'], value)
            return
        if 'il' in row:
            require(len(row) == 2, 'Invalid universe record')
            kind = next(k for k in row if k != 'il'); data = row[kind]
            if kind == 'succ': node = (kind, self.level(data))
            elif kind in ('max', 'imax'):
                require(isinstance(data, list) and len(data) == 2, 'Universe operands required')
                node = (kind, self.level(data[0]), self.level(data[1]))
            elif kind == 'param': node = (kind, self.name(data))
            else: raise ValueError('Unknown universe constructor')
            self.add(self.levels, row['il'], self.intern(node)); return
        if 'ie' in row:
            require(len(row) == 2, 'Invalid expression record')
            kind = next(k for k in row if k != 'ie'); data = row[kind]
            if kind == 'bvar': node = (kind, nat(data))
            elif kind == 'sort': node = (kind, self.level(data))
            elif kind == 'const':
                exact(data, ['name', 'us']); require(isinstance(data['us'], list), 'Universe list required')
                node = (kind, self.name(data['name']), tuple(self.level(x) for x in data['us']))
            elif kind == 'app':
                exact(data, ['fn', 'arg']); node = (kind, self.expr(data['fn']), self.expr(data['arg']))
            elif kind in ('lam', 'forallE'):
                exact(data, ['name', 'type', 'body', 'binderInfo']); self.name(data['name'])
                require(data['binderInfo'] in ('default', 'implicit', 'strictImplicit', 'instImplicit'), 'Binder info required')
                # Binder spelling is alpha-equivalent and never used for rendering.
                node = (kind, self.expr(data['type']), self.expr(data['body']), data['binderInfo'])
            elif kind == 'letE':
                exact(data, ['name', 'type', 'value', 'body', 'nondep']); self.name(data['name'])
                require(type(data['nondep']) is bool, 'Let flag required')
                node = (kind, self.expr(data['type']), self.expr(data['value']), self.expr(data['body']), data['nondep'])
            elif kind == 'proj':
                exact(data, ['typeName', 'idx', 'struct'])
                node = (kind, self.name(data['typeName']), nat(data['idx']), self.expr(data['struct']))
            elif kind == 'natVal':
                require(isinstance(data, str) and re.fullmatch(r'0|[1-9][0-9]{0,4095}', data), 'Canonical bounded natural literal required')
                node = (kind, data)
            elif kind == 'strVal':
                require(isinstance(data, str), 'String literal required'); node = (kind, data)
            elif kind == 'mdata':
                exact(data, ['expr', 'data']); require(isinstance(data['data'], dict), 'Metadata object required')
                # Exported metadata is not semantic and official readers drop it.
                self.add(self.exprs, row['ie'], self.expr(data['expr'])); return
            else: raise ValueError('Unknown expression constructor')
            self.add(self.exprs, row['ie'], self.intern(node)); return
        require(len(row) == 1, 'Exactly one declaration per record')
        kind, data = next(iter(row.items()))
        if kind == 'inductive':
            exact(data, ['types', 'ctors', 'recs'])
            for group, tag in [('types', 'induct'), ('ctors', 'ctor'), ('recs', 'rec')]:
                require(isinstance(data[group], list), 'Inductive group required')
                for item in data[group]: self.declaration(tag, item)
        else:
            self.declaration(kind, data)

    def declaration(self, kind, data):
        common = {'name', 'levelParams', 'type'}
        extra = {
            'axiom': {'isUnsafe'}, 'def': {'value', 'hints', 'safety', 'all'},
            'thm': {'value', 'all'}, 'opaque': {'value', 'all', 'isUnsafe'}, 'quot': {'kind'},
            'induct': {'numParams', 'numIndices', 'all', 'ctors', 'numNested', 'isRec', 'isUnsafe', 'isReflexive'},
            'ctor': {'induct', 'cidx', 'numParams', 'numFields', 'isUnsafe'},
            'rec': {'all', 'numParams', 'numIndices', 'numMotives', 'numMinors', 'rules', 'k', 'isUnsafe'},
        }
        require(kind in extra, 'Unknown declaration kind')
        exact(data, common | extra[kind])
        out = {'kind': kind}
        for key, value in data.items():
            if key in ('name', 'induct'): out[key] = self.name(value)
            elif key in ('levelParams', 'all', 'ctors'):
                require(isinstance(value, list), 'Name array required'); out[key] = [self.name(v) for v in value]
            elif key in ('type', 'value'): out[key] = self.expr(value)
            elif key in ('isUnsafe', 'isRec', 'isReflexive', 'k'):
                require(type(value) is bool, 'Declaration flag required'); out[key] = value
            elif key in ('numParams', 'numIndices', 'numNested', 'cidx', 'numFields', 'numMotives', 'numMinors'):
                out[key] = nat(value)
            elif key == 'rules':
                require(isinstance(value, list), 'Recursor rules required'); out[key] = []
                for rule in value:
                    exact(rule, ['ctor', 'nfields', 'rhs'])
                    out[key].append({'ctor': self.name(rule['ctor']), 'nfields': nat(rule['nfields']), 'rhs': self.expr(rule['rhs'])})
            elif key == 'hints':
                require(value in ('abbrev', 'opaque') if isinstance(value, str) else
                        isinstance(value, dict) and set(value) == {'regular'} and type(value['regular']) is int
                        and 0 <= value['regular'] < 2**32, 'Reducibility hints required')
                out[key] = value
            elif key == 'safety':
                require(value in ('safe', 'unsafe', 'partial'), 'Definition safety required'); out[key] = value
            elif key == 'kind':
                require(value in ('type', 'ctor', 'lift', 'ind'), 'Quotient kind required'); out['quot_kind'] = value
        require(out['name'] not in self.constants, 'Duplicate serialized declaration')
        self.constants[out['name']] = out

    @classmethod
    def read(cls, path):
        path = Path(path)
        require(path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_EXPORT,
                'Bounded regular serialized proof required')
        env = cls(); size = 0
        with path.open('rb') as stream:
            for number, line in enumerate(iter(lambda: stream.readline(MAX_LINE + 1), b'')):
                size += len(line)
                require(size <= MAX_EXPORT and len(line) <= MAX_LINE, 'Serialized proof exceeds size bound')
                row = json.loads(line.decode('utf-8'), object_pairs_hook=unique)
                if number == 0:
                    exact(row, ['meta']); meta = row['meta']; exact(meta, ['exporter', 'lean', 'format'])
                    require(meta['format'] == {'version': '3.1.0'}, 'Pinned export format required')
                    require(meta['lean']['version'] == '4.36.0', 'Pinned exported Lean version required')
                    env.metadata = meta
                else: env.item(row)
        require(env.metadata is not None and env.constants, 'Empty serialized proof')
        return env

    def expression_constants(self, key):
        todo, seen, result = [key], set(), set()
        while todo:
            key = todo.pop()
            if key in seen: continue
            seen.add(key); node = self.nodes[key]; kind = node[0]
            if kind == 'const': result.add(node[1])
            elif kind == 'proj': result.add(node[1]); todo.append(node[3])
            elif kind == 'app': todo.extend(node[1:3])
            elif kind in ('lam', 'forallE'): todo.extend(node[1:3])
            elif kind == 'letE': todo.extend(node[1:4])
        return result

    def references(self, declaration, proof=True):
        refs = self.expression_constants(declaration['type'])
        if proof and 'value' in declaration: refs |= self.expression_constants(declaration['value'])
        if declaration['kind'] == 'induct': refs |= set(declaration['ctors']) | set(declaration['all'])
        if declaration['kind'] == 'ctor': refs.add(declaration['induct'])
        if declaration['kind'] == 'rec':
            refs |= set(declaration['all'])
            for rule in declaration['rules']:
                refs.add(rule['ctor']); refs |= self.expression_constants(rule['rhs'])
        return refs

    def closure(self, names):
        todo, seen = list(names), set()
        while todo:
            name = todo.pop()
            if name in seen: continue
            require(name in self.constants, 'Missing declaration in exported closure: ' + display_name(name))
            seen.add(name); todo.extend(self.references(self.constants[name]) - seen)
        return seen


def compare_baseline(candidate, baseline, dependency_exports=()):
    trusted = dict(baseline.constants)
    for dependency in dependency_exports:
        for name, declaration in dependency.constants.items():
            require(name not in trusted or trusted[name] == declaration, 'Accepted dependency changes trusted declaration')
            trusted[name] = declaration
    for name, declaration in candidate.constants.items():
        if name in trusted:
            require(declaration == trusted[name], 'Candidate changed trusted declaration: ' + display_name(name))
    return trusted


def audit(candidate, baseline, theorem, allowed, dependency_exports=()):
    trusted = compare_baseline(candidate, baseline, dependency_exports)
    target = qualified(theorem)
    require(target in candidate.constants and candidate.constants[target]['kind'] == 'thm',
            'Selected theorem must be a proved theorem declaration')
    require(target not in trusted, 'Selected theorem must be new')
    reachable = candidate.closure([target])
    axioms = set()
    for name in reachable:
        declaration = candidate.constants[name]
        require(not declaration.get('isUnsafe') and declaration.get('safety', 'safe') == 'safe',
                'Unsafe or partial proof dependency')
        if declaration['kind'] == 'axiom':
            require(name in {qualified(x) for x in allowed}, 'Unauthorized axiom: ' + display_name(name))
            require(name in baseline.constants and declaration == baseline.constants[name], 'Axiom does not match trusted type')
            axioms.add(display_name(name))
        if declaration['kind'] == 'quot':
            require(name in baseline.constants and declaration == baseline.constants[name], 'Quotient primitive mismatch')
    return trusted, reachable, sorted(axioms)


def semantics(env, theorem, trusted):
    """Canonical, notation-free type and complete new semantic definition closure.

    Definitions used only in proofs do not change the proposition identity. The
    current bundle namespace is erased; other names stay exact. This deliberately
    does not claim to solve general definitional/mathematical equivalence.
    """
    target = qualified(theorem); prefix = target[0]; declaration = env.constants[target]
    budget = [MAX_STATEMENT]; semantic_defs = set(); normalized_nodes = {}

    def name(n):
        return ('SELF',) + n[1:] if n and n[0] == prefix else n

    def normalized(key, params):
        cache_key = (key, tuple(params))
        if cache_key in normalized_nodes: return normalized_nodes[cache_key]
        node = env.nodes[key]; kind = node[0]
        norm = lambda child: normalized(child, params)
        if kind == 'const': value = (kind, name(node[1]), tuple(norm(x) for x in node[2]))
        elif kind == 'param':
            require(node[1] in params, 'Undeclared universe parameter')
            value = (kind, params.index(node[1]))
        elif kind == 'proj': value = (kind, name(node[1]), node[2], norm(node[3]))
        elif kind in ('app', 'max', 'imax'): value = (kind, norm(node[1]), norm(node[2]))
        elif kind in ('succ', 'sort'): value = (kind, norm(node[1]))
        elif kind in ('lam', 'forallE'): value = (kind, norm(node[1]), norm(node[2]), node[3])
        elif kind == 'letE': value = (kind, *(norm(x) for x in node[1:4]), node[4])
        else: value = node
        result = digest(value); normalized_nodes[cache_key] = result; return result

    def emit(text):
        budget[0] -= len(text)
        require(budget[0] >= 0, 'Canonical theorem and definitions exceed 4000-character pilot limit')
        return text

    def render(key, params):
        node = env.nodes[key]; kind = node[0]
        if kind == 'zero': return emit('0')
        if kind == 'param':
            require(node[1] in params, 'Undeclared universe parameter')
            return emit('u' + str(params.index(node[1])))
        if kind == 'bvar': return emit('#' + str(node[1]))
        if kind == 'const':
            if node[1] not in trusted: semantic_defs.add(node[1])
            text = emit(display_name(name(node[1])))
            if node[2]: text += emit('.{') + emit(',').join(render(x, params) for x in node[2]) + emit('}')
            return text
        if kind in ('natVal', 'strVal'): return emit(node[1] if kind == 'natVal' else encode(node[1]))
        if kind == 'proj':
            if node[1] not in trusted: semantic_defs.add(node[1])
            return emit('(proj ' + display_name(name(node[1])) + ' ' + str(node[2]) + ' ') + render(node[3], params) + emit(')')
        tags = {'app': 'app', 'lam': 'lambda', 'forallE': 'forall', 'letE': 'let', 'sort': 'Sort',
                'succ': 'succ', 'max': 'max', 'imax': 'imax'}
        require(kind in tags, 'Unrenderable expression')
        keys = node[1:4] if kind == 'letE' else node[1:3] if kind in ('app', 'lam', 'forallE', 'max', 'imax') else node[1:2]
        return emit('(' + tags[kind] + ' ') + emit(' ').join(render(x, params) for x in keys) + emit(')')

    statement = emit('theorem : ') + render(declaration['type'], declaration['levelParams'])
    done, descriptions = set(), []
    while semantic_defs - done:
        current = sorted(semantic_defs - done, key=lambda n: encode(name(n)))[0]; done.add(current)
        require(current in env.constants, 'Missing statement definition')
        info = env.constants[current]
        params = info['levelParams']
        statement += emit('\n' + info['kind'] + ' ' + display_name(name(current)) + ' : ') + render(info['type'], params)
        record = {'kind': info['kind'], 'name': name(current), 'type': normalized(info['type'], params),
                  'levelParams': list(range(len(params)))}
        if 'value' in info and info['kind'] != 'thm':
            statement += emit(' := ') + render(info['value'], params); record['value'] = normalized(info['value'], params)
        if info['kind'] in ('induct', 'ctor', 'rec'):
            semantic_defs |= env.references(info)
            semantic_defs -= set(trusted)
            # Include the complete datatype/recursor package, not merely its type.
            extra = {k: v for k, v in info.items() if k not in ('name', 'type', 'levelParams', 'rules')}
            for field in ('all', 'ctors'):
                if field in extra: extra[field] = [name(n) for n in extra[field]]
            if 'induct' in extra: extra['induct'] = name(extra['induct'])
            if 'rules' in info:
                extra['rules'] = [{'ctor': name(r['ctor']), 'nfields': r['nfields'], 'rhs': normalized(r['rhs'], params)} for r in info['rules']]
                for rule in info['rules']:
                    statement += emit('\nrule ' + display_name(name(rule['ctor'])) + ' := ') + render(rule['rhs'], params)
            record['datatype'] = extra
            statement += emit(' [') + emit(encode({k: v for k, v in extra.items() if k != 'rules'})) + emit(']')
        require(info['kind'] not in ('axiom', 'quot'), 'New statement axiom or primitive forbidden')
        descriptions.append(record)
    identity = {'version': 1, 'type': normalized(declaration['type'], declaration['levelParams']), 'definitions': descriptions,
                'levelParams': list(range(len(declaration['levelParams'])))}
    require(len(statement) <= MAX_STATEMENT, 'Canonical theorem and definitions exceed 4000-character pilot limit')
    return statement, sha(stable_json(identity).encode()), digest(descriptions), identity


def proof_references(env, theorem, trusted=None):
    """Direct references after bounded beta, zeta, and constructor projection reduction.

    This detects syntactic use only, not necessity, independence, or novelty. It
    never expands arbitrary definitions or claims to erase every dead branch.
    """
    target_name = qualified(theorem); target = env.constants[target_name]
    budget, found, expanded = [200000], set(), set()
    safe_unfold = {qualified('Function.const'), qualified('letFun'), qualified('id')}

    def owned(name):
        return name not in trusted if trusted is not None else name[0] == target_name[0]

    def transparent(name):
        info = env.constants.get(name)
        if info and info['kind'] == 'def' and (owned(name) or name in safe_unfold):
            return info['value']
        return None

    def tick():
        budget[0] -= 1
        require(budget[0] >= 0, 'Proof reference reduction budget exceeded')

    def whnf(closure):
        while True:
            tick(); key, bindings = closure; node = env.nodes[key]; kind = node[0]
            if kind == 'bvar' and node[1] < len(bindings) and bindings[node[1]] is not None:
                closure = bindings[node[1]]; continue
            if kind == 'letE':
                closure = (node[3], ((node[2], bindings),) + bindings); continue
            if kind == 'const':
                value = transparent(node[1])
                if value is not None:
                    closure = (value, ()); continue
            if kind == 'app':
                fn = whnf((node[1], bindings)); f = env.nodes[fn[0]]
                if f[0] == 'lam':
                    closure = (f[2], ((node[2], bindings),) + fn[1]); continue
            if kind == 'proj':
                structure = whnf((node[3], bindings)); args = []
                while env.nodes[structure[0]][0] == 'app':
                    app = env.nodes[structure[0]]; args.append((app[2], structure[1]))
                    structure = whnf((app[1], structure[1]))
                head = env.nodes[structure[0]]
                info = env.constants.get(head[1]) if head[0] == 'const' else None
                if info and info['kind'] == 'ctor' and info['induct'] == node[1]:
                    args.reverse(); index = info['numParams'] + node[2]
                    if index < len(args): closure = args[index]; continue
            return closure

    def visit(closure):
        key, bindings = whnf(closure); node = env.nodes[key]; kind = node[0]
        if kind == 'const':
            found.add(node[1])
            info = env.constants.get(node[1])
            if (info and owned(node[1]) and node[1] not in expanded
                    and info['kind'] in ('thm', 'opaque') and 'value' in info):
                expanded.add(node[1]); visit((info['value'], ()))
        elif kind == 'app': visit((node[1], bindings)); visit((node[2], bindings))
        elif kind in ('lam', 'forallE'): visit((node[2], (None,) + bindings))
        elif kind == 'proj': visit((node[3], bindings))

    visit((target['value'], ()))
    return found
