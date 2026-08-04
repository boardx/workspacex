/**
 * #406 / #458 —— 已签组织能力目录的前端薄封装。
 *
 * #406 时这里刻意只读，注释写着「不暴露 mutate」。#458 把 Agent 目录的
 * 新增 / 更新 / 停用接上，于是写路径在这里出现——**只出现在这里**。
 *
 * ## 这个文件不做判断
 *
 * 没有「是不是管理员」的分支，也没有把 403 翻译成「按钮置灰」的逻辑。
 * 权限是服务端的裁决（`application/identity/mutate-capability.ts`），
 * 这一层只负责把契约里的形状原样送过去、把失败原样带回来。
 * 在客户端复述一份权限规则，等于给同一条规则留了第二份会漂移的副本。
 *
 * ## 形状全部来自 `@repo/contracts`
 *
 * 三个 payload 的 zod schema 就是服务端按 `op` 二次解析时用的那三个
 * （契约 `CapabilityAddPayload` / `UpdatePayload` / `DisablePayload`）。
 * 这里用 `z.infer` 取类型而不是手写 interface——手写的那一刻就多了一份副本。
 */
import { identity } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type CapabilityKind = z.infer<typeof identity.CapabilityKind>;
export type CapabilityListing = z.infer<typeof identity.CapabilityListing>;
export type VisibilityScope = z.infer<typeof identity.VisibilityScope>;
export type DisableMode = NonNullable<
  z.infer<typeof identity.operations.mutateCapability.in>["disableMode"]
>;

export type CapabilityAddPayload = z.infer<typeof identity.CapabilityAddPayload>;
export type CapabilityUpdatePayload = z.infer<typeof identity.CapabilityUpdatePayload>;
export type MutateCapabilityResult = z.infer<typeof identity.operations.mutateCapability.out>;

export async function listCapabilities(
  orgId: string,
  kind: CapabilityKind,
): Promise<CapabilityListing[]> {
  return apiRequest<CapabilityListing[]>(identity.operations.listCapabilities.path, {
    method: "GET",
    query: { orgId, kind },
  });
}

/**
 * 三个 op 共用的一次 POST。
 *
 * ⚠ 刻意**不**在这里兜住失败：`ApiError` 直接抛给调用方。
 * 吞掉 403 再返回 `null` 会让「被拒绝」和「什么都没发生」在类型上无法区分，
 * 而界面正是要把这两者显示成不同的东西。
 */
async function mutate(body: z.infer<typeof identity.operations.mutateCapability.in>) {
  return apiRequest<MutateCapabilityResult>(identity.operations.mutateCapability.path, {
    method: "POST",
    body,
  });
}

export async function addCapability(
  orgId: string,
  kind: CapabilityKind,
  payload: CapabilityAddPayload,
): Promise<MutateCapabilityResult> {
  return mutate({ orgId, kind, op: "add", payload });
}

export async function updateCapability(
  orgId: string,
  kind: CapabilityKind,
  payload: CapabilityUpdatePayload,
): Promise<MutateCapabilityResult> {
  return mutate({ orgId, kind, op: "update", payload });
}

/**
 * D-U5：`disableMode` 在契约里是可选的，服务端缺省 `interrupt`。
 * 这里做成**必填参数**——「安全默认」由服务端保证，但界面必须逼调用方
 * 明确说出选了哪一种，否则确认弹窗上那句「N 个进行中的调用会被中断」
 * 就成了一句谁也没选过的话。
 */
export async function disableCapability(
  orgId: string,
  kind: CapabilityKind,
  id: string,
  disableMode: DisableMode,
): Promise<MutateCapabilityResult> {
  return mutate({ orgId, kind, op: "disable", payload: { id }, disableMode });
}
