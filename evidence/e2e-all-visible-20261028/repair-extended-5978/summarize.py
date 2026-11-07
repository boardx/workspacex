import json, re
from pathlib import Path
from collections import Counter
root = Path(__file__).resolve().parent
latest = {}
waves = {}
def identity(file, project, title):
    name = title.split(' > ')[-1]
    code = re.search(r'TW-[^：: ]+', name)
    return (Path(file).name, project, code.group() if code else name)
def walk(suites, wave):
    for suite in suites:
        for spec in suite.get('specs', []):
            for case in spec['tests']:
                row = dict(file=Path(spec.get('file', suite.get('file', ''))).name,
                    project=case['projectName'], title=spec['title'], status=case['status'],
                    resultStatus=case['results'][-1]['status'], wave=wave,
                    durationMs=case['results'][-1].get('duration'),
                    attachments=[dict(name=a['name'], path=str(Path(a['path']).relative_to(root)))
                        for a in case['results'][-1].get('attachments', []) if a.get('path')])
                latest[identity(row['file'], row['project'], row['title'])] = row
        walk(suite.get('suites', []), wave)
for wave in ['pass1', 'pass2', 'pass3', 'pass4']:
    data = json.loads((root / f'{wave}-results.json').read_text())
    waves[wave] = data['stats']
    walk(data['suites'], wave)
original = json.loads((root.parent / 'full-regression-20261029/failures.json').read_text())
retested = []
for old in original:
    found = latest[identity(old['file'], old['project'], old['title'])]
    retested.append(dict(original=old['title'], **found))
assert len(retested) == 17
assert all(row['status'] == 'expected' for row in retested), 'Original failures remain'
counts = Counter(row['status'] for row in latest.values())
assert not counts['unexpected'] and not counts['flaky'], counts
(root / 'original-17-retest.json').write_text(json.dumps(retested, ensure_ascii=False, indent=2) + '\n')
(root / 'latest-cases.json').write_text(json.dumps(list(latest.values()), ensure_ascii=False, indent=2) + '\n')
summary = dict(waves=waves, latestUnique=dict(counts), originalFailures=17, originalRetestedPassed=17)
(root / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(summary, ensure_ascii=False, indent=2))
