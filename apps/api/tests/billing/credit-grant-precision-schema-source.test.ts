import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {renderCreditGrantPrecisionSchema} from "../../scripts/generate-credit-grant-precision-schema";
it("keeps cumulative grant precision and the decimal welcome trigger aligned with their contract sources",()=>{
 expect(readFileSync(new URL("../../migrations/20261102030500_credit_grant_precision.sql",import.meta.url),"utf8")).toBe(renderCreditGrantPrecisionSchema());
});
