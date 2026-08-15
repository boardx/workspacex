# Domain

Invariant: visual unification does not change resource identity, creation payloads, tag limits, persistence, permissions, or navigation destinations.

## ③ 件为什么不是 zod 契约文件（本束无对外 HTTP 面）

本束只统一既有 Studio 列表页与创建弹窗的视觉样式，不新增、删除或修改 HTTP 端点、请求载荷、响应结构或持久化行为。因此按 ADR-023 的形态 B 记录第 ③ 件：以现有页面行为的可执行回归命令证明 API 契约未被改变，具体门控命令见 `coverage.md` 的“API 操作 / 门控命令”列。
