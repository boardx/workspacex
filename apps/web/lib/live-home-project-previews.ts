/**
 * 首页「项目卡协作者」的数据（`GET /home/project-previews`，契约 `project.getHomeProjectPreviews`）。
 * 服务端只返回调用者有项目角色的项目，所以响应里出现某项目 ⟺ 我是它的成员——首页据此决定
 * 显示协作者、以及用哪个项目当「今日任务」的锚点，不再逐个项目探测成员接口（会撞必然的 403）。
 */
import { project } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type HomeProjectPreviews = z.infer<typeof project.operations.getHomeProjectPreviews.out>;

export async function getHomeProjectPreviews(): Promise<HomeProjectPreviews> {
  const op = project.operations.getHomeProjectPreviews;
  return op.out.parse(await apiRequest<unknown>(op.path, { method: op.method }));
}
