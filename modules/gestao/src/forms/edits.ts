import type { FormBuilder, FormField } from "./models";

export function oneOf<Value extends string>(
  value: string | undefined,
  options: readonly Value[],
): value is Value {
  return options.some((option) => option === value);
}
export function updateQuestion(
  field: FormField,
  key: string,
  value: string,
  checked: boolean,
): boolean {
  if (oneOf(key, ["required", "scored", "allow_na", "require_note"] as const))
    field[key] = checked;
  else if (oneOf(key, ["label", "help", "expected"] as const))
    field[key] = value;
  else if (
    key === "type" &&
    oneOf(value, [
      "BOOLEAN",
      "TEXT",
      "LONG_TEXT",
      "NUMBER",
      "DATE",
      "SINGLE_CHOICE",
      "MULTIPLE_CHOICE",
      "PHOTO",
    ] as const)
  )
    field.type = value;
  else if (key === "scope" && oneOf(value, ["GROUP", "INDIVIDUAL"] as const))
    field.scope = value;
  else if (key === "options")
    field.options = value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  else if (oneOf(key, ["min", "max"] as const))
    field[key] = value === "" ? null : Number(value);
  else return false;
  return true;
}
export function updateBuilder(
  builder: FormBuilder,
  key: string,
  value: string,
  checked: boolean,
): boolean {
  if (key === "apply_everyone") builder.apply_everyone = checked;
  else if (oneOf(key, ["name", "description", "area", "form_type"] as const))
    builder[key] = value;
  else if (
    key === "status" &&
    oneOf(value, ["DRAFT", "PUBLISHED", "ARCHIVED"] as const)
  )
    builder.status = value;
  else return false;
  return true;
}
