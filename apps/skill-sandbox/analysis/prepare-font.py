"""Build a static TrueType chart font from pinned OFL Noto CJK variable source.
Office's existing CFF font stays unchanged. This is font preparation, not rendering.
"""
from pathlib import Path
import sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont(sys.argv[1])
options = subset.Options()
options.recalc_timestamp = False
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=list(range(0x20, 0x7F)) + list(range(0x3000, 0x3040))
                   + list(range(0x4E00, 0xA000)) + list(range(0xFF00, 0xFFF0)))
subsetter.subset(font)
instantiateVariableFont(font, {'wght': 400}, inplace=True)
assert 'glyf' in font and 'fvar' not in font and 'CFF ' not in font
# Give the modified font its own family identity; keep original copyright/license records.
for record in font['name'].names:
    names = {1:'WorkspaceX Analysis Sans', 2:'Regular', 3:'WorkspaceX-Analysis-Sans-Regular-1',
             4:'WorkspaceX Analysis Sans Regular', 6:'WorkspaceXAnalysisSans-Regular',
             16:'WorkspaceX Analysis Sans', 17:'Regular'}
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
output = Path(sys.argv[2])
output.parent.mkdir(parents=True, exist_ok=True)
font.save(output)
check = TTFont(output)
cmap = check.getBestCmap()
assert all(ord(c) in cmap for c in '分组金额甲乙中文淼喆2026')
print('STATIC_TRUETYPE_ANALYSIS_FONT_OK', output.stat().st_size)
