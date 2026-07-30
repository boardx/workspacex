# Sprint 01/01 — wave-0：19 个无依赖的地基 feature（每束一条主干），72 点

- **所属阶段**: Phase 01 (run-a-project)
- **创建于**: 2026-07-30 18:42:06

## 本 sprint 目标
wave-0：19 个无依赖的地基 feature（每束一条主干），72 点

## 领取的 feature(引用自阶段权威清单,按 id)
- F07 (P1, auth) — 资源可见性范围过滤：全组织可用/仅某团队，拒绝时标明是组织层限制
- F10 (P1, auth) — 组织成员邀请与激活：入场即带组织角色+团队，链接身份以服务端为准（篡改无效）
- F15 (P1, auth) — 生成邀请链接：名单+身份四选+主链接/分组链接+有效期三档+邀请码+群发+撤销/重置全部+记录使用者
- F17 (P1, tpl) — 蓝本与版本领域模型 + 配置项定义表驱动的槽位与完成度派生
- F31 (P1, files) — 项目文件浏览器：artifacts 列表 API+RLS 过滤（可见集合≡检索可见集合）+ 树/列表双视图 + 行元数据
- F47 (P1, files) — 契约先行桩：ontology_edges 失效接口 + 报告段落标失效接口（phase-02 模块）
- F48 (P1, model) — 模型池领域模型：类型二分 + 能力元数据 + 合规属性受控枚举 + 三态 + 组合模型作为池内一条记录，凭据加密永不回显
- F52 (P1, mcp) — MCP 服务器领域模型 + 工具发现：三正交字段（授权范围/评审状态/连接状态）不合并，mcp:<服务器>.<工具> 命名空间，服务器级“涉客户数据”标注，凭据端点对非管理员不可见
- F55 (P1, agent) — Agent 领域模型：身份 + skill 挂载带版本 + 可见性范围 + clone_from（复制不继承工具白名单）+ 版本快照且项目开工锁版本 + 已停用态
- F61 (P1, skill) — Skill 声明式契约领域模型 + 静态契约校验 + 数据范围越权检查 + 安全扫描（自动门禁）+ 来源标记自动打标 + 四态状态机；运行时上下文只经 Context API
- F69 (P1, rec) — 开启多路录音并实时出字（三载体共享一套转写能力）
- F80 (P1, itv) — 访谈范围模型：project_id 可空 + 两种权限投影 + 服务端过滤
- F100 (P1, canvas) — fabric-markdown 源码并入 packages/ + ADR 版本锁定 + 模板注册表 19 个 key+display_name 契约
- F108 (P1, chat) — 对话可见性两层交集判定 + 四视角投影 + 观察者降级（服务端不下发）+ agent 私聊项目层 + 管理员边界
- F116 (P1, project) — 三类容器落库：projects 超类型（列集合白名单）+ workshops/research_projects/user_insights 三张 1:1 子类型表（判别列 kind + 复合外键互斥）
- F132 (P1, asset) — 后台左栏「AI 能力」组的项集合 ＝ AssetKind 六值（双向相等 + 反证套件）—— 补上画布模板与项目蓝本两项
- F144 (P1, research) — 新建深度研究配置面板：七组字段 + 逐项默认值 + 实时预览句，三处入口对观察者不存在于 DOM
- F03 (P2, auth) — 设备与会话列表：30 天有效期，可踢掉其它设备，被踢会话下次请求即失效
- F78 (P2, rec) — 材料保留期参数读取 + 到期时间固化 + 到期删除与删除证明

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 01/01` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
