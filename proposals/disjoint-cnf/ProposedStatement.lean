-- Trusted foundations. Core Lean only: no Mathlib dependency in this component.
def Clause := List (Nat × Bool)
def CNF := List Clause
def evalLiteral (a : Nat → Bool) (l : Nat × Bool) : Bool := a l.1 == l.2
def evalClause (a : Nat → Bool) (c : Clause) : Bool := c.any (evalLiteral a)
def evalCNF (a : Nat → Bool) (f : CNF) : Bool := f.all (evalClause a)
-- Goal: variable renaming commutes with CNF evaluation for every assignment.
-- This supports future reductions. It proves no complexity lower bound.
def renameClause (r : Nat → Nat) (c : Clause) : Clause := c.map (fun l => (r l.1, l.2))
def renameCNF (r : Nat → Nat) (f : CNF) : CNF := f.map (renameClause r)
def RenamingSound : Prop := ∀ (r : Nat → Nat) (a : Nat → Bool) (f : CNF),
  evalCNF a (renameCNF r f) = evalCNF (fun n => a (r n)) f

def Satisfiable (f : CNF) : Prop := ∃ a : Nat → Bool, evalCNF a f = true

-- Repeated variables are deliberately retained; membership is the only use.
def cnfVars (f : CNF) : List Nat := f.flatMap (fun c => c.map Prod.fst)
def DisjointCNFVars (f g : CNF) : Prop :=
  ∀ n : Nat, n ∈ cnfVars f → n ∈ cnfVars g → False

def DisjointSAT : Prop := ∀ (f g : CNF), DisjointCNFVars f g →
  (Satisfiable (List.append f g) ↔ Satisfiable f ∧ Satisfiable g)
