# 失败诊断（首次证据保留）
## 图片恢复与导出轮询
board-image-ingress navigate trace资源7d0594fd9c034f24abb9e85bb5b757ef.jsonl：fresh update 03:13:34.938Z发出，03:13:37.687Z ack seq1。owner资源4fb2e066e00b550ac859f5958afc7381.jsonl 03:13:37.703Z收到广播。首个export03:13:34.552Z创建seq0，03:13:38.067Z下载旧快照objects0；下一次export03:13:38.518Z已seq1/1093bytes，下载在5s轮询超时后的finally归档后返回409 ARCHIVED。不是实际丢同步。revoke业务步骤通过，但afterAll要求全文件四组proof且worker重启使其连带红。issue6018。
## GitHub真实上游
原生Node/curl API均200，raw10/12秒连接超时。系统scutil配置127.0.0.1:7897代理但shell没有proxy env；经系统代理curl raw200。raw的公网IP185.199.110.133直连失败，108/109/111在独立探测200。不得因此绕过SSRF guardedLookup或用替身替代真实GitHub验收。
## 聊天连接重置
copilotkit-v2-error-banner预热GET/api/copilotkit/info read ECONNRESET，尚未执行错误横幅行为断言。
## 计划执行矩阵
矩阵10/24，首个docx#2出现依赖延迟；POST/run200耗32.698s，同期messages503 dependency_unavailable（045a2bac-32ab-476b-bcf1-3712e00e55ac）、queued-messages500（be078be2-fb11-48de-9f9e-7590643db7f0）。04:51:06Z查询仅human，关联run1dab859f-9fc0-4b7d-8a48-9cf1f7e0a706；04:51:53Z通知中已见04:51:40Z任务完成。不能把首次无回复等价永久失败。后续xlsx/pptx/canvas测试共享600s预算超时，浏览器关闭为连带结果。现有API stdout无对应traceId底层错误，需要新隔离栈复测，不凭推断改业务代码。
