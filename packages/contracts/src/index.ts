/**
 * @repo/contracts — API 契约的**唯一事实源**（ADR-020）
 *
 * 每个契约束一个模块。前后端、mock、OpenAPI 全部从这里派生，
 * **任何一样都不许手写第二份**——本项目已五次因「同一事实声明在两处」而漂移。
 */
export * as identity from "./identity";
export * as artifact from "./artifact";
export * as contextPack from "./context-pack";
