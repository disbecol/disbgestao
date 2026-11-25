import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";

export type FormsView =
  | "forms-manage"
  | "forms-fill"
  | "forms-report"
  | "forms-schedule"
  | "forms-self";
export interface FormsProfile {
  id?: string;
  name: string;
  role: string;
}
export interface FormsContext {
  client: SupabaseClient | null;
  user: { id: string } | null;
  profile: FormsProfile | null;
  unit: string;
  units: string[];
  roles: Record<string, string>;
}
export interface FormsModal {
  title: string;
  subtitle?: string;
  html: string;
  actions?: string;
}
export type ReactFormsModal = Omit<FormsModal, "html" | "actions"> & {
  html: ReactNode;
  actions?: ReactNode;
};
export type ReactFormsAdapter = Omit<FormsAdapter, "modal"> & {
  modal(options: ReactFormsModal): void;
};
export interface FormsAdapter {
  context(): FormsContext;
  hasPermission(code: string): boolean;
  toast(message: string, kind?: string): void;
  openView(view: string, keepState?: boolean): void;
  modal(options: FormsModal): void;
  closeModal(): void;
  download(name: string, data: Blob): Promise<void> | void;
}
export interface FormsModule {
  start(): Promise<void>;
  stop(): void;
  enter(view: FormsView): Promise<void>;
  canChangeUnit(): boolean;
  refresh(): Promise<void>;
  destroy(): void;
}
