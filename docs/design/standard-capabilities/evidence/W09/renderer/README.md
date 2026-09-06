# W09 real renderer evidence

This increment uses preinstalled LibreOffice Writer/Impress/Calc for OOXML to PDF and
Poppler for PDF to PNG. The script is an adapter around those engines, not a renderer.
Dependencies install only at image build time. Existing session network:none, read-only
root, non-root, dropped capabilities, seccomp, 1 GiB memory and 128 PID limits remain.
The script uses an isolated temporary LibreOffice profile and fontconfig configuration
pointing at read-only `/usr/share/fonts`, because the native namespace deliberately does
not expose `/etc`. There is no new filesystem bind or runtime package installation.

The test image tag is `workspacex-skill-sandbox:w09-renderer`; all test projects have
`wx-office-render-` prefixes. The default `e003` image is not overwritten.

`baseline-red.txt` records the genuine old-image failure: the existing sandbox executes
creation/limited edits, then cannot find LibreOffice. No ready/rendered manifest is returned.

The regression fixture creates and edits all four formats using existing libraries, renders
inside the actual session execution namespace, reads generated PDF/PNGs through UDS,
checks extracted Chinese text and embedded Noto font names, and rejects malformed input.
Text extraction and embedded font checks are not substitutes for visual review; exported
pages require direct inspection for glyphs, clipping and layout.

The completed build and execution evidence follows. This increment does not claim all
advanced Office editing or comprehensive layout QA requirements are complete.

## Completed dynamic verification

Final image: `sha256:8f881eb6a6d7c878e9a5d0f71f0ec36b22998fed014786276dbbc22b19a5c3a8`,
Docker image inspect Size 288,926,138 bytes; baseline e003 Size 116,380,025 bytes
(same Docker-reported metric; not a claim about expanded filesystem size).
Build-time apt reported 497 MB added for the renderer packages. Exact installed versions
are in `real-render-tests.txt` (LibreOffice 4:7.4.7-1+deb12u14, Poppler 22.12.0).
Build logs retain actual resolved dependencies; base node tag and Debian repository are
not reproducible snapshots. No runtime installation or network access is used.

Final run exited 0. Container memory.max=1073741824 and pids.max=128 are asserted,
along with non-root UID1000 and the absence of /proc/version and /etc/passwd inside
the execution namespace. Actual cgroup peaks: memory 219,672,576 bytes and 33 PIDs.
Fresh service readiness 420ms; first conversion (fresh profile) DOCX5289ms,
PPTX3163ms, XLSX3003ms, PDF1083ms. These are single local fixture observations,
not production latency SLOs or large-document capacity claims.

Eight PNGs and four PDFs were downloaded using the actual UDS file endpoint.
Both worker and root inspected simple-fixture pages: Chinese is legible, no tofu/clipping
was seen, and tested Word headers/footers/page breaks and content are preserved. Root
sampled the first page of each format; worker inspected all eight. This is simple-fixture
visual inspection, not polished Office layout QA. The second PDF page is intentionally
blank: page-order editing moves the original empty page after the text-bearing page.
Malformed OOXML fails without a render result manifest. Partial files after a later
conversion failure remain session scratch data and must not be delivered as verified output.

The Linux launcher itself refuses absent /proc; upstream 7.4.7.2
[start.c](https://raw.githubusercontent.com/LibreOffice/core/libreoffice-7.4.7.2/desktop/unx/source/start.c)
shows that check and the normal-restart handling. The package's own soffice.sh documents
direct soffice.bin invocation. Our thin script configures the existing library directory,
handles only one normal-profile restart (81) under the same 60-second deadline, and
requires success; crashes are not retried. Config materialization is performed at build
time from installed Debian assets only. No /etc or /proc bind, secret configuration,
new capability, or seccomp exception was introduced.

## Reproduce

```bash
docker build -t workspacex-skill-sandbox:w09-renderer apps/skill-sandbox
python3 - <<'PY'
import json
from pathlib import Path
resources = Path('apps/api/scripts/office-package-resources')
Path('/private/tmp/w09-render-container.mjs').write_text(
    'globalThis.officeResources=' + json.dumps({p.name:p.read_text() for p in resources.iterdir() if p.is_file()}) + ';\n'
    + Path('apps/skill-sandbox/tests/office-renderer-container.mjs').read_text())
Path('/private/tmp/w09-render-override.yml').write_text('services:\n  skill-sandbox-sessions:\n    image: workspacex-skill-sandbox:w09-renderer\n')
PY
docker compose -p wx-office-render-final -f apps/skill-sandbox/docker-compose.sessions.yml -f /private/tmp/w09-render-override.yml run --rm -T --entrypoint node skill-sandbox-sessions --input-type=module < /private/tmp/w09-render-container.mjs
docker compose -p wx-office-render-final -f apps/skill-sandbox/docker-compose.sessions.yml -f /private/tmp/w09-render-override.yml down --volumes
```

The test emits ARTIFACT_BASE64 rows for evidence capture. `real-render-tests.txt` replaces
those long rows with decoded artifact paths and sizes; the actual bytes are adjacent.
All owned test containers and volumes were removed; only the named independent image remains.

Final package regression: the standard isolated wrapper ran
`tests/skill/office-full-packages.test.ts`, `platform-owned-skills-real-stack.test.ts`,
`office-docs-starter-pack-source-guard.test.ts` and `office-docs-cjk-guidance.test.ts`:
32/32 passed (`package-tests.txt`), wrapper cleanup completed. The deployed package now
has four files, including the shared renderer script; risk defaults and immutable legacy
version/seed behavior remain covered. `source-deployment.txt` confirms all four packages
load those resources from the actual source-deployment layout.
