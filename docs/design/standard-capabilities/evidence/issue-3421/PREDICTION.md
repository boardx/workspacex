# 测量前写下的可证伪预测（#3421），写于跑任何 run 之前

判别信号：`execute` 是否反复报同一个错 / write_file+edit_file 的 argChars 规模。

- P1（coord 的嫌疑）：逐次 execute 出现**同一个报错反复**，edit_file/write_file 轮次占大头。
  => 若成立，timeline 里能看到 >=2 次 status=error 的 execute 且报错正文相同。
- P2（我的对立假设）：execute **不报错或只报一次**，时间几乎全在"写脚本那一个模型轮次"，
  write_file 的 argChars 显著大于 PDF 那批（issue-3401 同一仪器）。
  => 若成立，pptx 正文缺 PDF 有的「⚠ 脚本要短」一节是候选根因。
- P3（两者都不成立）：时间散在固定开销/渲染/回传 => 按实测分布重新归因，不沿用任何嫌疑。

裁决以 timeline.json 的原始数据为准，不事后改预测。
