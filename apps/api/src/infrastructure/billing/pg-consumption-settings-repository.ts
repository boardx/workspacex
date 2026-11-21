import type { DatabasePort } from "../../application/ports/database.port";
import type { ConsumptionSettingsRepository, ConsumptionSettingsPatch, PlatformConsumptionSettings } from "../../application/billing/consumption-settings-service";
import type { OrgId } from "../../domain/org-id";
import { CREDIT_ADMISSION_POLICY } from "@repo/contracts/billing-consumption";
import { creditRateBps } from "../../application/billing/credit-consumption";

type SettingsRow = { credit_preflight_enabled: boolean; credit_rate_bps: number | null; credit_rate_cn_bps: number | null; credit_rate_us_bps: number | null };
const select = "SELECT credit_preflight_enabled,credit_rate_bps,credit_rate_cn_bps,credit_rate_us_bps FROM credit_consumption_settings WHERE singleton=true";

function settings(row: SettingsRow): PlatformConsumptionSettings {
  const defaultRate = creditRateBps(row.credit_rate_bps ?? process.env.WORKSPACEX_CREDIT_RATE_BPS);
  return {
    marketRates: {
      cn: { overrideBps: row.credit_rate_cn_bps, effectiveBps: row.credit_rate_cn_bps ?? defaultRate },
      us: { overrideBps: row.credit_rate_us_bps, effectiveBps: row.credit_rate_us_bps ?? defaultRate },
    },
    creditPreflightEnabled: row.credit_preflight_enabled,
    admissionPolicy: CREDIT_ADMISSION_POLICY,
    creditRateBps: row.credit_rate_bps,
    effectiveCreditRateBps: defaultRate,
  };
}

export class PgConsumptionSettingsRepository implements ConsumptionSettingsRepository {
  constructor(private readonly db: DatabasePort) {}

  async read(orgId: OrgId): Promise<PlatformConsumptionSettings> {
    return this.db.withTenant(orgId, async s => {
      const row = (await s.query<SettingsRow>(select)).rows[0];
      if (!row) throw new Error("credit_consumption_settings_missing");
      return settings(row);
    });
  }

  async update(orgId: OrgId, userId: string, input: ConsumptionSettingsPatch): Promise<PlatformConsumptionSettings> {
    return this.db.withTenant(orgId, async s => {
      const previous = (await s.query<SettingsRow>(select + " FOR UPDATE")).rows[0];
      if (!previous) throw new Error("credit_consumption_settings_missing");
      const rateColumn = input.market === "cn" ? "credit_rate_cn_bps"
        : input.market === "us" ? "credit_rate_us_bps" : "credit_rate_bps";
      const row = {
        ...previous,
        credit_preflight_enabled: input.creditPreflightEnabled ?? previous.credit_preflight_enabled,
        [rateColumn]: input.creditRateBps === undefined ? previous[rateColumn] : input.creditRateBps,
      };
      const result = settings(row);
      await s.query("UPDATE credit_consumption_settings SET credit_preflight_enabled=$1,credit_rate_bps=$2,credit_rate_cn_bps=$3,credit_rate_us_bps=$4,updated_by=$5,updated_at=now() WHERE singleton=true",
        [row.credit_preflight_enabled, row.credit_rate_bps, row.credit_rate_cn_bps, row.credit_rate_us_bps, userId]);
      await s.query("INSERT INTO credit_consumption_setting_changes(actor_id,old_enabled,new_enabled,old_credit_rate_bps,new_credit_rate_bps,credit_rate_market) VALUES($1,$2,$3,$4,$5,$6)",
        [userId, previous.credit_preflight_enabled, row.credit_preflight_enabled, previous[rateColumn], row[rateColumn], input.market ?? null]);
      return result;
    });
  }
}
