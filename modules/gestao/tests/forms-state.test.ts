import { describe, expect, it } from "vitest";
import {
  isAnswers,
  jsonClone,
  readBuilderDraft,
  readResponseDraft,
} from "../src/forms/drafts";
import { updateBuilder, updateQuestion } from "../src/forms/edits";
import type { FormBuilder, FormField } from "../src/forms/models";

const model = (): FormBuilder => ({
  name: "",
  description: "",
  area: "",
  form_type: "CHECKLIST",
  units: ["Matriz Caicó"],
  apply_everyone: false,
  apply_roles: [],
  apply_user_ids: [],
  report_roles: [],
  report_user_ids: [],
  status: "DRAFT",
  schema: {
    sections: [
      {
        id: "section",
        title: "",
        fields: [
          {
            id: "field",
            label: "",
            type: "SINGLE_CHOICE",
            expected: null,
            options: [],
            min: null,
            max: 0,
          },
        ],
      },
    ],
    evaluation: { enabled: true, area: "", membership: "AREA", user_ids: [] },
  },
});

describe("local Forms drafts", () => {
  it("restores zero, empty selections, notes, evidence and per-person answers without changing the wire format", () => {
    const value = {
      revision: 3,
      at: "2026-11-25T12:00:00Z",
      answers: {
        quantity: { value: 0 },
        choices: { value: [] },
        empty: { value: null },
        photo: {
          photos: ["user/response/file.jpg"],
          observation: "Ainda em análise",
          plan: "Conferir",
        },
        __sections: { section: "Observação da seção" },
        __evaluations: { person: { field: { value: "NA" } } },
      },
    };
    expect(readResponseDraft(JSON.stringify(value))).toEqual(value);
    expect(isAnswers(value.answers)).toBe(true);
    expect(readResponseDraft(null)).toBeNull();
  });
  it.each([
    "{invalid",
    JSON.stringify({ revision: "3", answers: {} }),
    JSON.stringify({ revision: 1, answers: { field: { value: true } } }),
    JSON.stringify({ revision: 1, answers: { __sections: { section: {} } } }),
    JSON.stringify({ revision: 1, answers: { __evaluations: { person: [] } } }),
    JSON.stringify({ revision: 1, answers: { field: { photos: [null] } } }),
  ])(
    "rejects an unreadable response draft with a recovery message: %s",
    (text) => {
      expect(() => readResponseDraft(text)).toThrow(/cópia foi mantida/);
    },
  );
  it("restores incomplete builders so unfinished questions can be completed later", () => {
    const draft = model();
    expect(readBuilderDraft(JSON.stringify(draft))).toEqual(draft);
    expect(readBuilderDraft(null)).toBeNull();
    draft.id = "existing";
    draft.version = 2;
    expect(readBuilderDraft(JSON.stringify(draft))).toEqual(draft);
  });
  it.each([
    "{invalid",
    JSON.stringify({ ...model(), units: "Matriz" }),
    JSON.stringify({ ...model(), status: "INVALID" }),
  ])("rejects malformed builders without discarding the source", (text) => {
    expect(() => readBuilderDraft(text)).toThrow(/cópia foi mantida/);
  });
  it("clones editable models without sharing their nested fields or permission arrays", () => {
    const original = model(),
      copy = jsonClone(original);
    copy.schema.sections[0].fields[0].label = "Outra pergunta";
    copy.units.push("Filial");
    expect(original.schema.sections[0].fields[0].label).toBe("");
    expect(original.units).toHaveLength(1);
  });
});

describe("typed form edits", () => {
  it("keeps numeric zero, cleared limits, independent flags and multiline options", () => {
    const field: FormField = {
      id: "field",
      label: "Quantidade",
      type: "NUMBER",
    };
    updateQuestion(field, "min", "0", false);
    updateQuestion(field, "max", "", false);
    updateQuestion(field, "required", "", true);
    updateQuestion(field, "scope", "INDIVIDUAL", false);
    updateQuestion(field, "type", "MULTIPLE_CHOICE", false);
    updateQuestion(field, "options", " Um \n\n Dois ", false);
    expect(field).toMatchObject({
      min: 0,
      max: null,
      required: true,
      scope: "INDIVIDUAL",
      type: "MULTIPLE_CHOICE",
      options: ["Um", "Dois"],
    });
    expect(updateQuestion(field, "id", "different", false)).toBe(false);
    expect(updateQuestion(field, "type", "INVALID", false)).toBe(false);
    expect(field.id).toBe("field");
  });
  it("accepts only editable model metadata and known statuses", () => {
    const draft = model();
    expect(updateBuilder(draft, "status", "ARCHIVED", false)).toBe(true);
    expect(updateBuilder(draft, "status", "INVALID", false)).toBe(false);
    expect(updateBuilder(draft, "version", "99", false)).toBe(false);
    updateBuilder(draft, "apply_everyone", "", true);
    expect(draft.status).toBe("ARCHIVED");
    expect(draft.apply_everyone).toBe(true);
    expect(draft.version).toBeUndefined();
  });
});
