结论：不能给所有 `registerModel` 强加单一 `providerKey/upstreamModelId`。现有 composite 是逻辑模型池记录，其运行绑定必须按 `shape` 分支；当前仓库没有 composite executor，因此不能把组合记录伪装成一个 provider 调用。

### 当前代码事实

| 层面 | 实际行为 |
|---|---|
| 身份 | composite 对消费者仍是一个标量 `modelId`，有序成员放在 `members[]`。[composite.ts L4-L13](https://github.com/boardx/workspacex/blob/4e6fbfda294a5511d86418a7c7f5f2ef04a01f4c/apps/api/src/domain/model/composite.ts#L4-L13) |
| 可选门禁 | composite 自身必须 `已启用`，且任一成员非 `已启用` 时整个组合被移出候选集，不降级到存活成员。[selectable.ts L48-L57](https://github.com/boardx/workspacex/blob/4e6fbfda294a5511d86418a7c7f5f2ef04a01f4c/apps/api/src/domain/model/selectable.ts#L48-L57) |
| 准入门禁 | composite 自身五项必须通过，每个成员也分别五项通过。[admission.ts L180-L218](https://github.com/boardx/workspacex/blob/4e6fbfda294a5511d86418a7c7f5f2ef04a01f4c/apps/api/src/domain/model/admission.ts#L180-L218) |
| 机密门禁 | 任一成员为 `closed-api`，整个组合的有效 kind 就是 `closed-api`。[composite.ts L30-L47](https://github.com/boardx/workspacex/blob/4e6fbfda294a5511d86418a7c7f5f2ef04a01f4c/apps/api/src/domain/model/composite.ts#L30-L47) |
| 路由 | `routeModelCall` 只选出 composite 的逻辑 `modelId`，没有展开成员。[route-call.ts L119-L165](https://github.com/boardx/workspacex/blob/4e6fbfda294a5511d86418a7c7f5f2ef04a01f4c/apps/api/src/domain/model/route-call.ts#L119-L165) |
| 执行端口 | `ModelCallPort.complete` 只能接收一组 `modelProvider/modelId`。[ports.ts L835-L850](https://github.com/boardx/workspacex/blob/4e6fbfda294a5511d86418a7c7f5f2ef04a01f4c/apps/api/src/application/agent-run/ports.ts#L835-L850)；仓库内没有 composite executor。 |

### 最小兼容映射

将当前草案的单一结构改为按 `shape` 区分的联合类型，不增加模型状态：

```ts
type SingleModelRuntimeBinding = {
  shape: "single";
  capabilityModelId: string;
  configRevision: string;
  providerKey: string;
  upstreamModelId: string;
};

type CompositeMemberRuntimeBinding = {
  role: string;
  binding: ModelRuntimeBinding;
};

type CompositeModelRuntimeBinding = {
  shape: "composite";
  capabilityModelId: string;
  configRevision: string;
  members: CompositeMemberRuntimeBinding[];
};

type ModelRuntimeBinding =
  | SingleModelRuntimeBinding
  | CompositeModelRuntimeBinding;
```

精确字段规则：

| 场景 | 字段要求 |
|---|---|
| `registerModel.shape = single` | 新增并要求 `providerKey`、`upstreamModelId`；`members` 必须为空。 |
| `registerModel.shape = composite` | 不接受顶层 `providerKey/upstreamModelId`；继续使用有序 `members[{modelId,role}]`。每个成员通过其自己的配置版本解析运行绑定。 |
| `configureModel` single | patch 可包含 `providerKey/upstreamModelId`；变化后递增 `configRevision` 并触发既有重测语义。 |
| `configureModel` composite | 不允许写顶层 provider/upstream；现契约也没有修改 members 的字段，因此本 delta 不顺带增加组合编辑能力。 |
| 管理列表 | single 返回顶层 provider/upstream；composite 返回成员引用，不能显示一个虚构的“组合 provider”。 |
| 运行快照 | single 固定一个 binding；composite 固定有序成员 binding，每个成员都带自己的 `capabilityModelId/configRevision/providerKey/upstreamModelId`。 |

为了不让成员重新配置后沿用旧的“组合自身准入记录”，composite 的 `configRevision` 应定义为有效配置版本：成员顺序、role 或任一成员 `configRevision` 变化时，它都必须变化。随后：

- composite 自身准入记录绑定 composite 有效 revision；
- 成员准入记录绑定各成员 revision；
- enable/run admission 只接受这些 revision 的精确组合。

这延续现有“双重门禁”，不引入新状态或第二模型池。

### `selectedModelId` 与 `degradedTo`

当前实现里：

- `selectedModelId` 是路由选中的逻辑模型；
- `degradedTo` 在所有成功分支恒为 `null`。[route-call.ts L57-L64](https://github.com/boardx/workspacex/blob/4e6fbfda294a5511d86418a7c7f5f2ef04a01f4c/apps/api/src/domain/model/route-call.ts#L57-L64)、[L158-L187](https://github.com/boardx/workspacex/blob/4e6fbfda294a5511d86418a7c7f5f2ef04a01f4c/apps/api/src/domain/model/route-call.ts#L158-L187)
- 配额代码只产生“应该降级”的布尔判断，并没有选择目标模型。[quota-policy.ts L56-L75](https://github.com/boardx/workspacex/blob/4e6fbfda294a5511d86418a7c7f5f2ef04a01f4c/apps/api/src/domain/templates/quota-policy.ts#L56-L75)

所以今日真实行为中，实际目标只能是 `selectedModelId`。若将来 `degradedTo` 非空，按契约“已自动切换到该模型”的含义，实际执行目标必须定义为：

```ts
const actualModelId = degradedTo ?? selectedModelId;
```

最小输出 delta：

```ts
{
  selectedModelId: string;       // 路由首先选中的逻辑模型
  degradedTo: string | null;     // 非空时覆盖实际目标
  modelBinding: ModelRuntimeBinding; // 必须绑定实际目标
}
```

必须签核的不变量：

```ts
modelBinding.capabilityModelId ===
  (degradedTo ?? selectedModelId)
```

若实际目标是 composite，`modelBinding` 就是包含有序成员绑定的 composite 分支；绝不能把它压成一个 provider。若执行层尚无 composite executor，则应在 admission/runtime 处明确失败，不能拿第一个成员静默执行。

本次仅核对 PR #3239 SHA `4e6fbfda294a5511d86418a7c7f5f2ef04a01f4c` 的源码与测试，未修改文件。
