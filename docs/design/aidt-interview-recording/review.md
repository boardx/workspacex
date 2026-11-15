# C 方案评审：general AIDT 项目的原生访谈录音与本人授权

日期：2026-11-15。**新增设计，待课程、产品及研发负责人确认；不在已批准的 A+B 范围内。** 本文件不批准设计、不修改任何 design-signoff 状态，也不代表录音、模型或真人授权已经验收。

A+B 已覆盖共享阶段成果与纯人类文字频道。本方案 C 只补真实访谈录音及转写；不包含语音房、成员通话、会议服务器或教师评分。不能以个人录音、Chat 口述输入、模拟访谈或外部授权后的文件上传冒称原生访谈闭环。

## 1. 本次要作出的决定

建议采用一条独立、默认关闭的 **general 项目真实访谈分支**：学生准备真实访谈及参与者名单，参与者本人完成完整告知与四项选择，服务端核验后才允许主动采音。复用现有项目鉴权、录音/ASR/结束/文件产物能力，不把 general 成员塞进 workshop 表，也不扩大旧授权写口。

下列事项都须明确批准后才能开发，不能当作 A+B 的细化自行实施：

1. general 项目中谁可以发起、查看原始录音/转写，以及参与者的只读本人门户。
2. 本人账户与受访者代号的可靠绑定；外部受访者采用什么身份核验及直接送达方式。
3. 四项分别拒绝时的能力降级，尤其单麦混录无法可靠剔除某个人的事实。
4. 真实告知配置、不可变快照、现有未装配 API 的接线及最小新增 API。
5. 录音原件保存、转写、授权收回和新版成果引用的生命周期。

建议先交付 **C1：已验证账户的本人签署 + general 原生主动录音/转写**；外部受访者 C2 必须有独立核验及直接送达，不能用学生自己持有的可转交 token 假装“已证明受访者本人”。课堂真实受访者不具备 C1 条件时，C1 不能算该课堂 FR05 已完成。

## 2. 已核实的实现与缺口

| 能力 | 源码依据 | 实际限制 |
| --- | --- | --- |
| 主动采音及持久转写 | `apps/web/components/chat/chat-recording-panel.tsx:92`、`apps/web/lib/live-asr.ts:47` | 真正调用 POST `/recording/sessions`、ASR WS、GET segments；thread 必须有真实 message 锚点；现挂在 legacy Chat，不能把它描述成 v2 已有访谈入口 |
| canonical Chat 语音输入 | `apps/web/components/chat/copilotkit-v2-panel.tsx:240` | `asr-draft` 只把口述填进输入框，不保存访谈录音，也不替代研究证据 |
| 个人实时转录 | `components/rec/transcription-history.tsx`、`lib/live-personal-transcriptions.ts`、`packages/contracts/src/personal-realtime-transcription.ts:102` | org + owner 的个人持久文本，关联项目不改变其权限，无访谈本人授权矩阵，也没有音频上传后转写入口 |
| 项目录音鉴权 | `apps/api/src/interface/recording/segment-ingestion.ts:131` | 直接 `findProjectMembership`，API 与 WS 共用；general 成员不在这张 workshop 表，故 general AIDT 当前会拒绝，不可造 workshop 角色绕过 |
| 现有授权页 | `apps/web/components/entry/consent-form.tsx:18`、`apps/web/app/(entry)/consent/page.tsx` | 真写 cells，但仅显示四项中的三项；告知/天数来自 mock；成功固定跳 `/session`；须项目角色且可代任意 participant 写，不能直接用于 C 的本人签署 |
| 录音矩阵门 | `apps/api/src/infrastructure/recording/pg-recording-repository.ts:344` | 所列每位参与者四项必须全 granted，缺项/denied 均拦；空名单也拦。与权威逐项降级语义存在差异，不能静默改旧门 |
| 矩阵读取 | `packages/contracts/src/recording.ts:398` | 有 GET `.../consent-matrix` 契约；本次对 API 源码检索未发现 handler，不能称可用 |
| 本人签署资产 | `packages/contracts/src/interview.ts:1723` 起、`application/interview/{issue-signing-token,get-consent-page,submit-consent,get-consent-mirror}.ts`、`infrastructure/interview/pg-consent-token-repository.ts` | 一次性签署 token、四位选择、只读研究员镜像和 PG 快照已有契约/用例；本次未发现这些用例的 HTTP controller 装配。令牌存储缺 org 上下文的历史限制见 F86 迁移，不可直接无审核放开 |
| 告知渲染资产 | `application/recording/consent-render.ts`、`domain/recording/consent-render.ts`、`application/recording/consent-render-ports.ts` | 缺变量应拒绝渲染；ports 明确模板、联系人及快照权威存储未有该束 PG 实现，不能用假天数/假合规邮箱替代 |
| 原件/转写物化 | `recording.controller.ts:658`、`application/recording/session-lifecycle.ts:95`、`domain/recording/file-first.ts` | 结束后 WebM 最多 20 MiB 的受保护上传可物化；从已有 segments 渲染 transcript.jsonl，**上传不会调用 ASR**。interview 计划有音频、转写、notes；thread 计划不存原音频 |
| Chat 附件文件转写 | `infrastructure/agent-run/standard-audio-service.ts:22`、`packages/contracts/src/standard-audio-tools.ts` | `wx_audio_transcribe` 可处理授权 run 中的 WAV/MP3，需真实 ASR/native session/tool authority；不是项目录音同意链，也不自动写访谈 segments |
| 看起来完整的其它录音屏 | `components/rec/rec-prep.tsx:12,166`、`components/itv/live-record.tsx`、`components/interview/interview-stage.tsx` | mock 预览或展示组件，不是可接入的真实录音引擎 |

