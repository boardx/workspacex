import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LiveTranscript } from "@/components/rec/live-transcript";
import { QuoteAnnotate } from "@/components/rec/quote-annotate";

const route = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(route.query),
}));

describe("project transcription review navigation", () => {
  it.each(["interview", "workshop", "thread"] as const)("keeps %s context when opening speaker review", (carrier) => {
    route.query = `mode=project&screen=live&carrier=${carrier}&as=facilitator&org=org-example&projectId=project-example&session=session-example`;
    render(<LiveTranscript state="default" carrier={carrier} view="facilitator" />);
    const links = screen.getAllByRole("link", { name: "去校对 →" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const target = new URL(link.getAttribute("href")!, "http://localhost/rec");
      expect(target.pathname).toBe("/rec");
      expect(target.searchParams.get("screen")).toBe("assign");
      for (const key of ["mode", "carrier", "as", "org", "projectId", "session"]) {
        expect(target.searchParams.get(key)).toBe(new URLSearchParams(route.query).get(key));
      }
    }
  });

  it("keeps project context from quote annotation too", () => {
    route.query = "mode=project&screen=annotate&carrier=workshop&as=groupLead&projectId=project-example";
    render(<QuoteAnnotate state="default" view="groupLead" />);
    const links = screen.getAllByRole("link", { name: "去校对 →" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const target = new URL(link.getAttribute("href")!, "http://localhost/rec");
      expect(target.searchParams.get("screen")).toBe("assign");
      expect(target.searchParams.get("mode")).toBe("project");
      expect(target.searchParams.get("carrier")).toBe("workshop");
      expect(target.searchParams.get("as")).toBe("groupLead");
      expect(target.searchParams.get("projectId")).toBe("project-example");
    }
  });
});
