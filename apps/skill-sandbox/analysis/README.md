# Offline analysis dependency profile

Python 3.11 profile for WX-S007/WX-S020. `requirements.in` is the direct-dependency
input; `requirements.lock` is the generated complete transitive version/hash lock.
Builds install only binary wheels with `--require-hashes`; source builds are refused.
The install tree, including wheel license metadata, is copied into Debian Python's
`/usr/local/lib/python3.11/dist-packages`, visible through the existing read-only /usr
namespace. No pip/runtime installation or new mount is added.

```sh
uv pip compile apps/skill-sandbox/analysis/requirements.in --python-version 3.11 --generate-hashes --universal --output-file apps/skill-sandbox/analysis/requirements.lock
```

Direct dependencies: numpy/pandas for computation; matplotlib/seaborn for offline static
charts; openpyxl for the XLSX input adapter; defusedxml for openpyxl's documented XML
entity protection. CSV/JSON use pandas directly. This is a deliberately bounded compatible
profile, not a claim that these are the newest available releases. Full resolved versions
and wheel hashes are in the lock. Upgrade the lock only together with real sandbox fixtures.

No SciPy, PyArrow, Jupyter, database drivers, Plotly or browser dependencies are included.
Native execute clears inherited environment, so code sets BLAS threads to one and an
Agg backend with temporary writable font cache before imports (shared skill runtime ref).
The existing 1GiB/128PID/container/seccomp boundaries are unchanged.

Build-time AMD64 wheel download checks lock availability on that architecture; it does
not execute AMD64 binaries. Actual runtime architecture and evidence are recorded per run.

Chart PDFs use a separate static TrueType font derived at build time from Noto CJK
revision `f8d157532fbfaeda587e826d4cd5b21a49186f7c` (SIL OFL1.1, `font-LICENSE`).
The Docker ADD verifies SHA256 `990c807e79c25662a5a9ecf7f971baeb2bf2eab9a559e5ecf15cdfdb8561d21f`.
The modified font is renamed WorkspaceX Analysis Sans, preserving original copyright
metadata. Office's CFF font is unchanged. Latin, CJK punctuation/fullwidth and U+4E00–9FFF
are retained; coverage of arbitrary scripts/emoji or CJK extensions is not claimed.
Matplotlib uses pdf.fonttype=42 with actual glyf TrueType outlines. The final fixture
requires readable Chinese PDF text without font mismatch warnings plus real page rendering.
