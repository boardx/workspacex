import snapshot from "./catalogs/bailian.json";
import { ProviderModelCatalog } from "./provider-model-catalog";

/** Validated, reviewed deployment snapshot. This does not register or enable tenant models. */
export const bailianModelCatalog = ProviderModelCatalog.parse(snapshot);
