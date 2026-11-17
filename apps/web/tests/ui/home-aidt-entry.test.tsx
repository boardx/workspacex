import * as React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectCard } from "@/components/home/home-work-cards";
import { projectWorkspaceHref, AIDT_PROJECT_TAG } from "@/lib/project-aidt";
afterEach(() => vi.unstubAllEnvs());
it("Home's actual project card returns an AIDT learning space to its separate native entry", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true");
  render(<ProjectCard project={{ id: "group/one", name: "我们的研究", kind: "general", tags: [AIDT_PROJECT_TAG], collaborators: null }} />);
  expect(screen.getByRole("link")).toHaveAttribute("href", "/aidt/group%2Fone");
  expect(screen.getByRole("link")).toHaveTextContent("AIDT");
});
it("ordinary and workshop projects keep their native workbench paths", () => {
  expect(projectWorkspaceHref({ id: "p/1", kind: "general", tags: [] })).toBe("/projects/p%2F1");
  expect(projectWorkspaceHref({ id: "w/1", kind: "workshop", tags: [AIDT_PROJECT_TAG] })).toBe("/projects/w%2F1");
});
