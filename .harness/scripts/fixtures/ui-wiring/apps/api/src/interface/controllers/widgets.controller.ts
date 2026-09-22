import { Controller, Get } from "@nestjs/common";
import { widgets as C } from "@repo/contracts";
import { listWidgets } from "../../application/widgets/list-widgets";

@Controller()
export class WidgetsController {
  @Get(C.operations.listWidgets.path)
  async list() {
    return listWidgets();
  }
}
