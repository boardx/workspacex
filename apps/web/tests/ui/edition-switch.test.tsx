/**
 * 2026-09-22 —— 「切到在线正式系统」的三条反证：
 *   ① 四条代价逐字来自契约（尤其「数据不会跟着走」——省掉它用户会以为切过去就能看到自己的东西）；
 *   ② 配了地址 ⇒ 一条真链接，且是新窗口（Electron 外壳据此交给系统浏览器）；
 *   ③ 没配地址 ⇒ 不画按钮，如实说状况（本仓不许出现点了没反应的控件）。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { CLOUD_SWITCH_NOTES, capabilitiesMissingIn, parseCloudUrl } from "@repo/contracts/deployment";
import { EditionProvider } from "@/lib/edition";
import { EditionSwitch } from "@/components/shell/edition-switch";

function open(cloudUrl: string | null): void {
  render(
    <EditionProvider edition="local" cloudUrl={cloudUrl}>
      <EditionSwitch />
    </EditionProvider>,
  );
  fireEvent.click(screen.getByTestId("edition-switch-open"));
}

it("states every cost the contract declares before letting anyone leave", () => {
  open("https://app.example.com/");
  const notes = screen.getByTestId("edition-switch-notes");
  expect(notes.children.length).toBe(CLOUD_SWITCH_NOTES.length);
  for (const note of CLOUD_SWITCH_NOTES) {
    expect(within(notes).getByTestId(`edition-switch-note-${note.id}`).textContent).toBe(note.statement);
  }
  // 这一条不可省
  expect(notes.textContent).toContain("不会跟着走");
});

it("lists the capabilities the online system adds, from the contract's matrix", () => {
  open("https://app.example.com/");
  const gains = screen.getByTestId("edition-switch-gains");
  expect(gains.children.length).toBe(capabilitiesMissingIn("local").length);
});

it("opens the configured address in a new window, never in the local shell", () => {
  const url = "https://app.example.com/";
  open(url);
  const link = screen.getByTestId("edition-switch-confirm").querySelector("a") ?? screen.getByTestId("edition-switch-confirm");
  expect(link.getAttribute("href")).toBe(parseCloudUrl(url));
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(screen.queryByTestId("edition-switch-unconfigured")).toBeNull();
});

it("says so honestly when this build has no online address, instead of a dead button", () => {
  open(null);
  expect(screen.queryByTestId("edition-switch-confirm")).toBeNull();
  const said = screen.getByTestId("edition-switch-unconfigured").textContent ?? "";
  expect(said).toContain("还没配");
  // 还留一条**真的可行**的路，不是只说「不行」，也不是指一条还没实现的通道
  // （R6：这里原本写的是「导出到正式组织」，而那一屏是演示态）
  expect(said).toContain("下载");
  expect(said).toContain("上传");
  expect(said).not.toContain("联系管理员");
});

it("refuses an unsafe or malformed address at the contract level", () => {
  for (const raw of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "https://u:p@h/", "not a url", ""]) {
    expect(parseCloudUrl(raw)).toBeNull();
  }
  expect(parseCloudUrl(" https://app.example.com ")).toBe("https://app.example.com/");
});
