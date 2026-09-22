import { Module } from "@nestjs/common";
import { WidgetsController } from "./interface/controllers/widgets.controller";

@Module({
  controllers: [
    WidgetsController,
  ],
  providers: [],
})
export class KernelModule {}
