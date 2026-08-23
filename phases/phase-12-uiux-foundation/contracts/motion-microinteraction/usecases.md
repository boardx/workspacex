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

## UC-5：首屏加载骨架屏→内容过渡动效（人类 2026-08-23 裁决新增，超出 F03/F04 原范围）
```
in:  { route: "chat" | "profile" | "org-admin", contentReady: boolean }
out: { renderedWithSkeletonToContentTransition: boolean }
pre: 路由已挂载，骨架屏基础设施存在（本束不建骨架屏组件本身，只定义骨架屏→内容这一段过渡的动效）
err: REDUCED_MOTION — 同 UC-2
err: NO_SKELETON_INFRASTRUCTURE — 目标路由尚无骨架屏组件时，本 UC 不产生任何动效（不得对
     普通 loading spinner 强行包一层过渡动效冒充「编排」）
```
⚠ 需要新开 feature（暂记 F17，最终编号由 requirement-author 或人工排定）——现有
F03（token）/F04（编排动效）覆盖的是消息到达与面板展开，不包含首屏加载。

## UC-6：附件/长任务上传进度动效（人类 2026-08-23 裁决新增，超出 F03/F04 原范围）
```
in:  { taskId: string, progress: number, phase: "uploading" | "processing" | "done" | "error" }
out: { renderedWithProgressAnimation: boolean }
pre: 上传/长任务已有真实进度事件源（依赖后端进度事件，如 DA-15 file_content_delta 一类通道
     ——本 UC 只定义收到真实进度事件后的前端动效呈现，不得在事件源缺失时插值编造进度）
err: REDUCED_MOTION — 同 UC-2
err: NO_PROGRESS_SOURCE — 后端不提供细粒度进度、只有二元「进行中/完成」时，动效降级为
     不确定态（indeterminate）指示器，不得插值出虚假的百分比动画
```
⚠ 需要新开 feature（暂记 F18，最终编号由 requirement-author 或人工排定）——且依赖后端
进度事件源是否存在，落地前需与对应后端能力（如 DA-15）对齐时序，不能单独抢跑。

## UC-4：微交互一致性稽核发现偏离并修复
```
in:  { domain: "chat" | "profile" | "org-admin" | "canvas", element: ComponentRef }
out: { classified: "无反馈" | "反馈不一致" | "反馈一致但可优化", fixed: boolean }
pre: 稽核清单已产出（按 uiux-standards.md §5 逐条检查）
err: THIRD_PARTY_UNCONTROLLED — 第三方渲染内容（如 CopilotKit 消息体内的链接）交互不受控，
     记录为已知限制，不强行注入样式覆盖（避免重蹈 accessibility-guardrails 束要收敛的问题）
```
