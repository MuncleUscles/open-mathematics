/- Modified for pnp.fun: remove unused upstream project import and add a
   graph-to-list-CNF compatibility proof using the existing CNF definitions.
   Upstream L-meta-253: PR #130, formal contributor lshhhhhhh, Apache-2.0.
   Original mathematical discovery is not established. No version migration. -/

theorem PEqualNP.Outside.L_meta_253 :
    ∀ (n : ℕ) (G : SimpleGraph (Fin n)) [DecidableRel G.Adj] (v : Fin n)
      (x : Fin n → Bool),
      decide (∃ u w : Fin n, G.Adj u w ∧
        Function.update x v false u = true ∧ Function.update x v false w = true) =
      decide (∃ u w : Fin n, u ≠ v ∧ w ≠ v ∧ G.Adj u w ∧
        x u = true ∧ x w = true) := by
  intro n G _ v x
  have updated (u : Fin n) :
      Function.update x v false u = true ↔ u ≠ v ∧ x u = true := by
    by_cases h : u = v
    · simp [h]
    · simp [h]
  rw [decide_eq_decide]
  simp_rw [updated]
  constructor
  · rintro ⟨u, w, hadj, ⟨huv, hu⟩, ⟨hwv, hw⟩⟩
    exact ⟨u, w, huv, hwv, hadj, hu, hw⟩
  · rintro ⟨u, w, huv, hwv, hadj, hu, hw⟩
    exact ⟨u, w, hadj, ⟨huv, hu⟩, ⟨hwv, hw⟩⟩

namespace Federation

-- These five definitions reproduce lean/Trusted.lean's list CNF semantics.
def Clause := List (Nat × Bool)
def CNF := List Clause
def evalLiteral (a : Nat → Bool) (l : Nat × Bool) : Bool := a l.1 == l.2
def evalClause (a : Nat → Bool) (c : Clause) : Bool := c.any (evalLiteral a)
def evalCNF (a : Nat → Bool) (f : CNF) : Bool := f.all (evalClause a)

noncomputable def relationCNF {n : ℕ} (R : Fin n → Fin n → Prop) [DecidableRel R] : CNF :=
  ((Finset.univ.filter (fun e : Fin n × Fin n => R e.1 e.2)).toList).map
    (fun e => [(e.1.val, true), (e.2.val, true)])

theorem relationCNF_semantics {n : ℕ} (R : Fin n → Fin n → Prop)
    [DecidableRel R] (a : Nat → Bool) :
    evalCNF a (relationCNF R) = true ↔
      ∀ u w : Fin n, R u w → a u.val = true ∨ a w.val = true := by
  constructor
  · intro h u w hR
    have hm : List.Mem [(u.val, true), (w.val, true)] (relationCNF R) := by
      apply List.mem_map.mpr
      refine ⟨(u, w), ?_, rfl⟩
      exact Finset.mem_toList.mpr (Finset.mem_filter.mpr ⟨Finset.mem_univ _, hR⟩)
    have hc := List.all_eq_true.mp h _ hm
    simpa [evalClause, evalLiteral] using hc
  · intro h
    apply List.all_eq_true.mpr
    intro c hc
    obtain ⟨⟨u, w⟩, he, rfl⟩ := List.mem_map.mp hc
    have hr : R u w := (Finset.mem_filter.mp (Finset.mem_toList.mp he)).2
    simpa [evalClause, evalLiteral] using h u w hr

theorem relationCNF_complement {n : ℕ} (R : Fin n → Fin n → Prop)
    [DecidableRel R] (a : Nat → Bool) :
    evalCNF a (relationCNF R) =
      !(decide (∃ u w : Fin n, R u w ∧ (!a u.val) = true ∧ (!a w.val) = true)) := by
  by_cases h : ∃ u w : Fin n, R u w ∧ (!a u.val) = true ∧ (!a w.val) = true
  · have he : evalCNF a (relationCNF R) = false := by
      cases hv : evalCNF a (relationCNF R)
      · rfl
      · obtain ⟨u, w, hR, hu, hw⟩ := h
        rcases (relationCNF_semantics R a).mp hv u w hR with ha | ha
        · simp [ha] at hu
        · simp [ha] at hw
    have hd : decide (∃ u w : Fin n, R u w ∧ (!a u.val) = true ∧ (!a w.val) = true) = true :=
      decide_eq_true h
    rw [hd, he]
    rfl
  · have he : evalCNF a (relationCNF R) = true := by
      apply (relationCNF_semantics R a).mpr
      intro u w hR
      cases hu : a u.val <;> cases hw : a w.val
      · exact False.elim (h ⟨u, w, hR, by simp [hu], by simp [hw]⟩)
      · exact Or.inr rfl
      · exact Or.inl rfl
      · exact Or.inl rfl
    have hd : decide (∃ u w : Fin n, R u w ∧ (!a u.val) = true ∧ (!a w.val) = true) = false :=
      decide_eq_false h
    rw [hd, he]
    rfl

theorem complement_update {n : ℕ} (a : Nat → Bool) (v : Fin n) :
    (fun u : Fin n => !(Function.update a v.val true u.val)) =
      Function.update (fun u : Fin n => !(a u.val)) v false := by
  funext u
  by_cases h : u = v
  · subst u
    simp
  · have hv : u.val ≠ v.val := fun e => h (Fin.ext e)
    simp [Function.update_of_ne h, Function.update_of_ne hv]

/-- Setting a cover variable true deletes its incident clauses. This connects
    the actual list CNF evaluator to the upstream graph restriction theorem. -/
theorem graphCNF_delete_vertex {n : ℕ} (G : SimpleGraph (Fin n))
    [DecidableRel G.Adj] (v : Fin n) (a : Nat → Bool) :
    evalCNF (Function.update a v.val true) (relationCNF G.Adj) =
      evalCNF a (relationCNF (fun u w => u ≠ v ∧ w ≠ v ∧ G.Adj u w)) := by
  rw [relationCNF_complement, relationCNF_complement]
  have h := PEqualNP.Outside.L_meta_253 n G v (fun u => !(a u.val))
  have hu := complement_update a v
  simp only [funext_iff] at hu
  simp only [hu]
  simpa only [and_assoc] using congrArg Bool.not h

end Federation
