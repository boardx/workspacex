import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CapabilityGovernancePreview } from "@/components/ai-capability-studio/governance-preview";

const CANARY = "demo-only-secret-canary-8f94";

/** Password properties may hold pending write input. No other DOM sink may echo it. */
function assertNoEcho() {
  expect(document.body.textContent).not.toContain(CANARY);
  for (const element of document.body.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      if (element instanceof HTMLInputElement && element.type === "password" && attribute.name === "value") continue;
      expect(attribute.value, `${element.tagName}.${attribute.name}`).not.toContain(CANARY);
    }
    if (element instanceof HTMLInputElement && element.type !== "password") expect(element.value).not.toContain(CANARY);
    if (element instanceof HTMLTextAreaElement) expect(element.value).not.toContain(CANARY);
  }
  expect(window.location.href).not.toContain(CANARY);
}

function observeExternalSinks() {
  const storage = vi.spyOn(Storage.prototype, "setItem");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const logs = ["log", "info", "warn", "error", "debug"].map(method =>
    vi.spyOn(console, method as "log").mockImplementation(() => undefined));
  return () => {
    expect(storage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    for (const log of logs) expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("governance preview write-only secret boundary", () => {
  it.each(["save", "invalid", "conflict", "close"])("model clears input after %s without echo, Web Storage, fetch or log leakage", action => {
    const assertNoExternalWrite = observeExternalSinks();
    const view = render(<CapabilityGovernancePreview />);
    fireEvent.click(screen.getByTestId("model-configure"));
    const input = screen.getByTestId("model-credential");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: CANARY } });
    expect(input).toHaveValue(CANARY);
    assertNoEcho();
    if (action === "invalid") fireEvent.change(screen.getByTestId("model-provider"), { target: { value: "INVALID PROVIDER" } });
    fireEvent.click(screen.getByTestId(action === "conflict" ? "model-simulate-conflict" : action === "close" ? "model-config-close" : "model-config-save"));
    if (!screen.queryByTestId("model-credential")) fireEvent.click(screen.getByTestId("model-configure"));
    expect(screen.getByTestId("model-credential")).toHaveValue("");
    assertNoEcho();
    view.unmount();
    render(<CapabilityGovernancePreview />);
    fireEvent.click(screen.getByTestId("model-configure"));
    expect(screen.getByTestId("model-credential")).toHaveValue("");
    assertNoExternalWrite();
  });

  it.each(["success", "failure", "invalid", "switch"])("MCP clears input after %s without echo, Web Storage, fetch or log leakage", action => {
    const assertNoExternalWrite = observeExternalSinks();
    const view = render(<CapabilityGovernancePreview />);
    fireEvent.click(screen.getByRole("radio", { name: "替换凭据（演示）" }));
    const input = screen.getByTestId("mcp-credential");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: CANARY } });
    expect(input).toHaveValue(CANARY);
    assertNoEcho();
    if (action === "invalid") fireEvent.change(screen.getByTestId("mcp-endpoint"), { target: { value: "" } });
    if (action === "switch") {
      fireEvent.click(screen.getByRole("radio", { name: "保留并使用现有凭据" }));
      fireEvent.click(screen.getByRole("radio", { name: "替换凭据（演示）" }));
    } else fireEvent.click(screen.getByTestId(action === "failure" ? "mcp-connect-failure" : "mcp-connect-success"));
    expect(screen.getByTestId("mcp-credential")).toHaveValue("");
    assertNoEcho();
    view.unmount();
    render(<CapabilityGovernancePreview />);
    fireEvent.click(screen.getByRole("radio", { name: "替换凭据（演示）" }));
    expect(screen.getByTestId("mcp-credential")).toHaveValue("");
    assertNoExternalWrite();
  });

  it("counterexample: visible text, accessible attributes and plain inputs are detected", () => {
    for (const html of [`<p>${CANARY}</p>`, `<button aria-label="${CANARY}"></button>`, `<input value="${CANARY}">`]) {
      const sink = document.createElement("div");
      sink.innerHTML = html;
      document.body.append(sink);
      expect(assertNoEcho).toThrow();
      sink.remove();
    }
  });
});
