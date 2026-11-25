import type {
  Answer,
  Answers,
  FormBuilder,
  FormField,
  FormSchema,
} from "./models";

export function jsonClone<T>(value: T): T {
  // DTOs only: preserve the existing JSON wire format and its behavior for optional fields.
  return JSON.parse(JSON.stringify(value)) as T;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
function answer(value: unknown): value is Answer {
  if (!record(value)) return false;
  const response = value.value;
  return (
    (response === undefined ||
      response === null ||
      typeof response === "string" ||
      (typeof response === "number" && Number.isFinite(response)) ||
      strings(response)) &&
    (value.observation === undefined ||
      typeof value.observation === "string") &&
    (value.plan === undefined || typeof value.plan === "string") &&
    (value.photos === undefined || strings(value.photos))
  );
}
function notes(value: unknown): value is Record<string, string> {
  return (
    record(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
export function isAnswers(value: unknown): value is Answers {
  if (!record(value)) return false;
  return Object.entries(value).every(([key, entry]) =>
    key === "__sections"
      ? notes(entry)
      : key === "__evaluations"
        ? record(entry) &&
          Object.values(entry).every(
            (bag) => record(bag) && Object.values(bag).every(answer),
          )
        : answer(entry),
  );
}
export type ResponseDraft = { revision: number; answers: Answers; at?: string };
function parseDraft(text: string, message: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw Error(message);
  }
}
export function readResponseDraft(text: string | null): ResponseDraft | null {
  if (text === null) return null;
  const message =
    "O rascunho local não pôde ser lido. A cópia foi mantida neste aparelho.";
  const value = parseDraft(text, message);
  if (
    !record(value) ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    !isAnswers(value.answers) ||
    (value.at !== undefined && typeof value.at !== "string")
  ) {
    throw Error(message);
  }
  return {
    revision: value.revision,
    answers: value.answers,
    ...(typeof value.at === "string" ? { at: value.at } : {}),
  };
}
function isField(value: unknown): value is FormField {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    typeof value.type !== "string"
  )
    return false;
  if (
    ![
      "BOOLEAN",
      "TEXT",
      "LONG_TEXT",
      "NUMBER",
      "DATE",
      "SINGLE_CHOICE",
      "MULTIPLE_CHOICE",
      "PHOTO",
    ].includes(value.type)
  )
    return false;
  return (
    ["required", "scored", "allow_na", "require_note"].every(
      (key) => value[key] === undefined || typeof value[key] === "boolean",
    ) &&
    (value.help === undefined || typeof value.help === "string") &&
    (value.positive_label === undefined || typeof value.positive_label === "string") &&
    (value.negative_label === undefined || typeof value.negative_label === "string") &&
    (value.expected === undefined ||
      value.expected === null ||
      typeof value.expected === "string") &&
    (value.scope === undefined ||
      value.scope === "GROUP" ||
      value.scope === "INDIVIDUAL") &&
    (value.options === undefined || strings(value.options)) &&
    ["min", "max"].every(
      (key) =>
        value[key] === undefined ||
        value[key] === null ||
        (typeof value[key] === "number" && Number.isFinite(value[key])),
    )
  );
}
function isSchema(value: unknown): value is FormSchema {
  if (
    !record(value) ||
    !Array.isArray(value.sections) ||
    !value.sections.every(
      (section) =>
        record(section) &&
        typeof section.id === "string" &&
        typeof section.title === "string" &&
        Array.isArray(section.fields) &&
        section.fields.every(isField),
    )
  )
    return false;
  if (value.evaluation === undefined) return true;
  const config = value.evaluation;
  return (
    record(config) &&
    typeof config.enabled === "boolean" &&
    typeof config.area === "string" &&
    (config.membership === undefined || config.membership === "AREA") &&
    (config.areas === undefined || strings(config.areas)) &&
    (config.user_ids === undefined || strings(config.user_ids))
  );
}
function isBuilder(value: unknown): value is FormBuilder {
  if (
    !record(value) ||
    !["name", "description", "area", "form_type"].every(
      (key) => typeof value[key] === "string",
    ) ||
    ![
      "units",
      "apply_roles",
      "apply_user_ids",
      "report_roles",
      "report_user_ids",
    ].every((key) => strings(value[key]))
  )
    return false;
  return (
    typeof value.apply_everyone === "boolean" &&
    ["DRAFT", "PUBLISHED", "ARCHIVED"].includes(String(value.status)) &&
    (value.id === undefined || typeof value.id === "string") &&
    (value.version === undefined ||
      (typeof value.version === "number" && Number.isInteger(value.version))) &&
    isSchema(value.schema)
  );
}
export function readBuilderDraft(text: string | null): FormBuilder | null {
  if (text === null) return null;
  const message =
    "A criação guardada não pôde ser lida. A cópia foi mantida neste aparelho.";
  const value = parseDraft(text, message);
  if (!isBuilder(value)) throw Error(message);
  return value;
}
