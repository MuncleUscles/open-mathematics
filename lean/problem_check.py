"""Pinned problem-policy validation and bounded proof-expression assembly.

This lexical gate reduces attack surface; Docker isolation remains mandatory for
production. Problem statements are trusted only through the caller's policy pin.
"""
import hashlib
import json
from pathlib import Path
import re

SHA = re.compile(r'[a-f0-9]{64}')
COMMIT = re.compile(r'[a-f0-9]{40}')
SLUG = re.compile(r'[a-z][a-z0-9_-]{0,63}')
REPOSITORY = re.compile(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+')
FILE = re.compile(r'[A-Za-z][A-Za-z0-9_/-]*\.lean')
MAX_PROOF = 12000
MAX_FILE = 65536
MAX_CLOSURE = 262144


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def stable_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def exact(value, fields):
    return isinstance(value, dict) and set(value) == set(fields)


def read_contained(root, relative, maximum=MAX_FILE):
    require(isinstance(relative, str) and re.fullmatch(r'[A-Za-z0-9_./-]+', relative), 'Invalid relative file')
    parts = relative.split('/')
    require(all(part and part not in ('.', '..') for part in parts), 'Contained relative file required')
    root = Path(root).resolve(strict=True)
    file = root
    for part in parts:
        file = file / part
        require(not file.is_symlink(), 'Symlink in trusted file path')
    require(file.is_file() and file.stat().st_size <= maximum, 'Bounded regular file required')
    data = file.read_bytes()
    require(len(data) <= maximum, 'File exceeds size bound')
    data.decode('utf-8', errors='strict')
    return data


def parse_policy(data):
    require(len(data) <= MAX_FILE, 'Policy exceeds size bound')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    value = json.loads(data.decode('utf-8', errors='strict'), object_pairs_hook=pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Invalid JSON constant')))
    require(data.decode().rstrip() == json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False),
            'Normalized policy JSON required')
    return value


def goal_commitment(identifier, goal, files):
    fields = {key: value for key, value in goal.items() if key != 'goal_hash'}
    fields.update({'id': identifier, 'files': {file: files[file] for file in goal['definition_files']}})
    return sha(stable_json(fields).encode())


def proposition_text(goal):
    prefix = re.match(r'^def ([A-Za-z][A-Za-z0-9_]*) : Prop :=', goal['statement'])
    require(prefix is not None and goal['theorem'] == 'candidate : ' + prefix.group(1),
            'Theorem must match exact statement declaration')
    proposition = goal['statement'][prefix.end():].strip()
    require(bool(proposition), 'Empty proposition')
    return proposition


def statement_fingerprint(goal, files):
    return sha(stable_json({'definitions': [{'sha256': files[file]} for file in goal['definition_files'][:-1]],
                            'proposition': proposition_text(goal)}).encode())


def load_policy(root, relative, expected_hash, identifier):
    require(isinstance(expected_hash, str) and SHA.fullmatch(expected_hash), 'Expected policy hash required')
    data = read_contained(root, relative)
    require(sha(data) == expected_hash, 'Policy hash mismatch')
    policy = parse_policy(data)
    require(exact(policy, ['version', 'name', 'problem', 'repository', 'branch', 'toolchain', 'allowed_axioms', 'files', 'goals']) and type(policy['version']) is int and policy['version'] == 4, 'Exact v4 policy required')
    require(SLUG.fullmatch(policy['name']) and SLUG.fullmatch(policy['problem']) and REPOSITORY.fullmatch(policy['repository']) and policy['branch'] == 'research', 'Invalid policy identity')
    require(policy['toolchain'] == 'lean4:4.19.0', 'Pinned Lean4.19.0 required')
    allowed = policy['allowed_axioms']
    require(isinstance(allowed, list) and len(allowed) == len(set(allowed)) and set(allowed) <= {'propext', 'Quot.sound'}, 'Restricted axiom policy required')
    files, goals = policy['files'], policy['goals']
    require(isinstance(files, dict) and 1 <= len(files) <= 32 and isinstance(goals, dict) and 1 <= len(goals) <= 16, 'Bounded policy closure required')
    inputs = {}
    for file, digest in files.items():
        require(FILE.fullmatch(file) and all(part not in ('', '..') for part in file.split('/')) and isinstance(digest, str) and SHA.fullmatch(digest), 'Invalid trusted file pin')
        inputs[file] = read_contained(root, 'lean/' + file)
        require(sha(inputs[file]) == digest, 'Trusted definition hash mismatch: ' + file)
    require(sum(map(len, inputs.values())) <= MAX_CLOSURE, 'Trusted closure exceeds bound')
    fingerprints, paths = set(), set()
    for name, goal in goals.items():
        require(SLUG.fullmatch(name) and exact(goal, ['path', 'theorem', 'statement', 'statement_hash', 'goal_hash', 'definition_files', 'dependency', 'rewardable']), 'Exact goal fields required')
        require(goal['path'] == 'research/proofs/' + name + '.proof' and goal['path'] not in paths, 'Invalid proof path')
        paths.add(goal['path'])
        require(isinstance(goal['theorem'], str) and re.fullmatch(r'candidate : [A-Za-z][A-Za-z0-9_]*', goal['theorem']), 'Exact candidate type required')
        require(isinstance(goal['statement'], str) and 10 <= len(goal['statement']) <= 2000, 'Bounded statement required')
        require(goal['dependency'] is None and type(goal['rewardable']) is bool, 'Imported dependencies unsupported')
        closure = goal['definition_files']
        require(isinstance(closure, list) and 1 <= len(closure) <= 16 and len(set(closure)) == len(closure) and all(file in files for file in closure), 'Ordered definition closure required')
        require(inputs[closure[-1]].decode().strip() == goal['statement'], 'Final statement file differs from displayed theorem')
        require(isinstance(goal['statement_hash'], str) and SHA.fullmatch(goal['statement_hash']) and goal['statement_hash'] == statement_fingerprint(goal, files), 'Statement fingerprint mismatch')
        require(goal['statement_hash'] not in fingerprints, 'Duplicate statement fingerprint')
        fingerprints.add(goal['statement_hash'])
        require(isinstance(goal['goal_hash'], str) and goal['goal_hash'] == goal_commitment(name, goal, files), 'Goal commitment mismatch')
    require(identifier in goals, 'Goal not in pinned policy')
    return policy, goals[identifier], data, inputs


# Explicit tactics and constructive term forms. No strings/comments/backticks,
# command separators, imports, quotations, evaluators or arbitrary namespaces.
WORDS = set('by intro intros constructor obtain rcases with have let refine apply exact cases induction rename_i simp simpa only using rw rfl change show from fun if then else match omega assumption contradiction decide subst specialize clear at all true false True False Prop Type Nat Bool List Option And Or Exists Not Eq Decidable Function Prod Iff some none nil cons zero succ inl inr left right congrArg congrFun id if_pos if_neg dif_pos dif_neg ite_true ite_false'.split())
NAMESPACES = {'List', 'Nat', 'Bool', 'Prod', 'And', 'Or', 'Exists', 'False', 'True', 'Eq', 'Not', 'Decidable', 'Option', 'Function', 'Iff'}
FORBIDDEN = set('axiom axiomArray sorry sorryAx admit native_decide native_refl implemented_by unsafe partial opaque noncomputable theorem lemma def abbrev instance class structure inductive import prelude namespace section end open export attribute syntax macro macro_rules elab elab_rules deriving set_option include omit variable variables universe universes mutual termination_by decreasing_by initialize builtin_initialize run_tac run_elab run_meta run_io run_cmd eval_tactic eval_expr unsafeCast unsafeCoerce unsafePerformIO do IO Lean Meta Elab Environment System Process String Char Array ByteArray Task USize UInt8 UInt16 UInt32 UInt64 ofReduceBool ofReduceNat of_decide_eq_true trustCompiler candidate'.split())
TOKEN = re.compile(r'[A-Za-z_][A-Za-z_0-9]*(?:\.(?:[A-Za-z_][A-Za-z_0-9]*|[0-9]+))*|[0-9]+|<;>|:=|=>|->|==|!=|<=|>=|\+\+|[^\s]')
PUNCT = set('()[]{}⟨⟩,:·?_=<>+*-/%|!@;∀∃→↔¬∧∨∈∉≤≥≠←∷') | {'<;>', ':=', '=>', '->', '==', '!=', '<=', '>=', '++'}
IDENT = r'[A-Za-z][A-Za-z_0-9]*'


def local_names(proof):
    names = set()
    patterns = [r'\b(?:have|let|rename_i)\s+(' + IDENT + r')',
                r'\b(?:intro|intros)\s+([^\n;]+)',
                r'\bfun\s+([^\n]*?)=>',
                r'\b(?:obtain)\s+(.*?)\s*:=',
                r'\brcases\s+[^\n]*?\s+with\s+([^\n]+)',
                r'\(([^():\n]+)\s*:',
                r'\bcases\s+(' + IDENT + r')\s*:',
                r'\|\s*' + IDENT + r'\s+([^\n]*?)=>']
    for pattern in patterns:
        for match in re.finditer(pattern, proof):
            names.update(re.findall(IDENT, match.group(1)))
    return names - WORDS - FORBIDDEN


def validate_expression(proof, trusted_source):
    require(isinstance(proof, str) and 0 < len(proof.encode()) <= MAX_PROOF, 'Proof input bound')
    require(proof.startswith('by\n'), 'Proof must begin with by and newline')
    require(all(ord(c) >= 32 or c in '\n\t' for c in proof), 'Control characters forbidden')
    require(not any(x in proof for x in ['--', '/-', '-/', '"', "'", '`', '#', '$', '\\']), 'Comments, strings, quotations and commands forbidden')
    trusted = set(re.findall(r'^(?:def|abbrev|theorem|lemma|structure|inductive)\s+(' + IDENT + r')\b', trusted_source, re.M))
    locals_ = local_names(proof)
    tokens = TOKEN.findall(proof)
    require(len(tokens) <= 6000, 'Proof token bound')
    stack, closing = [], {')': '(', ']': '[', '}': '{', '⟩': '⟨'}
    for token in tokens:
        if token in '([{⟨':
            stack.append(token)
            require(len(stack) <= 64, 'Proof nesting bound')
        elif token in closing:
            require(stack and stack.pop() == closing[token], 'Unbalanced proof delimiters')
        if token in PUNCT or token == '_':
            continue
        if token.isdecimal():
            require(len(token) <= 80, 'Numeric literal bound')
            continue
        require(re.fullmatch(r'[A-Za-z][A-Za-z_0-9]*(?:\.(?:[A-Za-z][A-Za-z_0-9]*|[0-9]+))*', token), 'Unsupported proof token')
        parts = token.split('.')
        require(not any(part in FORBIDDEN or part.startswith('__') for part in parts), 'Forbidden proof identifier')
        require(token in trusted or not any(re.match(r'(?:run_|eval_|native|unsafe|elab|meta)', part, re.I) for part in parts), 'Metaprogramming identifier forbidden')
        if len(parts) == 1:
            require(token in WORDS or token in trusted or token in locals_, 'Identifier is not a permitted tactic, definition or bound local: ' + token)
        elif parts[0] in NAMESPACES:
            pass  # Reviewed Core constructive namespaces; isolation still required.
        else:
            require(parts[0] in locals_ and all(p in {'1', '2', 'mp', 'mpr', 'symm', 'trans'} for p in parts[1:]), 'Unapproved namespace or projection')
    require(not stack, 'Unbalanced proof delimiters')


def assemble(policy, goal, inputs, proof):
    source = b'\n'.join(inputs[file] for file in goal['definition_files'])
    validate_expression(proof.decode('utf-8', errors='strict'), source.decode())
    target = goal['theorem'].split(' : ', 1)[1]
    # Indentation and a balanced parenthesized expression prevent top-level escape.
    expression = b'\n'.join(b'  ' + line for line in proof.split(b'\n'))
    return (b'set_option autoImplicit false\n' + source + b'\n\ntheorem ' + goal['theorem'].encode() + b' := (\n' + expression +
            b'\n)\nexample : ' + target.encode() + b' := candidate\n#print axioms candidate\n')