## 3. 学生及受访者看到的流程

1. 在 AIDT 共情/测试阶段点击“准备真实访谈”，填写本次目的、受访者代号及所有会被麦克风录到的在场者；不会默认持续采音。
2. 服务端读取真实项目、组织、材料保留期、数据控制方、联系人、合规邮箱，以及实际 ASR/模型处理边界。任一必需配置缺失就显示具体缺项，不发不完整授权邀请。
3. 每位参与者在自己的已验证身份页面读取本次告知，逐项选择、核对并提交；无预勾选，允许全部拒绝。学生只看到授权状态及操作条件，没有“替对方同意”。
4. 学生查看服务端权威矩阵：谁尚未回应、谁拒绝采集、本次哪些能力可用。更改参与者、扩大目的或改变处理方后，旧签署不得自动覆盖新增范围。
5. 只有参与者名单非空、身份绑定有效、所需授权满足、项目可写、保留期有效时，按钮才可开始；后端以同一事实再次判定。只靠前端禁用不构成门禁。
6. 点击后申请麦克风；拒绝、设备丢失、取消连接、断线都明确呈现。新在场者加入、名单/同意变化或撤回时立即停采，不对未同意者后台续录。
7. 学生主动停止，系统结束 ASR、读取真实保存的转写、保存原音频和笔记并校验回读。音频、转写、文件物化分别显示状态；部分成功不能显示“访谈已完整保存”。
8. 受访者代号、原音频、校对转写、原始引文与学生解释分别展示。发现卡引用真实材料及位置；AI 推测不变成引文，不自动形成小组结论。

## 4. 四项权利与单麦混录的安全规则

项名、顺序及含义仍只引用 `packages/contracts/src/consent-item.ts` 的 `CONSENT_ITEMS`，不新增第五项，不复制枚举。**完整回应与全部同意是两件事**：四项都作出选择即可完整回应，全部拒绝也是有效结果。

| 选择 | C general 分支拟定行为 | 首次交付的安全限制 |
| --- | --- | --- |
| record 未回应或拒绝 | 不采这个人的声音 | 同一物理麦克风无法保证排除在场者时，整场不开麦或立即停止；不能只把他从 trackPlan 删除后仍录到他 |
| transcript 拒绝 | 不把其音频送去转写 | 混合音频无法可靠分离时，整场 ASR 禁用；不能把音频上传转写工具当旁路。若 C1 尚无音频独存模式，明确该模式未支持，允许不录音的访谈 |
| ai_analysis 拒绝 | 不进入自动归纳/模型分析 | C1 若不能贯穿 segments→文件→发现卡→阶段上下文保留禁分析标记，须禁用该材料的 AI 分析，不能仅隐藏按钮或在提示词里说不要分析；混录无法区分时按整场处理 |
| attribution 拒绝 | 不署名引用 | 使用代号和必要脱敏；无可靠说话人识别时不得自动把某段分配给真人，也不得凭声纹猜身份 |

不支持的组合应显式说明能做什么，不能诱导学生要求对方全同意。不能为了本轮工期偷偷将 C 门改成“全部勾选才算本人完成”，也不能借本方案把 workshop 旧 gate 的行为一并更改。

ASR 本身是否属于告知中“转写处理”，AI 归纳属于哪家服务，数据是否离开当前组织边界，都必须与真实配置一致。未配置 ASR 应失败且保留已有材料，不回退另一模型。本人拒绝 AI 的材料不应用于七个教学 Skill 的上下文。

