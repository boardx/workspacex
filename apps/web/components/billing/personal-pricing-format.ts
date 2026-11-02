export const pricingNumber = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
export const pricingDate = (value: string) => new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
export const pricingMoney = (currency: string, amountMinor: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(amountMinor / 100);
