/- Append this trusted test to the assembled `fixtures/renaming_sat.proof` source.
   It uses a separate test theorem to check the inspector's expression reductions. -/

private theorem probe : True := True.intro
private theorem directUse : True := probe
private theorem retainedBeta : True := (fun (p : True) => p) probe
private theorem discardedBeta : True := (fun (_ : True) => True.intro) probe
private theorem retainedProjection : True := (PProd.mk True.intro probe).snd
private theorem discardedProjection : True := (PProd.mk True.intro probe).fst
private theorem binderTypeOnly (_ : probe = probe) : True := True.intro
private theorem unusedLet : True :=
  let _unused := probe
  True.intro

private theorem retainedLet : True :=
  let p := probe
  p

private def proofPair : PProd True True := PProd.mk True.intro probe

open Lean Elab Command in
run_cmd do
  let env ← getEnv
  for (name, expected) in [
    (``directUse, true),
    (``retainedBeta, true),
    (``discardedBeta, false),
    (``retainedProjection, true),
    (``discardedProjection, false),
    (``binderTypeOnly, false),
    (``unusedLet, false),
    (``retainedLet, true)
  ] do
    let some (.thmInfo info) := env.find? name | throwError "Missing test theorem {name}"
    unless usesProofConstant env ``probe info.value == expected do
      throwError "Wrong proof-use result for {name}, expected {expected}"

  let some (.defnInfo pair) := env.find? ``proofPair | throwError "Missing test pair"
  if usesProofConstant env ``probe (.proj ``PProd 0 pair.value) then
    throwError "Kernel projection counted a discarded field"
  unless usesProofConstant env ``probe (.proj ``PProd 1 pair.value) do
    throwError "Kernel projection missed a retained field"

  let some (.thmInfo sat) := env.find? `candidate | throwError "Missing SAT theorem"
  unless usesProofConstant env `renaming_sound sat.value do
    throwError "SAT proof lost its direct reference to renaming_sound"
