# verification · deep-agent-skill-catalog

## V1 — 全仓只剩一处决定 run 用哪些 skill
`grep -rn 'readPlatformSkills(' apps packages` 零命中（定义与调用都没有；只剩两处注释回指历史）。⚠ 反证：加回任何一处即红。

## V2 — deep-agent 的 system 只目录、org_skills 全文
`deep-agent-produces-files.test.ts` T4 ①：system 含 `- pptx:` / `- pdf-create:` / `call_skill`，不含全文独有句子、不含 `read_skill`；`org_skills[1].content` 含独有句子；`script_protocol` 照送。
⚠ 反证 T4-CP：`"full"` 模式含独有句子，`"deep-agent-catalog"` 不含。

## V3 — curated 覆盖在 deep-agent 上成立
T4 ②：快照只有 pptx ⇒ `org_skills` 只有 pptx。⚠ 反证：执行期再并任何目录进来即红。

## V4 — 纯 provider 路径不变
`skill-lazy-loading.test.ts` V1–V4、V6 逐字不动；V5 改为 deep-agent-catalog 形状。

## V5 — 真栈：不挑 skill 发消息，哨兵仍回显（信号来自 org_skills）
`copilotkit-v2-skill-mount.spec.ts` ①：替身改在 `org_skills` 看哨兵后仍绿。⚠ 反证：把 `toolSkills` 置空，`org_skills` 为空，哨兵消失，红。
