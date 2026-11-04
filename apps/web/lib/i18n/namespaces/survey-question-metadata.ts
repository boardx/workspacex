import { SURVEY_QUESTION_TYPES, type SurveyQuestionType } from "@repo/contracts/survey-question-types";

type Metadata = { label: string; description: string };
const english: Record<SurveyQuestionType, Metadata> = {
  single: { label: "Single choice", description: "Choose one option" },
  multi: { label: "Multiple choice", description: "Choose several options" },
  dropdown: { label: "Dropdown", description: "Choose from a dropdown list" },
  image_single: { label: "Image single choice", description: "Choose one image" },
  image_multi: { label: "Image multiple choice", description: "Choose several images" },
  short: { label: "Short text", description: "A brief text answer" },
  open: { label: "Long text", description: "A detailed text answer" },
  multiple_text: { label: "Multiple text fields", description: "Complete several fields separately" },
  number: { label: "Number", description: "A number within a range" },
  date: { label: "Date", description: "Choose a valid date" },
  time: { label: "Time", description: "Choose a time of day" },
  datetime: { label: "Date and time", description: "Enter a date and time" },
  email: { label: "Email", description: "Enter an email address" },
  phone: { label: "Phone", description: "Enter a contact phone number" },
  address: { label: "Address", description: "Complete separate address fields" },
  cascade: { label: "Cascading choice", description: "Choose a complete path level by level" },
  scale: { label: "Scale", description: "Choose a scale value" },
  rating: { label: "Star rating", description: "Rate satisfaction with stars" },
  nps: { label: "NPS", description: "Likelihood to recommend from 0 to 10" },
  slider: { label: "Slider", description: "Choose within a numeric range" },
  matrix_single: { label: "Matrix single choice", description: "Choose one option per row" },
  matrix_multi: { label: "Matrix multiple choice", description: "Choose several options per row" },
  matrix_scale: { label: "Matrix scale", description: "Rate each row" },
  matrix_input: { label: "Matrix text", description: "Enter text for each row" },
  matrix_dropdown: { label: "Matrix dropdown", description: "Choose from a dropdown for each row" },
  ranking: { label: "Ranking", description: "Arrange by priority" },
  allocation: { label: "Allocation", description: "Allocate a fixed total" },
  file: { label: "File upload", description: "Submit attachment references" },
  signature: { label: "Signature", description: "Submit a signature image reference" },
  description: { label: "Description text/image", description: "Description without an answer" },
  page_break: { label: "Section and page break", description: "Split a long survey into pages" },
};
type MetadataMessages = Record<`survey.design.type.${SurveyQuestionType}.${keyof Metadata}`, string>;
function messages(items: readonly (Metadata & { type: SurveyQuestionType })[]): MetadataMessages {
  // Both callers enumerate the canonical registry; English completeness is checked by Record above.
  return Object.fromEntries(items.flatMap(item => [
    [`survey.design.type.${item.type}.label`, item.label],
    [`survey.design.type.${item.type}.description`, item.description],
  ])) as MetadataMessages;
}
export const surveyQuestionMetadataZhCN = messages(SURVEY_QUESTION_TYPES);
export const surveyQuestionMetadataEn = messages(SURVEY_QUESTION_TYPES.map(({ type }) => ({ type, ...english[type] })));
