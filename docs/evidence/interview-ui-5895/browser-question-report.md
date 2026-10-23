# R1追加：按问题独立折叠答案

人类纠正后的新验收，以每个问题为折叠单元；整份访谈记录始终可见，不沿用旧全局折叠标准。

真实本地Next35895/Chromium验证4组合通过：375与1280；`### 1. 问题？`标题和`1. **问题？**`普通编号两类Markdown，每份均2题。专家名/两个问题保持可见，答案默认hidden。点击第一仅打开第一，第二保持收起；来源链接可见并保留href；Enter收第一，Space打开第二；无document横向溢出。

8张本轮截图：`browser-question-{heading|bold}-{collapsed|first-open}-{375|1280}.png`。结果`browser-question-results.json`，命令`node docs/evidence/interview-ui-5895/browser-question-check.cjs`退出0。HTTP/session为受控夹具，不声称真实DB/API模型验收。RSC真实请求放行。

服务按实现者要求暂时保留，等待确认后释放。未修改产品代码，未提交证据。
