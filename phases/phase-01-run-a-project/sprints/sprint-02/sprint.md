# Sprint 01/02 — wave-1 干净可派的 28 个 feature（93 点）—— 另 6 个（F125 F129 F134 F145 F146 F148）卡在待裁项，不进本 sprint

- **所属阶段**: Phase 01 (run-a-project)
- **创建于**: 2026-07-31 04:30:23

## 本 sprint 目标
wave-1 干净可派的 28 个 feature（93 点）—— 另 6 个（F125 F129 F134 F145 F146 F148）卡在待裁项，不进本 sprint

## 领取的 feature(引用自阶段权威清单,按 id)
- F11 (P1, auth) — 邀请管理员双人复核 + 配额用尽硬阻断 + 团队增删改 + 成员移除
- F12 (P1, auth) — 用分组链接免注册进场：令牌+手机号名单双核对，不建账号只建免注册身份
- F16 (P1, auth) — 撤销后 5 秒内新访问失效；已在场者保留至环节结束；分组与签到到场回写
- F18 (P1, tpl) — 蓝本设计器外壳：版本条、草稿自动保存、三动作按钮、完成度侧栏与 15 项配置目录
- F32 (P1, files) — 五类预览器 + 单个下载（短时效一次性、写审计）
- F33 (P1, files) — 批量 zip 导出（round-trip：目录结构≡树）+ manifest + FTS 搜索与六项筛选
- F34 (P1, files) — 空态/依赖失败/无权限/完整性校验失败态 + 契约态（改名重定向）
- F35 (P1, files) — 上传接口+服务端校验 + 三项安全检查（恶意扫描/MIME嗅探/解压炸弹）+ 对象存储写入
- F49 (P1, model) — 五项准入测试的人工判读记录 + 门禁：五项全过才可启用，判读不可删、改判留双份，组合成员各自过测且组合本身也过一次
- F53 (P1, mcp) — 授权范围服务端判定（三层权限第①层）+ 新注册默认隔离运行时阻断 + 越权拒绝拦截计数 + 新工具不自动进白名单 + 任务权限包申请接口
- F63 (P1, skill) — 把 skill 绑定到环节与角色：绑定条目模型（环节×skill×版本×下发角色×触发方式）+ 混合槽可区分 + 模板套用写入项目实例不回写 + 另存为组织模板
- F70 (P1, rec) — 转写段与时间码 anchor 完整性 + diarization 匿名声道 + 正在识别中间态
- F81 (P1, itv) — 访谈列表与范围切换器 + 挂到项目环节（固定快照绑定）+ 虚拟/真人混排强标记
- F82 (P1, itv) — 访谈模板数据模型（结构+时长+数据字段+来源）+ 套用即脱钩 + 用过 N 次统计
- F86 (P1, itv) — 一次性签署令牌 + 门户长效令牌 + 受访者授权页外壳与动态渲染快照
- F97 (P1, itv) — 访谈对象数据模型 + 两处投影一致 + 同意书状态单一来源
- F101 (P1, canvas) — 模板发布状态机（草稿/试跑/发布/归档 O-10）+ 实例固化版本 + mermaid 白名单「N 条语法被忽略」
- F103 (P1, canvas) — 真实 mermaid 渲染与三段互转（Markdown⇄mermaid⇄DiagramModel⇄fabric）+ [源码]视图
- F109 (P1, chat) — 对话卡片列表（今天/本周分组 + 徽标同源 + 新建/改名/删除）+ messages.jsonl file-first
- F110 (P1, chat) — AI 团队面板与在场三态 + [编制] + Agent 市场入口 + 消息流骨架与 AI 消息头
- F117 (P1, project) — createProject：一条创建路径 + 蓝本可选参数 + 两行原子写入 + 幂等 + 创建者不自动获角色
- F118 (P1, project) — agenda_segments 独立表：四态 + mergedInto + 同工作坊至多一个 active 的部分唯一索引 + artifact_bindings 补外键
- F122 (P1, project) — listProjects 两段式返回（我在里面 / 我管着它）+ 归档与组织停用「显示且标注只读」+ 平铺不折叠
- F124 (P1, project) — archiveProject / unarchiveProject：两态只读做在 PG RESTRICTIVE 策略 + 归档四连带 + 删除接口不存在的断言
- F133 (P1, asset) — 左栏计数与组织额度条：取不到显示「—」而不是 0，单类计数失败不拖垮整个左栏
- F141 (P1, asset) — 资产目录：文件树 + 文件内容读取，徽标由扩展名派生且未知扩展名不报错
- F66 (P2, skill) — Skill 版本与停用：不可变版本快照与版本链 + 发新版旧版自动归档且已建实例锁版本 + 引用枚举三类 + 停用/恢复 + 硬删永久拒绝 + 内置不可删
- F79 (P2, rec) — 同意书文案动态渲染 + 已提交渲染快照不可回溯改写

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 01/02` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
