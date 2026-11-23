/- Protocol-owned code. This process imports only the image's pinned libraries.
   Candidate exports are parsed as data; their compiled objects are never loaded. -/
import LeanExport.Basic
import LeanExport.Parse

open Lean LeanExport

def main (args : List String) : IO Unit := do
  let [configPath] := args | throw <| IO.userError "one baseline plan required"
  let config ← IO.ofExcept <| Json.parse (← IO.FS.readFile configPath)
  let modules ← IO.ofExcept <| config.getObjValAs? (Array String) "imports"
  let files ← IO.ofExcept <| config.getObjValAs? (Array String) "exports"
  initSearchPath (← findSysroot)
  let imports := modules.map fun text => { module := text.toName : Import }
  let env ← importModules imports {}
  let mut names : Array Name := #[]
  for path in files do
    let exported ← parseStream <| .ofHandle (← IO.FS.Handle.mk path .read)
    for name in exported.constOrder do
      if (env.find? name).isSome then
        names := names.push name
  dumpEnv env (some names.toList) []
