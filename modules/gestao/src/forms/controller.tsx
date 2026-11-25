import { Fragment } from "react";
import type { ReactNode } from "react";
import type { PDFPage } from "pdf-lib";
import type { FormsModule, FormsView, ReactFormsAdapter } from "./types";
import type {
  ActionPlan,
  Answer,
  Answers,
  CatalogFilter,
  DefinitionStatus,
  EvaluatedPerson,
  FormAssignment,
  FormBuilder,
  FormDefinition,
  FormField,
  FormPerson,
  FormResponse,
  FormReadRow,
  OwnEvaluation,
  PlanDisplay,
  FormSection,
  ReportFilter,
  ReportTab,
  ScheduleFilter,
  ValidationIssue,
} from "./models";
import type {} from "./core-contract";
import type { Tone } from "../shared/ui";
import { createFormsService, requireFormsContext } from "./service";
import {
  closestElement,
  controlValue,
  isControl,
  isElement,
  isInput,
} from "./dom";
import { jsonClone, readBuilderDraft, readResponseDraft } from "./drafts";
import { oneOf, updateBuilder, updateQuestion } from "./edits";
import { renderContent } from "../shared/react-host";
import {
  rowKey,
  attributeProps,
  styleProps,
  nonEmpty,
  Input,
  TextArea,
  Select,
  Option,
  badge,
  empty,
  field,
  input,
  options,
  btn,
  head,
} from "../shared/ui";

const F = window.DISB_FORMS;
const $ = (id: string) => document.getElementById(id);
const setText = (id: string, text: string) => {
  const element = $(id);
  if (element) element.textContent = text;
};
const STATUS: Record<string, string> = {
  DRAFT: "Rascunho",
  PUBLISHED: "Publicado",
  ARCHIVED: "Arquivado",
  COMPLETED: "Finalizado",
  CANCELLED: "Cancelado",
  PENDING: "Pendente",
  OPEN: "Em aberto",
  DONE: "Concluído",
};
const TYPES = F.FORM_TYPES;
const fmt = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })
    : "—";
const day = (v: string | null | undefined) =>
  v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—";
const pct = (v: number | null | undefined) =>
  v == null
    ? "Sem avaliação"
    : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const tone = (v: number | null | undefined): Tone =>
  v == null ? "neutral" : v >= 90 ? "good" : v >= 70 ? "warn" : "bad";

const errorMessage = (error: unknown) => {
  const message =
    error && typeof error === "object" && "message" in error
      ? error.message
      : error;
  const m = String(message || "Falha na operação.");
  if (/FORM_VERSION_CONFLICT/.test(m))
    return "Este registro foi alterado em outra tela. Atualize antes de salvar; suas alterações locais foram preservadas.";
  if (/FORM_REQUIRED:/.test(m))
    return "Preencha a pergunta: " + m.split("FORM_REQUIRED:")[1];
  if (/FORM_NOK_NOTE_REQUIRED:/.test(m))
    return (
      "Descreva a não conformidade: " + m.split("FORM_NOK_NOTE_REQUIRED:")[1]
    );
  if (/FORM_SCHEDULE_USER_FORBIDDEN/.test(m))
    return "Um dos colaboradores não tem acesso ao formulário ou à unidade. Revise as permissões do modelo.";
  if (/FORBIDDEN|42501|UNIDADE_SEM_ACESSO/.test(m))
    return "Seu acesso a este formulário ou unidade não está disponível. Atualize as permissões e tente novamente.";
  if (/FORM_EVALUATION_REQUIRED/.test(m))
    return "Selecione as pessoas avaliadas antes de preencher.";
  if (/FORM_EVALUATION_LOCKED/.test(m))
    return "Essa aplicação já tem pessoas selecionadas. Continue pelo rascunho existente.";
  if (/FORM_PHOTO|FORM_TOO_MANY_PHOTOS/.test(m))
    return "Confira as fotos: até 5 por resposta e 40 por aplicação, vinculadas a este registro.";
  if (
    /42P01|PGRST202|form_definitions.*(not|exist)|Could not find.*(forms_|form_)/i.test(
      m,
    )
  )
    return "O banco precisa da atualização do módulo Formulários (migrações 79 a 81).";
  if (/Failed to fetch|NetworkError|network|fetch/i.test(m))
    return "Sem conexão com o servidor. O rascunho permanece salvo neste aparelho.";
  return m;
};

