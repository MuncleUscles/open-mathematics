-- Boundary checks: empty conjunction is true; an empty clause is false.
example : Satisfiable ([] : CNF) := ⟨fun _ => false, rfl⟩
example : ¬ Satisfiable ([[]] : CNF) := by
  intro ⟨a, ha⟩
  simp [evalCNF, evalClause] at ha

-- Removing disjointness would be false: two opposite unit clauses.
example : Satisfiable [[(0, true)]] := ⟨fun _ => true, rfl⟩
example : Satisfiable [[(0, false)]] := ⟨fun _ => false, rfl⟩
example : ¬ Satisfiable ([[(0, true)]] ++ [[(0, false)]]) := by
  intro ⟨a, ha⟩
  change ((a 0 == true || false) && ((a 0 == false || false) && true)) = true at ha
  cases h : a 0 <;> simp [h] at ha

-- Disjointness is sufficient, not necessary for a particular pair.
example : Satisfiable ([[(0, true)]] ++ [[(0, true)]]) := ⟨fun _ => true, rfl⟩
example : ¬ DisjointCNFVars [[(0, true)]] [[(0, true)]] := by
  intro h
  exact h 0 (by simp [cnfVars]) (by simp [cnfVars])
