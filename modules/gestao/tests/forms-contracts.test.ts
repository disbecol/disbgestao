import { expectTypeOf, it } from "vitest";
import type { createFormsService } from "../src/forms/service";
import type { FormResponse } from "../src/forms/models";
import type { FormsFunctions } from "../src/forms/database";

it("retains the typed controller service boundary", () => {
  expectTypeOf<
    ReturnType<ReturnType<typeof createFormsService>["response"]>
  >().toEqualTypeOf<Promise<FormResponse>>();
  expectTypeOf<
    FormsFunctions["my_form_evaluations"]["Args"]
  >().not.toHaveProperty("p_user_id");
  expectTypeOf<
    FormsFunctions["my_form_evaluations"]["Returns"][number]
  >().not.toHaveProperty("revision");
  expectTypeOf<
    FormsFunctions["my_form_evaluations"]["Returns"][number]["own_plans"][number]
  >().not.toHaveProperty("response_id");
});

// Compile-time regression checks. Invalid writes must fail before a build ships.
function invalidWrites(service: ReturnType<typeof createFormsService>) {
  // @ts-expect-error optimistic concurrency is mandatory
  service.rpc("save_form_response", {
    p_id: "response",
    p_answers: {},
    p_finalize: true,
  });
  // @ts-expect-error only documented function names are permitted
  service.rpc("unknown_function", {});
  service.rpc("my_form_evaluations", {
    p_unit: "Matriz",
    p_from: "2026-01-01",
    p_to: "2026-12-31",
    p_offset: 0,
    // @ts-expect-error self results cannot select another user
    p_user_id: "other",
  });
  // @ts-expect-error schedule status must be a known value
  service.assignments({ status: "DELETED" });
}
void invalidWrites;