## 5. 最小数据关系与身份绑定

**建议复用而非复制**：真实访谈使用 `interview_sessions.source_kind='human'`，受访者使用 `interview_subjects`，名单关联使用 `interview_session_subjects`；`recording_sessions.source_ref_id` 指向该真实访谈。不得创建 virtual persona 冒充真人，不得使用随机不存在 sourceRefId，也不为 general 假造 group/agendaSegment。

新增准备入口若绕不开现有未装配的向导，可以创建真实 human 访谈和 roster，但不能暗中触发 AI 生成大纲，不能把数字人访谈接口改名充用。是否复用向导还是新建最小准备命令，应在契约中只保留一个权威创建动作。

需要补足的关系：

- `(orgId, projectId, interviewId, subjectId)` 必须由服务器关系查询确定，不能信任网页传来的项目或受访者代号。
- C1 加明确的 `subjectId ↔ verified principal.userId` 绑定。只有该主体可提交自己的 choices；没有绑定不能让组员代填。录音发起者是学生、受访者可能不在项目名单，两类权限独立。
- C2 外部受访者需可靠的一次性证明及直接送达：可复用 F86 token/核销设计，但需 org/project/source/subject 约束、过期、撤销、重放保护、服务器端直接送达和受访者身份核验。**仅持有学生生成或可读取的链接不能证明本人**；二维码也不自动证明身份。未实现身份条件时 C2 保持不可用。
- 将已提交的四项选择、身份验证方式、签署者、服务端时间、告知模板版本/内容 hash、保留期与处理方快照不可变保存。身份核验原始凭据不放进小组研究材料。
- 以真实 `interview_consent_submissions` / 签署快照作为 C 的同意权威来源；录音矩阵从它派生，不允许可被学生改写的 legacy `recording_consent_cells` 覆盖本人选择。若需要投影，必须是服务端同一事务、带明确来源版本且不能成为第二权威。
- 固定本次 roster 和授权 revision。开录必须匹配；录中变更需暂停/结束并重新核验。结束后不回写历史告知，撤回则保留必要的最小审计而停止后续使用，实际删除规则待确认。
- 原音频、转写及学生反思保留来源、时间、提交者和版本；转写派生自本场音频，不能覆盖原件。某文件缺失必须保留缺失状态。

F86 现有 token/snapshot 表的租户边界设计有已记录的历史缺口；需要先审查两层 token locator→已验证租户事务的设计，不能把无 principal 的入口接上任意 tenant 参数。本人 token 只能读取自己的告知、回执与门户，不能枚举小组成果或别人的同意。

## 6. 拟议 API 及权限变化（仅评审，不是已生效契约）

路径与字段以下给出可审阅的最小候选；开发时需落到正式 contract 单源并核对现有 interview 束，避免相同能力出现两个写口。

| 操作 | 最小输入/返回 | 权限和失败语义 |
| --- | --- | --- |
| 准备真实访谈 `POST /projects/:projectId/interview-recordings/preparations`（若现有 human 向导可安全装配则复用其创建动作，不同时保留两个） | 稳定 clientPreparationId；目的、受访者别名/已绑定主体、阶段引用；返回真实 interviewId、rosterRevision、待补配置/授权状态，不返回他人签署凭据 | general 实际成员 + 现有 canonical 项目内容写权限；校验 org/project 归属；归档/组织停用只读；请求本身不采音 |
| 签署邀请（优先复用 `POST /interviews/:interviewId/signing-tokens` 的能力） | interviewId、真实 subjectId；返回邀请状态/到期时间，C2 不把可代签 token 返回学生 | 核验当前项目写权限、真实 roster、告知完整性；只有本人可取得并使用最终凭据 |
| 读取本人告知（优先装配/收窄 `GET /interviews/consent/:token`） | 验证凭据；返回本人的代号、本次目的、真实处理与保留期、四项说明、不可变 noticeRevision/hash | 凭据必须绑定 subject；未验证/失效同一拒绝，不泄露访谈内容；未知配置不返回假告知 |
| 本人提交（优先收窄 `POST /interviews/consent/:token/submit`） | 四项 choices、所见 noticeRevision/hash、稳定 operationId；actor/subject 从服务器验证结果确定；返回签署回执、提交时间和本人门户 | 明确禁止学生/教师代签；全拒绝也是成功提交；告知版本冲突 409；失败不消费一次性凭据或产生半份有效授权；同操作丢回执重试返回同一回执 |
| 开录前矩阵 `GET /projects/:projectId/interview-recordings/:interviewId/consent-matrix` | source/roster revision；返回四项选择、回应状态、能力门、具体阻塞项及 matrixRevision | 实际小组成员查看最少必要状态；本人只看自己；无主观“已同意”推断。现有 session GET 只能在 session 创建后读取，不能解决开录前读取，故需 source 级形状 |
| 开始录音：复用 `POST /recording/sessions`，C general 增补准备/矩阵版本关联 | 原 sourceType=`interview`、真实 sourceRefId、projectId、非空 trackPlan、幂等键；加预期 roster/matrix revision（最终字段须签核） | general 专属 adapter 用 canonical read+content-write、实际成员及真实 source 归属；事务内重新验名单/本人授权/保留期；旧矩阵 409，缺项/拒录不开始，不创建无效 session |
| 录音运行/收尾：复用既有 ASR、segments、end、materialize-files | 服务器 session/track/锚点；ASR 只用服务器下发路径/鉴权信息；结束、原件上传/转写保存各自有幂等回执 | 每条读取、开始 ASR、续传及文件保存均重新核验成员/生命周期与本次同意；移除/撤回后停止。取消连接释放麦克风，实际已采集内容的保存/删除不伪称自动完成 |
| 本人后续修改/撤回（复用并完成 interview portal 用例） | 本人凭据、要撤回的项及预期 consent revision；返回真实处理回执 | 不能由学生替改；立即阻断不再获准的采集/ASR/分析；已派生成果及实际删除范围按权威策略处理，不能只改 UI 勾选 |

