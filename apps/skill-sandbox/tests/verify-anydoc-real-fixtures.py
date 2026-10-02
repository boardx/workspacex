"""Exercise the installed production AnyDoc CLI with real synthetic files, without a model."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--node', default='node')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
cli = (root / 'node_modules/@firecrawl/anydoc/cli.js').resolve(strict=True)
fixtures = Path(__file__).parent / 'fixtures/document-structure'
formats = {'pdf': fixtures / 'cross-page-table.pdf', 'docx': fixtures / 'native-locators.docx',
           'pptx': fixtures / 'native-locators.pptx', 'xlsx': fixtures / 'native-locators.xlsx'}
results = []
with tempfile.TemporaryDirectory(prefix='skills-anydoc-real-') as temporary:
    csv = Path(temporary) / 'source.csv'
    csv.write_text('group,revenue\nA,120\nB,450\n')
    formats['csv'] = csv
    for kind, source in formats.items():
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        output = Path(temporary) / f'{kind}.md'
        result = subprocess.run([args.node, str(cli), str(source), '--format', kind, '--output', str(output)],
                                capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, (kind, result.stderr)
        assert '120' in output.read_text(), kind
        assert hashlib.sha256(source.read_bytes()).hexdigest() == before
        if kind != 'csv':
            # Arbitrary single-line text is valid CSV; do not invent a corruption rule for it.
            corrupted = Path(temporary) / f'corrupt.{kind}'
            corrupted.write_bytes(b'synthetic broken document')
            invalid = Path(temporary) / f'bad-{kind}.md'
            failure = subprocess.run([args.node, str(cli), str(corrupted), '--format', kind, '--output', str(invalid)],
                                     capture_output=True, text=True, timeout=30)
            assert failure.returncode != 0, (kind, 'corrupt document succeeded')
            assert not invalid.exists()
        results.append({'format': kind, 'originalUnchanged': True, 'markdownContainsSourceValue': True,
                        'corruptChecked': kind != 'csv'})
print(json.dumps(results))
