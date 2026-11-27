"""Trusted v2 assembly: fixed statements and trusted proof-term inspection."""
from pathlib import Path
import re
from legacy_check import assemble as assemble_legacy
ROOT=Path(__file__).parent
ALLOWED=set('by intro r s h a f n hf ha rfl simp evalCNF renameCNF evalClause renameClause evalLiteral List.all_map List.any_map Function.comp_def constructor rcases with refine fun exact renaming_sound rw simpa only using .symm.trans'.split())
PUNCT=set('[],()⟨⟩·?_:=>')
def validate_expression(proof: str):
    if len(proof.encode())>12000:raise ValueError('proof input bound')
    tokens=re.findall(r'[A-Za-z_][A-Za-z_0-9.]*|\.symm\.trans|[^\s]',proof)
    if any(t not in ALLOWED and t not in PUNCT for t in tokens):raise ValueError('unsupported proof syntax')
    if not proof.lstrip().startswith('by\n'):raise ValueError('proof expression required')

def assemble(proof: str, goal='renaming', dependency=None) -> str:
    if goal=='renaming':return assemble_legacy(proof)
    if goal!='renaming_sat' or dependency is None:raise ValueError('enrolled goal and dependency required')
    validate_expression(proof)
    # Apply the v1 restricted grammar to the exact previously credited proof too.
    assemble_legacy(dependency)
    return 'import Lean\n'+(ROOT/'Trusted.lean').read_text()+'\ntheorem renaming_sound : RenamingSound := '+dependency+'\n'+(ROOT/'Downstream.lean').read_text()+'\ntheorem candidate : RenamingSAT := '+proof+'\nexample : RenamingSAT := candidate\n#print axioms candidate\n'+(ROOT/'Inspect.lean').read_text()
