# 真实模型 × 十种计划任务 × Office 产出

**0 / 4（0%）**　⚠ 本轮只跑了前 4 件（诊断模式），验收要跑满 10 件

判据：产物真的落库 + 真的下载到字节 + 字节头是那个格式。模型说做好了不算。

| 任务 | 格式 | 结果 | 耗时 | 详情 |
|---|---|---|---|---|
| ① 研究→PPT（人类原例） | pptx | ❌ | 524s | 没有产出 .pptx（现有：空） |
| ② 周报→Word | docx | ❌ | 582s | 没有产出 .docx（现有：空） |
| ③ 预算表→Excel | xlsx | ❌ | 82s | 没有产出 .xlsx（现有：空） |
| ④ 说明书→PDF | pdf | ❌ | 86s | 没有产出 .pdf（现有：空）；沙箱报错：const { PDFDocument } = require('pdf-lib'); const fontkit = require('@pdf-lib/fontkit'); const fs = require('fs'); (async () => { const doc = await PDFDocument.create(); doc.registerFontkit(fontkit); const fontPath = process.env.SKILL_SANDBOX_CJK_FONT; if (!fo |
