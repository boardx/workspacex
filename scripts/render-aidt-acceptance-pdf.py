#!/usr/bin/env python3
"""Render the AIDT human procedure, preserving blank human result fields.
Requires reportlab and PyMuPDF; never reads application configuration.
"""
from pathlib import Path
import argparse,re,html,json,hashlib
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
import fitz
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[1]/'docs/evidence/aidt-native/completion-20261116/a6/aidt-v2-human-acceptance.md')
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--qa-dir',type=Path)
args=parser.parse_args()
src=args.source.resolve();out=args.output.resolve();out.parent.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
pdfmetrics.registerFont(TTFont('Latin','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
FONT='STSong-Light';W,H=A4;left=42;right=42;usable=W-left-right
navy=colors.HexColor('#172D45');teal=colors.HexColor('#087F8C');gray=colors.HexColor('#576777')
styles={
 'body':ParagraphStyle('body',fontName=FONT,fontSize=10,leading=16,textColor=navy,wordWrap='CJK',spaceAfter=7),
 'cell':ParagraphStyle('cell',fontName=FONT,fontSize=9,leading=14,textColor=navy,wordWrap='CJK'),
 'th':ParagraphStyle('th',fontName=FONT,fontSize=9,leading=14,textColor=colors.white,wordWrap='CJK'),
 'h1':ParagraphStyle('h1',fontName=FONT,fontSize=23,leading=32,textColor=navy,spaceAfter=18,keepWithNext=True,wordWrap='CJK'),
 'h2':ParagraphStyle('h2',fontName=FONT,fontSize=15,leading=23,textColor=teal,spaceBefore=10,spaceAfter=12,keepWithNext=True,wordWrap='CJK'),
 'h3':ParagraphStyle('h3',fontName=FONT,fontSize=13,leading=21,textColor=navy,spaceBefore=8,spaceAfter=12,keepWithNext=True,wordWrap='CJK'),
}
def inline(s):
 s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',lambda m:m.group(1),s)
 s=s.replace('□','[ ]').replace('·',' / ')
 s=html.escape(s)
 s=re.sub(r'`([^`]+)`',lambda m:'<font name="Latin" size="8">'+m.group(1)+'</font>',s)
 s=re.sub(r'\*\*([^*]+)\*\*',r'\1',s)
 return s
story=[]
lines=src.read_text().splitlines();i=0;caseidx=[];pending_section=None
def para(s,kind='body'): return Paragraph(inline(s),styles[kind])
while i<len(lines):
 s=lines[i].strip()
 if not s:i+=1;continue
 if s.startswith('|'):
  rows=[]
  while i<len(lines) and lines[i].strip().startswith('|'):
   row=[x.strip() for x in lines[i].strip().strip('|').split('|')]
   if not all(re.fullmatch(r':?-+:?',x) for x in row):rows.append(row)
   i+=1
  n=len(rows[0]);rows=[r+['']*(n-len(r)) for r in rows]
  weights=([1.15,3.85] if n==2 else [1.2,1.5,3.3] if n==3 else [1.15,2.5,1.8,2.1] if n==4 else [0.7,1,2,1.8,0.7,0.7,1.7])
  if len(weights)!=n:weights=[1]*n
  widths=[usable*w/sum(weights) for w in weights]
  data=[[para(x,'th' if j==0 else 'cell') for x in r] for j,r in enumerate(rows)]
  table=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
  table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,0),0.5,navy),('LINEBELOW',(0,1),(-1,-1),0.35,colors.HexColor('#CDD9E4')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#F0F5F8'),colors.white])]))
  story.extend([table,Spacer(1,12)]);continue
 if s.startswith('#'):
  depth=len(s)-len(s.lstrip('#'));title=s[depth:].strip()
  if depth==1:
   story.append(para('WORKSPACEX / AIDT','h2'));story.append(para(title,'h1'))
  else:
   if depth==2 and title.startswith('1.'):
    story.append(Spacer(1,20));story.append(para('测试路线','h2'))
    for line in ['六阶段主线：H03 问题与理由 → H04 材料与发现卡 → H05 画像前反思 → H06 创意与描述单 → H07 原型 → H08/H09 测试与回溯 → H10 小组报告。','协作与可靠性：H01 课程和权限，H02 共享保存，H11 全界面成员文字沟通，H12 并发冲突与失败恢复。','范围复核：H13 教师点评、H14 叙事展示、H15 打印及3D，分别按已确认优先级记录；访谈录音与语音房另排。','操作前填写版本、入口和角色；操作时逐项记录实际结果与证据；结束后登记缺陷、复验范围和人类签字。','本册保留书写空间，适合课堂试用、打印及逐项复验。所有结果栏均由实际操作者填写。']:
     story.append(para(line))
   if depth==2 and title.startswith('3.'):
    pending_section=title;i+=1;continue
   if depth==2 or (depth==3 and re.match('H\\d+',title)):story.append(PageBreak())
   if pending_section:
    story.append(para(pending_section,'h2'));pending_section=None
   p=para(title,'h2' if depth==2 else 'h3');p.bookmark='section-'+str(len(caseidx));caseidx.append((title,p.bookmark,depth));story.append(p)
  i+=1;continue
 if re.match(r'\d+\.\s',s) or s.startswith('- '):
  story.append(para(s));i+=1;continue
 group=[s];i+=1
 while i<len(lines) and lines[i].strip() and not re.match(r'[#|]|\d+\.\s|- ',lines[i].strip()):group.append(lines[i].strip());i+=1
 story.append(para(' '.join(group)))
class Doc(SimpleDocTemplate):
 def afterFlowable(self,f):
  if hasattr(f,'bookmark'):
   self.canv.bookmarkPage(f.bookmark);self.canv.addOutlineEntry(f.getPlainText(),f.bookmark,level=0,closed=False)
def page(c,d):
 c.saveState();c.setStrokeColor(colors.HexColor('#D3DEE7'));c.setLineWidth(.5);c.line(left,H-31,W-right,H-31)
 c.setFont(FONT,8);c.setFillColor(gray);c.drawString(left,H-23,'WorkspaceX / AIDT V2 / 人工验收');c.drawRightString(W-right,H-23,'2026-11-16')
 c.line(left,31,W-right,31);c.drawString(left,20,'实际结果与签字由测试者填写 / 机器测试不代替人工验收');c.drawRightString(W-right,20,str(d.page));c.restoreState()
doc=Doc(str(out),pagesize=A4,leftMargin=left,rightMargin=right,topMargin=47,bottomMargin=47,title='AIDT V2 人工端到端测试与验收手册',author='WorkspaceX AIDT',pageCompression=1)
doc.build(story,onFirstPage=page,onLaterPages=page)
with fitz.open(out) as pdf:
 text=''.join(p.get_text() for p in pdf)
 missing=[f'H{i:02d}' for i in range(1,16) if f'H{i:02d}' not in text]
 assert not missing,missing
 assert all(x in text for x in ['暂无','证据不足','实际结果','签字','M01','M06'])
 assert len(pdf)>=16
 if args.qa_dir:
  args.qa_dir.mkdir(parents=True,exist_ok=True)
  for i in sorted(set([0,1,4,9,len(pdf)-1])):pdf[i].get_pixmap(matrix=fitz.Matrix(1.15,1.15)).save(str(args.qa_dir/f'qa-page-{i+1}.png'))
 print(json.dumps({'output':str(out),'pages':len(pdf),'bytes':out.stat().st_size,'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'pdf_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'all_cases_present':True},ensure_ascii=False))
