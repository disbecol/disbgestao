import { describe, expect, it } from "vitest";
import { createFormsService, requireFormsContext } from "../src/forms/service";
import type { FormsContext } from "../src/forms/types";

type Call = { table: string; steps: [string, ...unknown[]][] };
type Result = { data: unknown; error: { message: string } | null };
function harness(
  run: (call: Call) => Result | Promise<Result> = () => ({
    data: [],
    error: null,
  }),
) {
  const calls: Call[] = [],
    rpcs: { name: string; args: unknown }[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, steps: [] };
      calls.push(call);
      const query: Record<string, unknown> = {};
      for (const method of [
        "select",
        "eq",
        "neq",
        "gte",
        "lt",
        "lte",
        "in",
        "contains",
        "order",
        "range",
        "single",
        "maybeSingle",
      ])
        query[method] = (...args: unknown[]) => {
          call.steps.push([method, ...args]);
          return query;
        };
      query.then = (
        resolve: (result: Result) => void,
        reject: (error: unknown) => void,
      ) => Promise.resolve(run(call)).then(resolve, reject);
      return query;
    },
    async rpc(name: string, args: unknown) {
      rpcs.push({ name, args });
      return { data: [], error: null };
    },
  };
  // Minimal transport double: production uses the existing authenticated SDK client.
  const context: FormsContext = {
    client: client as unknown as FormsContext["client"],
    user: { id: "me" },
    profile: null,
    unit: "Matriz Caicó",
    units: ["Matriz Caicó"],
    roles: {},
  };
  return { context, calls, rpcs, service: createFormsService(() => context) };
}
const has = (call: Call, ...step: unknown[]) =>
  call.steps.some((actual) => JSON.stringify(actual) === JSON.stringify(step));

describe("Forms service using the existing session", () => {
  it("rejects missing authentication before issuing a read", async () => {
    const h = harness();
    h.context.user = null;
    expect(() => h.service.ownResponses()).toThrow(/sessão foi encerrada/);
    expect(h.calls).toHaveLength(0);
    expect(() => requireFormsContext({ ...h.context, client: null })).toThrow(
      /sessão/,
    );
  });
  it("pages a report with stable filters and unit even if the selected context changes during the request", async () => {
    let page = 0;
    const h = harness(() => {
      h.context.unit = "Filial Pau dos Ferros";
      return {
        data: Array.from({ length: page++ === 0 ? 250 : 2 }, (_, index) => ({
          id: `${page}-${index}`,
        })),
        error: null,
      };
    });
    const rows = await h.service.reportResponses({
      from: "2026-11-01",
      until: "2026-12-01",
      form: "form",
      respondent: "person",
    });
    expect(rows).toHaveLength(252);
    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) {
      expect(has(call, "eq", "unit", "Matriz Caicó")).toBe(true);
      expect(has(call, "neq", "status", "CANCELLED")).toBe(true);
      expect(has(call, "gte", "started_at", "2026-11-01")).toBe(true);
      expect(has(call, "lt", "started_at", "2026-12-01")).toBe(true);
      expect(has(call, "eq", "form_id", "form")).toBe(true);
      expect(has(call, "eq", "respondent_id", "person")).toBe(true);
      expect(has(call, "order", "id")).toBe(true);
    }
    expect(has(h.calls[1], "range", 250, 499)).toBe(true);
    await h.service.ownResponses();
    expect(has(h.calls[2], "eq", "unit", "Filial Pau dos Ferros")).toBe(true);
    expect(has(h.calls[2], "eq", "respondent_id", "me")).toBe(true);
  });
  it("does not silently truncate oversized exports", async () => {
    const h = harness(() => ({
      data: Array.from({ length: 250 }, () => ({ id: "row" })),
      error: null,
    }));
    await expect(h.service.ownResponses()).rejects.toThrow(/10.000 registros/);
    expect(h.calls).toHaveLength(40);
  });
  it("chunks response references and skips empty plan queries", async () => {
    const h = harness(),
      ids = Array.from({ length: 205 }, (_, i) => `response-${i}`);
    expect(await h.service.plans([])).toEqual([]);
    expect(h.calls).toHaveLength(0);
    await h.service.plans(ids);
    expect(
      h.calls.map((call) => call.steps.find((step) => step[0] === "in")?.[2]),
    ).toEqual([ids.slice(0, 100), ids.slice(100, 200), ids.slice(200)]);
    expect(h.calls.every((call) => call.table === "form_action_plans")).toBe(
      true,
    );
  });
  it("applies the selected schedule filters and person ordering", async () => {
    const h = harness();
    await h.service.assignments(
      {
        from: "2026-11-01",
        to: "2026-11-30",
        status: "PENDING",
        person: "person",
        form: "form",
      },
      true,
    );
    expect(h.calls[0].steps).toEqual(
      expect.arrayContaining([
        ["eq", "unit", "Matriz Caicó"],
        ["eq", "status", "PENDING"],
        ["eq", "user_id", "person"],
        ["eq", "form_id", "form"],
        ["gte", "due_date", "2026-11-01"],
        ["lte", "due_date", "2026-11-30"],
        ["order", "user_name"],
      ]),
    );
  });
  it("propagates server errors and rejects a response from another unit", async () => {
    const bad = harness(() => ({
      data: null,
      error: { message: "permission denied" },
    }));
    await expect(bad.service.definitions()).rejects.toMatchObject({
      message: "permission denied",
    });
    const foreign = harness(() => ({
      data: { id: "response", unit: "Filial Pau dos Ferros" },
      error: null,
    }));
    await expect(foreign.service.response("response")).rejects.toThrow(
      /outra unidade/,
    );
  });
  it("keeps self evaluation identity on the server and forwards typed arguments unchanged", async () => {
    const h = harness(),
      args = {
        p_unit: "Matriz Caicó",
        p_from: "2026-01-01",
        p_to: "2026-12-31",
        p_offset: 0,
      };
    await h.service.rpc("my_form_evaluations", args);
    expect(h.rpcs).toEqual([{ name: "my_form_evaluations", args }]);
    expect(Object.keys(h.rpcs[0].args as object)).not.toContain("p_user_id");
  });
});
