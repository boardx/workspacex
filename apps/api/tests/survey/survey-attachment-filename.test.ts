import { PassThrough } from "node:stream";
import type { Request, Response } from "express";
import multer, { memoryStorage } from "multer";
import { expect, it, vi } from "vitest";
import { SurveyAttachmentController } from "../../src/interface/controllers/survey-attachment.controller";
import type { SurveyAttachmentService } from "../../src/application/survey/survey-attachment-service";

/** Actual multipart parser used by FileInterceptor; no database, socket or server. */
async function parseBrowserFile(name: string, bytes: Buffer): Promise<Express.Multer.File> {
  const boundary = "survey-browser-filename-boundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n`, "utf8"),
    bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const stream = new PassThrough();
  const request = Object.assign(stream, { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(body.length) } }) as unknown as Request;
  const parsed = new Promise<void>((resolve, reject) => multer({ storage: memoryStorage() }).single("file")(request, {} as Response, error => error ? reject(error) : resolve()));
  stream.end(body);
  await parsed;
  expect(request.file).toBeTruthy();
  return request.file!;
}

it.each(["原附件 {name}.txt", "raw-attachment.txt"])("preserves browser multipart filename and bytes at the actual survey controller: %s", async name => {
  const bytes = Buffer.from("原附件字节 {count}\nRaw file bytes stay unchanged.\n", "utf8");
  const file = await parseBrowserFile(name, bytes);
  const upload = vi.fn(async (_token: string, _session: string, _question: string, input: { name: string; mime: string; bytes: Uint8Array }) => ({ attachmentId: "fixture-attachment", name: input.name }));
  const controller = new SurveyAttachmentController({ upload } as unknown as SurveyAttachmentService);
  const result = await controller.upload("fixture-publication", "fixture-session", "fixture-question", file);
  expect(upload).toHaveBeenCalledOnce();
  expect(upload.mock.calls[0]!.slice(0, 3)).toEqual(["fixture-publication", "fixture-session", "fixture-question"]);
  expect(upload.mock.calls[0]![3]).toEqual({ name, mime: "text/plain", bytes });
  expect(result).toEqual({ attachmentId: "fixture-attachment", name });
});
