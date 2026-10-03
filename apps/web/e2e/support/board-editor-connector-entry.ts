import { createHash, randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

type JsonCall = (method: string, path: string, data?: unknown) => Promise<unknown>;

export async function verifyEditorConnectorEntry(page: Page, boardId: string, call: JsonCall, capture: () => Promise<void>) {
  const state = async () => {
    const head = await call("GET", `/v1/whiteboards/${boardId}/head`);
    const exported = await call("POST", `/whiteboards/${boardId}/imports/standard-export`, { requestId: randomUUID() }) as { downloadPath: string; sha256: string };
    const payload = await call("GET", exported.downloadPath) as { contentBase64: string };
    const bytes = Buffer.from(payload.contentBase64, "base64");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(exported.sha256);
    const objects = (JSON.parse(bytes.toString("utf8")) as { objects: unknown }).objects;
    expect(Array.isArray(objects)).toBe(true);
    return { head, objects };
  };
  const before = await state();
  await expect(page.getByTestId("board-add-frame")).toHaveCount(0); // testid-gate: absent Frame creation remains outside the approved core-tool scope
  const button = page.getByTestId("board-add-connector");
  await expect(button).toBeVisible(); await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("board-connector-picker")).toBeVisible();
  await expect(page.getByTestId("board-connector-straight")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("board-connector-curve").click();
  await expect(page.getByTestId("board-connector-curve")).toHaveAttribute("aria-pressed", "true");
  await capture();
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("board-connector-picker")).toHaveCount(0);
  await page.getByTestId("board-tool-select").click();
  await expect(page.getByTestId("board-tool-select")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("board-add-frame")).toHaveCount(0); // testid-gate: absent Frame creation remains hidden after returning to Select
  expect(await state()).toEqual(before);
}
