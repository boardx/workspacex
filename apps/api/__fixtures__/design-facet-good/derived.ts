/**
 * 反向夹具：正确的写法必须**不**被抓。
 *
 * 一个只会开火、从不放行的门控与一个恒绿的门控一样没有信息量——
 * 它只会被加进忽略列表。所以「不过度开火」和「会开火」是同等重要的两条断言。
 */
import {
  designFacetKeys,
  designFacetDenominator,
  DESIGN_FACET_GROUPS,
} from "../../src/domain/templates/design-facet-table";

/** 分母读表，不写字面量——即便这一行谈的正是完成度分母 */
export const denominator = designFacetDenominator();

/** 槽位清单派生，不列举 */
export const slots = designFacetKeys();

/** 分组用唯一那份封闭枚举，不再列一遍 */
export const groups = DESIGN_FACET_GROUPS;

/** 引用单个 key 是消费，不是副本：低于阈值就不该开火 */
export const primarySlot = "topic-and-background";
