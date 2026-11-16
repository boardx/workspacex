# A5 — 已关联原型真实版本引用

本交付是独立组件、读取适配器和测试。父级负责将组件接入第5/6步，以及把引用持久化到现有 stage fields。这里未改动 `project-aidt.tsx`、stage-output 或 verification-loop；未更改任何设计签核状态、服务契约、权限或共享 Backlog，也未部署、合并或外发 GitHub。

## 接入

```tsx
import { AidtPrototypeVersionPicker } from "@/features/aidt/components/aidt-prototype-version-picker";
import { aidtPrototypeVersionLabel, type AidtPrototypeVersionReference } from "@/features/aidt/lib/aidt-prototype-versions";

<AidtPrototypeVersionPicker
  projectId={projectId}
  value={reference}
  readOnly={!canWrite}
  onChange={(reference) => {
    // 仅更新当前步骤的真实引用字段；保存仍使用已有 stage 保存动作。
    // 不覆盖学生原有 fields.version，不在此回调中修改 S6 questionSnapshot。
    updateCurrentStepReference(reference);
  }}
/>
```

回调返回 `AidtPrototypeVersionReference | null`：

```ts
{
  designId: string;
  versionId: string;
  designName: string;
  seq: number;
  summary: string;
  createdAt: string;
  source: "model" | "user" | "restore";
  frameCount: number;
  generatedFrameCount: number;
}
```

`null` 只代表移除本步引用，不会删除、恢复或解除原生 Design 资源。`aidtPrototypeVersionLabel(reference)` 返回人可读的设计名称 / vN / 摘要，IDs 需单独保留。frame counts 是快照结构事实，可能部分页面未生成；不代表质量、交互可用、真人测试、研究证据或 Agent 真模型验收。引用摘要是原生版本元数据，不是研究材料。

组件通过现有 SessionProvider 捕获 org/user/token，以 project/org/user/token/readOnly 的组合 key 隔离整个异步生命周期。身份切换、切项目、权限降级、模块禁用、收起组件会取消旧消费者；同一学生 token 刷新也重新加载。组件不自行持久化，也不创建问题快照。

## 真实读取与权限边界

1. 复用 `project.operations.listProjectResources` 的当前项目成员读取接口。
2. 与 `designWorkbench.operations.listMyProjects` 的当前 owner 列表求交；同时核对资源 `ownerUserId` 和设计 `ownerId`。其他人拥有的已关联设计不提供选择，不扩张权限。
3. 点选设计后重新核对关联与 owner，再从原生 `listPrototypeVersions` 读取实际历史行。
4. 点选版本时再次核对关联与 owner，并从原生 `getPrototypeVersion` 读取实际快照，核对返回 version ID 与请求一致、页数对应且至少一页真实存在。拒绝全 null / 空快照，部分生成保留明确的 X/Y 页数。

现有 `live-design-workbench.ts` / `live-project-resources.ts` 的这些读取函数没有显式 bearer/signal 参数。本 AIDT 独立适配器使用同一契约的 method/path/schema 和同一 `apiRequest`，捕获当前 bearer 与 AbortSignal；没有新增服务端操作，也没有依赖全局存储在异步阶段换身份。

实际归属证据：`apps/api/src/application/design-workbench/list-my-projects.ts` 的应用层按 `ownerId` 过滤；`prototype-versions.ts` 通过 `projects.getVersion(projectId, versionId)` 读取当前设计的指定版本。版本响应本身没有 designId，所以本实现依赖现有服务已绑定的双参数读取，不从摘要猜设计 ID。

版本响应已存在一个契约漂移：原生 `summaryView` 返回 `links`，而 `PrototypeVersionSummary` 没有该键。本地读取投影仅显式接受这个已存在字段，使用现有 `designPrototype.PrototypeLink` 派生数组 schema 校验，其余多余字段仍 strict 拒绝。没有使用任意 object / 全量 strip，也没有修改待签核的导航设计契约。

## 父级验收建议

- 第5步选择真实 v2，确认保存后重载仍带真实 IDs；旧学生文字引用仍保留并注明为历史说明。
- 已保存第6步 snapshot=v1 时，在第5步选择 v2，不应自动改写第6步快照。只有学生明确重新带入/确认才建立新快照。
- 第6步直接另选被测版本时显示其与原问题快照是否一致，不能静默继承成同一个版本。
- 当前项目关联他人的 Design：显示不可选数量，不授予原生编辑入口。
- 403/503/损坏响应：展示失败与重试，不能冒充没有关联或没有版本；选中复核失败应保留旧引用。
- 无历史版本、全未生成、部分生成三类分别验收；模型来源不等于质量通过。
- 真实账号权限、数据库持久化、浏览器截图、真实模型及课堂协作由集成环境补证。本交付受控响应的单元/组件测试不证明这些已通过。

## 逐轮记录

| 轮次 | 问题 | 修改 | 验证 |
|---|---|---|---|
| A5.1 | 文字引用无法定位真实版本；关联不能代替授权 | 新增当前项目关联 ∩ owner 列表读取，保留非 owner 不可选数量 | helper tests：交集、外部设计排除、显式 bearer |
| A5.2 | 列表版本不保证存在实际原型；原生 links 漂移 | 点击时复核真实快照；验证 known links，拒绝异常字段、重复 ID/seq、空快照 | helper tests：实际 ID、部分生成、全 null、损坏树 |
| A5.3 | 旧身份响应或只读降级可能改错引用 | keyed 消费者 + AbortController；只读禁止读取/更改；收起取消选中请求 | UI tests：project/org/user/token/readOnly 变更、旧请求和收起重开 |
| A5.4 | 服务失败易被当作空态；旧快照可能被覆盖 | 分离加载/空/失败，显式 retry；回调无 draft/snapshot 写入能力；历史值保留说明 | UI tests：失败/空态、重试、旧值保留；父级快照集成仍需验收 |
| A5.5 | 独立审阅发现：已有 A → 延迟核对 B → 移除 → B 回包，会覆盖学生的移除决定 | 移除时同步 abort 并清除 pending/error；完成回调也核对当前 controller；取消逻辑与收起/刷新复用 | `removal-race-red.log` 先复现 1 failed；`removal-race-green.log` 修复后 20/20 passed，含移除后重选可用 |

首次定向测试的一个成功场景夹具错误地把 text node 内容放在非契约属性中，strict 解析如期拒绝。夹具已按原生 schema 改为 `props.content`，没有放宽树校验。