function create(adapter: ReactFormsAdapter): FormsModule {
  const service = createFormsService(adapter.context);
  const rpc = service.rpc;
  const listeners: (() => void)[] = [];
  type Events = WindowEventMap & DocumentEventMap;
  const listen = <Type extends keyof Events>(
    target: EventTarget,
    type: Type,
    handler: (event: Events[Type]) => void,
  ) => {
    const listener: EventListener = (event) => handler(event as Events[Type]);
    target.addEventListener(type, listener);
    listeners.push(() => target.removeEventListener(type, listener));
  };
  const ctx = () => requireFormsContext(adapter.context()),
    can = (code: string) => adapter.hasPermission(code),
    notify = (s: string, t = "success") => adapter.toast(s, t);
  let definitions: FormDefinition[] = [],
    people: FormPerson[] = [],
    responses: FormResponse[] = [],
    assignments: FormAssignment[] = [],
    plans: ActionPlan[] = [],
    builder: FormBuilder | null = null,
    editingField = "",
    builderTab = "data",
    selectedForm = "",
    response: FormResponse | null = null,
    answers: Answers = {},
    sectionIndex = 0,
    reportTab: ReportTab = "summary",
    reportPage = 0,
    reportFilter: ReportFilter = {},
    busy = false,
    generation = 0,
    identity = "",
    saveTimer: ReturnType<typeof setTimeout> | undefined,
    saveChain = Promise.resolve(),
    dirty = false,
    clock: ReturnType<typeof setInterval> | undefined,
    lastView: FormsView | "" = "",
    scheduleFormOpen = false,
    loading = false,
    activePerson = "",
    pendingStart: { formId: string; assignmentId: string | null } | null = null,
    catalogFilter: CatalogFilter = {},
    scheduleView = "list",
    calendarMonth = "",
    executionPerson = "",
    uploading = false,
    myEvaluations: OwnEvaluation[] = [],
    myYear = new Date().getFullYear(),
    myForm = "",
    myEvolution = false;
  const rootFor = (view: string) => $(`view-${view}`);
  const currentKey = () =>
    `${adapter.context().user?.id || ""}|${adapter.context().unit || ""}`;
  const localKey = (r: FormResponse) =>
    `disb_forms_response_v1_${adapter.context().user?.id}_${r.id}`;
  const builderKey = () =>
    `disb_forms_builder_v1_${adapter.context().user?.id}_${adapter.context().unit}`;
  function requireBuilder(): FormBuilder {
    if (!builder) throw Error("Abra um formulário para editar.");
    return builder;
  }
  function requireResponse(): FormResponse {
    if (!response) throw Error("Abra uma aplicação para continuar.");
    return response;
  }
  function requireForm(id: string): FormDefinition {
    const form = findForm(id);
    if (!form)
      throw Error("O formulário não está mais disponível. Atualize a tela.");
    return form;
  }
  const findForm = (id: string) => definitions.find((f) => f.id === id);
  const currentPerson = () => ctx().profile;
  const manage = (f: FormDefinition | undefined) =>
    !!f && can("FORMS_MANAGE") && f.units.every((u) => ctx().units.includes(u));
  const fill = (f: FormDefinition | undefined) =>
    !!f &&
    can("FORMS_FILL") &&
    f.status === "PUBLISHED" &&
    (currentPerson().role === "ADMIN" ||
      f.apply_everyone ||
      f.apply_roles?.includes(currentPerson().role) ||
      f.apply_user_ids?.includes(ctx().user.id));
  const report = (f: FormDefinition | undefined) =>
    !!f &&
    can("FORMS_REPORT") &&
    (manage(f) ||
      currentPerson().role === "ADMIN" ||
      f.report_roles?.includes(currentPerson().role) ||
      f.report_user_ids?.includes(ctx().user.id));
  function persist() {
    if (!response) return;
    try {
      localStorage.setItem(
        localKey(response),
        JSON.stringify({
          revision: response.revision,
          answers,
          at: new Date().toISOString(),
        }),
      );
    } catch (_e) {
      notify(
        "Não foi possível guardar o rascunho neste aparelho. Salve no servidor antes de sair.",
        "error",
      );
    }
  }
  function rememberBuilder() {
    if (!builder) return;
    try {
      localStorage.setItem(builderKey(), JSON.stringify(builder));
    } catch (_e) {}
  }
  function paintNav() {
    const nav = $("formsDynamicNav");
    if (nav) renderContent(nav, "");
  }
  async function loadDefinitions() {
    const key = currentKey(),
      token = generation;
    if (!adapter.context().client || !adapter.context().user) return;
    if (!navigator.onLine)
      throw Error(
        "Conecte-se à internet para carregar os formulários da unidade. As respostas já abertas continuam guardadas no aparelho.",
      );
    const data = await service.definitions();
    if (key !== currentKey() || token !== generation) return;
    definitions = data;
    paintNav();
  }
  async function loadPeople() {
    const key = currentKey(),
      data = await rpc("forms_people_with_areas", {});
    if (key === currentKey()) people = data || [];
  }
  async function start() {
    if (identity !== currentKey()) {
      stop();
      identity = currentKey();
    }
    if (
      !can("FORMS_FILL") &&
      !can("FORMS_REPORT") &&
      !can("FORMS_MANAGE") &&
      !can("FORMS_SELF_VIEW")
    ) {
      stop();
      return;
    }
    try {
      await loadDefinitions();
    } catch (e) {
      definitions = [];
      paintNav();
      console.warn("Formulários", errorMessage(e));
    }
  }
  function stop() {
    generation++;
    clearTimeout(saveTimer);
    clearInterval(clock);
    definitions = [];
    people = [];
    responses = [];
    assignments = [];
    plans = [];
    builder = null;
    response = null;
    answers = {};
    selectedForm = "";
    activePerson = "";
    pendingStart = null;
    catalogFilter = {};
    scheduleView = "list";
    calendarMonth = "";
    executionPerson = "";
    myEvaluations = [];
    myYear = new Date().getFullYear();
    myForm = "";
    myEvolution = false;
    uploading = false;
    dirty = false;
    busy = false;
    loading = false;
    identity = "";
    reportFilter = {};
    scheduleFilter = {};
    scheduleFormOpen = false;
    scheduleResults = [];
    detailResponse = null;
    planContext = null;
    paintNav();
    for (const v of [
      "forms-manage",
      "forms-fill",
      "forms-report",
      "forms-schedule",
      "forms-self",
    ])
      if (rootFor(v)) renderContent(rootFor(v), "");
  }
  function canChangeUnit() {
    if (busy || uploading) {
      notify(
        "Aguarde a conclusão da operação antes de trocar de unidade.",
        "error",
      );
      return false;
    }
    if (builder) {
      rememberBuilder();
      if (
        !confirm(
          "Trocar de unidade? O rascunho de criação ficará salvo neste aparelho.",
        )
      )
        return false;
    }
    if (response && response.status === "DRAFT") {
      persist();
      if (
        dirty &&
        !confirm(
          "Trocar de unidade? Há respostas guardadas neste aparelho que ainda precisam ser sincronizadas.",
        )
      )
        return false;
    }
    return true;
  }
  async function enter(view: FormsView) {
    lastView = view;
    if (identity !== currentKey()) await start();
    try {
      if (view === "forms-self") {
        await loadMyEvaluations();
      }
      if (view === "forms-manage") {
        await Promise.all([loadDefinitions(), loadPeople()]);
        renderManage();
      }
      if (view === "forms-fill") {
        if (response) renderResponse();
        else {
          await loadDefinitions();
          await loadOwn();
          renderCatalog();
        }
      }
      if (view === "forms-report") {
        await loadDefinitions();
        await loadReport();
      }
      if (view === "forms-schedule") {
        await Promise.all([loadDefinitions(), loadPeople()]);
        await loadSchedule();
      }
    } catch (e) {
      renderContent(
        rootFor(view),
        <>
          {head(
            "CONFIGURAÇÃO",
            "Formulários",
            "Modelos e aplicações por unidade.",
          )}

          <div className={"notice"} role={"alert"}>
            {errorMessage(e)}
          </div>

          {btn("refresh", "Tentar novamente")}
        </>,
      );
    }
    paintNav();
  }
  function newBuilder(model: FormBuilder | null = null) {
    const section: FormSection = {
      id: F.id(),
      title: "Dados",
      fields: [
        {
          id: F.id(),
          label: "",
          type: "TEXT",
          required: true,
          help: "",
          scored: false,
          expected: "YES",
          allow_na: true,
          require_note: true,
        },
      ],
    };
    builder = model
      ? jsonClone(model)
      : {
          name: "",
          description: "",
          area: "",
          form_type: "CHECKLIST",
          units: [ctx().unit],
          apply_everyone: false,
          apply_roles: [],
          apply_user_ids: [],
          report_roles: ["ADMIN"],
          report_user_ids: [],
          status: "DRAFT",
          schema: {
            evaluation: { enabled: false, area: "", membership: "AREA" },
            sections: [section],
          },
        };
    if (builder.schema.evaluation) {
      delete builder.schema.evaluation.user_ids;
      builder.schema.evaluation.membership = "AREA";
    }
    builderTab = "data";
    editingField = builder.schema.sections[0]?.fields[0]?.id || "";
    adapter.openView("forms-manage", true);
    renderManage();
  }
  function choices(
    name: string,
    items: Array<string | { value: string; label?: string }>,
    selected: string[],
  ) {
    return (
      <div className={"fm-choice-list"}>
        {items.map((item, rowIndex) => (
          <label key={rowKey(item, rowIndex)}>
            <Input
              type={"checkbox"}
              data-fm-list={name}
              value={typeof item === "string" ? item : item.value}
              {...attributeProps(
                selected.includes(typeof item === "string" ? item : item.value)
                  ? "checked"
                  : "",
              )}
            ></Input>
            <span>
              {typeof item === "string" ? item : (item.label ?? item.value)}
            </span>
          </label>
        ))}
      </div>
    );
  }
  function renderManage() {
    const box = rootFor("forms-manage");
    if (!box) return;
    if (!builder) {
      let saved = false;
      try {
        saved = !!localStorage.getItem(builderKey());
      } catch (_e) {}
      renderContent(
        box,
        <>
          {head(
            "CRIAÇÃO",
            "Criar formulários",
            "Monte perguntas, organize seções e escolha quem pode preencher e acompanhar.",
            btn("new", "＋ Novo formulário", {}, "primary"),
          )}
          {saved ? (
            <div className={"fm-resume notice"}>
              <span>{"Há uma criação guardada neste aparelho."}</span>
              {btn("restore-builder", "Retomar criação")}
            </div>
          ) : (
            ""
          )}

          <div className={"fm-model-grid"}>
            {nonEmpty(
              definitions.filter(manage).map((f, rowIndex) => (
                <article key={rowKey(f, rowIndex)} className={"card fm-model"}>
                  <div className={"fm-model-top"}>
                    {badge(
                      STATUS[f.status],
                      f.status === "PUBLISHED" ? "good" : "neutral",
                    )}
                    <small>
                      {"Versão "}
                      {f.version}
                    </small>
                  </div>
                  <h2>{f.name}</h2>
                  <p>{f.description || "Sem descrição."}</p>
                  <div className={"fm-model-meta"}>
                    {f.area}
                    {" · "}
                    {TYPES[f.form_type] || f.form_type}
                    <br></br>
                    {f.units.join(" · ")}
                    <br></br>
                    {F.fields(f.schema).length}
                    {" perguntas · "}
                    {f.schema.sections.length}
                    {" seções"}
                  </div>
                  <div className={"actions"}>
                    {btn("edit", "Editar", { "data-id": f.id })}
                    {btn("preview", "Visualizar", { "data-id": f.id })}
                    {btn("duplicate", "Duplicar", { "data-id": f.id })}
                  </div>
                </article>
              )),
            ) ||
              empty(
                "Crie o primeiro formulário",
                "Ele ficará na lista de formulários disponíveis para os usuários autorizados.",
              )}
          </div>
        </>,
      );
      return;
    }
    renderContent(
      box,
      <>
        {head(
          "CRIAÇÃO",
          builder.id ? "Editar formulário" : "Novo formulário",
          "As aplicações iniciadas preservam a versão original das perguntas.",
          <>
            {btn("close-builder", "Voltar")}
            {btn("save-draft", "Salvar rascunho")}
            {btn(
              "publish",
              builder.status === "PUBLISHED"
                ? "Salvar e publicar"
                : "Publicar formulário",
              {},
              "primary",
            )}
          </>,
        )}

        <div
          className={"fm-tabs"}
          role={"tablist"}
          aria-label={"Etapas de criação"}
        >
          {[
            ["data", "1 · Dados e acessos"],
            ["questions", "2 · Seções e perguntas"],
            ["preview", "3 · Prévia"],
          ].map(([id, label], rowIndex) => (
            <button
              key={rowKey(undefined, rowIndex)}
              type={"button"}
              role={"tab"}
              aria-selected={builderTab === id}
              className={builderTab === id ? "active" : ""}
              data-fm-action={"builder-tab"}
              data-id={id}
            >
              {label}
            </button>
          ))}
        </div>

        <div id={"formsBuilderContent"}>
          {builderTab === "data"
            ? builderData()
            : builderTab === "questions"
              ? builderQuestions()
              : previewHtml(builder)}
        </div>
      </>,
    );
  }
  function builderData() {
    const model = requireBuilder();

    const roles = Object.entries(ctx().roles).map(([value, label]) => ({
        value,
        label,
      })),
      users = people.map((p) => ({
        value: p.id,
        label: `${p.name} · ${ctx().roles[p.role] || p.role}`,
      }));
    return (
      <>
        <div className={"card"}>
          <div className={"fm-card-title"}>
            <span>{"01"}</span>
            <div>
              <h2>{"Identificação"}</h2>
              <p>{"Um nome claro ajuda a equipe a encontrar o formulário."}</p>
            </div>
          </div>
          <div className={"fm-grid"}>
            {field(
              "Nome de exibição *",
              input("name", model.name, {
                maxLength: "200",
                placeholder: "Ex.: Inspeção de veículos",
              }),
              true,
            )}
            {field(
              "Descrição",
              <TextArea
                data-fm-meta={"description"}
                maxLength={350}
                rows={3}
                placeholder={"Explique o objetivo e quando preencher"}
              >
                {model.description}
              </TextArea>,
              true,
            )}
            {field(
              "Área responsável *",
              <>
                {input("area", model.area, {
                  maxLength: "100",
                  list: "formsAreas",
                  placeholder: "Ex.: Logística",
                })}

                <datalist id={"formsAreas"}>
                  {[
                    ...new Set([
                      "Logística",
                      "Armazém",
                      "Vendas",
                      "Segurança do Trabalho",
                      "Administrativo",
                      ...definitions.map((f) => f.area),
                    ]),
                  ].map((a, rowIndex) => (
                    <Option key={rowKey(a, rowIndex)} value={a}></Option>
                  ))}
                </datalist>
              </>,
            )}
            {field(
              "Tipo de formulário *",
              <Select data-fm-meta={"form_type"}>
                {!TYPES[model.form_type] ? (
                  <Option value={model.form_type} selected={true}>
                    {model.form_type}
                    {" · anterior"}
                  </Option>
                ) : (
                  ""
                )}
                {Object.entries(TYPES).map(([id, label], rowIndex) => (
                  <Option
                    key={rowKey(undefined, rowIndex)}
                    value={id}
                    {...attributeProps(
                      id === model.form_type ? "selected" : "",
                    )}
                  >
                    {label}
                  </Option>
                ))}
              </Select>,
            )}
          </div>
        </div>

        <div className={"card"}>
          <div className={"fm-card-title"}>
            <span>{"02"}</span>
            <div>
              <h2>{"Unidades e visibilidade"}</h2>
              <p>{"O acesso respeita as unidades de cada usuário."}</p>
            </div>
          </div>
          {choices("units", ctx().units, model.units)}
          <label className={"fm-toggle"}>
            <Input
              type={"checkbox"}
              data-fm-meta={"apply_everyone"}
              {...attributeProps(model.apply_everyone ? "checked" : "")}
            ></Input>
            <span>
              {"Todos os usuários autorizados destas unidades podem preencher"}
            </span>
          </label>
        </div>

        <div className={"card"}>
          <div className={"fm-card-title"}>
            <span>{"03"}</span>
            <div>
              <h2>{"Permissões"}</h2>
              <p>{"Selecione cargos, pessoas específicas ou ambos."}</p>
            </div>
          </div>
          <div className={"fm-permission-grid"}>
            <section>
              <h3>{"Quem pode preencher"}</h3>
              {model.apply_everyone ? (
                <p className={"notice"}>
                  {
                    "Todos os usuários das unidades selecionadas, com a permissão de preencher formulários."
                  }
                </p>
              ) : (
                <>
                  {choices("apply_roles", roles, model.apply_roles)}

                  <details>
                    <summary>
                      {"Pessoas específicas ("}
                      {model.apply_user_ids.length}
                      {")"}
                    </summary>
                    <Input
                      className={"fm-people-search"}
                      type={"search"}
                      placeholder={"Buscar pessoa"}
                      aria-label={"Buscar pessoas para preencher"}
                    ></Input>
                    {choices("apply_user_ids", users, model.apply_user_ids)}
                  </details>
                </>
              )}
            </section>
            <section>
              <h3>{"Quem pode acompanhar os relatórios"}</h3>
              {choices("report_roles", roles, model.report_roles)}
              <details>
                <summary>
                  {"Pessoas específicas ("}
                  {model.report_user_ids.length}
                  {")"}
                </summary>
                <Input
                  className={"fm-people-search"}
                  type={"search"}
                  placeholder={"Buscar pessoa"}
                  aria-label={"Buscar pessoas para acompanhar"}
                ></Input>
                {choices("report_user_ids", users, model.report_user_ids)}
              </details>
              <p className={"fm-help"}>
                {
                  "Cada participante pode consultar as próprias aplicações. Administradores e gestores autorizados do modelo podem acompanhá-lo."
                }
              </p>
            </section>
          </div>
        </div>

        {evaluationEditor()}

        {model.id ? (
          <div className={"card fm-archive-row"}>
            <div>
              <h3>{"Disponibilidade"}</h3>
              <p>{"Arquivar impede novas aplicações e mantém o histórico."}</p>
            </div>
            <Select
              data-fm-meta={"status"}
              aria-label={"Disponibilidade do formulário"}
            >
              {["DRAFT", "PUBLISHED", "ARCHIVED"].map((s, rowIndex) => (
                <Option
                  key={rowKey(s, rowIndex)}
                  value={s}
                  {...attributeProps(model.status === s ? "selected" : "")}
                >
                  {STATUS[s]}
                </Option>
              ))}
            </Select>
            {btn("save-status", "Salvar disponibilidade")}
          </div>
        ) : (
          ""
        )}
      </>
    );
  }
  function evaluationEditor() {
    const model = requireBuilder();

    const config = model.schema.evaluation || { enabled: false, area: "" },
      members = people.filter((p) =>
        p.units.some((u) => model.units.includes(u)),
      ),
      areas = [
        ...new Set(
          [
            ...members
              .map((p) => p.area)
              .filter((value): value is string => !!value),
            config.area,
          ].filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return (
      <div className={"card"}>
        <div className={"fm-card-title"}>
          <span>{"04"}</span>
          <div>
            <h2>{"Avaliação de colaboradores"}</h2>
            <p>
              {
                "Escolha a área. As pessoas serão selecionadas a cada aplicação."
              }
            </p>
          </div>
        </div>
        <label className={"fm-toggle"}>
          <Input
            type={"checkbox"}
            data-fm-evaluation={"enabled"}
            {...attributeProps(config.enabled ? "checked" : "")}
          ></Input>
          {"Avaliar colaboradores de uma área"}
        </label>
        {config.enabled ? (
          <>
            <div className={"fm-grid"}>
              {field(
                "Área avaliada *",
                <Select data-fm-evaluation={"area"}>
                  {options(areas, config.area, "Selecione a área")}
                </Select>,
                true,
              )}
            </div>
            <p className={"fm-help"}>
              {
                "Ao iniciar o DTO, o sistema mostrará os colaboradores ativos dessa área na unidade escolhida. O aplicador selecionará quem participa daquela avaliação."
              }
            </p>
            <p className={"fm-help"}>
              {
                "A área de cada pessoa pode ser ajustada em Usuários e perfis. Nas perguntas, escolha se a resposta vale para o grupo ou se cada pessoa terá sua própria resposta."
              }
            </p>
          </>
        ) : (
          ""
        )}
      </div>
    );
  }
  function questionEditor(section: FormSection, q: FormField) {
    const model = requireBuilder();

    const open = editingField === q.id,
      canScore = ["BOOLEAN", "SINGLE_CHOICE"].includes(q.type),
      expected =
        q.type === "BOOLEAN"
          ? [
              { value: "YES", label: "Sim" },
              { value: "NO", label: "Não" },
            ]
          : q.options || [];
    return (
      <article
        className={"fm-question-editor " + (open ? "open" : "")}
        data-question={q.id}
      >
        <div className={"fm-question-heading"}>
          <button
            type={"button"}
            data-fm-action={"edit-question"}
            data-id={q.id}
          >
            <span className={"fm-question-dot"}>
              {section.fields.indexOf(q) + 1}
            </span>
            <strong>{q.label || "Nova pergunta"}</strong>
            <small>{F.TYPES[q.type]}</small>
          </button>
          <div className={"fm-icon-actions"}>
            {btn("question-up", "↑", {
              "data-id": q.id,
              "aria-label": "Mover pergunta para cima",
            })}
            {btn("question-down", "↓", {
              "data-id": q.id,
              "aria-label": "Mover pergunta para baixo",
            })}
            {btn("question-copy", "⧉", {
              "data-id": q.id,
              "aria-label": "Duplicar pergunta",
            })}
            {btn("question-remove", "×", {
              "data-id": q.id,
              "aria-label": "Remover pergunta",
            })}
          </div>
        </div>
        {open ? (
          <div className={"fm-question-fields fm-grid"}>
            {field(
              "Pergunta *",
              <TextArea
                rows={2}
                maxLength={500}
                data-fm-q={"label"}
                data-id={q.id}
                placeholder={"O que você precisa verificar?"}
              >
                {q.label}
              </TextArea>,
              true,
            )}
            {model.schema.evaluation?.enabled
              ? field(
                  "Esta resposta vale para",
                  <Select data-fm-q={"scope"} data-id={q.id}>
                    <Option
                      value={"GROUP"}
                      {...attributeProps(
                        (q.scope || "GROUP") === "GROUP" ? "selected" : "",
                      )}
                    >
                      {"Todo o grupo avaliado"}
                    </Option>
                    <Option
                      value={"INDIVIDUAL"}
                      {...attributeProps(
                        q.scope === "INDIVIDUAL" ? "selected" : "",
                      )}
                    >
                      {"Cada pessoa individualmente"}
                    </Option>
                  </Select>,
                )
              : ""}
            {field(
              "Tipo de resposta",
              <Select data-fm-q={"type"} data-id={q.id}>
                {Object.entries(F.TYPES).map(([v, l], rowIndex) => (
                  <Option
                    key={rowKey(undefined, rowIndex)}
                    value={v}
                    {...attributeProps(q.type === v ? "selected" : "")}
                  >
                    {l}
                  </Option>
                ))}
              </Select>,
            )}
            {field(
              "Orientação (opcional)",
              <Input
                maxLength={500}
                data-fm-q={"help"}
                data-id={q.id}
                value={q.help}
                placeholder={"Ajude a pessoa a responder"}
              ></Input>,
            )}
            {q.type.includes("CHOICE")
              ? field(
                  "Opções * · uma por linha",
                  <TextArea
                    rows={4}
                    maxLength={4500}
                    data-fm-q={"options"}
                    data-id={q.id}
                  >
                    {(q.options || []).join("\n")}
                  </TextArea>,
                  true,
                )
              : ""}
            {q.type === "NUMBER" ? (
              <>
                {field(
                  "Valor mínimo",
                  <Input
                    type={"number"}
                    step={"any"}
                    data-fm-q={"min"}
                    data-id={q.id}
                    value={q.min ?? ""}
                  ></Input>,
                )}
                {field(
                  "Valor máximo",
                  <Input
                    type={"number"}
                    step={"any"}
                    data-fm-q={"max"}
                    data-id={q.id}
                    value={q.max ?? ""}
                  ></Input>,
                )}
              </>
            ) : (
              ""
            )}
            <div className={"fm-toggle-grid fm-wide"}>
              <label className={"fm-toggle"}>
                <Input
                  type={"checkbox"}
                  data-fm-q={"required"}
                  data-id={q.id}
                  {...attributeProps(q.required ? "checked" : "")}
                ></Input>
                {"Resposta obrigatória"}
              </label>
              {q.type === "BOOLEAN" ? (
                <label className={"fm-toggle"}>
                  <Input
                    type={"checkbox"}
                    data-fm-q={"allow_na"}
                    data-id={q.id}
                    {...attributeProps(q.allow_na ? "checked" : "")}
                  ></Input>
                  {"Permitir “Não se aplica”"}
                </label>
              ) : (
                ""
              )}
              {canScore ? (
                <label className={"fm-toggle"}>
                  <Input
                    type={"checkbox"}
                    data-fm-q={"scored"}
                    data-id={q.id}
                    {...attributeProps(q.scored ? "checked" : "")}
                  ></Input>
                  {"Impacta a conformidade"}
                </label>
              ) : (
                ""
              )}
            </div>
            {canScore && q.scored ? (
              <>
                {field(
                  "Resposta conforme",
                  <Select data-fm-q={"expected"} data-id={q.id}>
                    {options(expected, q.expected, "Escolha a resposta")}
                  </Select>,
                )}

                <label className={"fm-toggle"}>
                  <Input
                    type={"checkbox"}
                    data-fm-q={"require_note"}
                    data-id={q.id}
                    {...attributeProps(q.require_note ? "checked" : "")}
                  ></Input>
                  {"Exigir observação quando não conforme"}
                </label>
              </>
            ) : (
              ""
            )}
          </div>
        ) : (
          ""
        )}
      </article>
    );
  }
  function builderQuestions() {
    const model = requireBuilder();

    return (
      <>
        {model.schema.sections.map((s, i) => (
          <section key={rowKey(s, i)} className={"card fm-section-editor"}>
            <div className={"fm-section-heading"}>
              <div>
                <small>
                  {"SEÇÃO "}
                  {i + 1}
                </small>
                <Input
                  aria-label={"Título da seção " + (i + 1)}
                  data-fm-section={s.id}
                  maxLength={150}
                  value={s.title}
                ></Input>
              </div>
              <div className={"fm-icon-actions"}>
                {btn("section-up", "↑", {
                  "data-id": s.id,
                  "aria-label": "Mover seção para cima",
                })}
                {btn("section-down", "↓", {
                  "data-id": s.id,
                  "aria-label": "Mover seção para baixo",
                })}
                {btn("section-remove", "Remover seção", { "data-id": s.id })}
              </div>
            </div>
            {s.fields.map((q, rowIndex) => (
              <Fragment key={rowKey(q, rowIndex)}>
                {questionEditor(s, q)}
              </Fragment>
            ))}
            {btn("add-question", "＋ Adicionar pergunta", {
              "data-id": s.id,
            })}
          </section>
        ))}

        <div className={"fm-builder-bottom"}>
          {btn("add-section", "＋ Adicionar seção")}
          <p>{"Você pode reorganizar as seções e perguntas pelas setas."}</p>
          {btn(
            "builder-tab",
            "Ver prévia",
            { "data-id": "preview" },
            "primary",
          )}
        </div>
      </>
    );
  }
  function previewHtml(model: FormBuilder) {
    return (
      <>
        <div className={"notice"}>
          {"Prévia do formulário. Nenhuma aplicação é registrada nesta tela."}
        </div>
        <div className={"card"}>
          <h2>{model.name || "Nome do formulário"}</h2>
          <p>{model.description}</p>
        </div>

        {model.schema.sections.map((s, rowIndex) => (
          <div key={rowKey(s, rowIndex)} className={"card"}>
            <h2>{s.title}</h2>
            {s.fields.map((f, rowIndex) => (
              <div key={rowKey(f, rowIndex)} className={"fm-preview-question"}>
                <strong>{f.label || "Pergunta sem título"}</strong>{" "}
                {f.required ? badge("Obrigatória") : ""}{" "}
                {f.scored ? badge("Impacta conformidade", "warn") : ""}
                <small>
                  {F.TYPES[f.type]}
                  {f.options ? " · " + f.options.join(" / ") : ""}
                </small>
                {f.help ? <p>{f.help}</p> : ""}
                {f.type === "BOOLEAN" ? (
                  <div className={"fm-answer-buttons"}>
                    <span className={"yes"}>{"Sim"}</span>
                    <span className={"no"}>{"Não"}</span>
                    <span className={"na"}>{"N/A"}</span>
                  </div>
                ) : (
                  <div className={"fm-preview-input"}>{"Resposta"}</div>
                )}
              </div>
            ))}
          </div>
        ))}
      </>
    );
  }
  async function saveBuilder(status: DefinitionStatus) {
    if (busy || !builder) return;
    rememberBuilder();
    if (!F.clean(builder.name) || !F.clean(builder.area))
      throw Error("Informe o nome e a área responsável.");
    if (!builder.units.length) throw Error("Selecione ao menos uma unidade.");
    if (
      !builder.apply_everyone &&
      !builder.apply_roles.length &&
      !builder.apply_user_ids.length
    )
      throw Error("Selecione quem pode preencher o formulário.");
    F.validateSchema(builder.schema);
    const editing = builder,
      submitted = jsonClone(builder),
      key = currentKey(),
      storageKey = builderKey();
    busy = true;
    setBusy(true);
    try {
      const saved = await rpc("save_form_definition", {
        p_id: submitted.id || null,
        p_expected_version: submitted.version || 0,
        p_payload: { ...submitted, status },
      });
      if (key !== currentKey() || builder !== editing) return;
      if (JSON.stringify(builder) !== JSON.stringify(submitted)) {
        builder.id = saved.id;
        builder.version = saved.version;
        builder.status = saved.status;
        rememberBuilder();
        await loadDefinitions();
        renderManage();
        notify(
          "Versão salva. As alterações feitas durante o envio continuam guardadas para salvar novamente.",
        );
        return;
      }
      builder = null;
      localStorage.removeItem(storageKey);
      await loadDefinitions();
      renderManage();
      notify(`${saved.name}: ${STATUS[saved.status].toLowerCase()}.`);
    } finally {
      busy = false;
      setBusy(false);
    }
  }
  function setBusy(value: boolean) {
    document
      .querySelectorAll<HTMLButtonElement>(
        '[data-fm-action="publish"],[data-fm-action="save-draft"],[data-fm-action="finish"],[data-fm-action="save-response"]',
      )
      .forEach((b) => (b.disabled = value || uploading));
  }
  async function loadOwn() {
    const key = currentKey(),
      rows = await service.ownResponses();
    if (key === currentKey()) responses = rows;
  }
  function responseRows(rows: FormReadRow[]) {
    return (
      <div className={"fm-table-wrap"}>
        <table className={"fm-table"}>
          <thead>
            <tr>
              <th>{"Registro / formulário"}</th>
              <th>{"Aplicador / pessoas avaliadas"}</th>
              <th>{"Início e fim"}</th>
              <th>{"Duração"}</th>
              <th>{"Resultado"}</th>
              <th>{"Ações"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, rowIndex) => (
              <tr key={rowKey(r, rowIndex)}>
                <td>
                  <strong>{r.form_name}</strong>
                  <small>
                    {r.code}
                    {" · v"}
                    {r.form_version}
                  </small>
                </td>
                <td>
                  {r.respondent_name}
                  <small>
                    {(r.evaluated_people || [])
                      .map((p) => p.name)
                      .join(" · ") || r.unit}
                  </small>
                </td>
                <td>
                  {fmt(r.started_at)}
                  <small>
                    {r.completed_at ? fmt(r.completed_at) : STATUS[r.status]}
                  </small>
                </td>
                <td>{duration(r)}</td>
                <td>
                  {badge(
                    r.status === "COMPLETED" ? pct(r.score) : STATUS[r.status],
                    r.status === "COMPLETED" ? tone(r.score) : "warn",
                  )}
                </td>
                <td>
                  <div className={"actions"}>
                    {r.status === "DRAFT" && r.respondent_id === ctx().user.id
                      ? btn("resume", "Continuar", { "data-id": r.id })
                      : btn("detail", "Ver respostas", { "data-id": r.id })}
                    {r.status === "COMPLETED"
                      ? btn("pdf", "PDF", { "data-id": r.id })
                      : ""}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  function renderCatalog() {
    const box = rootFor("forms-fill"),
      available = definitions.filter(fill),
      mine = responses;
    renderContent(
      box,
      <>
        {head(
          "APLICAR",
          "Preencher formulários",
          "Escolha um formulário ou continue uma aplicação em andamento.",
          <>
            {btn("catalog", "Todos os formulários")}
            {btn("refresh", "Atualizar")}
          </>,
        )}

        <div className={"fm-unit-banner"}>
          <span>{"Unidade de aplicação"}</span>
          <strong>{ctx().unit}</strong>
        </div>
        <div className={"fm-tabs"} role={"tablist"} aria-label={"Aplicações"}>
          <button
            className={"active"}
            type={"button"}
            data-fm-action={"application-tab"}
            data-id={"available"}
          >
            {"Disponíveis ("}
            {available.length}
            {")"}
          </button>
          <button
            type={"button"}
            data-fm-action={"application-tab"}
            data-id={"drafts"}
          >
            {"Em andamento ("}
            {mine.filter((r) => r.status === "DRAFT").length}
            {")"}
          </button>
          <button
            type={"button"}
            data-fm-action={"application-tab"}
            data-id={"completed"}
          >
            {"Finalizados ("}
            {mine.filter((r) => r.status === "COMPLETED").length}
            {")"}
          </button>
        </div>
        <div id={"formsApplicationAvailable"}>
          <div className={"card fm-catalog-filters"}>
            {field(
              "Buscar formulário",
              <Input
                id={"formsCatalogSearch"}
                type={"search"}
                value={catalogFilter.search || ""}
                placeholder={"Nome do formulário"}
              ></Input>,
            )}
            {field(
              "Tipo de formulário",
              <Select data-fm-catalog-filter={"type"}>
                {options(
                  Object.entries(TYPES).map(([value, label]) => ({
                    value,
                    label,
                  })),
                  catalogFilter.type,
                )}
              </Select>,
            )}
            {field(
              "Área",
              <Select data-fm-catalog-filter={"area"}>
                {options(
                  [...new Set(available.map((f) => f.area))].sort(),
                  catalogFilter.area,
                  "Todas",
                )}
              </Select>,
            )}
          </div>
          <div className={"fm-model-grid"} id={"formsAvailableGrid"}>
            {nonEmpty(
              available.map((f, rowIndex) => (
                <article
                  key={rowKey(f, rowIndex)}
                  className={"card fm-model"}
                  data-fm-catalog-key={F.key(f.name + " " + f.area)}
                  data-fm-catalog-type={f.form_type}
                  data-fm-catalog-area={f.area}
                >
                  <div className={"fm-model-top"}>
                    {badge(f.area)}
                    {badge(TYPES[f.form_type] || f.form_type)}
                    <small>
                      {F.fields(f.schema).length}
                      {" perguntas"}
                    </small>
                  </div>
                  <h2>{f.name}</h2>
                  <p>{f.description || TYPES[f.form_type]}</p>
                  <small>
                    {"Versão "}
                    {f.version}
                    {" · "}
                    {f.schema.sections.length}
                    {" seções"}
                  </small>
                  {btn(
                    "start",
                    "▶ Iniciar formulário",
                    { "data-id": f.id },
                    "primary",
                  )}
                </article>
              )),
            ) ||
              empty(
                "Nenhum formulário disponível",
                "Verifique a unidade atual e as permissões do modelo.",
              )}
          </div>
        </div>
        <div id={"formsApplicationDrafts"} className={"hidden"}>
          {mine.some((r) => r.status === "DRAFT")
            ? responseRows(mine.filter((r) => r.status === "DRAFT"))
            : empty("Nenhuma aplicação em andamento")}
        </div>
        <div id={"formsApplicationCompleted"} className={"hidden"}>
          {mine.some((r) => r.status === "COMPLETED")
            ? responseRows(mine.filter((r) => r.status === "COMPLETED"))
            : empty("Nenhum formulário finalizado")}
        </div>
      </>,
    );
    filterCatalog();
  }
  function filterCatalog() {
    for (const card of document.querySelectorAll<HTMLElement>(
      "[data-fm-catalog-key]",
    ))
      card.classList.toggle(
        "hidden",
        !!(
          !(card.dataset.fmCatalogKey || "").includes(
            F.key(catalogFilter.search || ""),
          ) ||
          (catalogFilter.type &&
            card.dataset.fmCatalogType !== catalogFilter.type) ||
          (catalogFilter.area &&
            card.dataset.fmCatalogArea !== catalogFilter.area)
        ),
      );
  }
  function duration(r: Pick<FormResponse, "started_at" | "completed_at">) {
    const seconds = Math.max(
      0,
      Math.floor(
        ((r.completed_at ? new Date(r.completed_at) : new Date()).getTime() -
          new Date(r.started_at).getTime()) /
          1000,
      ),
    );
    return `${Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  }
  async function begin(formId: string, assignmentId: string | null = null) {
    if (busy) return;
    if (!navigator.onLine)
      throw Error(
        "Conecte-se para iniciar uma aplicação. Depois de iniciada, as respostas também ficam guardadas neste aparelho.",
      );
    if (findForm(formId)?.schema.evaluation?.enabled) {
      const key = currentKey(),
        targets = await rpc("forms_evaluation_people", {
          p_form_id: formId,
          p_unit: ctx().unit,
        });
      if (key !== currentKey()) return;
      pendingStart = { formId, assignmentId };
      adapter.modal({
        title: "Quem será avaliado?",
        subtitle: requireForm(formId).schema.evaluation?.area || "",
        html: targets.length ? (
          <>
            <p>
              {
                "Selecione uma ou mais pessoas. Perguntas comuns serão respondidas uma vez; perguntas individuais terão respostas para cada pessoa."
              }
            </p>

            {choices(
              "start_people",
              targets.map((p) => ({
                value: p.id,
                label: p.name + " · " + (ctx().roles[p.role] || p.role),
              })),
              [],
            )}
          </>
        ) : (
          empty(
            "Nenhum colaborador disponível",
            "Confira a área dos colaboradores em Usuários e perfis e as unidades de acesso.",
          )
        ),
        actions: targets.length
          ? btn("start-evaluated", "Iniciar avaliação", {}, "primary")
          : "",
      });
      return;
    }
    const key = currentKey();
    busy = true;
    try {
      const row = await rpc("start_form_response", {
        p_form_id: formId,
        p_unit: ctx().unit,
        p_id: F.id(),
        p_assignment_id: assignmentId,
      });
      if (key !== currentKey()) return;
      await openResponse(row);
    } finally {
      busy = false;
    }
  }
  async function openResponse(row: FormResponse) {
    response = row;
    activePerson = row.evaluated_people?.[0]?.id || "";
    selectedForm = row.form_id;
    answers = jsonClone(row.answers || {});
    sectionIndex = 0;
    dirty = false;
    try {
      const saved = readResponseDraft(localStorage.getItem(localKey(row)));
      if (row.status === "DRAFT" && saved?.revision === row.revision) {
        answers = saved.answers;
        dirty = JSON.stringify(answers) !== JSON.stringify(row.answers);
      } else if (saved && row.status === "DRAFT")
        notify(
          "Há uma cópia local de outra revisão. Foram carregadas as respostas atuais do servidor.",
          "error",
        );
    } catch (error) {
      notify(errorMessage(error), "error");
    }
    adapter.openView("forms-fill", true);
    if (row.status === "COMPLETED") {
      showDetail(row);
      response = null;
      return;
    }
    renderResponse();
    clearInterval(clock);
    clock = setInterval(() => {
      if (response) setText("formsElapsed", duration(response));
    }, 1000);
  }
  function answerBag(id: string, person = activePerson) {
    const rowSnapshot = requireResponse();

    const f = F.fields(rowSnapshot.schema_snapshot).find((f) => f.id === id);
    if (f?.scope === "INDIVIDUAL" && rowSnapshot.evaluated_people?.length) {
      answers.__evaluations ??= {};
      answers.__evaluations[person] ??= {};
      return answers.__evaluations[person];
    }
    return answers;
  }
  function currentAnswers() {
    const rowSnapshot = requireResponse();

    return activePerson
      ? F.evaluationAnswers(rowSnapshot.schema_snapshot, answers, activePerson)
      : answers;
  }

  function photoLinks(answer: Answer | undefined) {
    const photos = answer?.photos || [];
    return photos.length ? (
      <div className={"fm-photo-grid"}>
        {photos.map((path, i) => (
          <a
            key={rowKey(path, i)}
            data-fm-photo={path}
            target={"_blank"}
            rel={"noopener"}
          >
            <img alt={"Foto " + (i + 1)} loading={"lazy"}></img>
            <span>
              {"Abrir foto "}
              {i + 1}
            </span>
          </a>
        ))}
      </div>
    ) : (
      ""
    );
  }
  function photoEditor(field: FormField, answer: Answer) {
    return (
      <div className={"fm-photo-editor"}>
        <div className={"actions"}>
          {btn("photo-camera", "📷 Tirar foto", { "data-id": field.id })}
          {btn("photo-gallery", "Anexar fotos", { "data-id": field.id })}
          <small>
            {(answer.photos || []).length}
            {"/5 fotos"}
          </small>
        </div>
        <Input
          className={"hidden"}
          type={"file"}
          accept={"image/*"}
          capture={"environment"}
          data-fm-photo-input={field.id}
          data-source={"camera"}
        ></Input>
        <Input
          className={"hidden"}
          type={"file"}
          accept={"image/*"}
          multiple={true}
          data-fm-photo-input={field.id}
          data-source={"gallery"}
        ></Input>
        <div className={"fm-photo-grid"}>
          {(answer.photos || []).map((path, i) => (
            <div key={rowKey(path, i)}>
              <a data-fm-photo={path} target={"_blank"} rel={"noopener"}>
                <img alt={"Foto " + (i + 1)}></img>
                <span>
                  {"Abrir foto "}
                  {i + 1}
                </span>
              </a>
              {btn("photo-remove", "Remover do registro", {
                "data-id": field.id,
                "data-path": path,
              })}
            </div>
          ))}
        </div>
        <p className={"fm-help"}>
          {
            "Fotos privadas vinculadas ao registro. É preciso conexão para anexar. Até 40 fotos por aplicação."
          }
        </p>
      </div>
    );
  }
  async function photoOperation<T>(promise: PromiseLike<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Error(
                  "O envio ou carregamento da foto demorou demais. Verifique a conexão e tente novamente.",
                ),
              ),
            30000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function refreshPhotoLinks() {
    const links = [
        ...document.querySelectorAll<HTMLAnchorElement>("[data-fm-photo]"),
      ],
      paths = [
        ...new Set(
          links
            .map((e) => e.dataset.fmPhoto)
            .filter((path): path is string => !!path),
        ),
      ];
    if (!paths.length) return;
    const key = currentKey(),
      { data, error } = await photoOperation(
        ctx().client.storage.from("form-evidence").createSignedUrls(paths, 900),
      );
    if (error) {
      notify(
        "Não foi possível carregar as fotos. Verifique sua conexão.",
        "error",
      );
      return;
    }
    if (key !== currentKey()) return;
    for (const item of data || [])
      for (const link of links.filter(
        (a) => a.dataset.fmPhoto === item.path && a.isConnected,
      )) {
        if (item.signedUrl) {
          link.href = item.signedUrl;
          const image = link.querySelector("img");
          if (image) image.src = item.signedUrl;
        }
      }
  }
  async function compressPhoto(file: File) {
    if (!file.type.startsWith("image/")) throw Error("Selecione uma imagem.");
    if (file.size > 25 * 1024 * 1024)
      throw Error("A imagem deve ter até 25 MB antes da redução.");
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(
          1,
          1600 / Math.max(img.naturalWidth, img.naturalHeight),
        ),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context)
        throw Error("Não foi possível preparar essa foto neste aparelho.");
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      if (!blob || blob.size > 5 * 1024 * 1024)
        throw Error("Não foi possível preparar essa foto. Tente outra imagem.");
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function addPhotos(id: string, files: File[], person = activePerson) {
    if (uploading || busy) throw Error("Aguarde a operação atual.");
    if (!response || response.status !== "DRAFT") return;
    if (!navigator.onLine)
      throw Error(
        "Conecte-se para anexar fotos. Suas respostas continuam guardadas neste aparelho.",
      );
    const bag = answerBag(id, person),
      entry = (bag[id] ??= {}),
      row = response,
      key = currentKey(),
      field = F.fields(row.schema_snapshot).find((f) => f.id === id);
    if (!field) throw Error("Esta pergunta não está mais disponível.");
    if (
      (entry.photos || []).length + files.length > 5 ||
      F.evidencePaths(answers).length + files.length > 40
    )
      throw Error("Adicione até 5 fotos por resposta e 40 por aplicação.");
    uploading = true;
    setBusy(true);
    try {
      for (const file of files) {
        const blob = await compressPhoto(file),
          path = `${ctx().user.id}/${row.id}/${F.id()}.jpg`,
          { error } = await photoOperation(
            ctx()
              .client.storage.from("form-evidence")
              .upload(path, blob, { contentType: "image/jpeg", upsert: false }),
          );
        if (error) throw error;
        if (key !== currentKey() || response?.id !== row.id) return;
        const current = (answerBag(id, person)[id] ??= {});
        current.photos ??= [];
        current.photos.push(path);
        if (field.type === "PHOTO") current.value = [...current.photos];
        answerChanged();
      }
      notify("Fotos anexadas.");
    } finally {
      uploading = false;
      setBusy(false);
      if (key === currentKey() && response?.id === row.id) renderResponse();
    }
  }

  function answerControl(f: FormField, a: Answer) {
    const v = a?.value;
    if (f.type === "PHOTO")
      return (
        <p className={"fm-help"}>{"Adicione uma ou mais fotos abaixo."}</p>
      );
    if (f.type === "BOOLEAN")
      return (
        <div
          className={"fm-answer-buttons"}
          role={"radiogroup"}
          aria-label={f.label}
        >
          {[
            ["YES", "Sim", f.scored && f.expected === "NO" ? "no" : "yes"],
            ["NO", "Não", f.scored && f.expected === "NO" ? "yes" : "no"],
            ...(f.allow_na ? [["NA", "N/A", "na"]] : []),
          ].map(([value, label, kind], rowIndex) => (
            <button
              key={rowKey(undefined, rowIndex)}
              type={"button"}
              role={"radio"}
              aria-checked={v === value}
              className={kind + " " + (v === value ? "selected" : "")}
              data-fm-action={"answer"}
              data-id={f.id}
              data-value={value}
            >
              {label}
            </button>
          ))}
        </div>
      );
    if (f.type === "SINGLE_CHOICE")
      return (
        <Select data-fm-answer={f.id} aria-label={f.label}>
          {options(
            f.options || [],
            typeof v === "string" || typeof v === "number" ? v : undefined,
            "Selecione uma opção",
          )}
        </Select>
      );
    if (f.type === "MULTIPLE_CHOICE")
      return (
        <div className={"fm-multiple-options"}>
          {(f.options || []).map((option, rowIndex) => (
            <label key={rowKey(option, rowIndex)}>
              <Input
                type={"checkbox"}
                data-fm-multiple={f.id}
                value={option}
                {...attributeProps(
                  Array.isArray(v) && v.includes(option) ? "checked" : "",
                )}
              ></Input>
              {option}
            </label>
          ))}
        </div>
      );
    if (f.type === "LONG_TEXT")
      return (
        <TextArea
          rows={4}
          maxLength={4000}
          data-fm-answer={f.id}
          aria-label={f.label}
          placeholder={"Digite a resposta"}
        >
          {v ?? ""}
        </TextArea>
      );
    return (
      <Input
        type={
          f.type === "NUMBER" ? "number" : f.type === "DATE" ? "date" : "text"
        }
        {...attributeProps(
          f.type === "NUMBER"
            ? `step="any" ${f.min != null ? `min="${Number(f.min)}"` : ""} ${f.max != null ? `max="${Number(f.max)}"` : ""}`
            : 'maxlength="500"',
        )}
        data-fm-answer={f.id}
        aria-label={f.label}
        value={v ?? ""}
        placeholder={"Digite a resposta"}
      ></Input>
    );
  }
  function answerPart(f: FormField, person: EvaluatedPerson | null = null) {
    const rowSnapshot = requireResponse();

    const pid = person?.id || "",
      a =
        (person
          ? F.evaluationAnswers(rowSnapshot.schema_snapshot, answers, pid)
          : answers)[f.id] || {},
      negative = F.outcome(f, a) === "NOK",
      key = f.id + (pid ? "-" + pid : "");
    return (
      <div
        id={"fm-answer-" + key}
        className={"fm-person-answer " + (negative ? "has-nok" : "")}
        data-fm-person={pid}
        role={"group"}
        aria-label={person ? person.name + " · " + f.label : f.label}
      >
        {person ? (
          <div className={"fm-evaluated-person-name"}>
            <strong>{person.name}</strong>
            {!F.empty(a.value)
              ? badge(
                  negative
                    ? "NOK"
                    : F.outcome(f, a) === "NA"
                      ? "N/A"
                      : f.scored
                        ? "OK"
                        : "Respondido",
                  negative ? "bad" : F.outcome(f, a) === "NA" ? "warn" : "good",
                )
              : badge("Pendente")}
          </div>
        ) : (
          ""
        )}
        {answerControl(f, a)}
        {f.type === "PHOTO" || negative || (a.photos || []).length
          ? photoEditor(f, a)
          : ""}
        <div className={"fm-answer-tools"}>
          <button type={"button"} data-fm-action={"toggle-note"} data-id={f.id}>
            {"▤ Observação"}
            {negative && f.require_note ? " *" : ""}
          </button>
          <button
            type={"button"}
            data-fm-action={"toggle-plan"}
            data-id={f.id}
            {...attributeProps(negative ? "" : 'class="hidden"')}
          >
            {"＋ Plano de ação"}
          </button>
        </div>
        <div
          data-fm-note-box={f.id}
          className={negative || a.observation ? "" : "hidden"}
        >
          <label className={"fm-help"} htmlFor={"fm-note-" + key}>
            {negative ? "Descreva o problema" : "Observação"}
          </label>
          <TextArea
            id={"fm-note-" + key}
            rows={3}
            maxLength={2000}
            data-fm-note={f.id}
            placeholder={"Descreva o que foi observado"}
          >
            {a.observation || ""}
          </TextArea>
        </div>
        <div
          data-fm-plan-box={f.id}
          className={negative && a.plan ? "" : "hidden"}
        >
          <label className={"fm-help"} htmlFor={"fm-plan-" + key}>
            {"Plano de ação inicial · opcional"}
          </label>
          <TextArea
            id={"fm-plan-" + key}
            rows={3}
            maxLength={2000}
            data-fm-plan={f.id}
            placeholder={"O que será feito para corrigir?"}
          >
            {a.plan || ""}
          </TextArea>
        </div>
      </div>
    );
  }
  function renderResponse() {
    if (!response) return;
    const schema = response.schema_snapshot,
      section = schema.sections[sectionIndex],
      score = F.score(schema, answers),
      progress = requiredProgress(),
      people = response.evaluated_people || [],
      allAnswers = people.length
        ? people.map((p) => F.evaluationAnswers(schema, answers, p.id))
        : [answers];
    renderContent(
      rootFor("forms-fill"),
      <>
        {head(
          "APLICAÇÃO",
          response.form_name,
          `${response.code} · ${response.unit} · Aplicador: ${response.respondent_name}`,
          btn("back-catalog", "Voltar aos formulários"),
        )}

        <div className={"card fm-application-bar"}>
          <div>
            <strong id={"formsProgress"}>
              {progress.answered}
              {" de "}
              {progress.total}
              {" obrigatórias respondidas"}
            </strong>
            <div className={"fm-progress"}>
              <i
                style={styleProps(
                  "width:" +
                    (progress.total
                      ? (progress.answered / progress.total) * 100
                      : 100) +
                    "%",
                )}
              ></i>
            </div>
          </div>
          <div className={"fm-application-timer"}>
            <span>{"Tempo de aplicação"}</span>
            <strong id={"formsElapsed"}>{duration(response)}</strong>
          </div>
          <div id={"formsLiveScore"}>
            {badge(pct(score.percent), tone(score.percent))}
          </div>
        </div>

        {people.length ? (
          <div className={"card fm-evaluated-bar"}>
            <strong>
              {"Área avaliada: "}
              {schema.evaluation?.area}
            </strong>
            <p>
              {
                "Cada pergunta individual tem respostas separadas por pessoa. As perguntas de grupo valem para todos."
              }
            </p>
            <div className={"fm-evaluated-names"}>
              {people.map((p) => badge(p.name, "brand"))}
            </div>
          </div>
        ) : (
          ""
        )}

        <div
          className={"fm-tabs fm-section-tabs"}
          role={"tablist"}
          aria-label={"Seções do formulário"}
        >
          {schema.sections.map((s, i) => (
            <button
              key={rowKey(s, i)}
              type={"button"}
              role={"tab"}
              aria-selected={i === sectionIndex}
              className={i === sectionIndex ? "active" : ""}
              data-fm-action={"section"}
              data-id={i}
            >
              {s.title}
              <small>
                {
                  s.fields.filter((f) =>
                    allAnswers.every((a) => !F.empty(a[f.id]?.value)),
                  ).length
                }
                {"/"}
                {s.fields.length}
              </small>
            </button>
          ))}
        </div>
        <div
          id={"formsAnswerErrors"}
          className={"notice hidden"}
          role={"alert"}
        ></div>
        <div className={"fm-response-questions"}>
          {section.fields.map((f, rowIndex) => (
            <article
              key={rowKey(f, rowIndex)}
              className={"card fm-answer-card"}
            >
              <div className={"fm-answer-title"}>
                <strong>{f.label}</strong>
                <div>
                  {f.required ? badge("Obrigatória", "bad") : badge("Opcional")}
                  {f.scored ? badge("Impacta conformidade", "warn") : ""}
                  {people.length
                    ? badge(
                        f.scope === "INDIVIDUAL"
                          ? "Uma resposta por pessoa"
                          : "Todo o grupo",
                        "brand",
                      )
                    : ""}
                </div>
              </div>
              {f.help ? <p className={"fm-help"}>{f.help}</p> : ""}
              {f.scope === "INDIVIDUAL" && people.length
                ? people.map((p, rowIndex) => (
                    <Fragment key={rowKey(p, rowIndex)}>
                      {answerPart(f, p)}
                    </Fragment>
                  ))
                : answerPart(f)}
            </article>
          ))}
          <div className={"card"}>
            <label className={"fm-help"} htmlFor={"formsSectionNote"}>
              {"Observações desta seção · opcional"}
            </label>
            <TextArea
              id={"formsSectionNote"}
              data-fm-section-note={section.id}
              rows={3}
              maxLength={2000}
              placeholder={"Informações adicionais sobre esta seção"}
            >
              {answers.__sections?.[section.id] || ""}
            </TextArea>
          </div>
        </div>
        <div className={"fm-fill-footer"}>
          <div>
            <strong id={"formsSaveStatus"}>
              {dirty
                ? "Alterações guardadas neste aparelho"
                : "Rascunho salvo no servidor"}
            </strong>
            <small>
              {navigator.onLine
                ? "As respostas são salvas automaticamente."
                : "Sem internet. Conecte-se para sincronizar e finalizar."}
            </small>
          </div>
          <div className={"actions"}>
            {btn("discard", "Descartar rascunho")}
            {btn("save-response", "Salvar agora")}
            {sectionIndex ? btn("previous-section", "← Anterior") : ""}
            {sectionIndex < schema.sections.length - 1
              ? btn("next-section", "Próxima →", {}, "primary")
              : btn("finish", "Finalizar formulário", {}, "primary")}
          </div>
        </div>
      </>,
    );
    paintNav();
    void refreshPhotoLinks().catch((e) => notify(errorMessage(e), "error"));
  }
  function answerChanged() {
    dirty = true;
    persist();
    setText("formsSaveStatus", "Alterações guardadas neste aparelho");
    clearTimeout(saveTimer);
    if (navigator.onLine)
      saveTimer = setTimeout(
        () =>
          saveResponse(false).catch((e) => {
            setText("formsSaveStatus", errorMessage(e));
          }),
        1000,
      );
    updateProgress();
  }
  function requiredProgress() {
    const rowSnapshot = requireResponse();

    const rows = rowSnapshot.evaluated_people?.length
        ? rowSnapshot.evaluated_people.map((p) =>
            F.evaluationAnswers(rowSnapshot.schema_snapshot, answers, p.id),
          )
        : [answers],
      required = F.fields(rowSnapshot.schema_snapshot).filter(
        (f) => f.required,
      );
    return {
      total: rows.length * required.length,
      answered: rows.reduce(
        (n, a) => n + required.filter((f) => !F.empty(a[f.id]?.value)).length,
        0,
      ),
    };
  }
  function updateProgress() {
    if (!response) return;
    const s = F.score(response.schema_snapshot, answers),
      p = requiredProgress();
    setText(
      "formsProgress",
      `${p.answered} de ${p.total} obrigatórias respondidas`,
    );
    const bar = document.querySelector<HTMLElement>(
      ".fm-application-bar .fm-progress i",
    );
    if (bar)
      bar.style.width = `${p.total ? (p.answered / p.total) * 100 : 100}%`;
    if ($("formsLiveScore"))
      renderContent(
        $("formsLiveScore"),
        badge(pct(s.percent), tone(s.percent)),
      );
  }
  async function saveResponse(finalize: boolean) {
    clearTimeout(saveTimer);
    const expectedId = response?.id,
      expectedContext = currentKey();
    const operation = async () => {
      if (response?.id !== expectedId || currentKey() !== expectedContext)
        return;
      if (!response || response.status !== "DRAFT") return;
      if (finalize && uploading)
        throw Error("Aguarde o envio das fotos antes de finalizar.");
      if (!navigator.onLine) {
        persist();
        if (finalize)
          throw Error(
            "Conecte-se à internet para sincronizar as respostas e finalizar.",
          );
        return;
      }
      const check = F.validateResponse(
        response.schema_snapshot,
        answers,
        response.evaluated_people,
        finalize,
      );
      if (check.errors.length) {
        showAnswerErrors(check.errors);
        throw Error(check.errors[0].message);
      }
      const row = response,
        submitted = jsonClone(answers),
        key = currentKey();
      setBusy(true);
      try {
        const saved = await rpc("save_form_response", {
          p_id: row.id,
          p_expected_revision: row.revision,
          p_answers: submitted,
          p_finalize: finalize,
        });
        if (key !== currentKey() || response?.id !== row.id) return;
        response = saved;
        dirty = JSON.stringify(answers) !== JSON.stringify(submitted);
        if (!dirty) answers = jsonClone(saved.answers || {});
        persist();
        setText(
          "formsSaveStatus",
          dirty ? "Salvando novas alterações…" : "Rascunho salvo no servidor",
        );
        if (finalize) {
          localStorage.removeItem(localKey(saved));
          response = null;
          answers = {};
          dirty = false;
          clearInterval(clock);
          await loadOwn();
          renderCatalog();
          showDetail(saved);
          notify(
            "Formulário finalizado. Resultado registrado no acompanhamento.",
          );
        }
      } finally {
        setBusy(false);
      }
    };
    saveChain = saveChain.catch(() => {}).then(operation);
    return saveChain;
  }
  function showAnswerErrors(errors: ValidationIssue[]) {
    const rowSnapshot = requireResponse();

    if (errors[0].person) activePerson = errors[0].person;
    const index = rowSnapshot.schema_snapshot.sections.findIndex((s) =>
      s.fields.some((f) => f.id === errors[0].id),
    );
    if (index >= 0) sectionIndex = index;
    renderResponse();
    const box = $("formsAnswerErrors");
    if (box) {
      box.classList.remove("hidden");
      box.textContent = errors.map((e) => e.message).join(" ");
    }
    $(
      `fm-answer-${errors[0].id}${errors[0].person ? "-" + errors[0].person : ""}`,
    )?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // Relatórios, agendas e eventos são definidos abaixo para compartilhar o mesmo escopo.
  function filterDates() {
    const today = F.localDay(new Date()),
      year = Number(reportFilter.year || today.slice(0, 4)),
      annual = ["execution", "charts", "conformity"].includes(reportTab);
    return {
      from: annual
        ? `${year}-01-01`
        : reportFilter.from || today.slice(0, 7) + "-01",
      to: annual ? `${year}-12-31` : reportFilter.to || today,
      year,
    };
  }

  function myRows() {
    return myEvaluations.filter((r) => !myForm || r.form_id === myForm);
  }
  async function loadMyEvaluations() {
    if (!can("FORMS_SELF_VIEW")) throw Error("FORBIDDEN");
    if (!Number.isInteger(myYear) || myYear < 2020 || myYear > 2100)
      throw Error("Informe um ano entre 2020 e 2100.");
    const key = currentKey(),
      token = ++generation,
      rows = [],
      year = myYear;
    loading = true;
    renderMyEvaluations();
    try {
      for (let offset = 0; offset < 10000; offset += 250) {
        const data = await rpc("my_form_evaluations", {
          p_unit: ctx().unit,
          p_from: year + "-01-01",
          p_to: year + "-12-31",
          p_offset: offset,
        });
        if (key !== currentKey() || token !== generation) return;
        rows.push(...(data || []));
        if (!data || data.length < 250) break;
        if (offset === 9750)
          throw Error(
            "Há mais de 10.000 avaliações neste ano. Solicite ao administrador uma consulta por período.",
          );
      }
      myEvaluations = rows;
    } finally {
      if (key === currentKey() && token === generation) {
        loading = false;
        renderMyEvaluations();
      }
    }
  }
  function selfPlanHtml(row: FormReadRow, f: FormField) {
    const key = F.planField(f, row.evaluated_user_id),
      p = row.own_plans?.find((p) => p.field_id === key);
    return p ? (
      <div className={"fm-self-plan"}>
        <strong>
          {"Plano de ação · "}
          {p.status === "DONE" ? "Concluído" : "Em aberto"}
        </strong>
        <p>{p.description}</p>
        <small>
          {p.responsible_name}
          {p.due_date ? " · Prazo: " + day(p.due_date) : ""}
        </small>
        {p.completion_note ? <p>{p.completion_note}</p> : ""}
      </div>
    ) : (
      ""
    );
  }
  function renderMyEvaluations() {
    const box = rootFor("forms-self");
    if (!box) return;
    const rows = myRows(),
      models = [
        ...new Map(
          myEvaluations.map((r) => [
            r.form_id,
            { value: r.form_id, label: r.form_name },
          ]),
        ).values(),
      ].sort((a, b) => a.label.localeCompare(b.label));
    renderContent(
      box,
      <>
        {head(
          "MEUS RESULTADOS",
          myEvolution ? "Minha evolução por pergunta" : "Minhas avaliações",
          `${ctx().profile?.name || "Colaborador"} · ${ctx().unit} · ${myYear}`,
          myEvolution
            ? btn("self-back", "← Voltar às avaliações")
            : btn("self-export", "Baixar meus resultados"),
        )}
        {myEvolution ? (
          ""
        ) : (
          <div className={"card"}>
            <div className={"fm-self-filters"}>
              {field(
                "Ano",
                <Input
                  type={"number"}
                  min={"2020"}
                  max={"2100"}
                  data-fm-self-filter={"year"}
                  value={myYear}
                ></Input>,
              )}
              {field(
                "Formulário",
                <Select data-fm-self-filter={"form"}>
                  {options(models, myForm)}
                </Select>,
              )}
              {btn("self-filter", "Consultar", {}, "primary")}
            </div>
            <p className={"fm-help"}>
              {
                "Aqui aparecem as avaliações finalizadas em que você foi avaliado. As respostas de grupo também fazem parte do seu resultado. N/A não reduz sua aderência."
              }
            </p>
          </div>
        )}

        {loading ? (
          <div className={"card"} role={"status"}>
            {"Carregando suas avaliações…"}
          </div>
        ) : (
          <>
            {metrics(rows, "Minhas avaliações")}
            {myEvolution ? (
              personEvolutionHtml(rows, ctx().user.id, myYear)
            ) : (
              <>
                <div className={"fm-self-section-head"}>
                  <h2>{"Meu histórico"}</h2>
                  {btn("self-evolution", "Ver evolução por pergunta")}
                </div>
                <div className={"fm-self-grid"}>
                  {nonEmpty(
                    rows.map((r, rowIndex) => (
                      <article
                        key={rowKey(r, rowIndex)}
                        className={"card fm-self-result"}
                      >
                        <div className={"fm-model-top"}>
                          <small>{r.code}</small>
                          {badge(pct(r.score), tone(r.score))}
                        </div>
                        <h2>{r.form_name}</h2>
                        <p>
                          {r.evaluated_area}
                          {" · "}
                          {fmt(r.completed_at)}
                        </p>
                        <div className={"fm-self-counts"}>
                          <span className={"good"}>
                            <strong>{r.ok_count}</strong>
                            {" OK"}
                          </span>
                          <span className={"bad"}>
                            <strong>{r.nok_count}</strong>
                            {" NOK"}
                          </span>
                          <span className={"warn"}>
                            <strong>{r.na_count}</strong>
                            {" N/A"}
                          </span>
                        </div>
                        <small>
                          {"Aplicado por "}
                          {r.respondent_name}
                        </small>
                        <div className={"actions"}>
                          {btn(
                            "self-detail",
                            "Ver minha avaliação",
                            { "data-id": r.id },
                            "primary",
                          )}
                          {btn("self-pdf", "PDF", { "data-id": r.id })}
                        </div>
                      </article>
                    )),
                  ) ||
                    empty(
                      "Você ainda não tem avaliações neste filtro",
                      "As avaliações aparecerão aqui depois que forem finalizadas pelo aplicador.",
                    )}
                </div>
              </>
            )}
          </>
        )}
      </>,
    );
  }
  function dayEnd(value: string) {
    const d = new Date(value + "T00:00:00-03:00");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }
  async function loadPlans(rows: FormReadRow[]) {
    return service.plans(rows.map((row) => row.id));
  }
  async function loadReport() {
    const key = currentKey(),
      token = ++generation,
      dates = filterDates();
    if (dates.from > dates.to)
      throw Error("A data inicial deve ser anterior à final.");
    loading = true;
    renderReport();
    try {
      const rows = await service.reportResponses({
        from: dates.from + "T00:00:00-03:00",
        until: dayEnd(dates.to),
        form: reportFilter.form,
        respondent: reportTab !== "execution" ? reportFilter.person : undefined,
      });
      const [p, a] = await Promise.all([
        loadPlans(rows),
        service.assignments({
          from: dates.from,
          to: dates.to,
          form: reportFilter.form,
          person: reportFilter.person,
        }),
      ]);
      if (key !== currentKey() || token !== generation) return;
      responses = rows;
      plans = p;
      assignments = a;
      if (!people.length) await loadPeople();
    } finally {
      if (key === currentKey() && token === generation) {
        loading = false;
        renderReport();
      }
    }
  }
  function reportRowsFiltered() {
    return responses.filter(
      (r) =>
        (!reportFilter.area ||
          r.form_area === reportFilter.area ||
          (reportTab === "execution" &&
            r.schema_snapshot.evaluation?.area === reportFilter.area)) &&
        (!reportFilter.type ||
          findForm(r.form_id)?.form_type === reportFilter.type) &&
        (!reportFilter.search ||
          F.key(r.form_name).includes(F.key(reportFilter.search))),
    );
  }
  function metric(
    label: string,
    value: ReactNode,
    kind: Tone = "neutral",
    detail: ReactNode = "",
  ) {
    return (
      <article className={"fm-metric " + kind}>
        <small>{label}</small>
        <strong>{value}</strong>
        {detail ? <span>{detail}</span> : ""}
      </article>
    );
  }
  function metrics(rows: FormReadRow[], label = "") {
    const s = F.summarize(rows);
    return (
      <div className={"fm-metrics"}>
        {metric(
          "Conformidade",
          pct(s.percent),
          tone(s.percent),
          "N/A fora do cálculo",
        )}
        {metric(
          label ||
            (reportTab === "execution"
              ? "Avaliações concluídas"
              : "Aplicações finalizadas"),
          s.completed,
          "brand",
        )}
        {metric("Itens conformes", s.ok, "good")}
        {metric("Itens não conformes", s.nok, "bad")}
        {metric("Não se aplica", s.na, "warn")}
      </div>
    );
  }
  function renderReport() {
    const box = rootFor("forms-report");
    if (!box) return;
    const dates = filterDates(),
      tabs = [
        ["summary", "Acompanhamento"],
        ["applications", "Aplicações / detalhado"],
        ["execution", "Controle de execução"],
        ["farol", "Farol"],
        ["charts", "Gráficos"],
        ["conformity", "Mapa de conformidades"],
        ["issues", "Inconsistências"],
      ],
      rows = reportRowsFiltered(),
      annual = ["execution", "charts", "conformity"].includes(reportTab);
    if (reportTab === "execution" && executionPerson) {
      const rowsForPerson = F.assessmentRows(rows).filter(
          (r) => r.evaluated_user_id === executionPerson,
        ),
        name =
          rowsForPerson[0]?.evaluated_name ||
          people.find((p) => p.id === executionPerson)?.name ||
          "Colaborador";
      renderContent(
        box,
        <>
          {head(
            "EVOLUÇÃO INDIVIDUAL",
            "Evolução por pergunta",
            `${name} · ${ctx().unit} · ${dates.year}`,
            btn("close-evolution", "← Voltar ao controle de execução"),
          )}
          {metrics(rowsForPerson)}

          {personEvolutionHtml(rows, executionPerson, dates.year)}
        </>,
      );
      return;
    }
    renderContent(
      box,
      <>
        {head(
          "RELATÓRIOS",
          "Acompanhamento",
          "Aplicações, resultados e planos de ação da unidade atual.",
          <>
            {btn("export-csv", "Baixar CSV")}
            {btn("export-xlsx", "Baixar Excel", {}, "primary")}
          </>,
        )}

        <div className={"card fm-filter-card"}>
          <div className={"fm-report-filters"}>
            {field(
              "Unidade",
              <Input value={ctx().unit} readOnly={true}></Input>,
            )}
            {field(
              "Formulário",
              <Select data-fm-filter={"form"}>
                {options(
                  definitions.map((f) => ({
                    value: f.id,
                    label: f.name,
                  })),
                  reportFilter.form,
                )}
              </Select>,
            )}
            {field(
              reportTab === "execution" ? "Pessoa avaliada" : "Aplicador",
              <Select data-fm-filter={"person"}>
                {options(
                  people
                    .filter((p) => p.units.includes(ctx().unit))
                    .map((p) => ({ value: p.id, label: p.name })),
                  reportFilter.person,
                )}
              </Select>,
            )}
            {field(
              "Área",
              <Select data-fm-filter={"area"}>
                {options(
                  [
                    ...new Set(
                      definitions.flatMap((f) =>
                        [f.area, f.schema.evaluation?.area].filter(
                          (value): value is string => !!value,
                        ),
                      ),
                    ),
                  ].sort(),
                  reportFilter.area,
                  "Todas",
                )}
              </Select>,
            )}
            {field(
              "Tipo",
              <Select data-fm-filter={"type"}>
                {options(
                  Object.entries(TYPES).map(([value, label]) => ({
                    value,
                    label,
                  })),
                  reportFilter.type,
                )}
              </Select>,
            )}
            {annual ? (
              field(
                "Ano",
                <Input
                  data-fm-filter={"year"}
                  type={"number"}
                  min={"2020"}
                  max={"2100"}
                  value={dates.year}
                ></Input>,
              )
            ) : (
              <>
                {field(
                  "Início das aplicações · de",
                  <Input
                    data-fm-filter={"from"}
                    type={"date"}
                    value={dates.from}
                  ></Input>,
                )}
                {field(
                  "Até",
                  <Input
                    data-fm-filter={"to"}
                    type={"date"}
                    value={dates.to}
                  ></Input>,
                )}
              </>
            )}
            {btn("filter", "Filtrar", {}, "primary")}
          </div>
          <p className={"fm-help"}>
            {
              "Os resultados respeitam os acessos de cada formulário. As próprias aplicações também ficam disponíveis aqui."
            }
          </p>
        </div>

        <div
          className={"fm-tabs fm-report-tabs"}
          role={"tablist"}
          aria-label={"Visões de acompanhamento"}
        >
          {tabs.map(([id, label], rowIndex) => (
            <button
              key={rowKey(undefined, rowIndex)}
              type={"button"}
              role={"tab"}
              aria-selected={reportTab === id}
              className={reportTab === id ? "active" : ""}
              data-fm-action={"report-tab"}
              data-id={id}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className={"card"} role={"status"}>
            {"Carregando aplicações…"}
          </div>
        ) : (
          <>
            {metrics(
              reportTab === "execution"
                ? F.assessmentRows(rows).filter(
                    (r) =>
                      r.evaluated_user_id &&
                      (!reportFilter.person ||
                        r.evaluated_user_id === reportFilter.person),
                  )
                : rows,
            )}

            <div id={"formsReportBody"}>
              {reportTab === "summary"
                ? summaryHtml(rows)
                : reportTab === "applications"
                  ? applicationsHtml(rows)
                  : reportTab === "execution"
                    ? executionHtml(rows, dates.year)
                    : reportTab === "farol"
                      ? farolHtml(rows)
                      : reportTab === "charts"
                        ? chartsHtml(rows, dates.year)
                        : reportTab === "conformity"
                          ? conformityHtml(rows, dates.year)
                          : issuesHtml(rows)}
            </div>
          </>
        )}
      </>,
    );
  }
  function groupForms(rows: FormReadRow[]) {
    const map = new Map<
      string,
      { id: string; name: string; area?: string; rows: FormReadRow[] }
    >();
    for (const r of rows) {
      if (!map.has(r.form_id))
        map.set(r.form_id, {
          id: r.form_id,
          name: r.form_name,
          area: r.form_area,
          rows: [],
        });
      map.get(r.form_id)?.rows.push(r);
    }
    return [...map.values()].sort((a, b) => b.rows.length - a.rows.length);
  }
  function summaryHtml(rows: FormReadRow[]) {
    const groups = groupForms(rows);
    return (
      <div className={"card"}>
        <div className={"fm-card-title"}>
          <div>
            <h2>{"Resultados por formulário"}</h2>
            <p>
              {groups.length}
              {" formulários no filtro"}
            </p>
          </div>
        </div>
        {groups.length ? (
          <div className={"fm-table-wrap"}>
            <table className={"fm-table"}>
              <thead>
                <tr>
                  <th>{"Formulário"}</th>
                  <th>{"Área"}</th>
                  <th>{"Finalizados"}</th>
                  <th>{"Em andamento"}</th>
                  <th>{"Conformidade"}</th>
                  <th>{"Exportar"}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, rowIndex) => {
                  const s = F.summarize(g.rows);
                  return (
                    <tr key={rowKey(g, rowIndex)}>
                      <td>
                        <button
                          className={"fm-text-button"}
                          type={"button"}
                          data-fm-action={"report-form"}
                          data-id={g.id}
                        >
                          {g.name}
                        </button>
                      </td>
                      <td>{g.area}</td>
                      <td>{s.completed}</td>
                      <td>{s.drafts}</td>
                      <td>
                        {badge(pct(s.percent), tone(s.percent))}
                        <div className={"fm-progress " + tone(s.percent)}>
                          <i
                            style={styleProps(
                              "width:" + (s.percent ?? 0) + "%",
                            )}
                          ></i>
                        </div>
                      </td>
                      <td>
                        {btn("export-form", "Excel", { "data-id": g.id })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          empty(
            "Nenhuma aplicação neste período",
            "Altere os filtros ou preencha um formulário publicado.",
          )
        )}
      </div>
    );
  }
  function pager(total: number, size = 25) {
    return (
      <div className={"fm-pagination"}>
        <span>
          {total ? reportPage * size + 1 : 0}
          {"–"}
          {Math.min((reportPage + 1) * size, total)}
          {" de "}
          {total}
        </span>
        {btn(
          "page-prev",
          "← Anterior",
          reportPage === 0 ? { disabled: true } : {},
        )}
        {btn(
          "page-next",
          "Próxima →",
          (reportPage + 1) * size >= total ? { disabled: true } : {},
        )}
      </div>
    );
  }
  function applicationsHtml(rows: FormReadRow[]) {
    const paged = rows.slice(reportPage * 25, reportPage * 25 + 25);
    return (
      <div className={"card"}>
        {paged.length
          ? responseRows(paged)
          : empty("Nenhuma aplicação no filtro")}
        {pager(rows.length)}
      </div>
    );
  }
  function executionHtml(rows: FormReadRow[], year: number) {
    const assessed = F.assessmentRows(rows).filter(
        (r) => r.status === "COMPLETED" && r.evaluated_user_id,
      ),
      persons = new Map<
        string,
        { id: string; name: string; role: string; area?: string }
      >();
    for (const f of definitions.filter(
      (f) =>
        (!reportFilter.form || f.id === reportFilter.form) &&
        (!reportFilter.area || f.area === reportFilter.area) &&
        (!reportFilter.type || f.form_type === reportFilter.type),
    )) {
      if (!f.schema.evaluation?.enabled) continue;
      for (const p of people.filter(
        (p) =>
          p.units.includes(ctx().unit) &&
          F.key(p.area) === F.key(f.schema.evaluation?.area),
      ))
        persons.set(p.id, { ...p, area: f.schema.evaluation?.area });
    }
    for (const r of assessed) {
      if (!r.evaluated_user_id || !r.evaluated_name) continue;
      persons.set(r.evaluated_user_id, {
        id: r.evaluated_user_id,
        name: r.evaluated_name,
        role: r.evaluated_role || "",
        area: r.evaluated_area,
      });
    }
    const list = [...persons.values()]
      .filter((p) => !reportFilter.person || p.id === reportFilter.person)
      .sort((a, b) => a.name.localeCompare(b.name));
    return (
      <div className={"card"}>
        <div className={"fm-card-title"}>
          <div>
            <h2>
              {"Aderência por colaborador avaliado · "}
              {year}
            </h2>
            <p>
              {
                "Clique em um mês para abrir a evolução da pessoa por pergunta. Quem aplica o formulário não recebe a nota dos avaliados."
              }
            </p>
          </div>
        </div>
        <div className={"fm-table-wrap fm-matrix-wrap"}>
          <table className={"fm-table fm-matrix"}>
            <thead>
              <tr>
                <th>{"Pessoa avaliada / área"}</th>
                {F.MONTHS.map((m, rowIndex) => (
                  <th key={rowKey(m, rowIndex)}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((p, rowIndex) => (
                <tr key={rowKey(p, rowIndex)}>
                  <th>
                    {p.name}
                    <small>
                      {p.area}
                      {" · "}
                      {ctx().roles[p.role] || p.role}
                    </small>
                  </th>
                  {F.MONTHS.map((m, i) => {
                    const rs = assessed.filter(
                        (r) =>
                          r.evaluated_user_id === p.id &&
                          F.localDay(r.started_at).startsWith(
                            `${year}-${String(i + 1).padStart(2, "0")}`,
                          ),
                      ),
                      summary = F.summarize(rs);
                    return (
                      <td
                        key={rowKey(m, i)}
                        className={
                          summary.percent == null
                            ? ""
                            : summary.percent >= 90
                              ? "fm-cell-good"
                              : summary.percent >= 70
                                ? "fm-cell-warn"
                                : "fm-cell-bad"
                        }
                      >
                        {btn(
                          "person-evolution",
                          rs.length ? (
                            <>
                              <strong>{pct(summary.percent)}</strong>
                              <small>
                                {rs.length}
                                {" avaliação(ões)"}
                              </small>
                            </>
                          ) : (
                            "—"
                          ),
                          {
                            "data-id": p.id,
                            "data-month": i + 1,
                            "aria-label": "Evolução de " + p.name + " em " + m,
                          },
                          "fm-cell-button",
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length
          ? empty(
              "Nenhuma pessoa avaliada neste filtro",
              "Ative a avaliação de colaboradores no modelo. Registros antigos sem pessoas selecionadas continuam nos relatórios, sem atribuição retroativa.",
            )
          : ""}
      </div>
    );
  }
  function personEvolutionHtml(rows: FormReadRow[], id: string, year: number) {
    const person = F.assessmentRows(rows).find(
        (r) => r.evaluated_user_id === id,
      ),
      name =
        person?.evaluated_name ||
        people.find((p) => p.id === id)?.name ||
        "Colaborador",
      questions = F.questionMonths(rows, id, year);
    return (
      <section className={"card"} id={"formsPersonEvolution"}>
        <div className={"fm-card-title"}>
          <div>
            <h2>
              {name}
              {" · evolução por pergunta"}
            </h2>
            <p>
              {"Percentual de respostas conformes por mês · "}
              {year}
              {". N/A não reduz a aderência."}
            </p>
          </div>
        </div>
        <div className={"fm-table-wrap fm-matrix-wrap"}>
          <table className={"fm-table fm-matrix"}>
            <thead>
              <tr>
                <th>{"Pergunta / formulário"}</th>
                {F.MONTHS.map((m, rowIndex) => (
                  <th key={rowKey(m, rowIndex)}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {questions.map((q, rowIndex) => (
                <tr key={rowKey(q, rowIndex)}>
                  <th>
                    {q.label}
                    <small>{q.form}</small>
                  </th>
                  {q.months.map((m, rowIndex) => (
                    <td
                      key={rowKey(m, rowIndex)}
                      className={
                        m.percent == null
                          ? ""
                          : m.percent >= 90
                            ? "fm-cell-good"
                            : m.percent >= 70
                              ? "fm-cell-warn"
                              : "fm-cell-bad"
                      }
                    >
                      <strong>
                        {m.percent == null ? "—" : pct(m.percent)}
                      </strong>
                      {m.ok + m.nok + m.na ? (
                        <small>
                          {m.ok}
                          {" OK · "}
                          {m.nok}
                          {" NOK"}
                          {m.na ? " · " + m.na + " N/A" : ""}
                        </small>
                      ) : (
                        ""
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!questions.length
          ? empty("Ainda não há perguntas avaliadas para essa pessoa")
          : ""}
      </section>
    );
  }

  function farolHtml(rows: FormReadRow[]) {
    if (!reportFilter.form)
      return (
        <div className={"card"}>
          {empty(
            "Selecione um formulário",
            "O farol compara as respostas de cada aplicação, pergunta por pergunta.",
          )}
        </div>
      );
    const completed = F.assessmentRows(rows).filter(
        (r) => r.status === "COMPLETED",
      ),
      columns = completed.slice(reportPage * 8, reportPage * 8 + 8),
      questions = new Map<string, ReturnType<typeof F.fields>[number]>();
    for (const r of completed)
      for (const f of F.fields(r.schema_snapshot))
        if (!questions.has(f.id)) questions.set(f.id, f);
    if (!columns.length)
      return (
        <div className={"card"}>
          {empty("Nenhuma aplicação finalizada no filtro")}
        </div>
      );
    const row = (label: string, fn: (response: FormReadRow) => ReactNode) => (
      <tr>
        <th>{label}</th>
        {columns.map((r, rowIndex) => (
          <td key={rowKey(r, rowIndex)}>{fn(r)}</td>
        ))}
      </tr>
    );
    return (
      <div className={"card"}>
        <div className={"fm-card-title"}>
          <div>
            <h2>{"Farol das respostas"}</h2>
            <p>
              {
                "As cores indicam conformidade. N/A não reduz a nota; perguntas de texto não recebem avaliação."
              }
            </p>
          </div>
        </div>
        <div className={"fm-table-wrap fm-farol-wrap"}>
          <table className={"fm-table fm-farol"}>
            <thead>
              <tr>
                <th>{"Pergunta / aplicação"}</th>
                {columns.map((r, rowIndex) => (
                  <th key={rowKey(r, rowIndex)}>
                    <button
                      type={"button"}
                      className={"fm-text-button"}
                      data-fm-action={"detail"}
                      data-id={r.id}
                    >
                      {r.code}
                    </button>
                    <small>{r.evaluated_name || r.respondent_name}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row("Início", (r) => fmt(r.started_at))}
              {row("Finalização", (r) => fmt(r.completed_at))}
              {row("Conformidade", (r) => badge(pct(r.score), tone(r.score)))}
              {[...questions.values()].map((f, rowIndex) => (
                <tr key={rowKey(f, rowIndex)}>
                  <th>
                    <small>{f.section_title}</small>
                    {f.label}
                  </th>
                  {columns.map((r, rowIndex) => {
                    const historical = F.fields(r.schema_snapshot).find(
                      (q) => q.id === f.id,
                    );
                    if (!historical)
                      return (
                        <td key={rowKey(r, rowIndex)}>
                          {"Não constava nesta versão"}
                        </td>
                      );
                    const a = r.answers?.[f.id],
                      result = F.outcome(historical, a);
                    return (
                      <td
                        key={rowKey(r, rowIndex)}
                        className={"fm-farol-" + (result || "TEXT")}
                      >
                        <strong>{F.answerText(historical, a)}</strong>
                        {result
                          ? badge(
                              result,
                              result === "OK"
                                ? "good"
                                : result === "NOK"
                                  ? "bad"
                                  : "warn",
                            )
                          : ""}
                        {a?.observation ? <small>{a.observation}</small> : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pager(completed.length, 8)}
      </div>
    );
  }
  function annualChart(rows: FormReadRow[], year: number, quality = false) {
    const months = F.annual(rows, year),
      max = Math.max(1, ...months.map((m) => m.completed)),
      left = 44,
      top = 26,
      width = 900,
      height = 210,
      step = width / 12;
    const lines = Array.from({ length: 5 }, (_, i) => {
      const y = top + height - (i * height) / 4;
      return (
        <Fragment key={rowKey(_, i)}>
          <line
            x1={left}
            x2={left + width}
            y1={y}
            y2={y}
            stroke={"#e6edf5"}
          ></line>
          <text x={left - 9} y={y + 4} textAnchor={"end"}>
            {Math.round((max * i) / 4)}
          </text>
        </Fragment>
      );
    });
    const bars = months.map((m, i) => {
      const x = left + i * step + step * 0.23,
        h = (m.completed / max) * height;
      return (
        <g key={rowKey(m, i)}>
          <title>
            {m.label}
            {": "}
            {m.completed}
            {" aplicações; conformidade "}
            {pct(m.percent)}
          </title>
          <rect
            x={x}
            y={top + height - h}
            width={step * 0.54}
            height={h}
            rx={"4"}
            fill={quality ? "#21a76a" : "#2864e8"}
          ></rect>
          <text
            x={left + i * step + step / 2}
            y={top + height + 23}
            textAnchor={"middle"}
          >
            {m.label}
          </text>
        </g>
      );
    });
    const points = months
      .map(
        (m, i) =>
          `${left + i * step + step / 2},${top + height - ((m.percent ?? 0) / 100) * height}`,
      )
      .join(" ");
    return (
      <figure className={"fm-chart"}>
        <svg
          viewBox={"0 0 990 280"}
          role={"img"}
          aria-label={
            "Aplicações mensais em " +
            year +
            (quality ? " e conformidade percentual" : "")
          }
        >
          {lines}
          {bars}
          {quality ? (
            <>
              <polyline
                points={points}
                fill={"none"}
                stroke={"#7c4de8"}
                strokeWidth={"3"}
              ></polyline>
              <text x={"980"} y={"20"} textAnchor={"end"}>
                {"Linha: 0–100%"}
              </text>
            </>
          ) : (
            ""
          )}
        </svg>
        <figcaption>
          {"Quantidade de aplicações finalizadas por mês de início"}
          {quality ? " · linha roxa: conformidade das respostas avaliadas" : ""}
          {"."}
        </figcaption>
      </figure>
    );
  }
  function barRows(items: { name: string; count: number }[], negative = false) {
    const max = Math.max(1, ...items.map((x) => x.count));
    return (
      <div className={"fm-ranking"}>
        {nonEmpty(
          items.map((x, rowIndex) => (
            <div key={rowKey(x, rowIndex)}>
              <span title={x.name}>{x.name}</span>
              <div className={"fm-rank-track"}>
                <i
                  className={negative ? "bad" : ""}
                  style={styleProps("width:" + (x.count / max) * 100 + "%")}
                ></i>
              </div>
              <strong>{x.count}</strong>
            </div>
          )),
        ) || empty("Nenhum resultado no filtro")}
      </div>
    );
  }
  function chartsHtml(rows: FormReadRow[], year: number) {
    return (
      <>
        <div className={"card"}>
          <h2>
            {"Aplicações ao longo do ano · "}
            {year}
          </h2>
          {annualChart(rows, year)}
        </div>
        <div className={"card"}>
          <h2>{"Formulários mais aplicados"}</h2>
          {barRows(
            groupForms(rows.filter((r) => r.status === "COMPLETED")).map(
              (g) => ({ name: g.name, count: g.rows.length }),
            ),
          )}
        </div>
      </>
    );
  }
  function conformityHtml(rows: FormReadRow[], year: number) {
    const negative = F.issues(rows),
      byQuestion = new Map<string, { name: string; count: number }>(),
      all = new Map<string, { name: string; form: string; months: number[] }>();
    for (const r of rows.filter((r) => r.status === "COMPLETED"))
      for (const f of F.fields(r.schema_snapshot)) {
        if (f.scored) {
          const k = r.form_id + ":" + f.id;
          if (!all.has(k))
            all.set(k, {
              name: f.label,
              form: r.form_name,
              months: Array(12).fill(0),
            });
        }
      }
    for (const x of negative) {
      const k = x.response.form_id + ":" + x.field.id;
      if (!byQuestion.has(k))
        byQuestion.set(k, { name: x.field.label, count: 0 });
      const question = byQuestion.get(k);
      if (question) question.count++;
      const m = Number(F.localDay(x.response.started_at).slice(5, 7)) - 1;
      const annualQuestion = all.get(k);
      if (annualQuestion && m >= 0 && m < 12) annualQuestion.months[m]++;
    }
    return (
      <>
        <div className={"card"}>
          <h2>{"Evolução anual · quantidade e conformidade"}</h2>
          {annualChart(rows, year, true)}
        </div>
        <div className={"card"}>
          <h2>{"Ranking de não conformidades"}</h2>
          {barRows(
            [...byQuestion.values()].sort((a, b) => b.count - a.count),
            true,
          )}
        </div>
        <div className={"card"}>
          <h2>{"Acompanhamento por pergunta · não conformidades"}</h2>
          <div className={"fm-table-wrap fm-matrix-wrap"}>
            <table className={"fm-table fm-matrix"}>
              <thead>
                <tr>
                  <th>{"Pergunta"}</th>
                  {F.MONTHS.map((m, rowIndex) => (
                    <th key={rowKey(m, rowIndex)}>{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...all.values()].map((q, rowIndex) => (
                  <tr key={rowKey(q, rowIndex)}>
                    <th>
                      {q.name}
                      <small>{q.form}</small>
                    </th>
                    {q.months.map((n, rowIndex) => (
                      <td
                        key={rowKey(n, rowIndex)}
                        className={n ? "fm-cell-bad" : ""}
                      >
                        {n || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!all.size ? empty("Nenhuma pergunta avaliada no filtro") : ""}
        </div>
      </>
    );
  }
  function issuesHtml(rows: FormReadRow[]) {
    const all = F.issues(rows, plans),
      withPlan = all.filter((x) => x.plan),
      done = withPlan.filter((x) => x.plan?.status === "DONE");
    return (
      <>
        <div className={"fm-metrics three"}>
          {metric("Não conformidades", all.length, "bad")}
          {metric("Com plano de ação", withPlan.length, "brand")}
          {metric("Planos concluídos", done.length, "good")}
        </div>
        <div className={"card"}>
          <h2>{"Inconsistências e planos de ação"}</h2>
          {all.length ? (
            <>
              <div className={"fm-table-wrap"}>
                <table className={"fm-table"}>
                  <thead>
                    <tr>
                      <th>{"Formulário / registro"}</th>
                      <th>{"Colaborador"}</th>
                      <th>{"Pergunta / observação"}</th>
                      <th>{"Resposta"}</th>
                      <th>{"Plano / prazo"}</th>
                      <th>{"Ação"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {all
                      .slice(reportPage * 25, reportPage * 25 + 25)
                      .map((x, rowIndex) => (
                        <tr key={rowKey(x, rowIndex)}>
                          <td>
                            <strong>{x.response.form_name}</strong>
                            <small>
                              {x.response.code}
                              {" · "}
                              {day(F.localDay(x.response.started_at))}
                            </small>
                          </td>
                          <td>
                            {x.response.evaluated_name || "Não informado"}
                            <small>
                              {"Aplicador: "}
                              {x.response.respondent_name}
                            </small>
                          </td>
                          <td>
                            <strong>{x.field.label}</strong>
                            <small>
                              {x.answer?.observation || "Sem observação"}
                            </small>
                          </td>
                          <td>
                            {badge(F.answerText(x.field, x.answer), "bad")}
                          </td>
                          <td>
                            {x.plan ? (
                              <>
                                {badge(
                                  STATUS[x.plan.status],
                                  x.plan.status === "DONE" ? "good" : "warn",
                                )}
                                <small>
                                  {x.plan.responsible_name}
                                  {" · "}
                                  {day(x.plan.due_date)}
                                </small>
                              </>
                            ) : (
                              badge("Sem plano", "bad")
                            )}
                          </td>
                          <td>
                            {btn(
                              "plan",
                              x.plan ? "Ver / editar plano" : "＋ Plano",
                              {
                                "data-id": x.response.id,
                                "data-field": F.planField(
                                  x.field,
                                  x.response.evaluated_user_id,
                                ),
                              },
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {pager(all.length)}
            </>
          ) : (
            empty("Nenhuma não conformidade neste período")
          )}
        </div>
      </>
    );
  }
  let detailResponse: FormReadRow | null = null;
  function showDetail(row: FormReadRow) {
    detailResponse = row;
    const s = F.score(row.schema_snapshot, row.answers);
    adapter.modal({
      title: row.form_name,
      subtitle: `${row.code} · ${row.unit} · versão ${row.form_version}`,
      html: (
        <>
          <div className={"fm-detail-header"}>
            <div>
              <small>{"APLICADOR"}</small>
              <strong>{row.respondent_name}</strong>
            </div>
            <div>
              <small>{"INÍCIO"}</small>
              <strong>{fmt(row.started_at)}</strong>
            </div>
            <div>
              <small>{"FIM"}</small>
              <strong>{fmt(row.completed_at)}</strong>
            </div>
            <div>
              <small>{"DURAÇÃO"}</small>
              <strong>{duration(row)}</strong>
            </div>
            <div>
              <small>{"RESULTADO"}</small>
              {badge(pct(s.percent), tone(s.percent))}
            </div>
          </div>
          {F.assessmentRows([row]).map((assessment, rowIndex) => (
            <Fragment key={rowKey(assessment, rowIndex)}>
              {assessment.evaluated_name ? (
                <h2 className={"fm-person-heading"}>
                  {assessment.evaluated_name}{" "}
                  <small>{assessment.evaluated_area}</small>{" "}
                  {badge(pct(assessment.score), tone(assessment.score))}
                </h2>
              ) : (
                ""
              )}
              {row.schema_snapshot.sections.map((section, rowIndex) => (
                <section
                  key={rowKey(section, rowIndex)}
                  className={"fm-detail-section"}
                >
                  <h3>
                    {section.title}
                    <small>
                      {section.fields.length}
                      {" perguntas"}
                    </small>
                  </h3>
                  {section.fields.map((f, rowIndex) => {
                    const a = assessment.answers?.[f.id],
                      o = F.outcome(f, a);
                    return (
                      <div
                        key={rowKey(f, rowIndex)}
                        className={"fm-detail-answer"}
                      >
                        <strong>{f.label}</strong>
                        <div>
                          {o
                            ? badge(
                                F.answerText(f, a),
                                o === "OK"
                                  ? "good"
                                  : o === "NOK"
                                    ? "bad"
                                    : "warn",
                              )
                            : F.answerText(f, a)}
                        </div>
                        {a?.observation ? (
                          <p>
                            <b>{"Observação:"}</b> {a.observation}
                          </p>
                        ) : (
                          ""
                        )}
                        {a?.plan ? (
                          <p>
                            <b>{"Plano inicial:"}</b> {a.plan}
                          </p>
                        ) : (
                          ""
                        )}
                        {photoLinks(a)}
                        {row._self_view ? selfPlanHtml(row, f) : ""}
                        {row.status === "COMPLETED" &&
                        !row._self_view &&
                        o === "NOK"
                          ? btn("plan", "Plano de ação", {
                              "data-id": row.id,
                              "data-field": F.planField(
                                f,
                                assessment.evaluated_user_id,
                              ),
                            })
                          : ""}
                      </div>
                    );
                  })}
                  {row.answers?.__sections?.[section.id] ? (
                    <div className={"fm-detail-answer"}>
                      <strong>{"Observações da seção"}</strong>
                      <p>{row.answers.__sections[section.id]}</p>
                    </div>
                  ) : (
                    ""
                  )}
                </section>
              ))}
            </Fragment>
          ))}
        </>
      ),
      actions: (
        <>
          {btn(
            row._self_view ? "self-export-one" : "export-one",
            "Baixar CSV",
            { "data-id": row.id },
          )}
          {row.status === "COMPLETED"
            ? btn(
                row._self_view ? "self-pdf" : "pdf",
                "Baixar PDF",
                { "data-id": row.id },
                "primary",
              )
            : ""}
        </>
      ),
    });
    void refreshPhotoLinks();
  }
  async function openPlan(row: FormResponse, fieldId: string) {
    if (!people.length) await loadPeople();
    const f = F.fields(row.schema_snapshot).find(
      (f) => f.id === fieldId.split("@")[0],
    );
    if (!f) return;
    const subject = fieldId.split("@")[1];
    if (subject)
      row =
        F.assessmentRows([row]).find((r) => r.evaluated_user_id === subject) ||
        row;
    const result = await rpcPlanFor(row.id, fieldId),
      p = result || {
        response_id: row.id,
        field_id: fieldId,
        description: row.answers?.[f.id]?.plan || "",
        responsible_id: row.respondent_id,
        due_date: "",
        status: "OPEN",
        completion_note: "",
        revision: 0,
      };
    planContext = { row, fieldId, plan: p };
    adapter.modal({
      title: "Plano de ação",
      subtitle: f.label,
      html: (
        <>
          <p className={"notice"}>
            {row.form_name}
            {" · "}
            {row.code}
            {" · "}
            {row.respondent_name}
          </p>
          <div className={"fm-grid"}>
            {field(
              "O que será feito? *",
              <TextArea id={"formsPlanDescription"} rows={4} maxLength={2000}>
                {p.description}
              </TextArea>,
              true,
            )}
            {field(
              "Responsável *",
              <Select id={"formsPlanResponsible"}>
                {options(
                  people
                    .filter((u) => u.units.includes(row.unit))
                    .map((u) => ({ value: u.id, label: u.name })),
                  p.responsible_id,
                  "Selecione",
                )}
              </Select>,
            )}
            {field(
              "Prazo",
              <Input
                type={"date"}
                id={"formsPlanDue"}
                value={p.due_date || ""}
              ></Input>,
            )}
            {field(
              "Situação",
              <Select id={"formsPlanStatus"}>
                <Option
                  value={"OPEN"}
                  {...attributeProps(p.status === "OPEN" ? "selected" : "")}
                >
                  {"Em aberto"}
                </Option>
                <Option
                  value={"DONE"}
                  {...attributeProps(p.status === "DONE" ? "selected" : "")}
                >
                  {"Concluído"}
                </Option>
              </Select>,
            )}
            {field(
              "Descrição da conclusão · obrigatória ao concluir",
              <TextArea id={"formsPlanCompletion"} rows={3} maxLength={2000}>
                {p.completion_note || ""}
              </TextArea>,
              true,
            )}
          </div>
        </>
      ),
      actions: btn("save-plan", "Salvar plano", {}, "primary"),
    });
  }
  let planContext: {
    row: FormResponse;
    fieldId: string;
    plan: ActionPlan;
  } | null = null;
  async function rpcPlanFor(responseId: string, fieldId: string) {
    return service.plan(responseId, fieldId);
  }
  async function savePlan() {
    const c = planContext;
    if (!c || busy) return;
    const status = controlValue("formsPlanStatus");
    if (!oneOf(status, ["OPEN", "DONE"] as const))
      throw Error("Selecione um status válido para o plano.");
    busy = true;
    try {
      await rpc(
        c.fieldId.includes("@")
          ? "save_form_evaluation_plan"
          : "save_form_action_plan",
        {
          p_response_id: c.row.id,
          p_field_id: c.fieldId,
          p_expected_revision: c.plan.revision,
          p_payload: {
            description: controlValue("formsPlanDescription"),
            responsible_id: controlValue("formsPlanResponsible"),
            due_date: controlValue("formsPlanDue"),
            status,
            completion_note: controlValue("formsPlanCompletion"),
          },
        },
      );
      adapter.closeModal();
      notify("Plano de ação salvo.");
      if (lastView === "forms-report") await loadReport();
    } finally {
      busy = false;
    }
  }
  async function exportData(
    kind: "csv" | "xlsx",
    rows: FormReadRow[] = reportRowsFiltered(),
    suppliedPlans: PlanDisplay[] | null = null,
  ) {
    const currentPlans =
        suppliedPlans ?? (navigator.onLine ? await loadPlans(rows) : plans),
      matrix = F.exportRows(rows, currentPlans),
      name = `formularios_${F.localDay(new Date())}`;
    if (kind === "xlsx")
      return adapter.download(
        name + ".xlsx",
        new Blob([F.xlsx(matrix)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
    return adapter.download(
      name + ".csv",
      new Blob([F.csv(matrix)], { type: "text/csv;charset=utf-8" }),
    );
  }
  let pdfLibPromise: Promise<unknown> | null = null;
  async function pdfReport(row: FormReadRow) {
    if (!window.PDFLib) {
      if (!pdfLibPromise)
        pdfLibPromise = new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "vendor/pdf-lib.min.js";
          s.onload = resolve;
          s.onerror = () => {
            pdfLibPromise = null;
            reject(Error("Não foi possível carregar o gerador de PDF."));
          };
          document.head.append(s);
        });
      await pdfLibPromise;
    }
    const pdf = window.PDFLib;
    if (!pdf) throw Error("Não foi possível carregar o gerador de PDF.");
    const printedPhotos = new Set<string>(),
      { PDFDocument, StandardFonts, rgb } = pdf,
      doc = await PDFDocument.create(),
      font = await doc.embedFont(StandardFonts.Helvetica),
      bold = await doc.embedFont(StandardFonts.HelveticaBold),
      width = 595,
      height = 842,
      margin = 42;
    let page: PDFPage = doc.addPage([width, height]),
      y = height - margin;
    const text = (v: unknown) =>
      String(v ?? "").replace(/[^\x20-\x7e\u00a0-\u00ff]/g, " ");
    const newPage = (first = false) => {
      if (!first) page = doc.addPage([width, height]);
      y = height - margin;
      page.drawRectangle({
        x: 0,
        y: height - 12,
        width,
        height: 12,
        color: rgb(0.1, 0.35, 0.82),
      });
      page.drawText("DISB GESTÃO | FORMULÁRIOS", {
        x: margin,
        y,
        font: bold,
        size: 10,
        color: rgb(0.1, 0.35, 0.65),
      });
      y -= 27;
    };
    const line = (
      value: unknown,
      { size = 10, strong = false, color = rgb(0.12, 0.19, 0.28) } = {},
    ) => {
      const f = strong ? bold : font,
        words = text(value).split(/\s+/);
      let out = "";
      for (const word of words) {
        if (
          f.widthOfTextAtSize((out ? out + " " : "") + word, size) >
            width - margin * 2 &&
          out
        ) {
          draw(out);
          out = word;
        } else out += (out ? " " : "") + word;
      }
      draw(out);
      function draw(v: string) {
        if (y < 55) newPage();
        page.drawText(v, { x: margin, y, font: f, size, color });
        y -= size + 6;
      }
    };
    newPage(true);
    line(row.form_name, { size: 18, strong: true });
    line(`${row.code} | ${row.unit} | Versão ${row.form_version}`);
    line(`Aplicador: ${row.respondent_name}`);
    line(`Início: ${fmt(row.started_at)} | Fim: ${fmt(row.completed_at)}`);
    line(`Duração: ${duration(row)} | Conformidade: ${pct(row.score)}`, {
      strong: true,
    });
    y -= 12;
    for (const assessment of F.assessmentRows([row])) {
      if (assessment.evaluated_name) {
        if (y < 120) newPage();
        line("Pessoa avaliada: " + assessment.evaluated_name, {
          size: 13,
          strong: true,
        });
        line(
          "Área: " +
            assessment.evaluated_area +
            " | Conformidade: " +
            pct(assessment.score),
        );
      }
      for (const section of row.schema_snapshot.sections) {
        if (y < 110) newPage();
        line(section.title, { size: 13, strong: true });
        for (const f of section.fields) {
          if (y < 90) newPage();
          const a = assessment.answers?.[f.id],
            o = F.outcome(f, a);
          line(f.label, { strong: true });
          line(F.answerText(f, a), {
            color:
              o === "NOK"
                ? rgb(0.75, 0.13, 0.15)
                : o === "OK"
                  ? rgb(0.04, 0.45, 0.25)
                  : rgb(0.2, 0.25, 0.33),
          });
          if (a?.observation) line("Observação: " + a.observation);
          if (a?.plan) line("Plano inicial: " + a.plan);
          for (const path of a?.photos || []) {
            if (printedPhotos.has(path)) {
              line("Foto já apresentada neste relatório.", { size: 9 });
              continue;
            }
            const { data, error } = await photoOperation(
              ctx().client.storage.from("form-evidence").download(path),
            );
            if (error) throw error;
            const bytes = await data.arrayBuffer(),
              img = path.endsWith(".png")
                ? await doc.embedPng(bytes)
                : await doc.embedJpg(bytes),
              scale = Math.min(
                1,
                (width - margin * 2) / img.width,
                220 / img.height,
              ),
              w = img.width * scale,
              h = img.height * scale;
            if (y - h < 55) {
              newPage();
              line(f.label + " · foto", { strong: true });
            }
            page.drawImage(img, { x: margin, y: y - h, width: w, height: h });
            y -= h + 12;
            printedPhotos.add(path);
          }
          y -= 7;
        }
        if (row.answers?.__sections?.[section.id])
          line("Observações da seção: " + row.answers.__sections[section.id]);
        y -= 12;
      }
    }
    doc
      .getPages()
      .forEach((p, i) =>
        p.drawText(
          `Disb Gestão | ${row.code} | ${i + 1}/${doc.getPageCount()}`,
          { x: margin, y: 25, font, size: 8, color: rgb(0.4, 0.45, 0.5) },
        ),
      );
    return adapter.download(
      `${row.code}.pdf`,
      new Blob([new Uint8Array(await doc.save())], { type: "application/pdf" }),
    );
  }

  let scheduleFilter: ScheduleFilter = {},
    scheduleResults: FormResponse[] = [];
  function eligiblePerson(form: FormDefinition | undefined, p: FormPerson) {
    return (
      !!form &&
      p.units.includes(ctx().unit) &&
      (p.role === "ADMIN" ||
        form.apply_everyone ||
        form.apply_roles.includes(p.role) ||
        form.apply_user_ids.includes(p.id))
    );
  }
  async function loadSchedule() {
    const key = currentKey(),
      today = F.localDay(new Date());
    scheduleFilter.from ||= today.slice(0, 7) + "-01";
    scheduleFilter.to ||=
      today.slice(0, 7) +
      "-" +
      new Date(
        Number(today.slice(0, 4)),
        Number(today.slice(5, 7)),
        0,
      ).getDate();
    if (scheduleFilter.from > scheduleFilter.to)
      throw Error("Revise o intervalo dos agendamentos.");
    const data = await service.assignments(scheduleFilter, true);
    const results = await service.responsesByIds(
      data.map((row) => row.response_id).filter((id): id is string => !!id),
    );
    if (key !== currentKey()) return;
    assignments = data;
    scheduleResults = results;
    renderSchedule();
  }
  function renderSchedule() {
    const done = assignments.filter((a) => a.status === "COMPLETED").length,
      pending = assignments.filter((a) => a.status === "PENDING").length;
    renderContent(
      rootFor("forms-schedule"),
      <>
        {head(
          "AGENDAMENTOS",
          "Agendamentos de formulários",
          "Distribua aplicações por colaborador, unidade e data.",
          can("FORMS_MANAGE")
            ? btn("new-schedule", "＋ Novo agendamento", {}, "primary")
            : "",
        )}

        <div className={"card fm-report-filters"}>
          {field(
            "Formulário",
            <Select data-fm-schedule-filter={"form"}>
              {options(
                definitions.map((f) => ({
                  value: f.id,
                  label: f.name,
                })),
                scheduleFilter.form,
              )}
            </Select>,
          )}
          {field(
            "Colaborador",
            <Select data-fm-schedule-filter={"person"}>
              {options(
                people
                  .filter((p) => p.units.includes(ctx().unit))
                  .map((p) => ({ value: p.id, label: p.name })),
                scheduleFilter.person,
              )}
            </Select>,
          )}
          {field(
            "Situação",
            <Select data-fm-schedule-filter={"status"}>
              {options(
                ["PENDING", "COMPLETED", "CANCELLED"].map((s) => ({
                  value: s,
                  label: STATUS[s],
                })),
                scheduleFilter.status,
              )}
            </Select>,
          )}
          {field(
            "Início",
            <Input
              type={"date"}
              data-fm-schedule-filter={"from"}
              value={scheduleFilter.from}
            ></Input>,
          )}
          {field(
            "Fim",
            <Input
              type={"date"}
              data-fm-schedule-filter={"to"}
              value={scheduleFilter.to}
            ></Input>,
          )}
          {btn("schedule-filter", "Filtrar")}
        </div>

        {scheduleFormOpen ? scheduleEditor() : ""}

        <div className={"fm-metrics"}>
          {metric("Total agendado", done + pending, "brand")}
          {metric("Realizados", done, "good")}
          {metric("Pendentes", pending, "warn")}
          {metric(
            "Executado",
            done + pending ? pct((done / (done + pending)) * 100) : "—",
            "brand",
          )}
          {metric(
            "Conformidade",
            pct(F.summarize(scheduleResults).percent),
            "good",
          )}
        </div>
        <div
          className={"fm-tabs"}
          role={"tablist"}
          aria-label={"Visualização dos agendamentos"}
        >
          {[
            ["list", "Lista"],
            ["calendar", "Calendário"],
          ].map(([id, label], rowIndex) => (
            <button
              key={rowKey(undefined, rowIndex)}
              type={"button"}
              role={"tab"}
              aria-selected={scheduleView === id}
              className={scheduleView === id ? "active" : ""}
              data-fm-action={"schedule-view"}
              data-id={id}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={"card"}>
          {scheduleView === "calendar" ? (
            calendarHtml()
          ) : assignments.length ? (
            <div className={"fm-table-wrap"}>
              <table className={"fm-table"}>
                <thead>
                  <tr>
                    <th>{"Formulário"}</th>
                    <th>{"Colaborador / unidade"}</th>
                    <th>{"Data prevista"}</th>
                    <th>{"Situação"}</th>
                    <th>{"Ações"}</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a, rowIndex) => {
                    const f = findForm(a.form_id),
                      late =
                        a.status === "PENDING" &&
                        a.due_date < F.localDay(new Date());
                    return (
                      <tr key={rowKey(a, rowIndex)}>
                        <td>{f?.name || "Formulário"}</td>
                        <td>
                          {a.user_name}
                          <small>{a.unit}</small>
                        </td>
                        <td>{day(a.due_date)}</td>
                        <td>
                          {badge(
                            late ? "Atrasado" : STATUS[a.status],
                            late
                              ? "bad"
                              : a.status === "COMPLETED"
                                ? "good"
                                : "warn",
                          )}
                        </td>
                        <td>
                          <div className={"actions"}>
                            {a.user_id === ctx().user.id &&
                            a.status === "PENDING" &&
                            fill(f)
                              ? btn("start-assignment", "Iniciar / continuar", {
                                  "data-id": a.id,
                                })
                              : ""}
                            {a.response_id
                              ? btn("assignment-detail", "Ver aplicação", {
                                  "data-id": a.response_id,
                                })
                              : ""}
                            {a.status === "PENDING" && f && manage(f)
                              ? btn("cancel-assignment", "Cancelar", {
                                  "data-id": a.id,
                                })
                              : ""}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            empty(
              "Nenhum agendamento no filtro",
              "Os responsáveis verão aqui as aplicações atribuídas a eles.",
            )
          )}
        </div>
      </>,
    );
  }
  function calendarHtml() {
    const month =
        calendarMonth ||
        scheduleFilter.from?.slice(0, 7) ||
        F.localDay(new Date()).slice(0, 7),
      label = new Date(month + "-01T12:00:00Z").toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
    return (
      <>
        <div className={"fm-calendar-head"}>
          {btn("calendar-prev", "← Mês anterior")}
          <h2>{label}</h2>
          {btn("calendar-next", "Próximo mês →")}
        </div>
        <div className={"fm-calendar-scroll"}>
          <div className={"fm-calendar-inner"}>
            <div className={"fm-calendar-week"}>
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(
                (d, rowIndex) => (
                  <span key={rowKey(d, rowIndex)}>{d}</span>
                ),
              )}
            </div>
            <div className={"fm-calendar-grid"}>
              {F.calendarDays(month).map((date, rowIndex) => {
                const items = assignments.filter(
                  (a) => String(a.due_date).slice(0, 10) === date,
                );
                return (
                  <section
                    key={rowKey(date, rowIndex)}
                    className={
                      "fm-calendar-day " +
                      (date.startsWith(month) ? "" : "other-month") +
                      " " +
                      (date === F.localDay(new Date()) ? "today" : "")
                    }
                  >
                    <strong>{Number(date.slice(-2))}</strong>
                    {items.map((a, rowIndex) => (
                      <button
                        key={rowKey(a, rowIndex)}
                        type={"button"}
                        className={
                          "fm-calendar-event " + a.status.toLowerCase()
                        }
                        data-fm-action={"calendar-assignment"}
                        data-id={a.id}
                      >
                        <b>{findForm(a.form_id)?.name || "Formulário"}</b>
                        <span>{a.user_name}</span>
                        <small>{STATUS[a.status]}</small>
                      </button>
                    ))}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
        <p className={"fm-help"}>
          {
            "O calendário respeita os filtros de formulário, colaborador e situação."
          }
        </p>
      </>
    );
  }
  async function changeCalendarMonth(delta = 0) {
    const current =
        calendarMonth ||
        scheduleFilter.from?.slice(0, 7) ||
        F.localDay(new Date()).slice(0, 7),
      date = new Date(current + "-01T12:00:00Z");
    date.setUTCMonth(date.getUTCMonth() + delta);
    calendarMonth = date.toISOString().slice(0, 7);
    scheduleFilter.from = calendarMonth + "-01";
    const last = new Date(date);
    last.setUTCMonth(last.getUTCMonth() + 1);
    last.setUTCDate(0);
    scheduleFilter.to = last.toISOString().slice(0, 10);
    await loadSchedule();
  }
  function scheduleEditor() {
    const today = F.localDay(new Date());
    return (
      <section className={"card fm-schedule-editor"}>
        <div className={"fm-card-title"}>
          <div>
            <h2>{"Novo agendamento"}</h2>
            <p>
              {
                "Somente formulários publicados e colaboradores autorizados podem ser agendados."
              }
            </p>
          </div>
          {btn("close-schedule", "Fechar")}
        </div>
        <div className={"fm-grid"}>
          {field(
            "Formulário *",
            <Select id={"formsScheduleModel"}>
              <Option value={""}>{"Selecione"}</Option>
              {definitions
                .filter((f) => f.status === "PUBLISHED" && manage(f))
                .map((f, rowIndex) => (
                  <Option key={rowKey(f, rowIndex)} value={f.id}>
                    {f.name}
                  </Option>
                ))}
            </Select>,
            true,
          )}
          {field("Unidade", <Input readOnly={true} value={ctx().unit}></Input>)}
          {field(
            "Repetição",
            <Select id={"formsScheduleRepeat"}>
              <Option value={"ONCE"}>{"Uma vez"}</Option>
              <Option value={"DAILY"}>{"Todos os dias"}</Option>
              <Option value={"WEEKLY"}>{"Dias da semana"}</Option>
              <Option value={"BIWEEKLY"}>{"Quinzenal · a cada 15 dias"}</Option>
              <Option value={"MONTHLY"}>{"Mensal · mesmo dia"}</Option>
            </Select>,
          )}
          {field(
            "Data inicial *",
            <Input
              id={"formsScheduleStart"}
              type={"date"}
              value={today}
            ></Input>,
          )}
          {field(
            "Data final *",
            <Input id={"formsScheduleEnd"} type={"date"} value={today}></Input>,
          )}
          <div id={"formsScheduleWeekdays"} className={"fm-wide hidden"}>
            {choices(
              "schedule_weekdays",
              ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(
                (label, value) => ({ value: String(value), label }),
              ),
              [],
            )}
          </div>
          <div className={"fm-wide"}>
            <label className={"fm-help"}>{"Colaboradores *"}</label>
            <Input
              type={"search"}
              className={"fm-people-search"}
              aria-label={"Buscar colaboradores para agendar"}
              placeholder={"Buscar colaborador"}
            ></Input>
            <div id={"formsSchedulePeople"}>
              {empty("Escolha o formulário para selecionar os responsáveis")}
            </div>
          </div>
        </div>
        <div className={"actions right"}>
          {btn("save-schedule", "Criar agendamento", {}, "primary")}
        </div>
      </section>
    );
  }
  async function saveSchedule() {
    if (busy) return;
    const model = controlValue("formsScheduleModel"),
      users = [
        ...document.querySelectorAll<HTMLInputElement>(
          "[data-fm-schedule-user]:checked",
        ),
      ].map((e) => e.value);
    if (!model || !users.length)
      throw Error("Selecione o formulário e os colaboradores.");
    busy = true;
    try {
      const count = await rpc("create_form_schedule", {
        p_form_id: model,
        p_unit: ctx().unit,
        p_users: users,
        p_start: controlValue("formsScheduleStart"),
        p_end: controlValue("formsScheduleEnd"),
        p_repeat: controlValue("formsScheduleRepeat"),
        p_weekdays: [
          ...document.querySelectorAll<HTMLInputElement>(
            '[data-fm-list="schedule_weekdays"]:checked',
          ),
        ].map((e) => Number(e.value)),
      });
      scheduleFormOpen = false;
      await loadSchedule();
      notify(
        `${count} agendamento(s) criado(s). Registros já existentes foram preservados.`,
      );
    } finally {
      busy = false;
    }
  }
  const getQuestion = (id: string) =>
    builder?.schema.sections.flatMap((s) => s.fields).find((f) => f.id === id);
  const locateQuestion = (id: string) =>
    builder?.schema.sections.find((s) => s.fields.some((f) => f.id === id));
  function move<T>(list: T[], index: number, delta: number) {
    const next = index + delta;
    if (index < 0 || index >= list.length || next < 0 || next >= list.length)
      return;
    [list[index], list[next]] = [list[next], list[index]];
  }
  function refreshAnswerState(id: string, person: string) {
    const rowSnapshot = requireResponse();

    const f = F.fields(rowSnapshot.schema_snapshot).find((f) => f.id === id);
    if (!f) return;
    const a = answerBag(id, person)[id],
      negative = F.outcome(f, a) === "NOK",
      card = $(`fm-answer-${id}${person ? "-" + person : ""}`);
    if (!card) return;
    card.classList.toggle("has-nok", negative);
    card
      .querySelector('[data-fm-action="toggle-plan"]')
      ?.classList.toggle("hidden", !negative);
    if (negative)
      card.querySelector("[data-fm-note-box]")?.classList.remove("hidden");
    else card.querySelector("[data-fm-plan-box]")?.classList.add("hidden");
  }
  function onInput(event: Event) {
    const target = event.target;
    if (!isControl(target)) return;
    const subject =
      closestElement(target, "[data-fm-person]")?.dataset.fmPerson || "";
    const checked = isInput(target) && target.checked;
    if (target.matches(".fm-people-search")) {
      const term = F.key(target.value);
      target.parentElement
        ?.querySelectorAll<HTMLElement>(
          ".fm-choice-list label,[data-fm-schedule-label]",
        )
        .forEach((label) =>
          label.classList.toggle(
            "hidden",
            !F.key(label.textContent).includes(term),
          ),
        );
      return;
    }
    if (target.id === "formsCatalogSearch") {
      catalogFilter.search = target.value;
      filterCatalog();
      return;
    }
    if (target.dataset.fmCatalogFilter) {
      const key = target.dataset.fmCatalogFilter;
      if (oneOf(key, ["search", "area", "type"] as const))
        catalogFilter[key] = target.value;
      filterCatalog();
      return;
    }
    if (target.dataset.fmSelfFilter) {
      if (target.dataset.fmSelfFilter === "year") myYear = Number(target.value);
      else myForm = target.value;
      return;
    }
    if (target.dataset.fmFilter) {
      const key = target.dataset.fmFilter;
      if (
        oneOf(key, [
          "form",
          "person",
          "area",
          "type",
          "year",
          "from",
          "to",
          "search",
        ] as const)
      )
        reportFilter[key] = target.value;
      return;
    }
    if (target.dataset.fmScheduleFilter) {
      const key = target.dataset.fmScheduleFilter;
      if (oneOf(key, ["form", "person", "from", "to"] as const))
        scheduleFilter[key] = target.value;
      else if (
        key === "status" &&
        oneOf(target.value, ["", "PENDING", "COMPLETED", "CANCELLED"] as const)
      )
        scheduleFilter.status = target.value;
      return;
    }
    if (builder && target.dataset.fmEvaluation) {
      builder.schema.evaluation ??= {
        enabled: false,
        area: "",
        membership: "AREA",
      };
      if (target.dataset.fmEvaluation === "enabled")
        builder.schema.evaluation.enabled = checked;
      else if (target.dataset.fmEvaluation === "area")
        builder.schema.evaluation.area = target.value;
      rememberBuilder();
      return;
    }
    if (builder && target.dataset.fmMeta) {
      updateBuilder(builder, target.dataset.fmMeta, target.value, checked);
      rememberBuilder();
      return;
    }
    if (builder && target.dataset.fmSection) {
      const s = builder.schema.sections.find(
        (s) => s.id === target.dataset.fmSection,
      );
      if (s) s.title = target.value;
      rememberBuilder();
      return;
    }
    if (
      builder &&
      target.dataset.fmList &&
      target.dataset.fmList !== "schedule_weekdays"
    ) {
      const name = target.dataset.fmList;
      if (
        oneOf(name, [
          "units",
          "apply_roles",
          "apply_user_ids",
          "report_roles",
          "report_user_ids",
        ] as const)
      ) {
        builder[name] = [
          ...document.querySelectorAll<HTMLInputElement>(
            `[data-fm-list="${name}"]:checked`,
          ),
        ].map((e) => e.value);
      }
      rememberBuilder();
      return;
    }
    if (builder && target.dataset.fmQ) {
      const q = getQuestion(target.dataset.id || ""),
        name = target.dataset.fmQ;
      if (!q) return;
      updateQuestion(q, name, target.value, checked);
      rememberBuilder();
      return;
    }
    if (!response || response.status !== "DRAFT") return;
    if (target.dataset.fmAnswer) {
      const id = target.dataset.fmAnswer,
        f = F.fields(response.schema_snapshot).find((f) => f.id === id);
      if (!f) return;
      const bag = answerBag(id, subject);
      bag[id] ??= {};
      bag[id].value =
        f.type === "NUMBER"
          ? target.value === ""
            ? null
            : Number(target.value)
          : target.value;
      refreshAnswerState(id, subject);
      answerChanged();
    }
    if (target.dataset.fmMultiple) {
      const id = target.dataset.fmMultiple;
      const bag = answerBag(id, subject);
      bag[id] ??= {};
      bag[id].value = [
        ...document.querySelectorAll<HTMLInputElement>(
          `[data-fm-multiple="${id}"]:checked`,
        ),
      ].map((e) => e.value);
      answerChanged();
    }
    if (target.dataset.fmNote) {
      const bag = answerBag(target.dataset.fmNote, subject);
      bag[target.dataset.fmNote] ??= {};
      bag[target.dataset.fmNote].observation = target.value;
      answerChanged();
    }
    if (target.dataset.fmPlan) {
      const bag = answerBag(target.dataset.fmPlan, subject);
      bag[target.dataset.fmPlan] ??= {};
      bag[target.dataset.fmPlan].plan = target.value;
      answerChanged();
    }
    if (target.dataset.fmSectionNote) {
      answers.__sections ??= {};
      answers.__sections[target.dataset.fmSectionNote] = target.value;
      answerChanged();
    }
  }
  function onChange(event: Event) {
    const target = event.target;
    if (!isControl(target)) return;
    if (builder && target.dataset.fmEvaluation === "enabled") {
      if (!builder.schema.evaluation?.enabled)
        for (const f of F.fields(builder.schema)) {
          const question = getQuestion(f.id);
          if (question) question.scope = "GROUP";
        }
      renderManage();
      return;
    }
    if (builder && target.dataset.fmMeta === "apply_everyone") {
      renderManage();
      return;
    }
    if (
      builder &&
      target.dataset.fmQ &&
      ["type", "scored", "allow_na", "require_note", "options"].includes(
        target.dataset.fmQ,
      )
    ) {
      const q = getQuestion(target.dataset.id || "");
      if (!q) return;
      if (target.dataset.fmQ === "type") {
        q.scored = q.type === "BOOLEAN";
        q.expected = q.type === "BOOLEAN" ? "YES" : null;
        q.allow_na = true;
        q.require_note = true;
        if (q.type.includes("CHOICE")) q.options ||= ["Opção 1", "Opção 2"];
      }
      if (
        q.type === "SINGLE_CHOICE" &&
        q.scored &&
        (q.expected == null || !(q.options || []).includes(q.expected))
      )
        q.expected = q.options?.[0] || "";
      rememberBuilder();
      renderManage();
      return;
    }
    if (
      target.dataset.fmAnswer &&
      F.fields(response?.schema_snapshot).find(
        (f) => f.id === target.dataset.fmAnswer,
      )?.type === "SINGLE_CHOICE"
    ) {
      renderResponse();
      return;
    }
    if (
      target.dataset.fmPhotoInput &&
      isInput(target) &&
      target.files?.length
    ) {
      void addPhotos(
        target.dataset.fmPhotoInput,
        [...target.files],
        closestElement(target, "[data-fm-person]")?.dataset.fmPerson || "",
      ).catch((e) => notify(errorMessage(e), "error"));
      return;
    }
    if (target.id === "formsScheduleRepeat")
      $("formsScheduleWeekdays")?.classList.toggle(
        "hidden",
        target.value !== "WEEKLY",
      );
    if (target.id === "formsScheduleModel") {
      const model = findForm(target.value),
        eligible = people.filter((p) => eligiblePerson(model, p));
      renderContent(
        $("formsSchedulePeople"),
        eligible.length ? (
          <div className={"fm-choice-list"}>
            {eligible.map((p, rowIndex) => (
              <label key={rowKey(p, rowIndex)} data-fm-schedule-label={""}>
                <Input
                  type={"checkbox"}
                  data-fm-schedule-user={""}
                  value={p.id}
                ></Input>
                <span>
                  {p.name}
                  {" · "}
                  {ctx().roles[p.role] || p.role}
                </span>
              </label>
            ))}
          </div>
        ) : (
          empty(
            "Nenhum colaborador autorizado",
            "Revise os acessos do formulário.",
          )
        ),
      );
    }
  }
  function isStoredResponse(row: FormReadRow): row is FormResponse {
    return (
      !row._self_view &&
      typeof row.revision === "number" &&
      typeof row.respondent_id === "string" &&
      (!row.own_plans ||
        row.own_plans.every(
          (plan) =>
            typeof plan.revision === "number" &&
            typeof plan.response_id === "string" &&
            "responsible_id" in plan,
        ))
    );
  }
  async function getResponse(id: string) {
    const row =
      responses.find((row) => row.id === id) ||
      (detailResponse?.id === id ? detailResponse : null);
    if (row && isStoredResponse(row)) {
      if (row.unit !== ctx().unit)
        throw Error("Esta aplicação pertence a outra unidade.");
      return row;
    }
    return service.response(id);
  }
  async function handleAction(action: string, target: HTMLElement) {
    const id = target.dataset.id || "",
      subject =
        closestElement(target, "[data-fm-person]")?.dataset.fmPerson || "";
    switch (action) {
      case "self-filter":
        return loadMyEvaluations();
      case "self-evolution":
        myEvolution = true;
        renderMyEvaluations();
        rootFor("forms-self")?.scrollIntoView({ block: "start" });
        return;
      case "self-back":
        myEvolution = false;
        renderMyEvaluations();
        return;
      case "self-detail": {
        const row = myEvaluations.find((r) => r.id === id);
        if (row) return showDetail(row);
        return;
      }
      case "self-pdf": {
        const row = myEvaluations.find((r) => r.id === id);
        if (row) return pdfReport(row);
        return;
      }
      case "self-export-one": {
        const row = myEvaluations.find((r) => r.id === id);
        if (row)
          return exportData(
            "csv",
            [row],
            (row.own_plans || []).map((p) => ({ ...p, response_id: row.id })),
          );
        return;
      }
      case "self-export":
        return exportData(
          "csv",
          myRows(),
          myRows().flatMap((r) =>
            (r.own_plans || []).map((p) => ({ ...p, response_id: r.id })),
          ),
        );
      case "refresh":
        return enter(lastView || "forms-fill");
      case "new":
        return newBuilder();
      case "edit": {
        const f = findForm(id);
        if (f && manage(f)) newBuilder(f);
        return;
      }
      case "duplicate": {
        const f = findForm(id);
        if (!f || !manage(f)) return;
        const copy: FormBuilder = jsonClone(f);
        delete copy.id;
        delete copy.version;
        copy.name = (f.name + " (cópia)").slice(0, 200);
        copy.status = "DRAFT";
        newBuilder(copy);
        return;
      }
      case "restore-builder": {
        const saved = readBuilderDraft(localStorage.getItem(builderKey()));
        if (saved) {
          builder = saved;
          builderTab = "data";
          editingField = saved.schema.sections[0]?.fields[0]?.id || "";
          renderManage();
        }
        return;
      }
      case "close-builder":
        if (
          confirm("Voltar à lista? A criação ficará guardada neste aparelho.")
        ) {
          rememberBuilder();
          builder = null;
          renderManage();
        }
        return;
      case "builder-tab":
        if (!oneOf(id, ["data", "questions", "preview"] as const)) return;
        builderTab = id;
        renderManage();
        return;
      case "preview":
        adapter.modal({
          title: requireForm(id).name,
          subtitle: "Prévia do formulário",
          html: previewHtml(requireForm(id)),
          actions: "",
        });
        return;
      case "save-draft":
        return saveBuilder("DRAFT");
      case "publish":
        return saveBuilder("PUBLISHED");
      case "save-status":
        return saveBuilder(requireBuilder().status);
      case "add-section": {
        const section: FormSection = {
          id: F.id(),
          title: `Seção ${requireBuilder().schema.sections.length + 1}`,
          fields: [],
        };
        requireBuilder().schema.sections.push(section);
        rememberBuilder();
        renderManage();
        return;
      }
      case "section-remove":
        if (requireBuilder().schema.sections.length === 1)
          throw Error("Mantenha ao menos uma seção.");
        if (
          confirm(
            "Remover esta seção e suas perguntas do modelo? Aplicações já iniciadas serão preservadas.",
          )
        ) {
          requireBuilder().schema.sections =
            requireBuilder().schema.sections.filter((s) => s.id !== id);
          rememberBuilder();
          renderManage();
        }
        return;
      case "section-up":
      case "section-down":
        move(
          requireBuilder().schema.sections,
          requireBuilder().schema.sections.findIndex((s) => s.id === id),
          action === "section-up" ? -1 : 1,
        );
        rememberBuilder();
        renderManage();
        return;
      case "add-question": {
        const s = requireBuilder().schema.sections.find((s) => s.id === id);
        if (!s) return;
        const q: FormField = {
          id: F.id(),
          label: "",
          type: "BOOLEAN",
          required: true,
          scored: true,
          expected: "YES",
          allow_na: true,
          require_note: true,
          help: "",
        };
        s.fields.push(q);
        editingField = q.id;
        rememberBuilder();
        renderManage();
        return;
      }
      case "edit-question":
        editingField = editingField === id ? "" : id;
        renderManage();
        return;
      case "question-remove":
        if (confirm("Remover esta pergunta do modelo?")) {
          const s = locateQuestion(id);
          if (!s) return;
          s.fields = s.fields.filter((f) => f.id !== id);
          rememberBuilder();
          renderManage();
        }
        return;
      case "question-up":
      case "question-down": {
        const s = locateQuestion(id);
        if (!s) return;
        move(
          s.fields,
          s.fields.findIndex((f) => f.id === id),
          action === "question-up" ? -1 : 1,
        );
        rememberBuilder();
        renderManage();
        return;
      }
      case "question-copy": {
        const s = locateQuestion(id),
          original = getQuestion(id);
        if (!s || !original) return;
        const q = jsonClone(original);
        q.id = F.id();
        s.fields.splice(s.fields.findIndex((f) => f.id === id) + 1, 0, q);
        editingField = q.id;
        rememberBuilder();
        renderManage();
        return;
      }
      case "catalog":
        if (uploading) throw Error("Aguarde o envio das fotos.");
        catalogFilter = {};
        selectedForm = "";
        response = null;
        clearInterval(clock);
        await loadOwn();
        renderCatalog();
        paintNav();
        return;
      case "back-catalog":
        if (uploading) throw Error("Aguarde o envio das fotos.");
        if (dirty) await saveResponse(false);
        response = null;
        clearInterval(clock);
        await loadOwn();
        renderCatalog();
        return;
      case "application-tab":
        for (const [key, name] of [
          ["available", "Available"],
          ["drafts", "Drafts"],
          ["completed", "Completed"],
        ])
          $(`formsApplication${name}`)?.classList.toggle("hidden", key !== id);
        target.parentElement
          ?.querySelectorAll<HTMLElement>("button")
          .forEach((b) => b.classList.toggle("active", b === target));
        return;
      case "start":
        return begin(id);
      case "start-evaluated": {
        if (busy || !pendingStart) return;
        const people = [
          ...document.querySelectorAll<HTMLInputElement>(
            '[data-fm-list="start_people"]:checked',
          ),
        ].map((e) => e.value);
        if (!people.length) throw Error("Selecione ao menos uma pessoa.");
        const key = currentKey(),
          p = pendingStart;
        busy = true;
        try {
          const row = await rpc("start_form_response_evaluated", {
            p_form_id: p.formId,
            p_unit: ctx().unit,
            p_id: F.id(),
            p_people: people,
            p_assignment_id: p.assignmentId,
          });
          if (key !== currentKey()) return;
          adapter.closeModal();
          pendingStart = null;
          await openResponse(row);
        } finally {
          busy = false;
        }
        return;
      }
      case "resume":
        return openResponse(await getResponse(id));
      case "answer": {
        const bag = answerBag(id, subject);
        bag[id] ??= {};
        const value = target.dataset.value;
        if (!oneOf(value, ["YES", "NO", "NA"] as const)) return;
        bag[id].value = value;
        answerChanged();
        renderResponse();
        return;
      }
      case "evaluated-person":
        if (uploading)
          throw Error("Aguarde o envio das fotos para trocar de pessoa.");
        activePerson = id;
        renderResponse();
        return;
      case "photo-camera":
      case "photo-gallery":
        target
          .closest("[data-fm-person]")
          ?.querySelector<HTMLInputElement>(
            `[data-fm-photo-input="${id}"][data-source="${action === "photo-camera" ? "camera" : "gallery"}"]`,
          )
          ?.click();
        return;
      case "photo-remove": {
        if (uploading) throw Error("Aguarde o envio das fotos.");
        const bag = answerBag(id, subject),
          entry = bag[id];
        if (!entry) return;
        entry.photos = (entry.photos || []).filter(
          (p) => p !== target.dataset.path,
        );
        if (
          F.fields(requireResponse().schema_snapshot).find((f) => f.id === id)
            ?.type === "PHOTO"
        )
          entry.value = entry.photos;
        answerChanged();
        renderResponse();
        return;
      }
      case "toggle-note":
        target
          .closest("[data-fm-person]")
          ?.querySelector<HTMLInputElement>(`[data-fm-note-box="${id}"]`)
          ?.classList.toggle("hidden");
        return;
      case "toggle-plan":
        target
          .closest("[data-fm-person]")
          ?.querySelector<HTMLInputElement>(`[data-fm-plan-box="${id}"]`)
          ?.classList.toggle("hidden");
        return;
      case "section":
        sectionIndex = Number(id);
        renderResponse();
        return;
      case "next-section":
        sectionIndex = Math.min(
          sectionIndex + 1,
          requireResponse().schema_snapshot.sections.length - 1,
        );
        renderResponse();
        rootFor("forms-fill")?.scrollIntoView({ block: "start" });
        return;
      case "previous-section":
        sectionIndex = Math.max(0, sectionIndex - 1);
        renderResponse();
        return;
      case "save-response":
        await saveResponse(false);
        if (navigator.onLine) notify("Respostas salvas.");
        return;
      case "finish":
        return saveResponse(true);
      case "discard":
        if (uploading) throw Error("Aguarde o envio das fotos.");
        if (
          confirm(
            "Descartar este rascunho? O histórico de aplicações finalizadas não será alterado.",
          )
        ) {
          clearTimeout(saveTimer);
          await saveChain.catch(() => {});
          const current = requireResponse();
          await rpc("cancel_form_response", { p_id: current.id });
          localStorage.removeItem(localKey(current));
          response = null;
          answers = {};
          dirty = false;
          clearInterval(clock);
          await loadOwn();
          renderCatalog();
          notify("Rascunho descartado.");
        }
        return;
      case "person-evolution":
        executionPerson = id;
        renderReport();
        rootFor("forms-report")?.scrollIntoView({ block: "start" });
        return;
      case "close-evolution":
        executionPerson = "";
        renderReport();
        return;
      case "report-tab":
        executionPerson = "";
        if (
          !oneOf(id, [
            "summary",
            "applications",
            "execution",
            "farol",
            "charts",
            "conformity",
            "issues",
          ] as const)
        )
          return;
        reportTab = id;
        reportPage = 0;
        return loadReport();
      case "filter":
        reportPage = 0;
        return loadReport();
      case "report-form":
        reportFilter.form = id;
        reportTab = "applications";
        reportPage = 0;
        return loadReport();
      case "page-prev":
        reportPage = Math.max(0, reportPage - 1);
        renderReport();
        return;
      case "page-next":
        reportPage++;
        renderReport();
        return;
      case "detail":
      case "assignment-detail":
        return showDetail(await getResponse(id));
      case "plan":
        if (!target.dataset.field) return;
        return openPlan(await getResponse(id), target.dataset.field);
      case "save-plan":
        return savePlan();
      case "export-csv":
        return exportData("csv");
      case "export-xlsx":
        return exportData("xlsx");
      case "export-form":
        return exportData(
          "xlsx",
          reportRowsFiltered().filter((r) => r.form_id === id),
        );
      case "export-one":
        return exportData("csv", [await getResponse(id)]);
      case "pdf":
        return pdfReport(await getResponse(id));
      case "new-schedule":
        scheduleFormOpen = true;
        renderSchedule();
        return;
      case "close-schedule":
        scheduleFormOpen = false;
        renderSchedule();
        return;
      case "save-schedule":
        return saveSchedule();
      case "schedule-view":
        scheduleView = id;
        if (id === "calendar")
          calendarMonth =
            scheduleFilter.from?.slice(0, 7) ||
            F.localDay(new Date()).slice(0, 7);
        renderSchedule();
        return;
      case "calendar-prev":
        return changeCalendarMonth(-1);
      case "calendar-next":
        return changeCalendarMonth(1);
      case "calendar-assignment": {
        const a = assignments.find((a) => a.id === id);
        if (!a) return;
        const f = findForm(a.form_id);
        adapter.modal({
          title: f?.name || "Agendamento",
          subtitle: day(a.due_date),
          html: (
            <>
              <p>
                <b>{"Colaborador:"}</b> {a.user_name}
              </p>
              <p>
                {a.unit}
                {" · "}
                {STATUS[a.status]}
              </p>
            </>
          ),
          actions: (
            <>
              {a.user_id === ctx().user.id && a.status === "PENDING" && fill(f)
                ? btn(
                    "start-assignment",
                    "Iniciar / continuar",
                    { "data-id": a.id },
                    "primary",
                  )
                : ""}
              {a.response_id
                ? btn("assignment-detail", "Ver aplicação", {
                    "data-id": a.response_id,
                  })
                : ""}
            </>
          ),
        });
        return;
      }
      case "schedule-filter":
        calendarMonth = scheduleFilter.from?.slice(0, 7) || calendarMonth;
        return loadSchedule();
      case "start-assignment": {
        const a = assignments.find((a) => a.id === id);
        if (!a) return;
        return begin(a.form_id, a.id);
      }
      case "cancel-assignment":
        if (confirm("Cancelar este agendamento pendente?")) {
          await rpc("cancel_form_assignment", { p_id: id });
          await loadSchedule();
          notify("Agendamento cancelado.");
        }
        return;
    }
  }
  listen(document, "input", onInput);
  listen(document, "change", (event) => {
    onInput(event);
    onChange(event);
  });
  listen(document, "click", (event) => {
    if (!isElement(event.target)) return;
    const target = closestElement(event.target, "[data-fm-action]");
    if (!target || !target.dataset.fmAction) return;
    event.preventDefault();
    Promise.resolve(handleAction(target.dataset.fmAction, target)).catch(
      (error) => notify(errorMessage(error), "error"),
    );
  });
  listen(window, "beforeunload", (event) => {
    if (dirty || builder || uploading) {
      persist();
      rememberBuilder();
      event.preventDefault();
      event.returnValue = "";
    }
  });
  listen(window, "online", () => {
    if (dirty && response)
      saveResponse(false).catch((e) => notify(errorMessage(e), "error"));
  });
  listen(window, "focus", () => {
    if (identity && navigator.onLine && !builder && !response) void start();
  });
  return {
    start,
    stop,
    enter,
    canChangeUnit,
    refresh: () => enter(lastView || "forms-fill"),
    destroy() {
      stop();
      listeners.splice(0).forEach((remove) => remove());
    },
  };
}
export { create };
