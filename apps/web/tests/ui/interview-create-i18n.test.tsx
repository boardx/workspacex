import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { DigitalInterviewCreateModal } from "@/components/itv/digital-interview-create-modal";
const api = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: api.push }) }));
vi.mock("@/lib/interview-api", async original => ({ ...await original<typeof import("@/lib/interview-api")>(), createDigitalInterviewDraft: api.create }));
function Language() { const { setLocale } = useI18n(); return <><button onClick={() => setLocale("en")}>EN test</button><button onClick={() => setLocale("zh-CN")}>ZH test</button></>; }
function show() { return render(<I18nProvider initialLocale="en"><Language /><DigitalInterviewCreateModal open onOpenChange={vi.fn()} projectId="project-raw" /></I18nProvider>); }
function swap(locale: "en" | "zh-CN") { fireEvent.click(screen.getByText(locale === "en" ? "EN test" : "ZH test")); }
beforeEach(() => vi.clearAllMocks());
it("keeps the exact pending create request and edited name/tag across locale changes", async () => {
 let finish!: (value: { interviewId: string }) => void;
 api.create.mockImplementation(() => new Promise(resolve => { finish = resolve; })); show();
 expect(screen.getByRole("heading", { name: "New interview" })).toBeVisible();
 fireEvent.change(screen.getByRole("textbox", { name: "Interview name" }), { target: { value: "用户原名 {count}" } });
 fireEvent.change(screen.getByTestId("itv-create-tag-input"), { target: { value: "未提交原标签" } });
 fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
 await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1)); const payload = api.create.mock.calls[0]![0];
 expect(payload).toMatchObject({ name: "用户原名 {count}", tags: ["未提交原标签"], scope: { kind: "project", projectId: "project-raw" } });
 swap("zh-CN"); swap("en"); expect(api.create.mock.calls[0]![0]).toBe(payload); expect(api.create).toHaveBeenCalledTimes(1);
 expect(screen.getByRole("textbox", { name: "Interview name" })).toHaveValue("用户原名 {count}");
 await act(async () => finish({ interviewId: "created-raw" })); expect(api.push).toHaveBeenCalledWith("/itv/created-raw/intake?projectId=project-raw");
});
it("localizes the new editable default only at creation and preserves it after language changes", () => {
 show(); const input=screen.getByRole("textbox", { name: "Interview name" }); expect(input).toHaveValue("Untitled interview");
 fireEvent.change(input,{target:{value:"已改名"}}); swap("zh-CN"); swap("en"); expect(input).toHaveValue("已改名"); expect(api.create).not.toHaveBeenCalled();
});
it("retranslates the failed create notice and retains input for an explicit retry", async () => {
 api.create.mockRejectedValueOnce(Error("private provider detail")); show();
 fireEvent.change(screen.getByRole("textbox", { name: "Interview name" }),{target:{value:"保留原稿"}});
 fireEvent.click(screen.getByRole("button",{name:"Start interview"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("Your input is preserved"); swap("zh-CN"); expect(screen.getByRole("alert")).toHaveTextContent("当前输入已保留"); swap("en");
 expect(screen.getByRole("alert")).toHaveTextContent("Your input is preserved"); expect(api.create).toHaveBeenCalledTimes(1); expect(screen.getByRole("textbox", { name: "Interview name" })).toHaveValue("保留原稿");
});
it("prepares and selects the localized default before opening after a closed-dialog locale change", async () => {
 function Closed(){const [open,setOpen]=React.useState(false);return <><button onClick={()=>setOpen(true)}>Open test</button><DigitalInterviewCreateModal open={open} onOpenChange={setOpen}/></>;}
 render(<I18nProvider initialLocale="en"><Language/><Closed/></I18nProvider>);swap("zh-CN");fireEvent.click(screen.getByText("Open test"));
 const input=screen.getByRole("textbox",{name:"访谈名称"}) as HTMLInputElement;expect(input).toHaveValue("未命名访谈");
 await waitFor(()=>{expect(input.selectionStart).toBe(0);expect(input.selectionEnd).toBe(input.value.length);});
});
