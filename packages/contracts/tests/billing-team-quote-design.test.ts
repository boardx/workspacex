import {expect,it} from "vitest";
import {TeamQuote} from "../src/billing-team";
const base={orgId:"org-a",generation:"pricing-v1",quoteRef:"quote-a",catalogVersion:"catalog-v1",sku:"team-year",provider:"wechat",currency:"CNY",amountMinor:999000,createdAt:"2026-11-16T10:00:00Z",expiresAt:"2026-11-16T10:05:00Z"};
const initial={...base,purpose:"initial",seats:5,monthlyCredits:100000,billingCycle:"year",renewalMode:"manual",planVersion:0};
const term={purchaseAnchor:"2026-11-01T10:00:00Z",paidPeriodStart:"2026-11-01T10:00:00Z",paidPeriodEnd:"2027-11-01T10:00:00Z",billingCycle:"year",purchasedSeats:5,monthlyCredits:100000};
const addon={...base,purpose:"add_seats",term,additionalSeats:2,monthlyCreditsAfter:130000,estimatedFirstCredits:15000,creditPeriodStart:"2026-11-01T10:00:00Z",creditPeriodEnd:"2026-12-01T10:00:00Z",planVersion:2};
it("keeps annual payment distinct from monthly quota in the initial or renewal quote",()=>{
 expect(TeamQuote.parse(initial)).toEqual(initial);
 expect(TeamQuote.safeParse({...initial,purpose:"renewal",seats:7,monthlyCredits:130000,planVersion:2}).success).toBe(true);
 for(const patch of [{monthlyCredits:1200000},{seats:4},{monthlyCredits:99999},{provider:"stripe"},{paidPeriodEnd:term.paidPeriodEnd}])expect(TeamQuote.safeParse({...initial,...patch}).success).toBe(false);
});
it("quotes a co-term increment against a paid annual term and a separate monthly credit window",()=>{
 expect(TeamQuote.parse(addon)).toEqual(addon);
 for(const patch of [{additionalSeats:0},{additionalSeats:0.5},{monthlyCreditsAfter:160000},{estimatedFirstCredits:30000.01},{estimatedFirstCredits:-1},{creditPeriodEnd:term.paidPeriodEnd},{creditPeriodStart:base.expiresAt}])expect(TeamQuote.safeParse({...addon,...patch}).success).toBe(false);
});
it.each(["2026-11-16T10:00:00Z","2026-11-16T10:05:01Z"])("rejects an expired or overlong quote expiry %s",expiresAt=>{
 expect(TeamQuote.safeParse({...initial,expiresAt}).success).toBe(false);
});
it("clamps only the seat add-on quote to the original paid expiry",()=>{
 const createdAt="2027-11-01T09:59:00Z";
 const nearEnd={...addon,createdAt,expiresAt:term.paidPeriodEnd,creditPeriodStart:"2027-10-01T10:00:00Z",creditPeriodEnd:term.paidPeriodEnd,estimatedFirstCredits:0.67};
 expect(TeamQuote.safeParse(nearEnd).success).toBe(true);
 expect(TeamQuote.safeParse({...nearEnd,expiresAt:"2027-11-01T10:01:00Z"}).success).toBe(false);
 // A renewal quote can outlive the old term; its paid term has not begun yet.
 expect(TeamQuote.safeParse({...initial,purpose:"renewal",createdAt,expiresAt:"2027-11-01T10:04:00Z"}).success).toBe(true);
});
it("keeps permanent top-up independent of paid term and subscription renewal",()=>{
 const topup={...base,purpose:"credit_topup",credits:10000,provider:"stripe",currency:"USD",renewalMode:"manual"};
 expect(TeamQuote.parse(topup)).toEqual(topup);
 for(const patch of [{credits:1},{renewalMode:"automatic"},{seats:5},{term},{planVersion:0},{estimatedFirstCredits:1}])expect(TeamQuote.safeParse({...topup,...patch}).success).toBe(false);
});
it.each([0,-1,0.5,Infinity,Number.MAX_SAFE_INTEGER+1])("rejects unsafe quote money %s",amountMinor=>{
 expect(TeamQuote.safeParse({...initial,amountMinor}).success).toBe(false);
});
it("rejects extra account, paid-result or merchant authority in a quote",()=>{
 for(const field of ["ownerId","actorId","customerId","paymentRef","success","url","isEnterprise"])
  expect(TeamQuote.safeParse({...initial,[field]:"forged"}).success).toBe(false);
});

it("allows a zero-credit estimate when rounding the final fraction below 0.01",()=>{
 expect(TeamQuote.safeParse({...addon,createdAt:"2026-12-01T09:59:59.999Z",expiresAt:"2026-12-01T10:04:59.999Z",estimatedFirstCredits:0}).success).toBe(true);
});