### 权限保持与收窄

- **workshop 原行为保持**：不全局将 `requireProjectRole` 改为宽松 general 解析；不改变旧 mutable-cell 路由对 workshop 的已有语义。
- C general 使用单独、默认关闭的服务分支，由服务器项目 kind 和真实访谈来源判别，不能让 query/body 的 mode 决定鉴权。
- 成员身份复用 `resolveProjectLayer` / `authorize`，并额外要求实际 general 成员；组织管理员不是超级成员。采用已有项目内容写动作，不复制角色矩阵。
- general 原始音频/转写的受众必须写入本人告知；参与者仅签署不等于加入项目。教师、观察者或组织管理员不会因身份名称自动获得原始材料访问权。
- C general 拒绝经旧 `/recording/consent/decisions` 代写自己的权威矩阵，不把旧接口扩为 general 可写。
- 401 无认证；未知/跨组/不可见来源统一 404；已知只读/不允许代签 403；输入/名单不完整 422；过期 roster/notice/幂等内容冲突 409；配置/依赖不可用明确 503 或契约中可行动的缺项，不冒空态。错误码最终须正式契约确定，不能散落前后端。

本人提交需要 **消费 token、写 immutable snapshot/choices、签发门户回执在同一事务内**。现 F86 用例依次调用端口不自动证明跨仓储原子性，接线前须验证故障回滚；不得在存储失败后显示已授权。

## 7. 复用采音链时必须完成的工程工作

- 抽取/复用 `live-recording` 的受控麦克风生命周期、既有 ASR 客户端与停止逻辑，不复制另一个 recorder。canonical Chat 的输入草稿麦克风继续原行为。
- 真实 interview carrier 使用 timecode，不借 thread message 锚点伪装访谈。原始 WebM 与 PCM 转写可以来自同一主动采集，但当前 PCM handle 不自动产生可保存 WebM：需要受控原件捕获适配及大小/停止策略，不能谎称已有持久原音频。
- 分开显示“录音已停止”“转写已保存”“音频已保存”“归档已完成”。结束失败保留 session 身份；取消/断线不复用旧 session 的异步事件；重复 stop 不多建成果。
- 保留 20 MiB 文件限制并给真实容量/时长反馈；不能保证任意课堂时长都装得下。超过限制应主动停止或使用经过批准的分段方案，不能无限内存缓冲。长录音、断线后原音频恢复仍需技术验证。
- 转写必须可校对，原稿与学生修订分开；无识别结果、低质量音频及模型未配置不等于成功。不得以文本模型编出未识别的访谈。
- 原音频物化沿 `materialize-files` 校验魔数/大小/hash；只有已保存对象和正确 derivedFrom/来源关系才允许报告引用。上传该接口不会触发转写，应明确实时 ASR 与文件保存的顺序。
- 无同意者、名单为空、全部拒绝时都不能开启采音；不生成“已完成真实研究”的示例占位数据。

## 8. 可复验场景与反证

