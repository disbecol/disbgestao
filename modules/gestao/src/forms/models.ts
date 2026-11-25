export type FieldType =
  | "BOOLEAN"
  | "TEXT"
  | "LONG_TEXT"
  | "NUMBER"
  | "DATE"
  | "SINGLE_CHOICE"
  | "MULTIPLE_CHOICE"
  | "PHOTO";
export type FieldScope = "GROUP" | "INDIVIDUAL";
export type DefinitionStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type ResponseStatus = "DRAFT" | "COMPLETED" | "CANCELLED";
export type AssignmentStatus = "PENDING" | "COMPLETED" | "CANCELLED";
export type PlanStatus = "OPEN" | "DONE";
export type Outcome = "OK" | "NOK" | "NA";

export type FormField = {
  id: string;
  label: string;
  type: FieldType;
  help?: string;
  required?: boolean;
  scored?: boolean;
  expected?: string | null;
  allow_na?: boolean;
  require_note?: boolean;
  scope?: FieldScope;
  options?: string[];
  min?: number | null;
  max?: number | null;
};
export type FormSection = { id: string; title: string; fields: FormField[] };
export type FormSchema = {
  sections: FormSection[];
  evaluation?: {
    enabled: boolean;
    area: string;
    membership?: "AREA";
    user_ids?: string[];
  };
};
export type AnswerValue = string | number | string[] | null;
export type Answer = {
  value?: AnswerValue;
  observation?: string;
  plan?: string;
  photos?: string[];
};
// The existing RPC/local-storage wire format reserves these two keys. They are
// validated separately at the persistence boundary; normal field IDs map to Answer.
export type Answers = Record<string, Answer> & {
  __sections?: Record<string, string>;
  __evaluations?: Record<string, Record<string, Answer>>;
};
export type FormDefinition = {
  id: string;
  version: number;
  name: string;
  description: string;
  area: string;
  form_type: string;
  units: string[];
  apply_everyone: boolean;
  apply_roles: string[];
  apply_user_ids: string[];
  report_roles: string[];
  report_user_ids: string[];
  status: DefinitionStatus;
  schema: FormSchema;
};
export type FormBuilder = Omit<FormDefinition, "id" | "version"> & {
  id?: string;
  version?: number;
};
export type FormPerson = {
  id: string;
  name: string;
  role: string;
  units: string[];
  area?: string;
  active?: boolean;
};
export type EvaluatedPerson = Pick<FormPerson, "id" | "name" | "role" | "area">;
export type FormResponse = {
  id: string;
  form_id: string;
  form_name: string;
  form_area?: string;
  form_version: number;
  unit: string;
  code: string;
  status: ResponseStatus;
  revision: number;
  respondent_id: string;
  respondent_name: string;
  started_at: string;
  completed_at: string | null;
  schema_snapshot: FormSchema;
  answers: Answers;
  score: number | null;
  ok_count?: number;
  nok_count?: number;
  na_count?: number;
  evaluated_people?: EvaluatedPerson[];
  evaluated_user_id?: string;
  evaluated_name?: string;
  evaluated_role?: string;
  evaluated_area?: string;
  _evaluation_view?: boolean;
  _self_view?: boolean;
  own_plans?: ActionPlan[];
};
export type FormAssignment = {
  id: string;
  form_id: string;
  unit: string;
  user_id: string;
  user_name: string;
  due_date: string;
  status: AssignmentStatus;
  response_id: string | null;
};
export type ActionPlan = {
  id?: string;
  response_id: string;
  field_id: string;
  revision: number;
  description: string;
  responsible_id: string | null;
  responsible_name?: string | null;
  due_date: string | null;
  status: PlanStatus;
  completion_note: string | null;
};
// Personal results intentionally omit write revisions, author IDs and plan ownership IDs.
// Keep their read contract separate from the records used by save/cancel operations.
export type OwnActionPlan = Pick<
  ActionPlan,
  | "field_id"
  | "description"
  | "responsible_name"
  | "due_date"
  | "status"
  | "completion_note"
>;
export type PlanDisplay = OwnActionPlan &
  Partial<Omit<ActionPlan, keyof OwnActionPlan>>;
export type FormReadRow = Omit<
  FormResponse,
  "revision" | "respondent_id" | "own_plans"
> & {
  revision?: number;
  respondent_id?: string;
  own_plans?: PlanDisplay[];
};
export type OwnEvaluation = Omit<
  FormReadRow,
  "revision" | "respondent_id" | "status" | "own_plans"
> & {
  status: "COMPLETED";
  _self_view: true;
  _evaluation_view: true;
  own_plans: OwnActionPlan[];
};
export type ReportTab =
  | "summary"
  | "applications"
  | "execution"
  | "farol"
  | "charts"
  | "conformity"
  | "issues";
export type ReportFilter = Partial<
  Record<
    "form" | "person" | "area" | "type" | "year" | "from" | "to" | "search",
    string
  >
>;
export type ScheduleFilter = {
  form?: string;
  person?: string;
  status?: AssignmentStatus | "";
  from?: string;
  to?: string;
};
export type CatalogFilter = Partial<Record<"search" | "type" | "area", string>>;
export type ValidationIssue = { id?: string; person?: string; message: string };
export type Score = {
  ok: number;
  nok: number;
  na: number;
  answered: number;
  total: number;
  percent: number | null;
};
export type Summary = Pick<Score, "ok" | "nok" | "na" | "percent"> & {
  completed: number;
  drafts: number;
};
export type ResponseIssue = {
  response: FormReadRow;
  field: FormField;
  answer?: Answer;
  plan: PlanDisplay | null;
};
export type QuestionMonths = {
  id: string;
  label: string;
  form: string;
  months: Pick<Score, "ok" | "nok" | "na" | "percent">[];
};
export type AnnualMonth = Summary & { label: string; month: number };
