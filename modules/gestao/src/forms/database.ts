import type {
  ActionPlan,
  Answers,
  EvaluatedPerson,
  FormAssignment,
  FormBuilder,
  FormDefinition,
  FormPerson,
  FormResponse,
  OwnEvaluation,
  PlanStatus,
} from "./models";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};
type StartArgs = {
  p_form_id: string;
  p_unit: string;
  p_id: string;
  p_assignment_id: string | null;
};
type PlanArgs = {
  p_response_id: string;
  p_field_id: string;
  p_expected_revision: number;
  p_payload: {
    description: string;
    responsible_id: string;
    due_date: string;
    status: PlanStatus;
    completion_note: string;
  };
};
export type FormsFunctions = {
  forms_staff_people: { Args: Record<string, never>; Returns: FormPerson[]; };
  forms_people_with_areas: {
    Args: Record<string, never>;
    Returns: FormPerson[];
  };
  forms_evaluation_people: {
    Args: { p_form_id: string; p_unit: string };
    Returns: EvaluatedPerson[];
  };
  save_form_definition: {
    Args: {
      p_id: string | null;
      p_expected_version: number;
      p_payload: FormBuilder;
    };
    Returns: FormDefinition;
  };
  start_form_response: { Args: StartArgs; Returns: FormResponse };
  start_form_response_evaluated: {
    Args: StartArgs & { p_people: string[] };
    Returns: FormResponse;
  };
  save_form_response: {
    Args: {
      p_id: string;
      p_expected_revision: number;
      p_answers: Answers;
      p_finalize: boolean;
    };
    Returns: FormResponse;
  };
  cancel_form_response: { Args: { p_id: string }; Returns: null };
  my_form_evaluations: {
    Args: { p_unit: string; p_from: string; p_to: string; p_offset: number };
    Returns: OwnEvaluation[];
  };
  save_form_evaluation_plan: { Args: PlanArgs; Returns: ActionPlan };
  save_form_action_plan: { Args: PlanArgs; Returns: ActionPlan };
  create_form_schedule: {
    Args: {
      p_form_id: string;
      p_unit: string;
      p_users: string[];
      p_start: string;
      p_end: string;
      p_repeat: string;
      p_weekdays: number[];
    };
    Returns: number;
  };
  cancel_form_assignment: { Args: { p_id: string }; Returns: null };
};
// This describes the existing 79–81 migrations. It does not create or change schema.
export type FormsDatabase = {
  public: {
    Tables: {
      form_definitions: Table<FormDefinition>;
      form_responses: Table<FormResponse>;
      form_assignments: Table<FormAssignment>;
      form_action_plans: Table<ActionPlan>;
    };
    Views: Record<string, never>;
    Functions: FormsFunctions;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
