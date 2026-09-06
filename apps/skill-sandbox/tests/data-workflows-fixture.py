"""Known-answer offline data fixture; executed inside the actual native sandbox."""
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
import hashlib
import json
from pathlib import Path
import pandas as pd
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
import seaborn as sns
import openpyxl
from openpyxl.xml.functions import fromstring
from defusedxml.common import EntitiesForbidden
try:
    fromstring(b'<!DOCTYPE x [<!ENTITY entity "expanded">]><x>&entity;</x>')
except EntitiesForbidden:
    print('XML_ENTITY_REJECTED')
else:
    raise AssertionError("XML entity expansion was not rejected")
from matplotlib import font_manager
font_manager.fontManager.addfont('/usr/share/fonts/workspacex/analysis/AnalysisSans.ttf')
font = font_manager.FontProperties(fname='/usr/share/fonts/workspacex/analysis/AnalysisSans.ttf')
plt.rcParams['font.family'] = font.get_name()
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['pdf.fonttype'] = 42

results = []
for ext in ('csv', 'xlsx', 'json'):
    source = Path('/workspace/input.' + ext)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if ext == 'csv':
        frame = pd.read_csv(source, dtype={'group':str})
    elif ext == 'xlsx':
        frame = pd.read_excel(source, sheet_name='Data', engine='openpyxl')
    else:
        frame = pd.read_json(source)
    numeric = pd.to_numeric(frame['value'], errors='coerce')
    missing = int(frame['value'].isna().sum())
    invalid = int((numeric.isna() & frame['value'].notna()).sum())
    duplicates = int(frame.duplicated().sum())
    clean = frame.assign(value=numeric).dropna(subset=['value'])
    # Explicit fixture policy: preserve duplicate observations; omit unknown values,
    # retain genuine zero. Never silently substitute zero for a missing value.
    grouped = clean.groupby('group')['value'].agg(['sum','count','mean'])
    assert len(frame) == 6 and missing == 1 and invalid == 1 and duplicates == 1
    assert grouped['sum'].to_dict() == {'甲':10.0,'乙':40.0}
    assert grouped['count'].to_dict() == {'甲':2,'乙':2}
    assert float(np.sum(clean['value'].to_numpy())) == 50.0
    assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
    results.append({'format':ext,'sourceSha256':digest,'rows':len(frame),
                    'missing':missing,'invalidNumeric':invalid,'duplicatesPreserved':duplicates,
                    'policy':'omit unknown values; retain zero and duplicate observations',
                    'totals':grouped['sum'].to_dict()})
assert all(r['totals'] == results[0]['totals'] for r in results)
grouped.to_csv('/workspace/results.csv')
fig, ax = plt.subplots(figsize=(7,4))
sns.barplot(x=grouped.index, y=grouped['sum'], ax=ax, errorbar=None, color='#4C72B0')
ax.set(title='分组金额：甲 10，乙 40', xlabel='组别', ylabel='金额（元）', ylim=(0,45))
for bar in ax.patches:
    ax.text(bar.get_x()+bar.get_width()/2,bar.get_height()+0.5,f'{bar.get_height():.0f}',ha='center')
fig.tight_layout()
fig.savefig('/workspace/chart.png',dpi=120)
fig.savefig('/workspace/chart.pdf')
plt.close(fig)
assert pd.read_csv('/workspace/results.csv')['sum'].sum() == 50
Path('/workspace/results.json').write_text(json.dumps({'sources':results,
    'versions':{'pandas':pd.__version__,'numpy':np.__version__,'matplotlib':matplotlib.__version__,
                'seaborn':sns.__version__,'openpyxl':openpyxl.__version__},
    'limitation':'descriptive fixture; no causal inference'},ensure_ascii=False,sort_keys=True))
print('OFFLINE_THREE_FORMATS_KNOWN_ANSWER_MISSING_DUPLICATE_ZERO_REPRODUCIBLE_OK')
