import {TEAM_INCLUDED_SEATS,TEAM_MONTHLY_CREDITS,TEAM_SEAT_MONTHLY_CREDITS} from "@repo/contracts/billing-team";
/** Signed v1 defaults for migration generation only. Runtime catalog reads credit_packages. */
export const TEAM_APPROVED_DEFAULTS=[
 {market:"cn",currency:"CNY",cycle:"month",amountMinor:99900,additionalSeatAmountMinor:14900},
 {market:"cn",currency:"CNY",cycle:"year",amountMinor:999000,additionalSeatAmountMinor:149000},
 {market:"us",currency:"USD",cycle:"month",amountMinor:14900,additionalSeatAmountMinor:2500},
 {market:"us",currency:"USD",cycle:"year",amountMinor:149000,additionalSeatAmountMinor:25000},
].map(p=>({...p,sku:`team-${p.market}-${p.cycle}-v1`,includedSeats:TEAM_INCLUDED_SEATS,monthlyCredits:TEAM_MONTHLY_CREDITS,additionalSeatMonthlyCredits:TEAM_SEAT_MONTHLY_CREDITS}));
