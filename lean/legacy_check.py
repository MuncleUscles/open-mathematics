"""Trusted wrapper: source is assembled by the verifier, not a PR workflow."""
from pathlib import Path
import re
ALLOWED = set('by intro r a f rfl simp evalCNF renameCNF evalClause renameClause evalLiteral List.all_map List.any_map Function.comp_def'.split())
def assemble(proof: str) -> str:
    if len(proof)>12000 or not proof.isascii(): raise ValueError('proof input bound or encoding')
    # Deliberately narrow MVP tactic vocabulary. No commands, comments, strings,
    # attributes, elaborators, imports, macros, eval, axioms or user definitions.
    tokens=re.findall(r'[A-Za-z_][A-Za-z_0-9.]*|[^\s]',proof)
    if any(t not in ALLOWED and t not in '[],' for t in tokens): raise ValueError('unsupported proof syntax')
    if not proof.lstrip().startswith('by\n'): raise ValueError('proof expression required')
    trusted=Path(__file__).with_name('Trusted.lean').read_text()
    return trusted+'\ntheorem candidate : RenamingSound := '+proof+'\nexample : RenamingSound := candidate\n#print axioms candidate\n'
