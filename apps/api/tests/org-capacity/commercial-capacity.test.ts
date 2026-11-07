import {readFileSync} from "node:fs";
import {TEAM_INCLUDED_SEATS} from "@repo/contracts/billing-team";
import { describe, expect, it } from "vitest";
import { resolveCommercialCapacity as resolve } from "../../src/application/org-capacity/commercial-capacity";
const license = { generation: "epoch-2", purchasedSeats: "5", pendingSeats: "7", pendingPurchaseRef: "purchase-1" };
describe("commercial capacity facts", () => {
  it("does not grant unpaid additional seats", () => expect(resolve("epoch-2", null, license)).toEqual({kind:"limited",seats:5n}));
  it("constrains an initial pending purchase", () => expect(resolve("epoch-2", null, {...license,purchasedSeats:null})).toEqual({kind:"limited",seats:7n}));
  it("fails closed for old generation and incomplete facts", () => {
    expect(resolve("epoch-3", null, license)).toEqual({kind:"invalid"});
    expect(resolve("epoch-2", null, {...license,pendingPurchaseRef:null})).toEqual({kind:"invalid"});
    expect(resolve("epoch-2", null, {...license,purchasedSeats:"4"})).toEqual({kind:"invalid"});
  });
  it("derives Enterprise from current canonical plan", () => {
    expect(resolve("epoch-2", {plan:"enterprise",billingGeneration:"epoch-2"},null)).toEqual({kind:"unlimited"});
    expect(resolve("epoch-2", {plan:"enterprise",billingGeneration:"epoch-1"},null)).toEqual({kind:"invalid"});
  });
  it("preserves legacy behavior when commercial facts do not exist", () => expect(resolve("epoch-2",null,null)).toEqual({kind:"legacy"}));
});

it("migration capacity floor matches the signed contract",()=>{
 const sql=readFileSync(new URL("../../migrations/20261102031000_org_commercial_capacity.sql",import.meta.url),"utf8");
 for(const column of ["purchased_seats","pending_seats"]) expect(sql).toContain(`CHECK(${column}>=${TEAM_INCLUDED_SEATS})`);
});
