import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AidtHome } from "@/features/aidt/components/aidt-home";
const mock=vi.hoisted(()=>({role:"admin",groups:vi.fn(),list:vi.fn(),courseGroups:vi.fn(),create:vi.fn(),link:vi.fn()}));
vi.mock("@/components/session/session-provider",()=>({useOptionalSession:()=>({session:{currentOrgId:"org",userId:"same-user",sessionToken:"same-token"},identity:{orgRole:mock.role}})}));
vi.mock("@/features/aidt/lib/aidt-module-config",()=>({isAidtModuleEnabled:()=>true}));
vi.mock("@/features/aidt/lib/aidt-course-context",()=>({loadAidtCourseGroups:mock.groups}));
vi.mock("@/features/aidt/lib/aidt-course-client",()=>({listAidtCourses:mock.list,listAidtCourseGroups:mock.courseGroups,createAidtCourse:mock.create,linkAidtCourseGroup:mock.link}));
vi.mock("@/features/aidt/components/aidt-create-project-form",()=>({AidtCreateProjectForm:()=>null}));
const managerCourse={id:"manager-only",name:"只有管理者可见的课程",createdAt:"2026-11-16T00:00:00Z"};
beforeEach(()=>{vi.resetAllMocks();mock.role="admin";mock.groups.mockResolvedValue([]);mock.list.mockResolvedValueOnce({items:[managerCourse],nextCursor:null}).mockResolvedValue({items:[],nextCursor:null});mock.courseGroups.mockResolvedValue({course:managerCourse,items:[],nextCursor:null});});
it("the real Home invalidates a completed manager directory when org role changes with unchanged actor and token",async()=>{
 const {rerender}=render(<AidtHome/>);await screen.findByTestId("aidt-course-manager-only");
 const firstSignal=mock.list.mock.calls[0]![0].signal as AbortSignal;
 mock.role="consultant";rerender(<AidtHome/>);
 expect(screen.queryByTestId("aidt-course-manager-only")).toBeNull();expect(firstSignal.aborted).toBe(true);
 await screen.findByTestId("aidt-courses-empty");expect(mock.list).toHaveBeenCalledTimes(2);
 expect(mock.list.mock.calls[1]![0]).toMatchObject({userId:"same-user",sessionToken:"same-token"});
});
it("the real Home aborts a late manager group read on same-token demotion",async()=>{
 let finish!:(value:unknown)=>void;mock.courseGroups.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const {rerender}=render(<AidtHome/>);fireEvent.click(await screen.findByTestId("aidt-course-manager-only"));await waitFor(()=>expect(mock.courseGroups).toHaveBeenCalledTimes(1));
 const signal=mock.courseGroups.mock.calls[0]![0].signal as AbortSignal;
 mock.role="consultant";rerender(<AidtHome/>);await screen.findByTestId("aidt-courses-empty");
 expect(signal.aborted).toBe(true);await act(async()=>finish({course:managerCourse,items:[],nextCursor:null}));
 expect(screen.queryByTestId("aidt-course-selected")).toBeNull();expect(screen.queryByText(managerCourse.name)).toBeNull();
});
it("the real Home aborts a pending manager mutation and rejects its late success after same-token demotion",async()=>{
 let finish!:(value:unknown)=>void;mock.create.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const {rerender}=render(<AidtHome/>);await screen.findByTestId("aidt-course-manager-only");
 fireEvent.change(screen.getByTestId("aidt-course-name"),{target:{value:"旧管理范围的新课程"}});fireEvent.click(screen.getByTestId("aidt-course-create-save"));await waitFor(()=>expect(mock.create).toHaveBeenCalledTimes(1));
 const signal=mock.create.mock.calls[0]![0].signal as AbortSignal;
 mock.role="consultant";rerender(<AidtHome/>);await screen.findByTestId("aidt-courses-empty");expect(signal.aborted).toBe(true);
 await act(async()=>finish({course:{...managerCourse,id:"late-created"},replayed:false}));
 expect(screen.queryByTestId("aidt-course-selected")).toBeNull();expect(screen.queryByTestId("aidt-course-notice")).toBeNull();expect(mock.courseGroups).not.toHaveBeenCalled();
});
