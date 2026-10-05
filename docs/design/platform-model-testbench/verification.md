# 验证边界与待完成项

最终 API 纯测试：17 文件、252 项通过（2026-10-05），独立配置不启动数据库。包括核心模型冻结与调用前校验、并发/重放/取消、严格身份和供应商客户端、原生用量部分 Token 明细。供应商 HTTP 均替代，无付费调用。

Web 测试台/adapter/金额：49 项通过；组织核心模型 UI 与 host：24 项通过。8 张组件截图、375/768/1280 viewport 无溢出、axe/page errors 为零，见 evidence/ui-verification.md；API/会话外壳为替代依赖，不代表真实登录或数据库验收。

API 正常完整 lint 和 permission lint 已通过。最终 API/Web 类型检查通过；独立源码审查未发现新增阻断。正常提交 hooks 与 CI 在后续集成流程中记录。

组织核心模型 4 项、平台测试仓储 7 项、原生 ASR 3 项实际 PostgreSQL 验收已编写，交正常 CI 执行，未运行本地数据库。迁移保持追加且可重复执行，不修改现有组织额度。

部署注册缺失时模型明确不可用；公共目录不授予权限。普通组织 ASR 缺严格 Token 上界，明确禁用。取消缺安全关闭证明继续保留预留；跨实例取消不宣称立即终止厂商请求。

真实本地 Web/API 和正常 operator/member 会话不可用，真实登录 E2E 阻塞。未启动数据库、Docker、迁移、修改生产权限、部署或合并。

## CI 与测试工程验收回执

HEAD dfe38ecd8964da724683645fce3c9044331c529d 的独立后端 QA 实际重跑 252/252；前端 QA 73/73，组件浏览器三档尺寸通过。报告在 evidence/qa-backend.md 与 qa-frontend.md。前端 QA 执行者也是原实现作者，不能冒充独立作者审查；外部测试工程师尚未确认接单。

该 HEAD 正常 CI 已实际验证：核心模型 PostgreSQL 4/4（backend shard4 job111658468415）、平台测试 PostgreSQL 7/7（shard7 job111658468550）、原生用量 PostgreSQL 15/15（shard8 job111658468490）。这些单套通过不等于整个 CI 通过。backend runtime、原生调用 lane、core-loop、设计与原型 lane 通过；整轮仍因路由登记、旧构造器源码断言、输入来源 fixture 查询误配、权限元数据审计登记缺失失败。

修复保持普通组织 ASR 禁用、未配置核心绑定拒绝、真实输入绑定和权限边界；新导航元数据不搬业务 mock，路由事实按正常扫描登记，mock 上限保持35；权限裸 allowlist 上限保持128，新增元数据按现有逐条审计机制验前提。最新修复 SHA 与完整 CI 回执以 PR 记录为准。

修复本地复验：联合 API 19 文件280/280；导航76/76分批通过；正常 ui-wiring 扫描通过（wired54/mock24/shell18/preview37，上限35未变）；权限机械反证新45项与既有合计128/128通过，新suite接入正常backend测试入口。裸权限allowlist157-29=128，上限128未变。实际数据库仅上述旧CI证据，本地没有启动数据库。

第二轮CI：e9bb646925e91a72f4823fe7c83140e00c63d971 backend run37280447293完整通过，包括8分片、core PG4/4、native PG15/15与31项权限六路径测试。harness run37280447336控制面/全量编译通过，但全栈3例RSC预取404与2例旧mock依赖台账失败。trace确定新独立页被动态generateStaticParams重复生成；修为独立/动态路由分离，保留prefetch/console断言。新17项路由测试及20项精确mock台账验证通过，正常接线gate通过；最新提交仍须CI验证。
