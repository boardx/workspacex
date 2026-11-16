# 最终完整测试报告 PDF 独立复核

仅检查本地最终 PDF 的可读性与内容呈现，不重跑模型或产品测试、不改源、不重渲染，也不代表人类教学验收。

- 文件：`/workspace/artifacts/aidt-v2-acceptance/AIDT-V2-完整测试报告.pdf`，17 页、179383 字节。
- PDF SHA256：`a9e5cb25b978823e3f501f4beed0a1ae563126133a1035a9db4726bdb44ba02f`。
- 源 SHA256：`4c47d892737e363ff652cfd3dced0c476090b1c343dff004f9fbaeb5720a7bb6`。
- 全 17 页均有正文，最少 223 个正文字符；文字边界未超出页面。实际可见文字只使用已嵌入的 Droid-Sans-Fallback 和 DejaVuSans 子集。注册的默认 Helvetica 未嵌入，但没有非空可见文本使用它。
- 使用既有 PNG 抽查第 1、2、5、10、17 页：中文、表格和标题清楚，未见乱码、重叠、越界；其他页仅进行文本和边界检查。
- 实际 PDF 保留 818 Web、86/52 API、42 physical/330391 reported tokens、E003 原 2 skip；保留两次 SUM critical1，不将完整外观当成功。学生澄清后同线程真实修订、显式审阅保存和 17512 字节导出均有记录。
- PDF 明确区分合成材料与真人研究，人工/课程验收尚待执行，不能称全部 P0 或真实课堂已通过。报告渲染时尚未 Library 保存，此次本地复核不证明已交付 Library 或用户设备已打开。人工手册的实际填写/签字仍空白，未代签。
- 人工手册 SHA256 仍为 `931196e442ebf94ff1704759b6fcd1bb310da2790fbb0cc88df16d4ef7c1313e`，字节未变。

详见 `review.json`、`metrics.json` 与 `report-extracted-layout.txt`。本次没有阻断性的本地 PDF 可读性问题；计数在报告中出现不等于本复核重新证明测试结果。
