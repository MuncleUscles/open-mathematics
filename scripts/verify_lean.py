#!/usr/bin/env python3
"""Trusted assembly and isolated Lean checking; PR build scripts never execute."""
import argparse,hashlib,json,os,re,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lean'))
from check import assemble
from legacy_check import assemble as legacy_assemble
sha=lambda b:hashlib.sha256(b).hexdigest()
p=argparse.ArgumentParser()
p.add_argument('proof',nargs='?',default=str(ROOT/'fixtures/renaming.proof'))
p.add_argument('--goal',default='renaming');p.add_argument('--dependency-file');p.add_argument('--dependency-artifact')
p.add_argument('--trusted-fixture',action='store_true');p.add_argument('--head',default='0'*40);p.add_argument('--base',default='0'*40);p.add_argument('--repository',default='fixture/open-mathematics');a=p.parse_args()
policy=json.loads((ROOT/'lean/policy.json').read_text())
for name,expected in policy['files'].items():
    if sha((ROOT/'lean'/name).read_bytes())!=expected:raise ValueError('trusted foundation changed: '+name)
if a.goal not in policy['goals']:raise ValueError('unenrolled goal')
goal=policy['goals'][a.goal]
proof=Path(a.proof).read_bytes().decode('utf-8');dependency=None
if goal['dependency']:
    if not a.dependency_file or not re.fullmatch('[a-f0-9]{64}',a.dependency_artifact or ''):raise ValueError('exact credited dependency required')
    dependency=Path(a.dependency_file).read_bytes().decode('utf-8')
    if sha(legacy_assemble(dependency).encode())!=a.dependency_artifact:raise ValueError('credited dependency artifact mismatch')
elif a.dependency_file or a.dependency_artifact:raise ValueError('unexpected dependency')
source=assemble(proof,a.goal,dependency)
if not re.fullmatch('[a-f0-9]{40}',a.head) or not re.fullmatch('[a-f0-9]{40}',a.base):raise ValueError('exact commits required')
with tempfile.TemporaryDirectory() as d:
    file=Path(d)/'Check.lean';file.write_text(source);os.chmod(d,0o755);file.chmod(0o644)
    container_name='open-math-'+Path(d).name
    if a.trusted_fixture:
        if Path(a.proof).resolve()!=(ROOT/'fixtures'/('renaming_sat.proof' if a.goal=='renaming_sat' else 'renaming.proof')).resolve():raise ValueError('only bundled fixture may run outside isolation')
        if dependency is not None and Path(a.dependency_file).resolve()!=(ROOT/'fixtures/renaming.proof').resolve():raise ValueError('only bundled dependency may run outside isolation')
        lean=os.environ.get('LEAN_BIN','lean');version=subprocess.run([lean,'--version'],capture_output=True,text=True,check=True).stdout
        if 'version 4.19.0' not in version:raise ValueError('wrong Lean version')
        cmd=[lean,'--trust=0','-DmaxHeartbeats=100000',str(file)]
    else:
        image=os.environ.get('TRUSTED_LEAN_IMAGE','')
        if not re.fullmatch(r'(?:[\w./:-]+@)?sha256:[a-f0-9]{64}',image):raise ValueError('pinned isolated verifier image required')
        cmd=['docker','run','--rm','--name',container_name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=1g','--memory-swap=1g','--pids-limit=32','--ulimit=nofile=64:64','--user=65534:65534','--tmpfs=/tmp:rw,noexec,nosuid,size=32m','-v',f'{d}:/input:ro',image,'sh','-c','lean --version && exec lean --trust=0 -DmaxHeartbeats=100000 /input/Check.lean']
    try:result=subprocess.run(cmd,capture_output=True,text=True,timeout=45)
    finally:
        if not a.trusted_fixture:subprocess.run(['docker','rm','--force',container_name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
    log=result.stdout+result.stderr
    if not a.trusted_fixture and 'version 4.19.0' not in log:raise ValueError('isolated toolchain version mismatch')
    if result.returncode or 'sorry' in log or 'warning:' in log or 'error:' in log:raise ValueError('Lean rejected: '+log[:2000])
    match=re.search(r"'candidate' depends on axioms: \[(.*?)\]",log,re.S)
    if match:axioms=[x.strip() for x in match[1].split(',') if x.strip()]
    elif "'candidate' does not depend on any axioms" in log:axioms=[]
    else:raise ValueError('missing axiom report')
    if set(axioms)-set(policy['allowed_axioms']):raise ValueError('unauthorized axioms: '+str(axioms))
    used=re.findall(r'^OPEN_MATH_PROOF_USE:([^\n]+)$',log,re.M)
    if goal['dependency'] and used!=[goal['dependency']]:raise ValueError('required dependency is not used in the elaborated proof body')
    print(json.dumps({'result':'pass','mode':'trusted-fixture' if a.trusted_fixture else 'isolated','repository':a.repository,'head':a.head,'base':a.base,'toolchain':policy['toolchain'],'checker':'open-mathematics-v2','policy':sha((ROOT/'lean/policy.json').read_bytes()),'goal':a.goal,'statement_hash':goal['statement_hash'],'artifact_hash':sha(source.encode()),'proof_hash':sha(proof.encode()),'axioms':axioms,'sorry':False,'theorems':[goal['theorem']],'proof_body_uses':used,'dependency_artifact':a.dependency_artifact,'log':log},indent=2))
