# ① UI（方案A已获会话批准）

本目录的[ui-preview.html](ui-preview.html)是静态审阅材料；课程数据/按钮动作均是标明的示意，未接后端。正式实现位于 `/aidt` 的 `aidt-courses-panel.tsx`，使用课程四操作API；当前源码已实现，隔离栈需要最终build/restart后做真实验收。静态示意不作为运行证据，未部署生产。

## 课程入口

沿用 `/aidt`，最上方课程卡标题、简短说明与“新建课程”（仅确认后的管理能力显示）。课程卡不放伪造进度；学生只见自己所属课程。课程详情是同页选择，不另建聊天或组工作区；显示课程标题、“我的小组”及真实成员。每个组仍进入原有 `/aidt/:projectId`。所有真实成员组在“全部已加入的小组”保留，不根据名称或tag推断课程。

课程详情的“关联已有小组”只展示既有真实owner组；选择后明确提交、新API成功回读才称“已关联”。“新建小组”仍调用现有Project表单，成功后让管理者回到这里关联，避免隐式跨服务事务。课堂活动、模型引导、阶段完成与课程关系分开。

## 七态与边界

- 加载：正在读取课程/小组；不显示假空态。
- 空：尚无所属课程；旧组仍可进入；管理者可明确创建。
- 失败：保留操作输入、提供重试；不把失败当未参加课程。
- 无权：按原服务拒绝，不显示别组信息；管理资格不等于资料读权。
- 归档组/停用组织：明确只读，以Project真实状态为准。
- 成功：仅以server回读关联/成员显示，不能因为输入了课程名就宣布建立关系。
- 切身份/关闭模块：同步隐藏旧组/课程并取消读请求，迟到响应不得复现。

实际锚点：`aidt-courses`、`aidt-course-create`、`aidt-course-name`、`aidt-course-create-save`、`aidt-course-<courseId>`、`aidt-course-selected`、`aidt-course-link-project`、`aidt-course-link-save`、`aidt-course-project-<projectId>`、`aidt-courses-error`、`aidt-course-groups-error`。现有 `aidt-project-<projectId>`、`aidt-new`、`aidt-group-members-<projectId>` 继续兼容。
