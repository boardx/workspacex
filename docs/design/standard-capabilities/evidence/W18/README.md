# W18 offline analysis and visualization increment

Two complete starter-pack skills reuse the Apache-2.0 Anthropic sources at
`1f517b9de47e827c80cd933ed364e16838072239`: data/skills/analyze and data-visualization.
Upstream text is unchanged, with LICENSE, resolved CONNECTORS reference and SHA256
provenance. WorkspaceX entry points and one shared runtime reference restrict execution
to authorized local CSV/JSON/XLSX and static PNG/PDF. Source hashes are recorded in
`upstream-digests.json`. No warehouse, notebook, browser or duplicate analysis engine exists.

`starter-pack.txt` verifies actual FileSkillStarterPackSource loading of both packages,
all bytes/digests/local references, generated-manifest freshness, absent deployment root,
missing version and tamper rejection. Import still requires the existing authorized
starter-pack API and configured SKILL_STARTER_PACK_ROOT; no claim of deployed/imported
skills or real-model following of instructions is made by these component tests.

## Real execution evidence

`baseline-red.txt`: previous renderer image cannot import pandas. Final test exited 0:
`real-analysis-tests.txt`, `results.json`, `results.csv`, `chart.png`, `chart.pdf`,
`chart-page.png` (the latter is actual Poppler rendering of the PDF).

- CSV/XLSX/JSON each have six records and produce totals 甲10, 乙40, sum50.
- Missing and invalid numeric inputs are counted separately (one each); one duplicate is
  explicitly preserved and genuine zero retained. Input SHA256 remains unchanged.
- The exact same script executes twice and result JSON compares byte-identically.
- Invalid columns fail before any result file; openpyxl's actual XML parser rejects
  entity expansion through the hash-locked defusedxml dependency.
- Chinese PDF text is extracted correctly and both PDF/page generation reject font/type
  mismatch or fontconfig warnings. Worker inspected both PNG and rendered PDF page:
  Chinese legible, axis units/zero baseline correct, labels40/10 match result table, no
  clipping. This is a known-answer simple chart fixture, not exhaustive visual QA.

The tested image is `sha256:3ca8f5f0661fbf220863682a0c4021560213f9dfcb8f9ddb764158d9fa1c699c`,
arm64, Docker image Size372,611,044 bytes (renderer baseline288,926,138, same metric).
The actual cgroup memory limit1,073,741,824 bytes, pids128 and UID1000 are asserted;
actual peaks215,048,192 bytes and33PIDs. Namespace checks assert /etc/passwd and
/proc/version are absent. Network:none/read-only/seccomp/capability settings are inherited
unchanged. All owned test containers and volumes were removed; the independent image
is retained for inspection, without replacing e003 or w09-renderer.

## Dependency and font evidence

`build-wheels.txt` records hash-verified native arm64 wheel installation and a separate
AMD64 wheel download with --require-hashes --only-binary. AMD64 binaries were not run.
`analysis/requirements.lock` is the complete transitive lock; six direct dependencies are
numpy2.2.6, pandas2.2.3, matplotlib3.10.3, seaborn0.13.2, openpyxl3.1.5 and defusedxml0.7.1.
No runtime installs are performed. Wheel license metadata remains in the copied install
tree. Python/node image tags and Debian repositories are not fully reproducible snapshots;
the claim here is exact Python wheel versions/hashes, not a reproducible whole-image build.

The existing Office CFF font rendered PNGs but produced unreliable PDF text under
Matplotlib Type3, while Type42 with that CFF produced a type mismatch warning. The fix
uses a real glyf TrueType font, not relaxed validation. Pinned Noto source revision
`f8d157532fbfaeda587e826d4cd5b21a49186f7c`, SHA256
`990c807e79c25662a5a9ecf7f971baeb2bf2eab9a559e5ecf15cdfdb8561d21f`, SIL OFL1.1.
Build-time fontTools (itself hash-locked) derives a14,287,892-byte static font with a new
WorkspaceX Analysis Sans family name; the original copyright and license are retained.
Office's existing Noto CFF is unchanged. `build-font.txt` records the actual preparation.

## Commands

```sh
node --import tsx skills/data-workflows/scripts/build.ts --check
node --import tsx skills/data-workflows/scripts/verify.ts
docker build -t workspacex-skill-sandbox:w18-analysis apps/skill-sandbox
python3 - <<'PY'
from pathlib import Path
import json
Path('/private/tmp/w18-container.mjs').write_text('globalThis.analysisFixture='+json.dumps(Path('apps/skill-sandbox/tests/data-workflows-fixture.py').read_text())+';\n'+Path('apps/skill-sandbox/tests/data-workflows-container.mjs').read_text())
Path('/private/tmp/w18-override.yml').write_text('services:\n  skill-sandbox-sessions:\n    image: workspacex-skill-sandbox:w18-analysis\n')
PY
docker compose -p wx-data-workflows-final -f apps/skill-sandbox/docker-compose.sessions.yml -f /private/tmp/w18-override.yml run --rm -T --entrypoint node skill-sandbox-sessions --input-type=module < /private/tmp/w18-container.mjs
docker compose -p wx-data-workflows-final -f apps/skill-sandbox/docker-compose.sessions.yml -f /private/tmp/w18-override.yml down --volumes
```

The test emits base64 artifact rows; the persisted log replaces these with decoded file
paths/sizes and retains all other output. Scripts used to run the fixture remain in tests.
No broad API/database tests were needed or run for this package/runtime-only increment.
