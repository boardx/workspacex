#!/usr/bin/env python3
"""Maintainer only: assemble a secret-free standalone deployment kit."""
import hashlib,json,shutil,subprocess,tarfile,tempfile
from pathlib import Path
P=Path(__file__).resolve().parents[1]; R=P.parents[1]
FILES=['deploy-registry-images.py','registry-images.py','minimal-docker-release.py','hosted-release.py','canonical_control.py','install-image-release.sh']
def main():
    provenance=json.loads((P/'templates/provenance.json').read_text())
    for name,digest in provenance.items():
        if hashlib.sha256((R/name).read_bytes()).hexdigest()!=digest:
            raise SystemExit('Canonical source changed; review/regenerate kit before packaging: '+name)
    with tempfile.TemporaryDirectory() as temp:
        stage=Path(temp); kit=stage/'workspacex-us'
        shutil.copytree(P,kit,ignore=shutil.ignore_patterns('.local','dist','__pycache__','*.pyc'))
        patchtree=stage/'patch';patchtree.mkdir()
        for name in FILES:
            path=patchtree/'scripts'/name;path.parent.mkdir(exist_ok=True);shutil.copy2(R/'scripts'/name,path)
        path=patchtree/'.github/workflows/image-release.yml';path.parent.mkdir(parents=True);shutil.copy2(R/'.github/workflows/image-release.yml',path)
        subprocess.run(['git','apply','--unsafe-paths',str(P/'github/us-support.patch')],cwd=patchtree,check=True)
        shutil.copytree(patchtree/'scripts',kit/'tools')
        for name in ['docker-seccomp.json','docker-apparmor-sessions']:
            shutil.copy2(R/'apps/skill-sandbox/security'/name,kit/'templates'/name)
        sources={str(p.relative_to(kit)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(kit.rglob('*')) if p.is_file()}
        (kit/'SHA256SUMS').write_text(''.join(h+'  '+n+'\n' for n,h in sources.items()))
        (P/'dist').mkdir(exist_ok=True); archive=P/'dist/workspacex-us.tar.gz'
        with tarfile.open(archive,'w:gz') as t:t.add(kit,arcname=kit.name)
        digest=hashlib.sha256(archive.read_bytes()).hexdigest()
        (P/'dist/workspacex-us.tar.gz.sha256').write_text(digest+'  workspacex-us.tar.gz\n')
        print('Created '+str(archive)+'; configuration/secrets are excluded')
if __name__=='__main__':main()
