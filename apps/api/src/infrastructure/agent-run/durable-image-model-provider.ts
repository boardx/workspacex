import { createHash, randomUUID } from "node:crypto";
import { Transformer } from "@napi-rs/image";
import { imageSize } from "image-size";
import { IMAGE_GENERATE_LIMITS } from "@repo/contracts/standard-image-tools";
import { ModelCallError, type ModelCallInput, type ModelCallCompletion, type ModelCallPort } from "../../application/agent-run/ports";
import type { ObjectStore } from "../../application/artifact/ports";
import type { GeneratedImageDownloader } from "../../application/agent-run/standard-image-tools";
import { assertCurrentRunLease } from "../../application/agent-run/run-lease";
import { sniffKind } from "../../domain/files/mime-sniff";
import type { OrgId } from "../../domain/org-id";
import type { BailianImageProvider } from "./bailian-image-provider";

/** The image Agent uses the same guarded download and message-attachment storage as tools. */
export class DurableImageModelProvider implements ModelCallPort {
  constructor(
    private readonly provider: Pick<BailianImageProvider, "generateImage" | "supportsRequestAccounting">,
    private readonly objects: ObjectStore,
    private readonly downloader: GeneratedImageDownloader,
  ) {}
  supportsRequestAccounting(): boolean { return this.provider.supportsRequestAccounting(); }

  async complete(input: ModelCallInput): Promise<ModelCallCompletion> {
    if (input.modelProvider !== "bailian-image" || !input.orgId || !input.runId || !input.executionAttemptId || !input.executionLeaseEpoch) {
      throw new ModelCallError("MODEL_CALL_FAILED", "IMAGE_ACCOUNTING_CONTEXT_REQUIRED");
    }
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(IMAGE_GENERATE_LIMITS.deadlineMs)]) : AbortSignal.timeout(IMAGE_GENERATE_LIMITS.deadlineMs);
    signal.throwIfAborted();
    await assertCurrentRunLease();
    // Preserve admission/usage errors; never retry a paid generation on archive failure.
    const generated = await this.provider.generateImage(input.user, signal, {
      orgId: input.orgId as OrgId, parentRunId: input.runId,
      attemptId: input.executionAttemptId, leaseEpoch: input.executionLeaseEpoch,
    });
    try {
      const delivered = generated.delivery === "url" ? await this.downloader.download(generated.url, signal) : { bytes: generated.bytes };
      const bytes = Buffer.from(delivered.bytes);
      if (!bytes.length || bytes.length > IMAGE_GENERATE_LIMITS.maxBytes) throw new Error();
      const kind = sniffKind(bytes);
      if (kind !== "png" && kind !== "jpeg") throw new Error();
      const size = imageSize(bytes);
      if (!size.width || !size.height || size.width > 2048 || size.height > 2048) throw new Error();
      if (new Transformer(bytes).rawPixelsSync().length < size.width * size.height) throw new Error();
      const mime = kind === "png" ? "image/png" : "image/jpeg";
      const name = `generated-image.${kind === "png" ? "png" : "jpg"}`;
      const scope = createHash("sha256").update(JSON.stringify([input.orgId, input.runId])).digest("hex");
      const objectKey = `agent-run-outputs/${scope}/${randomUUID()}/${name}`;
      signal.throwIfAborted(); await assertCurrentRunLease();
      await this.objects.putOnce(objectKey, bytes, mime);
      const head = await this.objects.head(objectKey);
      const restored = await this.objects.get(objectKey);
      if (!head || head.sizeBytes !== bytes.length || head.mime !== mime || !restored || !Buffer.from(restored).equals(bytes)) throw new Error();
      signal.throwIfAborted(); await assertCurrentRunLease();
      return { text: "图片已生成，请查看本条消息的图片附件。", files: [{ name, mime, sizeBytes: bytes.length, objectKey }] };
    } catch {
      throw new ModelCallError("MODEL_CALL_FAILED", "generated_image_unavailable");
    }
  }
}
