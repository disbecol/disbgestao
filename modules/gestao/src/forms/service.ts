import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormsContext } from "./types";
import type { FormsDatabase, FormsFunctions } from "./database";
import type {
  ActionPlan,
  FormAssignment,
  FormDefinition,
  FormResponse,
  ScheduleFilter,
} from "./models";

type ServerResult<T> = { data: T | null; error: { message: string } | null };
type PageQuery<Row> = {
  range(from: number, to: number): PromiseLike<ServerResult<Row[]>>;
};
export type ReadyFormsContext = Omit<
  FormsContext,
  "client" | "user" | "profile"
> & {
  client: SupabaseClient<FormsDatabase>;
  user: { id: string };
  profile: NonNullable<FormsContext["profile"]>;
};

export function requireFormsContext(context: FormsContext): ReadyFormsContext {
  if (!context.client || !context.user)
    throw Error("Sua sessão foi encerrada. Entre novamente para continuar.");
  return {
    ...context,
    // The application supplies its existing authenticated client. This assertion
    // adds the types of the existing Forms schema; it never creates another client.
    client: context.client as SupabaseClient<FormsDatabase>,
    user: context.user,
    profile: context.profile ?? { name: "Colaborador", role: "" },
  };
}

async function collectRows<Row>(build: () => PageQuery<Row>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 250) {
    const { data, error } = await build().range(offset, offset + 249);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 250) return rows;
    if (rows.length >= 10000)
      throw Error(
        "O filtro possui mais de 10.000 registros. Reduza o intervalo para consultar e exportar todos os dados.",
      );
  }
}

export function createFormsService(context: () => FormsContext) {
  const current = () => requireFormsContext(context());
  async function rpc<Name extends keyof FormsFunctions>(
    name: Name,
    args: FormsFunctions[Name]["Args"],
  ): Promise<FormsFunctions[Name]["Returns"]> {
    const { data, error } = await current().client.rpc<
      Name,
      FormsFunctions[Name]["Args"]
    >(name, args);
    if (error) throw error;
    // The generated SDK's conditional RPC result cannot retain the correlation
    // between a generic function name and its documented JSON return value.
    return data as unknown as FormsFunctions[Name]["Returns"];
  }
  return {
    rpc,
    async definitions(): Promise<FormDefinition[]> {
      const { client, unit } = current();
      const { data, error } = await client
        .from("form_definitions")
        .select("*")
        .contains("units", [unit])
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    ownResponses(): Promise<FormResponse[]> {
      const { client, unit, user } = current();
      return collectRows(() =>
        client
          .from("form_responses")
          .select("*")
          .eq("unit", unit)
          .eq("respondent_id", user.id)
          .neq("status", "CANCELLED")
          .order("started_at", { ascending: false }),
      );
    },
    reportResponses(filter: {
      from: string;
      until: string;
      form?: string;
      respondent?: string;
    }): Promise<FormResponse[]> {
      const { client, unit } = current();
      return collectRows(() => {
        let query = client
          .from("form_responses")
          .select("*")
          .eq("unit", unit)
          .neq("status", "CANCELLED")
          .gte("started_at", filter.from)
          .lt("started_at", filter.until)
          .order("started_at", { ascending: false })
          .order("id");
        if (filter.form) query = query.eq("form_id", filter.form);
        if (filter.respondent)
          query = query.eq("respondent_id", filter.respondent);
        return query;
      });
    },
    assignments(
      filter: ScheduleFilter,
      orderByPerson = false,
    ): Promise<FormAssignment[]> {
      const { client, unit } = current();
      return collectRows(() => {
        let query = client
          .from("form_assignments")
          .select("*")
          .eq("unit", unit)
          .gte("due_date", filter.from ?? "")
          .lte("due_date", filter.to ?? "")
          .order("due_date");
        if (filter.form) query = query.eq("form_id", filter.form);
        if (filter.person) query = query.eq("user_id", filter.person);
        if (filter.status) query = query.eq("status", filter.status);
        if (orderByPerson) query = query.order("user_name");
        return query;
      });
    },
    async plans(responseIds: string[]): Promise<ActionPlan[]> {
      const { client } = current();
      const rows: ActionPlan[] = [];
      for (let index = 0; index < responseIds.length; index += 100) {
        const ids = responseIds.slice(index, index + 100);
        if (ids.length)
          rows.push(
            ...(await collectRows(() =>
              client
                .from("form_action_plans")
                .select("*")
                .in("response_id", ids)
                .order("created_at"),
            )),
          );
      }
      return rows;
    },
    async responsesByIds(responseIds: string[]): Promise<FormResponse[]> {
      const { client } = current();
      const rows: FormResponse[] = [];
      for (let index = 0; index < responseIds.length; index += 100) {
        const ids = responseIds.slice(index, index + 100);
        if (ids.length)
          rows.push(
            ...(await collectRows(() =>
              client
                .from("form_responses")
                .select("*")
                .in("id", ids)
                .order("started_at"),
            )),
          );
      }
      return rows;
    },
    async plan(
      responseId: string,
      fieldId: string,
    ): Promise<ActionPlan | null> {
      const { data, error } = await current()
        .client.from("form_action_plans")
        .select("*")
        .eq("response_id", responseId)
        .eq("field_id", fieldId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async response(id: string): Promise<FormResponse> {
      const { client, unit } = current();
      const { data, error } = await client
        .from("form_responses")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      if (!data || data.unit !== unit)
        throw Error("Esta aplicação pertence a outra unidade.");
      return data;
    },
  };
}
