open Lean in
private def proofConstructorField? (env : Environment) (structureName : Name) (index : Nat)
    (major : Expr) : Option Expr := do
  let .const name _ := major.getAppFn | none
  let some (.ctorInfo ctor) := env.find? name | none
  let args := major.getAppArgs
  if ctor.induct == structureName && index < ctor.numFields &&
      args.size == ctor.numParams + ctor.numFields then
    args[ctor.numParams + index]?
  else
    none

open Lean in
private partial def reduceProofHead (env : Environment) (expr : Expr) : Expr :=
  match expr with
  | .mdata _ body => reduceProofHead env body
  | .letE _ _ value body _ => reduceProofHead env (body.instantiate1 value)
  | .proj structureName index major =>
    let major := reduceProofHead env major
    match proofConstructorField? env structureName index major with
    | some field => reduceProofHead env field
    | none => .proj structureName index major
  | .app .. =>
    let fn := reduceProofHead env expr.getAppFn
    let args := expr.getAppArgs
    if fn.isLambda then
      reduceProofHead env (fn.beta args)
    else
      let app := mkAppN fn args
      app.withApp fun fn args =>
        match fn with
        | .const name _ =>
          match env.getProjectionFnInfo? name with
          | some field =>
            match env.find? field.ctorName, args[field.numParams]? with
            | some (.ctorInfo ctor), some major =>
              let projection := Expr.proj ctor.induct field.i major
              reduceProofHead env (mkAppRange projection (field.numParams + 1) args.size args)
            | _, _ => app
          | none => app
        | _ => app
  | _ => expr

-- Inspect the surviving expression after beta, zeta and projection reduction. Constant
-- bodies stay opaque, and an occurrence does not establish mathematical necessity.
open Lean in
partial def usesProofConstant (env : Environment) (target : Name) (expr : Expr) : Bool :=
  let expr := reduceProofHead env expr
  match expr with
  | .const name _ => name == target
  | .app .. =>
    usesProofConstant env target expr.getAppFn || expr.getAppArgs.any (usesProofConstant env target)
  | .lam _ _ body _ | .forallE _ _ body _ | .proj _ _ body =>
    usesProofConstant env target body
  | _ => false

open Lean Elab Command in
run_cmd do
  let env ← getEnv
  match env.find? `candidate with
  | some (.thmInfo info) =>
    if usesProofConstant env `renaming_sound info.value then
      logInfo "OPEN_MATH_PROOF_USE:renaming_sound"
    else
      logInfo "OPEN_MATH_PROOF_USE:none"
  | _ => throwError "candidate must be a theorem"
