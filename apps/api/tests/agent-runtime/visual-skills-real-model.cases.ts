/** Synthetic offline graphics only: no remote image provider or third-party assets. */
export const visualScenarios = [
 {id:'S017',packId:'standard-visual',packVersion:'1.0.1',skill:'visual-content',filename:'design-brief.txt',
  source:'Create a static Chinese poster. Exact text: 开放日 / 欢迎体验. Width 800 pixels, height 600 pixels. Do not invent a date, price or location. Use only installed fonts and drawn shapes, no third-party assets or remote image provider.',
  prompt:'根据附件视觉目标选择合适技能，制作精确800×600中文海报poster.png，并发布图片和设计说明report.md。仅使用离线已安装库和字体，不下载素材或调用生成式供应商。实际读取检查文件；报告素材来源和无法完成的视觉检查。',
  required:[/800/,/600/,/开放日/,/欢迎体验/,/字体|font/i],forbidden:[/已调用.*生成|第三方素材已获授权/],image:{name:'poster.png',width:800,height:600}},
 {id:'S020',packId:'data-workflows',packVersion:'1.0.0',skill:'data-visualization',filename:'counts.txt',
  source:'category,count\n甲组,10\n乙组,20\n丙组,\nUnit: people. Empty count is missing, not zero. Data are entirely synthetic.',
  prompt:'根据附件类别数据选择合适技能，生成800×600的中文静态条形图chart.png及report.md并发布。丙组缺失不能补零；图表与报告列明甲10人乙20人、缺失口径和数据表，report.md包含完整可复现Python脚本，同时将实际运行的完整脚本chart.py作为text/plain单独发布。只用已安装离线库，实际检查文件，无法完成视觉检查须明确。',
  required:[/甲组/,/乙组/,/丙组/,/10/,/20/,/缺失|missing/i,/```python/],forbidden:[/丙组.{0,8}[：:=]\s*0\s*(?:人|$)/m],image:{name:'chart.png',width:800,height:600}}
];
