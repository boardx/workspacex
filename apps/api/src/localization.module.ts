/** Keep localization composition outside the oversized legacy KernelModule. */
import { Module } from "@nestjs/common";
import { IdentityPersistenceModule } from "./infrastructure/identity/identity-persistence.module";
import { DATABASE_PORT, type DatabasePort } from "./application/ports/database.port";
import { ENTITY_LOCALIZATION_REPOSITORY } from "./application/localization/entity-localization";
import { PgEntityLocalizationRepository } from "./infrastructure/localization/pg-entity-localization-repository";
import { EntityLocalizationController } from "./interface/controllers/entity-localization.controller";

@Module({
  imports: [IdentityPersistenceModule],
  controllers: [EntityLocalizationController],
  providers: [{ provide: ENTITY_LOCALIZATION_REPOSITORY, useFactory: (db: DatabasePort) => new PgEntityLocalizationRepository(db), inject: [DATABASE_PORT] }],
  exports: [ENTITY_LOCALIZATION_REPOSITORY],
})
export class LocalizationModule {}
