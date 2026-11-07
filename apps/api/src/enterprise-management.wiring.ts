/** Enterprise composition stays separate from the large legacy Kernel module. */
import type {Provider} from "@nestjs/common";
import {DATABASE_PORT,type DatabasePort} from "./application/ports/database.port";
import {ENTERPRISE_MANAGEMENT} from "./application/billing/enterprise-ports";
import {enterpriseManagement} from "./application/billing/enterprise-management";
import {EnterpriseUpgrade} from "./application/billing/enterprise-upgrade";
import {EnterpriseCreditGrant} from "./infrastructure/billing/enterprise-credit-grant";
import {EnterpriseNoPaidTeamAdapter} from "./infrastructure/billing/enterprise-no-paid-team";
import {PgEnterpriseUpgradeStore} from "./infrastructure/billing/enterprise-upgrade-store";
import {EnterpriseManagementController} from "./interface/controllers/enterprise-management.controller";
export const enterpriseManagementControllers=[EnterpriseManagementController];
export const enterpriseManagementProviders:Provider[]=[{
 provide:ENTERPRISE_MANAGEMENT,inject:[DATABASE_PORT],
 useFactory:(db:DatabasePort)=>enterpriseManagement(new EnterpriseUpgrade(new PgEnterpriseUpgradeStore(db),new EnterpriseNoPaidTeamAdapter(db)),new EnterpriseCreditGrant(db)),
}];
