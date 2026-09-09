# 上游解绑与重新绑定

只读代码审查基线8f26c8a23：未找到生产sourcePin/check/merge/rebind/detach消费者。URL导入只存sourceUrl，编辑追加版本；不可变SkillSource来源标签不是可变上游绑定，不能用它表示换源。

## 用户路径

私库失联优先重新授权原connectionId，保留原pin与比较基线。只有用户明确选择不同仓库、路径或来源才换源。解绑在远端不可达时仍可完成；先说明只停止跟踪，保留草稿文件、已发布版本和Agent固定绑定。

重新绑定从有效预检候选进入，第一版限兼容Skill；普通仓库适配的路径映射不明确时报告BASELINE_MAPPING_REQUIRED并保留原绑定。确认绑定本身不覆盖文件，而是进入“需建立比较基线”；用户逐文件审阅新源与本地差异，明确保留/采用，再建立后续比较基线。不得假造历史共同祖先，也不能静默称unchanged或fast-forward。

## 最小契约方向

| 操作 | 输入 | 事务结果 |
|---|---|---|
| detachSkillSource | 既有ExactDraft CAS、幂等key、理由 | revision恰+1、sourcePin=null；文件/manifest/发布血缘保持。审计保留旧pin和旧baseline；不要求远端可访问 |
| rebindSkillSource | ExactDraft CAS、previewId、candidateId、expectedPreviewDigest、幂等key、理由 | pin只能从授权有效服务端预检读取；文件不变、revision恰+1，baseline-required |

现有getSkillDraft须投影绑定/基线状态，但不能再复制sourcePin成为第二份来源事实。checkSkillUpstream需增加baseline-required；mergeSkillUpstream明确建立基线模式，关联服务端review、当前revision、新绑定及完整差异选择。当前本地文件不得被冒充为旧源base。

CAS冲突、候选不匹配、预检过期、来源移动、授权失效必须全不写。源绑定变动使旧上游review、待应用AI patch和精确revision试跑证据失效；已发布版本与Agent pin不变。摘要按既有定义重算，实际字节与manifest相等必须由存储测试证明，不能仅对比响应声称未变。

此文是签核输入；新增schema与UI尚待补齐，C34未完成，不把历史文件读取schema通过等同换源完成。
