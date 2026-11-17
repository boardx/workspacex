# 人工手册 PDF 独立只读复核

现有文件：`/workspace/artifacts/aidt-v2-acceptance/AIDT-V2-人工测试验收手册.pdf`。未修改源文、重新生成 PDF 或代填人工结果。

- 29 页，203,745 字节，SHA256 `931196e442ebf94ff1704759b6fcd1bb310da2790fbb0cc88df16d4ef7c1313e`，PDF 可解析且未加密；29 页均有可提取正文，无越过页面边界的文字 span。
- H01–H15、FR19 和 M26 均存在；页首、H03、旧 SUM、旧七场收费、旧身份及历史机器记录的限定已保留。旧 M01–M25 未被当作本轮最新快照。
- 已查看 root 现有的第 1、10、29 页 PDF 栅格图；中文标题、步骤、表格和签字页可读，未见空白渲染、方框乱码或截页。封面和结果页保留留白，最后三方签字、证据填写及试点选择均空白／未选择，不构成人工通过。
- 实际文字使用 Droid-Sans-Fallback／DejaVuSans，均为嵌入 TrueType 子集。`pdffonts` 另列出未嵌入的 Base14 Helvetica **注册资源**，但实际可见文字 span 中没有使用 Helvetica；不能笼统声称每个注册字体资源都已嵌入。
- PDF 将空复选框显示为 `[ ]`；共提取到 27 个未选择的“通过”和 27 个未选择的“失败”，未发现已勾选 `☑`。人工结果和课程签核继续由人填写。

详细证据：`review.json`、`manual-fonts.txt`、`manual-extracted-layout.txt`。全页进行了文本／边界检查；图像抽看仅 1、10、29 页，不冒称逐页视觉验收。这是本地现有 PDF 字节的可读性复核，不证明用户设备或 Library viewer 已打开，也不是浏览器截图或课堂验收。
