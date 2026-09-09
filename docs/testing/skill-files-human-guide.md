# Skill 多文件与 Agent 绑定：人工验收

Target: [devapp](https://devapp.boardx.us/skill). Final main `8e08a8f98ce5e9b3c3d57c6d888d85726744fab2` deployed successfully. At 2026-09-10 07:05 CST, server identity, API/Web, Agent service and HTTPS login checks passed. Authenticated human acceptance remains pending because the Mac is locked. Use a test-organization administrator account.

如果没有专用已发布 Agent，可先到 [Agent 后台](https://devapp.boardx.us/platform-admin/agent)，点击“新建 / 导入 Agent”，选择 URL 导入。使用公开模板 `https://raw.githubusercontent.com/anthropics/skills/main/template/SKILL.md`，命名为本组织内唯一的“多文件验收 Agent”。导入后将指令改为“根据已固定的 Skill 读取参考文件并回答用户问题”，点击“保存指令”，再点击“发布”，确认按钮显示“已发布”。记录这个 Agent 名称，后续绑定和聊天都使用它。

## 1. 导入并进入文件编辑

在 devapp 打开 `/skill`，点击“新建 Skill”，选择导入及“仓库/目录 URL”。输入你有权使用的公开 GitHub Skill 仓库或目录地址，扫描后选择候选，使用本组织内未重复的名称导入。成功后关闭弹窗，在新卡片点击“编辑源码”，进入 `/platform-admin/skill/…`。

页面应显示实际文件列表。不要用 `/platform-admin/skill` 作为列表入口。导入失败时先处理页面错误；不要继续把旧卡片当作新导入结果。

## 2. 编辑三个文本文件，统一保存

用专用测试 Skill 操作，避免覆盖业务内容。点击 `SKILL.md`，将“文件内容”替换为：

```markdown
---
name: reference-check
description: 核对验收参考文件中的标记。
---
当用户要求核对参考标记时，读取 references/check.txt，
只回复其中 marker 的值，不从用户消息猜测答案。
```

在“新文件路径”分别填下列路径，点击“新建文件”，填写内容；文件已存在则直接选择编辑。

`references/check.txt`：

```text
marker=海盐松果-731
```

`notes/checklist.txt`：

```text
验收目标：三个文件一次保存，刷新后内容保留。
```

勾选“确认统一保存全部修改并发布新版本”，点击“保存全部文件并发布”。成功后刷新页面，逐个打开三个文件核对内容。若失败，页面应保留未保存修改；不要急着点击放弃。保存会发布新 Skill 版本，**不会自动更新任何 Agent 已固定的版本**。

补测删除：选择 `notes/checklist.txt`，勾选“确认从下一版本删除 notes/checklist.txt”，点击“删除所选文件”，再统一保存并发布。刷新后该文件应消失，另外两个文件应保留。记录新版本号，后续试跑和绑定使用这个版本。

## 3. 试跑参考文件

展开“试跑当前已保存版本”，在“试跑输入”填写：

```text
请核对参考标记，只回复标记值。
```

点击“试跑已保存版本”。预期回复 `海盐松果-731`，并确认页面显示的试跑版本是刚保存的版本。**不要将标记答案粘进试跑或聊天输入**。服务报错、缺少模型或无法读取参考文件都应记录为未通过，不能以“保存成功”代替试跑通过。一次答对是行为证据；若有来源/工具记录，也一并保存。

## 4. 绑定专用 Agent，并在新聊天验证

点击“固定版本到 Agent / 恢复旧绑定”，在“选择 Agent”选择上面已发布的专用测试 Agent。核对目标 Skill 版本与“完整固定清单”，记录原清单；勾选确认后点击“固定所示 Skill 版本”。其他 Skill 固定项应保留。

**保留这个绑定页面，在另一标签页进入 [聊天](https://devapp.boardx.us/chat)**。左侧点击“交一件事给 AI”，确认进入没有消息的新任务；在输入框下方点击“能力：自动匹配”（控件名称“选择能力”），选择刚发布的专用 Agent。确认按钮显示“能力：<专用 Agent 名称>”，再发送上面的核对请求。预期得到相同标记。切换能力本身不会新建会话；不要在已有消息的旧线程上冒充新会话验收，也不要用 `?agentId=...` 参数代替真实选择。已有会话不会自动切换到新的绑定。

## 5. 恢复并留证

回到未刷新的绑定页面，再勾选确认，点击“恢复本页上次 Skill 固定项”。核对恢复后的完整清单与原记录；其他 Skill 项仍应保留。**恢复后清单为空表示恢复组织默认 Skill 选择（自动加载已启用 Skill），不是禁用全部 Skill。** 恢复会发布新的 Agent 版本，不会删除刚编辑的 Skill 文件。

快捷恢复记录仅存在本页，刷新或离开后不保留。若显示冲突或“结果未确认”，先重新读取并核对，不能把它当作确定未写入。留存部署版本、三个文件刷新截图、试跑结果、新聊天结果及绑定/恢复清单；未完成的步骤明确写“待验证”。
