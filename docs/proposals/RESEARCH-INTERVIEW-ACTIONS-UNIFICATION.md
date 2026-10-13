# 研究与访谈操作按钮一致化（#5671）

用户已授权统一两域按钮风格、颜色和位置。沿现有深色主按钮与设计 token，不改全站 Button 默认、选中卡片、业务流程或权限。原生文件生成仍遵循现有报告文件服务，不在本次运行模型。

## 位置与层级

- 返回列表/返回上一页放在页头左侧，outline 中号按钮；已有未保存内容导航确认保留。
- 同类步骤的确认、保存、继续、生成主操作放在步骤内容之后的右对齐 footer。上一步和取消为 outline，主要动作 primary，主要动作位于同组最后。
- 报告生成/重新生成/更多/文件按钮使用内容内右对齐操作区，避免独立 fixed 位置遮挡标题或导航。长文阅读的操作区是否 sticky 由原壳决定，不创建额外浮层。
- 局部编辑仍位于编辑对象旁；删除等危险操作保持 destructive/原危险提示，不藏进主要确认按钮。
- 小屏自然换行，维持操作顺序、可见焦点与可读禁用态；不重复尺寸/颜色规则。

## 共享接口与所有权

`components/research-studio/research-workflow-actions.tsx` 是两域操作规则的唯一消费入口，继续委托已有 `components/ui/button.tsx` 的 variant、md 尺寸、颜色和禁用 token：

- `WorkflowActionButton`: 原生 Button 属性（仅不提供 size），保留 asChild/ref 与所有原 variant，默认 outline；流程主操作显式 primary，次操作 outline，危险操作 destructive；`loading` 禁止重复点击并声明 aria-busy，asChild 链接也阻止导航及子/父点击并使用已有 disabled token；`icon` 在 loading 时由单一 spinner 替换；显式 type、回调、disabled 和无障碍标签保留。
- `WorkflowActionBar`: div 属性与 children，`placement="inline" | "footer"`；共用右对齐、换行、间距及 footer 分隔。

共享组件、ReportFileActions 和研究侧接入由研究 worker 独占。访谈 owner 只接入其 header/step 组件，保留原业务条件及局部危险操作。两域不得分别复制操作样式；步骤导航、助手浮动按钮、卡片选中态不属于普通操作按钮，不批量替换。

## 验证

真实标准浏览器使用当前 Next 路由、登录、API 和隔离 PostgreSQL 保存状态，两域代表步骤/报告对照截图及计算样式。检查 375/768/1280 无横向溢出、主次颜色/高度/位置一致、loading/disabled 不产生操作、返回导航可用；审计或验收不能提交生成命令、启动 AgentRun 或调用模型。单元验证关键交互，独立 review 与当前 exact SHA CI 全绿后交付 main PR，不自动合并部署。
