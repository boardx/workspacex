"""Build-time relocation of installed, non-secret Debian LibreOffice assets.
The session namespace intentionally exposes /usr, but neither /etc nor /var.
"""
from pathlib import Path
import shutil

root = Path('/usr/lib/libreoffice')
external_roots = ('/etc/libreoffice/', '/var/lib/libreoffice/', '/var/spool/libreoffice/')
links = [path for path in root.rglob('*')
         if path.is_symlink() and str(path.readlink()).startswith(external_roots)]
for path in links:
    temporary = Path(str(path) + '.materialized')
    if path.is_dir():
        # Debian ships dangling optional LDAP *.sample links; they are not runtime config.
        shutil.copytree(path.resolve(), temporary, ignore_dangling_symlinks=True)
    else:
        shutil.copy2(path.resolve(), temporary)
    path.unlink()
    temporary.rename(path)
bootstrap = root / 'program/fundamentalrc'
bootstrap.write_text(bootstrap.read_text().replace(
    'file:///etc/libreoffice/registry', 'file:///usr/lib/libreoffice/share/registry'))
assert (root / 'share/registry/main.xcd').is_file()
print('LibreOffice installed configuration materialized inside /usr')
