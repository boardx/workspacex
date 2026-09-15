/**
 * 应用层薄编排：把请求交给领域层的确定性评分引擎（ad-hoc MVP，issue #3676）。
 *
 * 不做任何 I/O、不查库、不发副作用——本函数本身与领域层一样是纯函数，
 * 这里只是遵循仓库既有分层约定（controller 不直接触达 domain 细节，
 * 经 application 层一层薄转发），不是真的需要编排逻辑。
 */
import {
  rateWithDataQuality,
  type FinancialInput,
  type HumanConfirmedFacts,
  type RatingResult,
} from "../../domain/postinvest-rating/scoring";

export function rateFinancials(input: FinancialInput, facts: HumanConfirmedFacts): RatingResult {
  return rateWithDataQuality(input, facts);
}
