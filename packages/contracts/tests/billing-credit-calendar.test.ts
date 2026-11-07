import {expect,it} from "vitest";
import {creditMonthWindowAt,creditMonthBoundary,paidCreditWindows} from "../src/billing-credit-calendar";
const anchor=new Date("2026-01-31T10:00:00Z");
it.each([
 ["2026-01-31T10:00:00Z",0,"2026-01-31T10:00:00Z","2026-02-28T10:00:00Z"],
 ["2026-02-28T09:59:59.999Z",0,"2026-01-31T10:00:00Z","2026-02-28T10:00:00Z"],
 ["2026-02-28T10:00:00Z",1,"2026-02-28T10:00:00Z","2026-03-31T10:00:00Z"],
 ["2026-03-31T10:00:00Z",2,"2026-03-31T10:00:00Z","2026-04-30T10:00:00Z"],
] as const)("locates the original-anchor window at %s",(at,offset,start,end)=>{
 expect(creditMonthWindowAt(anchor,new Date(at))).toEqual({offset,start:new Date(start),end:new Date(end)});
});
it("preserves leap-day anchors across years and equivalent timezone notation",()=>{
 const leap=new Date("2024-02-29T18:00:00+08:00");
 expect(creditMonthWindowAt(leap,new Date("2025-02-28T18:00:00+08:00"))).toEqual({offset:12,start:new Date("2025-02-28T10:00:00Z"),end:new Date("2025-03-29T10:00:00Z")});
 expect(creditMonthBoundary(leap,48)).toEqual(new Date("2028-02-29T10:00:00Z"));
});
it("has no earned window before the anchor",()=>{
 expect(creditMonthWindowAt(anchor,new Date("2026-01-31T09:59:59.999Z"))).toBeNull();
});
it("does not mutate anchors or replace the paid-window schedule",()=>{
 creditMonthWindowAt(anchor,new Date("2027-05-02T10:00:00Z"));
 expect(anchor.toISOString()).toBe("2026-01-31T10:00:00.000Z");
 expect(paidCreditWindows(anchor,"year",new Date("2030-01-01T00:00:00Z"))).toHaveLength(12);
});
it("rejects invalid lookup dates",()=>{
 expect(()=>creditMonthWindowAt(new Date(NaN),anchor)).toThrow();
 expect(()=>creditMonthWindowAt(anchor,new Date(NaN))).toThrow();
});
