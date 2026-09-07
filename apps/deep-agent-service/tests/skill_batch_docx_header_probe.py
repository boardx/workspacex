"""Isolated renderer comparison; altered copy is diagnostic, not model acceptance."""
import io
import json
import zipfile
from pathlib import Path
from native_sandbox_fixture import real_native_session
root = Path(__file__).resolve().parents[3]
evidence = root / 'docs/design/standard-capabilities/evidence/g-skill-batch/S003/header-probe'
evidence.mkdir(exist_ok=True)
original = (evidence.parent / 'report.docx').read_bytes()
output = io.BytesIO()
with zipfile.ZipFile(io.BytesIO(original)) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
    for item in source.infolist():
        data = source.read(item.filename)
        if item.filename == 'word/settings.xml':
            assert b'<w:evenAndOddHeaders w:val="false"/>' in data
            data = data.replace(b'<w:evenAndOddHeaders w:val="false"/>', b'')
        target.writestr(item, data)
renderer = (root / 'apps/api/scripts/office-package-resources/render-office.py').read_bytes()
with real_native_session(pins=[]) as (sandbox, _):
    for result in sandbox.upload_files([('/workspace/original.docx', original), ('/workspace/no-even-setting.docx', output.getvalue()), ('/workspace/render.py', renderer)]):
        assert result.error is None
    for name in ['original', 'no-even-setting']:
        result = sandbox.execute(f'python3 /workspace/render.py /workspace/{name}.docx /workspace/{name}-preview', timeout=120)
        assert result.exit_code == 0, result.output
        files = sandbox.download_files([f'/workspace/{name}-preview/page-2.png'])
        assert files[0].error is None
        (evidence / f'{name}-page-2.png').write_bytes(files[0].content)
print(json.dumps({'comparison': 'same DOCX except removing explicit false evenAndOddHeaders', 'changedModelArtifact': False, 'visualInspectionRequired': True}))
