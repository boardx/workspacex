import { beforeEach, expect, it, vi } from "vitest";
import { loadAidtCourseGroups } from "@/features/aidt/lib/aidt-course-context";
const mock = vi.hoisted(() => ({ enabled: true, request: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mock.request }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mock.enabled }));
const scope = { orgId: "org", userId: "student", sessionToken: "captured-bearer" };
const group = (id = "g1", tags = ["workspacex:aidt"]) => ({ id, name: `小组${id}`, kind: "general", status: "active", readOnlyReason: null, tags });
const member = (userId = "student") => ({ userId, displayName: userId === "student" ? "学生甲" : "指导者", role: "collaborator" });
let projects: unknown[], roster: unknown;
beforeEach(() => {
  vi.resetAllMocks(); mock.enabled = true; projects = [group()]; roster = { members: [member(), member("teacher")] };
  mock.request.mockImplementation(async (path: string) => path === "/projects" ? projects : roster);
});
it("uses real roster membership, never organization management visibility or free course tags", async () => {
  projects = [group(), group("managed"), group("ordinary", []), group("tag-only", ["workspacex:aidt", "course:fake"])];
  mock.request.mockImplementation(async (path: string) => path === "/projects" ? projects : path === "/projects/g1/collaborators" ? roster : { members: [member("other")] });
  expect(await loadAidtCourseGroups(scope)).toEqual([{ project: group(), canLink: false, members: [{ userId: "student", displayName: "学生甲" }, { userId: "teacher", displayName: "指导者" }] }]);
  expect(mock.request.mock.calls.some(([path]) => path === "/home/project-previews")).toBe(false);
  expect(mock.request.mock.calls.some(([path]) => path.includes("ordinary/collaborators"))).toBe(false);
  for (const [,options] of mock.request.mock.calls) expect(options).toMatchObject({ method: "GET", sessionToken: "captured-bearer" });
  expect(mock.request).toHaveBeenCalledWith("/projects", expect.objectContaining({ query: { orgId: "org" } }));
});
it("projects server member names without inventing roles, course IDs or progress", async () => {
  const [result] = await loadAidtCourseGroups(scope);
  expect(result?.members).toEqual([{ userId: "student", displayName: "学生甲" }, { userId: "teacher", displayName: "指导者" }]);
  for (const field of ["courseId", "teacherRole", "progress", "memberRole"]) expect(result).not.toHaveProperty(field);
});
it("keeps truly empty results distinct from malformed or failed authorization reads", async () => {
  projects = []; expect(await loadAidtCourseGroups(scope)).toEqual([]);
  projects = [group()]; roster = { members: [{ userId: "student" }] }; await expect(loadAidtCourseGroups(scope)).rejects.toThrow();
  mock.request.mockRejectedValueOnce(new Error("403")); await expect(loadAidtCourseGroups(scope)).rejects.toThrow("403");
});
it("rejects duplicate groups or roster members, and excludes a managed-only group", async () => {
  projects = [group(), group()]; await expect(loadAidtCourseGroups(scope)).rejects.toThrow("AIDT_GROUP_MEMBERSHIP_INCONSISTENT");
  projects = [group()]; roster = { members: [member(), member()] }; await expect(loadAidtCourseGroups(scope)).rejects.toThrow("AIDT_GROUP_MEMBERSHIP_INCONSISTENT");
  roster = { members: [member("other")] }; expect(await loadAidtCourseGroups(scope)).toEqual([]);
});
it("includes groups beyond homepage preview caps and archived groups while bounding roster concurrency to four", async () => {
  projects = Array.from({length:9},(_,i)=>({...group(`g${i}`),status:i===8?"archived":"active",readOnlyReason:i===8?"archived":null}));
  const finish:Array<()=>void>=[];
  mock.request.mockImplementation((path:string) => path === "/projects" ? Promise.resolve(projects) : new Promise(resolve=>finish.push(()=>resolve({members:[member()]}))));
  const result = loadAidtCourseGroups(scope);
  await vi.waitFor(()=>expect(finish).toHaveLength(4)); finish.slice(0,4).forEach(done=>done());
  await vi.waitFor(()=>expect(finish).toHaveLength(8)); finish.slice(4,8).forEach(done=>done());
  await vi.waitFor(()=>expect(finish).toHaveLength(9)); finish[8]!();
  const groups = await result; expect(groups).toHaveLength(9); expect(groups[8]?.project.status).toBe("archived");
});
it("performs no read without identity/module access and discards late cancelled responses", async () => {
  mock.enabled = false; await expect(loadAidtCourseGroups(scope)).rejects.toThrow("AIDT_GROUP_CONTEXT_CHANGED");
  mock.enabled = true; await expect(loadAidtCourseGroups({ ...scope, userId: "" })).rejects.toThrow(); expect(mock.request).not.toHaveBeenCalled();
  const controller = new AbortController();
  mock.request.mockImplementation(async (path: string) => { if (path !== "/projects") controller.abort(); return path === "/projects" ? projects : roster; });
  await expect(loadAidtCourseGroups({ ...scope, signal: controller.signal })).rejects.toThrow("AIDT_GROUP_CONTEXT_CHANGED");
});

it("offers linking only when the current native roster actually identifies the actor as owner", async () => { roster = { members: [{ ...member(), role: "owner" }] }; expect((await loadAidtCourseGroups(scope))[0]?.canLink).toBe(true); });
