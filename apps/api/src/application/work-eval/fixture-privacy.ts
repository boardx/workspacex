/**
 * EV02 E11：夹具只许合成数据。邮箱 / 手机号正则命中且不在合成白名单 → `eval` 拒绝运行
 * （退出语义 FIXTURE_REAL_DATA_SUSPECTED）。白名单只收保留域名（RFC 2606 / 6761）与
 * 明确的合成前缀，不收任何真实域名。
 */
const EMAIL = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;
const CN_MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const INTL_PHONE = /\+\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/g;
const SYNTHETIC_EMAIL_DOMAIN = /(^|\.)(example\.(com|org|net)|[\w-]+\.(test|example|invalid))$/i;
const SYNTHETIC_PHONE = /^(\+?0+|1[3-9]0{9})$/;

export interface PersonalDataFinding {
  file: string;
  kind: "email" | "phone";
  match: string;
}

export function scanFixtureForPersonalData(file: string, text: string): PersonalDataFinding[] {
  const out: PersonalDataFinding[] = [];
  for (const m of text.matchAll(EMAIL)) {
    if (!SYNTHETIC_EMAIL_DOMAIN.test(m[1] ?? "")) out.push({ file, kind: "email", match: m[0] });
  }
  for (const re of [CN_MOBILE, INTL_PHONE]) {
    for (const m of text.matchAll(re)) {
      if (!SYNTHETIC_PHONE.test(m[0].replace(/[\s-]/g, ""))) out.push({ file, kind: "phone", match: m[0] });
    }
  }
  return out;
}
