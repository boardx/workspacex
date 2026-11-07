import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {TEAM_APPROVED_DEFAULTS} from "../../src/domain/billing/team-approved-defaults";
import {renderTeamProductSeed} from "../../scripts/generate-team-product-seed";
it("keeps approved defaults seed-only and one monthly quota for both payment cycles",()=>{
 expect(TEAM_APPROVED_DEFAULTS.map(p=>[p.market,p.cycle,p.amountMinor,p.additionalSeatAmountMinor,p.monthlyCredits])).toEqual([["cn","month",99900,14900,100000],["cn","year",999000,149000,100000],["us","month",14900,2500,100000],["us","year",149000,25000,100000]]);
 expect(readFileSync(new URL("../../migrations/20261102072000_team_product_seed.sql",import.meta.url),"utf8")).toBe(renderTeamProductSeed());
 expect(renderTeamProductSeed()).toContain("ON CONFLICT(package_id) DO NOTHING");
});
