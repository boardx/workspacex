import * as React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { EditionProvider } from "@/lib/edition";
import { CapabilityEditionNote } from "@/components/chat/capability-edition-note";
import { capabilitiesMissingIn } from "@repo/contracts/deployment";
function LocaleControl() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
afterEach(cleanup);
it("keeps the local gated footer expanded and the same contract capability identities across locale", () => {
  render(<I18nProvider initialLocale="en"><LocaleControl /><EditionProvider edition="local" cloudUrl={null}><CapabilityEditionNote compact /></EditionProvider></I18nProvider>);
  const note = screen.getByTestId("capability-edition-note");
  const absent = capabilitiesMissingIn("local").filter(row => row.local === "absent");
  const summary = within(note).getByText(`Unavailable on this computer (${absent.length} capabilities)`);
  fireEvent.click(summary); expect(note).toHaveAttribute("open");
  const image = screen.getByTestId("capability-edition-absent-image-generation");
  expect(image.textContent).toContain("Image generation — Not supported in the local edition");
  expect(screen.queryByTestId("capability-edition-absent-audit-provenance")).toBeNull();
  expect(within(note).getAllByRole("listitem")).toHaveLength(absent.length);
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("capability-edition-note")).toBe(note); expect(note).toHaveAttribute("open");
  expect(screen.getByTestId("capability-edition-absent-image-generation")).toBe(image);
  expect(within(note).getAllByRole("listitem")).toHaveLength(absent.length);
});
it("uses the cloud column for the actual unavailable state rather than reusing the local list", () => {
  render(<I18nProvider initialLocale="en"><EditionProvider edition="cloud"><CapabilityEditionNote compact /></EditionProvider></I18nProvider>);
  const offline = screen.getByTestId("capability-edition-absent-offline");
  expect(offline.textContent).toContain("Offline use — Not supported in this edition");
  expect(screen.queryByTestId("capability-edition-absent-image-generation")).toBeNull();
  expect(screen.getByTestId("capability-edition-note").textContent).toContain("These capabilities are unavailable in the current edition.");
});
