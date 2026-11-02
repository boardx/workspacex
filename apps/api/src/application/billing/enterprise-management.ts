import type { EnterpriseManagement } from "./enterprise-ports";
import type { EnterpriseUpgrade } from "./enterprise-upgrade";
/** Composition wrapper keeps HTTP code independent from financial infrastructure. */
export function enterpriseManagement(upgrade:EnterpriseUpgrade,grants:Pick<EnterpriseManagement,"grant">):EnterpriseManagement {
 return {grant:(...args)=>grants.grant(...args),upgrade:(...args)=>upgrade.upgrade(...args),operation:(...args)=>upgrade.operation(...args)};
}
