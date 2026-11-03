import { AUTHORED_DISPLAY_UPDATE_REPOSITORY } from "./application/localization/authored-display-update";
import { PgAuthoredDisplayUpdateRepository } from "./infrastructure/localization/pg-authored-display-update-repository";
import { AuthoredDisplayUpdateController } from "./interface/controllers/authored-display-update.controller";
/** Keep localization composition outside the oversized legacy KernelModule. */
import { SKILL_STARTER_IMPORT_REPOSITORY } from "./application/skill-import/ports";
import { AGENT_STARTER_IMPORT_REPOSITORY } from "./application/agent-import/ports";
import { PORTABLE_EXPORT_REPOSITORY } from "./application/localization/portable-export";
import { PgSkillStarterImportRepository } from "./infrastructure/skill/pg-skill-starter-import-repository";
import { PgAgentStarterImportRepository } from "./infrastructure/agent/pg-agent-starter-import-repository";
import { PgPortableExportRepository } from "./infrastructure/localization/pg-portable-export-repository";
import { PortablePackageController } from "./interface/controllers/portable-package.controller";
import { Module } from "@nestjs/common";
import { IdentityPersistenceModule } from "./infrastructure/identity/identity-persistence.module";
import { DATABASE_PORT, type DatabasePort } from "./application/ports/database.port";
import { ENTITY_LOCALIZATION_REPOSITORY } from "./application/localization/entity-localization";
import { PgEntityLocalizationRepository } from "./infrastructure/localization/pg-entity-localization-repository";
import { EntityLocalizationController } from "./interface/controllers/entity-localization.controller";

@Module({
  imports: [IdentityPersistenceModule],
  controllers: [EntityLocalizationController, PortablePackageController, AuthoredDisplayUpdateController],
  providers: [
    { provide: AUTHORED_DISPLAY_UPDATE_REPOSITORY, useFactory: (db: DatabasePort) => new PgAuthoredDisplayUpdateRepository(db), inject: [DATABASE_PORT] },
    { provide: SKILL_STARTER_IMPORT_REPOSITORY, useFactory: (db: DatabasePort) => new PgSkillStarterImportRepository(db), inject: [DATABASE_PORT] },
    { provide: AGENT_STARTER_IMPORT_REPOSITORY, useFactory: (db: DatabasePort) => new PgAgentStarterImportRepository(db), inject: [DATABASE_PORT] },
    { provide: PORTABLE_EXPORT_REPOSITORY, useFactory: (db: DatabasePort) => new PgPortableExportRepository(db), inject: [DATABASE_PORT] },
    { provide: ENTITY_LOCALIZATION_REPOSITORY, useFactory: (db: DatabasePort) => new PgEntityLocalizationRepository(db), inject: [DATABASE_PORT] }],
  exports: [ENTITY_LOCALIZATION_REPOSITORY],
})
export class LocalizationModule {}
