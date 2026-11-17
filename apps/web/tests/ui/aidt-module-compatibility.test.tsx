import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { TaskWorkbenchEmptyState, TASK_WORKBENCH_TEMPLATES } from "@/components/chat/chat-task-workbench-empty-state";
import { ProjectCard } from "@/components/home/home-work-cards";
import { ProjectBreadcrumb } from "@/components/project/project-breadcrumb";
import { projectWorkspaceHref } from "@/lib/project-aidt";
import type { HomeProject } from "@/components/home/use-home-work";

const route = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(route.search) }));
afterEach(() => { vi.unstubAllEnvs(); route.search = ""; });

it.each([undefined, "false", "true"])("keeps ordinary Chat's real templates and context when AIDT=%s", (flag) => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", flag);
  const choose = vi.fn();
  render(<I18nProvider initialLocale="zh-CN"><TaskWorkbenchEmptyState onUseTemplate={choose} materialsCount={3} skillsCount={2} briefing={<aside>尚未发送的个人工作背景</aside>} /></I18nProvider>);
  for (const template of TASK_WORKBENCH_TEMPLATES) expect(screen.getByTestId(template.id)).toBeVisible();
  expect(screen.getByTestId("chat-task-workbench-context-chip-materials")).toHaveTextContent("材料 3");
  expect(screen.getByTestId("chat-task-workbench-context-chip-materials")).toHaveAttribute("data-source", "live");
  expect(screen.getByTestId("chat-task-workbench-context-chip-skills")).toHaveTextContent("技能 2");
  expect(screen.getByTestId("chat-task-workbench-context-chip-project")).toHaveTextContent("个人对话");
  expect(screen.getByText("尚未发送的个人工作背景")).toBeVisible();
  expect(screen.queryByText(/工作坊主题|本组自己决定|学生先提供/)).toBeNull();
  expect(choose).not.toHaveBeenCalled();
  const first = TASK_WORKBENCH_TEMPLATES[0]!;
  fireEvent.click(screen.getByTestId(first.id));
  expect(choose).toHaveBeenCalledTimes(1);
  expect(choose).toHaveBeenCalledWith(first.goal);
});

it.each([undefined, "true"])("keeps ordinary general/workshop cards and URLs when AIDT=%s", (flag) => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", flag);
  const projects: HomeProject[] = [
    { id: "general/ordinary", name: "现有通用项目", kind: "general", tags: ["研究"], collaborators: null },
    { id: "workshop/ordinary", name: "现有工作坊", kind: "workshop", tags: ["workspacex:aidt"], collaborators: null },
  ];
  render(<I18nProvider initialLocale="zh-CN"><>{projects.map((project) => <ProjectCard key={project.id} project={project} />)}</></I18nProvider>);
  for (const project of projects) {
    const expected = `/projects/${encodeURIComponent(project.id)}`;
    expect(projectWorkspaceHref(project)).toBe(expected);
    expect(screen.getByTestId(`home-recent-project-${project.id}`)).toHaveAttribute("href", expected);
    expect(screen.getByText(project.name)).toBeVisible();
  }
});

it("keeps an AIDT-tagged project's ordinary entry and card when the module is disabled", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "false");
  const project: HomeProject = { id: "research/group", name: "已存在的研究小组", kind: "general", tags: ["workspacex:aidt"], collaborators: null };
  render(<I18nProvider initialLocale="zh-CN"><ProjectCard project={project} /></I18nProvider>);
  expect(screen.getByTestId(`home-recent-project-${project.id}`)).toHaveAttribute("href", "/projects/research%2Fgroup");
  expect(screen.getByText(project.name)).toBeVisible();
  expect(screen.queryByText("AIDT", { exact: true })).toBeNull();
});

it.each([undefined, "true"])("does not reinterpret a normal Studio step query as an AIDT return when AIDT=%s", (flag) => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", flag);
  route.search = "step=2&thread=existing-thread";
  render(<I18nProvider initialLocale="zh-CN"><ProjectBreadcrumb projectId="ordinary/project" sub="transcript" /></I18nProvider>);
  expect(screen.getByTestId("project-breadcrumb-back")).toHaveAttribute("href", "/projects/ordinary%2Fproject?tab=research&sub=transcript");
});

it("keeps a stale AIDT return query in the ordinary project when the module is disabled", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "false");
  route.search = "aidtStep=2&aidtThread=teaching-thread";
  render(<I18nProvider initialLocale="zh-CN"><ProjectBreadcrumb projectId="ordinary/project" sub="design" /></I18nProvider>);
  expect(screen.getByTestId("project-breadcrumb-back")).toHaveAttribute("href", "/projects/ordinary%2Fproject?tab=research&sub=design");
});

it("preserves non-AIDT navigation and role visibility across the opt-in", async () => {
  const navigation = async (flag: string) => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", flag);
    vi.resetModules();
    const { navSegmentsForViewer } = await import("@/lib/navigation");
    return navSegmentsForViewer({ orgName: "existing-org", orgRole: "member", platformOperator: false });
  };
  const disabled = await navigation("false"), enabled = await navigation("true");
  const entries = (segments: typeof disabled) => segments.flatMap((segment) => segment.items).map(({ key, label, href, children, ucRefs }) => ({ key, label, href, children, ucRefs }));
  expect(entries(disabled).some((entry) => entry.key === "aidt")).toBe(false);
  expect(entries(enabled).filter((entry) => entry.key === "aidt")).toEqual([expect.objectContaining({ href: "/aidt" })]);
  expect(entries(enabled).filter((entry) => entry.key !== "aidt")).toEqual(entries(disabled));
  expect(entries(disabled).some((entry) => entry.key === "chat")).toBe(true);
  expect(entries(disabled).some((entry) => entry.key === "projects")).toBe(true);
  expect(entries(disabled).some((entry) => entry.key === "admin" || entry.key === "platform-admin")).toBe(false);
});
