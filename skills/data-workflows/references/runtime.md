# Shared offline analysis runtime

Only operate on explicitly provided, authorized `/workspace` files. Preserve source bytes;
write results to new paths. Hash the actual input and record Python/library versions.
CSV/JSON use pandas; XLSX uses openpyxl through pandas. XLSX formulas are not evaluated
by openpyxl: missing/stale cached values are a limitation, not zero. ExcelJS remains the
existing Office editing library. No data warehouse, notebook, browser or new credentials
are supplied by this package. Upstream connector examples describe optional categories.

Native execute clears inherited environment. Set these explicitly before importing libraries:

```python
import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MPLBACKEND'] = 'Agg'
os.environ['MPLCONFIGDIR'] = '/tmp/workspacex-matplotlib'
from pathlib import Path
config_dir = Path(os.environ['MPLCONFIGDIR'])
config_dir.mkdir(exist_ok=True)
fontconfig = config_dir / 'fonts.conf'
fontconfig.write_text('<fontconfig><dir>/usr/share/fonts</dir><cachedir>/tmp/workspacex-font-cache</cachedir></fontconfig>')
os.environ['FONTCONFIG_FILE'] = str(fontconfig)
import pandas as pd
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
from matplotlib import font_manager
font_manager.fontManager.addfont('/usr/share/fonts/workspacex/analysis/AnalysisSans.ttf')
font = font_manager.FontProperties(fname='/usr/share/fonts/workspacex/analysis/AnalysisSans.ttf')
plt.rcParams['font.family'] = font.get_name()
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['pdf.fonttype'] = 42
```

The image build pins and hashes all Python dependencies. Never install at runtime.
Use PNG/PDF for static charts; do not use `fig.show()`, Plotly, cloud notebooks or network
APIs in this offline profile. Current sandbox memory/time/file limits still apply: inspect
input size and process bounded datasets; a resource failure must not become a partial
success. Distinguish data-frame parsing from validation of its meaning.

For reproducibility, save the exact code actually executed, input SHA256, sheet/column
selection, missing-value policy, row/duplicate/drop counts, units/denominator and output
values. Re-run and compare numeric results; plotting metadata may change without changing
the computation. Open rendered pages for inspection and read final bytes before delivery.
Never overwrite the input, infer an unavailable dataset, or invent sources, p-values,
confidence intervals, current tool permissions or an execution result.
