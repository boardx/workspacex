import { surveyRuntimeErrorCatalogue } from "@/lib/survey/runtime-error-copy";
type RuntimeMessages = Record<`survey.runtimeError.${keyof typeof surveyRuntimeErrorCatalogue}`, string>;
function messages(index: 0 | 1): RuntimeMessages {
  return Object.fromEntries(Object.entries(surveyRuntimeErrorCatalogue).map(([key, pair]) => [`survey.runtimeError.${key}`, pair[index]])) as RuntimeMessages;
}
export const surveyRuntimeErrorsZhCN = messages(0);
export const surveyRuntimeErrorsEn = messages(1);
