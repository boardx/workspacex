# AIDT 可操作系统反馈闭环计划

目标：学生能实际打开并完成小组操作；技术测试、用户访问和真实AI分别给证据。A+B边界不扩，访谈录音C另排，语音房后置。当前以c616680c5为新基线独立捕捉，修复后冻结业务版本再复验。上一轮结果保留历史，不移作本轮证据。

```mermaid
flowchart LR
  G["本轮：实际可用系统"] --> Q["Agent 6 · 原生新截图/双账号复测"]
  Q --> A["Agent 1 · 成员入口/创建/保存概览"]
  Q --> B["Agent 2 · Chat上下文/图片重试"]
  Q --> C["Agent 3 · 来源选择/报告状态"]
  Q --> D["Agent 4 · 话题恢复/键盘/并发回复"]
  Q --> E["Agent 5 · 迁移重放/服务就绪"]
  A & B & C & D & E --> I["主Agent · 集成/点子误删保护"]
  I --> Q
  I --> R["用户访问与真实模型配置"]
  R --> U["用户亲自完成六步"]
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G blocked
  %% blocked G: Need user runtime target and existing real model configuration; no callable shared preview/browser tool, no user-accessible application verified
  class Q tested
  %% evidence Q: 538 web regressions/type/lint/design + strict4 HTTP/PG/browser, feedback-loop/final/manifest.json; domain local red/green records retained
  class A tested
  %% evidence A: 538 web regressions/type/lint/design + strict4 HTTP/PG/browser, feedback-loop/final/manifest.json; domain local red/green records retained
  class B tested
  %% evidence B: 538 web regressions/type/lint/design + strict4 HTTP/PG/browser, feedback-loop/final/manifest.json; domain local red/green records retained
  class C tested
  %% evidence C: 538 web regressions/type/lint/design + strict4 HTTP/PG/browser, feedback-loop/final/manifest.json; domain local red/green records retained
  class D tested
  %% evidence D: 538 web regressions/type/lint/design + strict4 HTTP/PG/browser, feedback-loop/final/manifest.json; domain local red/green records retained
  class E tested
  %% evidence E: 538 web regressions/type/lint/design + strict4 HTTP/PG/browser, feedback-loop/final/manifest.json; domain local red/green records retained
  class I tested
  %% evidence I: 538 web regressions/type/lint/design + strict4 HTTP/PG/browser, feedback-loop/final/manifest.json; domain local red/green records retained
  class R blocked
  class U blocked
  %% blocked U: Need user runtime target and existing real model configuration; no callable shared preview/browser tool, no user-accessible application verified
  %% blocked R: Need user runtime target and existing real model configuration; no callable shared preview/browser tool, no user-accessible application verified
```

进度：2026-11-15 09:48 北京时间，六个Agent已启动本轮，问题队列见issues.json；无受控预览入口和真实模型配置，不能标整套系统已可供用户操作。GitHub外发和协调网关限制保留。
