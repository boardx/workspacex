/**
 * 销售线 Workflow 定义（CT08：W011–W016、W018）。W017 不在第一阶段清单（I-C2），不得出现。
 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { W011 } from "./w011";
import { W012 } from "./w012";
import { W013 } from "./w013";
import { W014 } from "./w014";
import { W015 } from "./w015";
import { W016 } from "./w016";
import { W018 } from "./w018";

export { W011, W012, W013, W014, W015, W016, W018 };

export const SALES_WORKFLOW_DEFINITIONS: readonly WorkContentWorkflowModule[] = Object.freeze([W011, W012, W013, W014, W015, W016, W018]);
