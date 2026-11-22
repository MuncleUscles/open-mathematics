#!/usr/bin/env python3
"""Proof input only. Never check out or execute a contributor's build scripts."""
import argparse,hashlib,json,os,re,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lean'))
from check import assemble
sha=lambda b:hashlib.sha256(b).hexdigest()
p=argparse.ArgumentParser();p.add_argument('proof',nargs='?',default=str(ROOT/'fixtures/renaming.proof'));p.add_argument('--trusted-fixture',action='store_true');p.add_argument('--head',default='0'*40);p.add_argument('--base',default='0'*40);p.add_argument('--repository',default='fixture/open-mathematics');a=p.parse_args()
proof=Path(a.proof).read_text();source=assemble(proof)
if not re.fullmatch('[a-f0-9]{40}',a.head) or not re.fullmatch('[a-f0-9]{40}',a.base):raise ValueError('exact commits required')
with tempfile.TemporaryDirectory() as d:
    file=Path(d)/'Check.lean';file.write_text(source);os.chmod(d,0o755);file.chmod(0o644)
    container_name='open-math-'+Path(d).name
    if a.trusted_fixture:
        if Path(a.proof).resolve()!=(ROOT/'fixtures/renaming.proof').resolve():raise ValueError('only bundled fixture may run outside isolation')
        lean=os.environ.get('LEAN_BIN','lean')
        version=subprocess.run([lean,'--version'],capture_output=True,text=True,check=True).stdout
        if 'version 4.19.0' not in version:raise ValueError('wrong Lean version')
        cmd=[lean,'--trust=0','-DmaxHeartbeats=100000',str(file)]
    else:
        image=os.environ.get('TRUSTED_LEAN_IMAGE','')
        if not re.fullmatch(r'(?:[\w./:-]+@)?sha256:[a-f0-9]{64}',image):raise ValueError('pinned isolated verifier image required')
        cmd=['docker','run','--rm','--name',container_name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=1g','--memory-swap=1g','--pids-limit=32','--ulimit=nofile=64:64','--user=65534:65534','--tmpfs=/tmp:rw,noexec,nosuid,size=32m','-v',f'{d}:/input:ro',image,'sh','-c','lean --version && exec lean --trust=0 -DmaxHeartbeats=100000 /input/Check.lean']
    try:
        result=subprocess.run(cmd,capture_output=True,text=True,timeout=45)
    finally:
        if not a.trusted_fixture:subprocess.run(['docker','rm','--force',container_name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
    log=result.stdout+result.stderr
    if not a.trusted_fixture and 'version 4.19.0' not in log:raise ValueError('isolated toolchain version mismatch')
    if result.returncode or 'sorry' in log or 'warning:' in log or 'error:' in log:raise ValueError('Lean rejected: '+log[:2000])
    match=re.search(r"'candidate' depends on axioms: \[(.*?)\]",log,re.S)
    if match:axioms=[x.strip() for x in match[1].split(',') if x.strip()]
    elif "'candidate' does not depend on any axioms" in log:axioms=[]
    else:raise ValueError('missing axiom report')
    if set(axioms)-{'propext','Quot.sound'}:raise ValueError('unauthorized axioms: '+str(axioms))
    policy=json.loads((ROOT/'lean/policy.json').read_text())
    for name in ['Trusted.lean','check.py']:
        if sha((ROOT/'lean'/name).read_bytes())!=policy['files'][name]:raise ValueError('trusted foundation changed')
    print(json.dumps({'result':'pass','mode':'trusted-fixture' if a.trusted_fixture else 'isolated','repository':a.repository,'head':a.head,'base':a.base,'toolchain':'leanprover/lean4:v4.19.0','checker':'open-mathematics-v1','policy':sha((ROOT/'lean/policy.json').read_bytes()),'statement_hash':sha((ROOT/'lean/Trusted.lean').read_bytes()),'artifact_hash':sha(source.encode()),'proof_hash':sha(proof.encode()),'axioms':axioms,'sorry':False,'theorems':['candidate : RenamingSound'],'log':log},indent=2))
