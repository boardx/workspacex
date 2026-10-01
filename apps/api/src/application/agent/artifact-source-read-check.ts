/**
 * AG07 / D002 决策 6 —— `SourceReadPermissionCheck` 的生产实现：交接包里的证据引用是产物版本 ID，
 * 以**给定用户**（发起人）身份逐条走文件预览的同一道读门（`previewArtifactVersion`：
 * `wsx_visible_artifacts()` 行门 + `authorize()`），不另写第二套可见性规则。
 *
 * 任何一条读不到（不存在 / 无权 / 依赖失败）都进 `denied`，不区分原因（N-25：不做存在性探针）。
 */
import type { OrgId } from "../../domain/org-id";
import { previewArtifactVersion, type DeliveryDeps } from "../files/deliver-artifact";
import type { SourceReadPermissionCheck } from "./agent-handoff";

export class ArtifactSourceReadPermissionCheck implements SourceReadPermissionCheck {
  constructor(private readonly deps: DeliveryDeps) {}

  async check(input: { readonly orgId: OrgId; readonly userId: string; readonly sourceRefs: readonly string[] }) {
    const readable: { ref: string; mime: string }[] = [];
    const denied: string[] = [];
    for (const ref of new Set(input.sourceRefs)) {
      try {
        const preview = await previewArtifactVersion(this.deps, { orgId: input.orgId, userId: input.userId, versionId: ref });
        readable.push({ ref, mime: preview.meta.mime });
      } catch {
        denied.push(ref);
      }
    }
    return { readable, denied };
  }
}
