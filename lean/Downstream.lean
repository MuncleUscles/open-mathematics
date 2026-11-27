def Satisfiable (f : CNF) : Prop := ∃ a : Nat → Bool, evalCNF a f = true

def RenamingSAT : Prop := ∀ (r s : Nat → Nat), (∀ n, s (r n) = n) → ∀ f, Satisfiable (renameCNF r f) ↔ Satisfiable f
