"""Build a portable source ZIP and a single-file cofounder demo. No keys or DBs."""
from pathlib import Path
import base64,json,zipfile
root=Path(__file__).resolve().parents[1];dist=root/'dist'
allowed=['src','public','contracts','tests','lean','research','docs','scripts','github','fixtures','.github']
files=[root/n for n in ['README.md','AGENTS.md','LICENSE','package.json','package-lock.json','requirements.txt','.env.example','.gitignore']]
for directory in allowed:
    files += [p for p in (root/directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix not in ['.zip','.pyc']]
with zipfile.ZipFile(dist/'open-mathematics-source.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(files):
        if p.exists():z.write(p,'open-mathematics/'+str(p.relative_to(root)))
evidence={name:json.loads((root/'public'/file).read_text()) for name,file in [('studio','studio-evidence.json'),('lean','lean-evidence.json')]}
downloads={name:base64.b64encode((dist/name).read_bytes()).decode() for name in ['open-mathematics-source.zip','README.md','AGENTS.md','studio-evidence.json','lean-evidence.json']}
html=(dist/'index.html').read_text().replace('<link rel="stylesheet" href="style.css">','<style>'+(dist/'style.css').read_text()+'</style>')
boot='window.OPEN_MATH_EVIDENCE='+json.dumps(evidence)+';window.OPEN_MATH_DOWNLOADS='+json.dumps(downloads)+';'
script=(boot+(dist/'app.js').read_text()).replace('</script','<\\/script')
html=html.replace('<script src="app.js"></script>','<script>'+script+'</script>')
(dist/'standalone.html').write_text(html)
print('Packaged source ZIP and standalone.html')
