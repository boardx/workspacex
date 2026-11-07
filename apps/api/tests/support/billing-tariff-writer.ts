/** Reuse #6268's actual restricted writer, in an isolated test DB only. */
import {provisionBillingTariffWriter} from '../../scripts/provision-billing-tariff-writer';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {migrationConfig} from '../../src/infrastructure/db/pg-config';
export async function createFixtureTariffWriter(){
 const password='isolated-test-writer-password-6268';
 await provisionBillingTariffWriter(password);
 return new PgDatabase({...migrationConfig(),user:'app_billing_tariff_writer',password});
}
