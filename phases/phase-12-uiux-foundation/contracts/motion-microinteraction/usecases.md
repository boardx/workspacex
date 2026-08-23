# 契约束 `motion-microinteraction` — 签核②：用例接口

> 本束**无后端 API 契约面**——动效与微交互全部是前端展示层行为，第③件签核材料
> 记录为「不适用」，理由见 `design-signoff.md`。

## UC-1：定义语义化动效档位
```
in:  无（配置级 UC，产出是 tailwind.config.ts 的静态声明）
out: { fast: MotionToken, base: MotionToken, slow: MotionToken }
pre: 无
err: 无运行时失败态（配置级）；唯一的「错误」是选值缺乏依据，要求 globals.css 注释写明理由
```

## UC-2：消息到达时的编排动效
```
in:  { message: ChatMessage, isStreaming: boolean }
out: { renderedWithEntryAnimation: boolean }
pre: chat 会话已建立且消息列表已挂载
err: REDUCED_MOTION — 用户系统开启减少动态效果，降级为瞬时渲染（I-2）
err: HIGH_FREQUENCY_ARRIVAL — isStreaming 为 true 时，不对逐字增量重复触发整条编排动效，
     只在消息气泡首次出现时触发一次
```

## UC-3：面板展开/收起编排动效
```
in:  { panelId: string, expanded: boolean }
out: { renderedWithTransition: boolean }
pre: 面板已挂载
err: REDUCED_MOTION — 同 UC-2
err: RAPID_TOGGLE — 用户快速连续点击展开/收起，动效不应堆叠或产生视觉抖动（需 debounce 或中断上一次动画）
```

## UC-4：微交互一致性稽核发现偏离并修复
```
in:  { domain: "chat" | "profile" | "org-admin" | "canvas", element: ComponentRef }
out: { classified: "无反馈" | "反馈不一致" | "反馈一致但可优化", fixed: boolean }
pre: 稽核清单已产出（按 uiux-standards.md §5 逐条检查）
err: THIRD_PARTY_UNCONTROLLED — 第三方渲染内容（如 CopilotKit 消息体内的链接）交互不受控，
     记录为已知限制，不强行注入样式覆盖（避免重蹈 accessibility-guardrails 束要收敛的问题）
```
