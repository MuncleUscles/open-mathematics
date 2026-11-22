from pathlib import Path
import sys,pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lean'))
from check import assemble
@pytest.mark.parametrize('attack',['by\n sorry','by\n exact Classical.choice (sorry)','by\n axiom fake : False','by\n rfl\n#print axioms candidate','by\n run_tac unsafeIO (IO.println "success")','by\n native_decide','by\n simp\nend\ntheorem candidate : True := by trivial','by\n -- hide\n sorry','by\n exact ⟨⟩'])
def test_proof_bypasses_rejected(attack):
    with pytest.raises(ValueError):assemble(attack)
def test_trusted_statement_cannot_be_replaced():
    proof=(Path(__file__).resolve().parents[1]/'fixtures/renaming.proof').read_text()
    source=assemble(proof)
    assert 'theorem candidate : RenamingSound :=' in source
    assert 'example : RenamingSound := candidate' in source
