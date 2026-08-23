# 契约束 `accessibility-guardrails` — 签核②：用例接口

> 本束**无后端 API 契约面**——四个 feature 全部是前端可达性行为的验证与修复，
> 不涉及服务端调用契约。第③件签核材料记录为「不适用」。

## UC-1：键盘走查一条核心任务
```
in:  { domain: "chat" | "profile" | "org-admin", taskName: string }
out: { completed: boolean, blockers: KeyboardStep[] }
pre: 已登录对应角色（org-admin 任务需管理权限角色）
err: FOCUS_LOST — 某一步焦点丢失到 body 或不可见元素
err: ESC_NOT_HANDLED — 当前弹层 Esc 无响应
err: TAB_ORDER_MISMATCH — Tab 顺序与视觉顺序不一致
```

## UC-2：登记第三方组件样式覆盖
```
in:  { library: string, selector: string, reason: string, tokenRef: string }
out: { registered: boolean }
pre: tokenRef 必须引用 globals.css 中已存在的 token（不能登记一个字面量值）
err: UNREGISTERED_OVERRIDE — 覆盖存在但未登记，lint 拦截
err: STALE_SELECTOR — 第三方库升级后原选择器失效，登记表条目需要复核（非静默失败）
```

## UC-3：补齐图片/图标可访问性标注
```
in:  { element: ImgOrIcon, context: string }
out: { classified: "meaningful-image" | "decorative-icon", altOrAriaHidden: string | "aria-hidden" }
pre: 无
err: AMBIGUOUS_SEMANTIC — 图片语义难以一句话描述（如复杂数据可视化），需配合相邻文字说明，
     不强行编造 alt 文本
```

## UC-4：axe-core 自动化扫描接入
```
in:  { targetPages: string[] }
out: { violations: AxeViolation[] }
pre: 目标页面可访问（本地或预发环境）
err: SCAN_TIMEOUT — 页面加载超时，需重试而非静默跳过该页面的扫描
```
