"""Independently reopen actual delivered PDF AcroForm in a fresh owned sandbox."""
import hashlib
import json
from pathlib import Path
from native_sandbox_fixture import real_native_session
root = Path(__file__).resolve().parents[3]
pdf = (root / 'docs/design/standard-capabilities/evidence/g-skill-batch/S006_FORM/filled.pdf').read_bytes()
script = b'''const fs=require('fs');const {PDFDocument}=require('pdf-lib');
(async()=>{const d=await PDFDocument.load(fs.readFileSync('/workspace/filled.pdf'));const f=d.getForm();
const observed={name:f.getTextField('name').getText(),date:f.getTextField('date').getText(),consent:f.getCheckBox('consent').isChecked()};
if(observed.name!=='TEST USER'||observed.date!=='2026-09-07'||observed.consent!==true)throw new Error('actual field values differ');
console.log(JSON.stringify(observed));})().catch(()=>{process.stderr.write('PDF form check failed');process.exitCode=1;});'''
with real_native_session(pins=[]) as (sandbox, _):
    for result in sandbox.upload_files([('/workspace/filled.pdf', pdf), ('/workspace/check.cjs', script)]):
        assert result.error is None
    result = sandbox.execute('node /workspace/check.cjs', timeout=30)
    assert result.exit_code == 0, result.output
    observed = json.loads(result.output)
print(json.dumps({'actualPdfSha256': hashlib.sha256(pdf).hexdigest(), 'reopenedFieldValues': observed, 'newSandboxSession': True, 'hostExecutedGeneratedSource': False}))
