import type {
  PlanDisplay,
  AnnualMonth,
  Answer,
  Answers,
  EvaluatedPerson,
  FieldType,
  FormField,
  FormReadRow,
  FormSchema,
  Outcome,
  QuestionMonths,
  ResponseIssue,
  Score,
  Summary,
  ValidationIssue,
} from "./models";

export interface FormsCore {
  TYPES: Record<FieldType, string>;
  FORM_TYPES: Record<string, string>;
  MONTHS: string[];
  clean(value: unknown): string;
  key(value: unknown): string;
  esc(value: unknown): string;
  id(): string;
  fields(
    schema: FormSchema | null | undefined,
  ): (FormField & { section_id: string; section_title: string })[];
  empty(value: unknown): boolean;
  validateSchema<T extends FormSchema>(schema: T): T;
  validateAnswers(
    schema: FormSchema,
    answers: Answers,
    final?: boolean,
  ): { answers: Answers; errors: ValidationIssue[] };
  validateResponse(
    schema: FormSchema,
    answers: Answers,
    people: EvaluatedPerson[] | undefined,
    final?: boolean,
  ): { answers: Answers; errors: ValidationIssue[] };
  evaluationAnswers(
    schema: FormSchema,
    answers: Answers,
    person: string,
  ): Answers;
  assessmentRows<Row extends FormReadRow>(rows: Row[]): Row[];
  planField(field: FormField, person?: string): string;
  questionMonths(
    rows: FormReadRow[],
    person: string,
    year: number,
  ): QuestionMonths[];
  calendarDays(month: string): string[];
  evidencePaths(answers: Answers): string[];
  outcome(field: FormField, answer: Answer | undefined): Outcome | null;
  score(schema: FormSchema, answers: Answers): Score;
  answerText(field: FormField, answer: Answer | undefined): string;
  localDay(value: string | Date | null | undefined): string;
  summarize(rows: FormReadRow[]): Summary;
  issues(rows: FormReadRow[], plans?: PlanDisplay[]): ResponseIssue[];
  annual(rows: FormReadRow[], year: number): AnnualMonth[];
  csv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string;
  exportRows(rows: FormReadRow[], plans?: PlanDisplay[]): unknown[][];
  xlsx(
    rows: ReadonlyArray<ReadonlyArray<unknown>>,
    sheetName?: string,
  ): Uint8Array<ArrayBuffer>;
}

declare global {
  interface Window {
    DISB_FORMS: FormsCore;
    PDFLib?: typeof import("pdf-lib");
  }
}
