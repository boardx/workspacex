import { randomUUID } from "node:crypto";
import type { ArtifactClock } from "../../application/artifacts-steering/ports";

/** 生产用 `ArtifactClock`：真实时间 + 前缀 UUID（同 `artifact` 束 `UuidIdFactory` 的理由：
 *  一个裸 UUID 出现在日志/存储 key 里时看不出它是什么，误传时也不会报错，只会静默查不到）。 */
export class SystemArtifactClock implements ArtifactClock {
  now(): string {
    return new Date().toISOString();
  }

  newArtifactId(): string {
    return `artifact-${randomUUID()}`;
  }
}
