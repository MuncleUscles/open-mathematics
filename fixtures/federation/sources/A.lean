/- Modified for pnp.fun: remove unused project import, narrow Mathlib imports,
   and place the unchanged theorem in the protocol bundle namespace.
   Source: brilliant-hq/pequalnp-proofs, PR #2, Apache-2.0.
   Formal contributor: brilliant-hq. Original discovery is not established. -/

theorem PEqualNP.Outside.L_gct_126 : ∀ (R : Type) [CommRing R] (x y z : R), 24 * x * y * z = (x + y + z) ^ 3 - (x + y - z) ^ 3 - (x - y + z) ^ 3 + (x - y - z) ^ 3 := by
  intro R _ x y z
  ring
