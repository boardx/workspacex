"""Replay the actual delivered S007 source twice in a fresh owned sandbox, never on host."""
import base64
import hashlib
import json
import re
from pathlib import Path
from native_sandbox_fixture import real_native_session

root = Path(__file__).resolve().parents[3]
evidence = root / 'docs/design/standard-capabilities/evidence/g-skill-batch/S007'
code = (evidence / 'analyze.py').read_bytes()
source = (evidence / 'source.txt').read_bytes()
expected = (evidence / 'result.csv').read_bytes()
paths = set(re.findall(rb'/inputs/[a-f0-9]{64}/data\.csv', code))
assert len(paths) == 1
input_path = paths.pop().decode()
with real_native_session(pins=[], inputs=[{'path': input_path, 'contentBase64': base64.b64encode(source).decode()}]) as (sandbox, _):
    uploaded = sandbox.upload_files([('/workspace/analyze.py', code)])
    assert all(result.error is None for result in uploaded)
    hashes = []
    for _ in range(2):
        result = sandbox.execute('python3 /workspace/analyze.py', timeout=30)
        assert result.exit_code == 0 and not result.truncated
        files = sandbox.download_files(['/workspace/result.csv'])
        assert len(files) == 1 and files[0].error is None
        assert files[0].content == expected
        hashes.append(hashlib.sha256(files[0].content).hexdigest())
print(json.dumps({'actualPublishedCodeSha256': hashlib.sha256(code).hexdigest(), 'sourceSha256': hashlib.sha256(source).hexdigest(), 'freshSessionRuns': 2, 'byteIdenticalToPublishedCsv': True, 'csvHashes': hashes, 'hostExecutedGeneratedSource': False}))