| 场景 | 必须成立的结果 |
| --- | --- |
| general 组内学生准备 → 本人签署 → 主动录音 → 停止 → 重登查看 | 相同真实来源下的音频、转写和授权快照可读回；两名组员看到同一授权状态；PG 与对象存储中有相应实体，不能只验证 React state |
| 学生构造 participantId、提交他人 choices 或持有未绑定 token | 不能替他人授权；无第二条 mutable-cell 旁路；本人身份和 subject 不匹配被拒 |
| 四位全拒绝；缺一项；空 roster | 全拒绝回执能保存，但不采音；缺项与有效拒绝清楚区分；空 roster 永不放行 |
| 同意 AI=false / attribution=false / transcript=false | 分别实测不进入模型上下文、不署名、不送 ASR；无法逐人分离时整场限制。扫描实际 provider 请求及导出，不能只看页面标签 |
| 告知缺真实保留期、控制方、联系人或邮箱 | 不发签署邀请；不出现 mock 天数/邮箱；已存旧快照不被新配置改写 |
| roster/notice 改变、最后一人正在签署或开录并发 | 事务内版本校验；不使用旧矩阵；失败不建半个录音；故障后本人可安全重试同一请求 |
| 正在录音时权限撤销、归档、参与者撤回/新在场者加入 | 停止采音/禁止新上游推送，显示原因；已有数据按真实保存/撤回结果显示，不直接删 UI 假装已销毁 |
| 麦克风拒绝、取消连接、设备移除、断线重连、旧 session 延迟帧 | 不悄悄开麦，不混写会话，所有资源释放；不可恢复时明确失败；真实浏览器麦克风验证与 mock 分开记 |
| ASR 未配置/额度不足/提供方失败；原音频上传失败 | 保留真实已有材料，分项失败可重试；没有转写不得生成成功反馈；原件缺失的报告显式标记 |
| 跨 org/project 的 session、subject、snapshot、artifact、portal | 同一不可见响应；受访者 token 不能读小组资料；管理员非成员也不能读 |
| workshop 旧 start/consent/ASR/stop/物化 | 现有回归行为逐项保持；C 默认关闭不会给旧路径发新请求或修改普通项目数据 |

验证分层：schema/权限单元 → 真实隔离 PG 并发/事务/tenant → 已配置 ASR 的真实浏览器与实际麦克风 → 两组隔离及受访者本人设备流程。循环播放夹具可检验管线，不能声称真人授权或课堂学习效果已验证。

## 9. 本轮六小时的可行边界

**本轮 A+B 期间可完成**：查证、该评审包、FR05 缺口在现 Demo 的明确边界说明；不悄悄改录音权限、创建未签核服务或把个人笔记改称访谈。

**C 被明确批准且真实环境/配置齐备后，可优先交付一个 C1 垂直切片**：general 实际成员、真实 human 访谈/roster、已验证账户的本人四项签署、真实矩阵/告知、受控开始/停止和一场短录音转写及原件保存。是否能在六小时内验收取决于既有身份映射、存储、告知配置和 ASR 实例是否可用；需要先用这些事实排定范围，不能预先承诺完整 FR05。

**不应压进六小时并宣称完成**：外部匿名身份核验和直接送达、全部同意组合的音轨级可靠分离、长时录音/断线原件恢复、完整撤回与派生物删除审计、未成年人监护授权（如适用）、30 人课堂及并发/音频质量验收。某项是试点必需时应承认为阻塞，不能从 UI 隐去。

本方案不承诺特定法规合规或法律身份认证等级。课程负责人需确认参与者范围、课程受众、保留/撤回策略、实际处理方与试点方式；这决定 C1 是否足够、C2 是否是开课前置。

## 10. 交给负责人确认的具体问题

1. 是否批准新增 **C general 原生访谈分支**，保持 A+B 和 workshop 旧流程隔离？
2. 首次验收仅限已验证账户的 C1，还是必须覆盖无 WorkspaceX 账户的真实外部受访者 C2？若必须 C2，采用何种本人核验和服务器直接送达渠道？
3. 是否同意四项独立选择及单麦整场安全降级，且不支持的模式明确停留待补而不要求对方全选？
4. 谁提供真实告知模板、组织控制方、联系人、合规邮箱、实际服务商/处理方式与材料保留/撤回策略？缺失时是否保持不开录？
5. 原音频+转写+notes 是首次验收的必要集合吗？可接受的一场录音上限和失败恢复目标是什么？

批准上述具体范围后，才将确定形状落到正式契约束及测试；本 review 不自行改变签核状态。
