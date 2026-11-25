import { create as createController } from "./forms/controller";
import { releaseContent, renderContent } from "./shared/react-host";
import type { FormsAdapter, FormsModule, ReactFormsModal } from "./forms/types";
export const engine = "react-typescript";
export { releaseContent as release };

export function create(adapter: FormsAdapter): FormsModule {
  const controller = createController({
    ...adapter,
    modal({ html, actions, ...metadata }: ReactFormsModal) {
      for (const id of ["modalBody", "modalActions"]) {
        const element = document.getElementById(id);
        if (element) releaseContent(element);
      }
      adapter.modal({ ...metadata, html: "", actions: "" });
      renderContent(document.getElementById("modalBody"), html);
      renderContent(document.getElementById("modalActions"), actions);
    },
    closeModal() {
      for (const id of ["modalBody", "modalActions"]) {
        const element = document.getElementById(id);
        if (element) releaseContent(element);
      }
      adapter.closeModal();
    },
  });
  const clearRoots = () => {
    for (const view of [
      "forms-manage",
      "forms-fill",
      "forms-report",
      "forms-schedule",
      "forms-self",
    ]) {
      const element = document.getElementById("view-" + view);
      if (element) releaseContent(element);
    }
    const nav = document.getElementById("formsDynamicNav");
    if (nav) releaseContent(nav);
    if (document.getElementById("modal")?.classList.contains("forms-modal")) {
      for (const id of ["modalBody", "modalActions"]) {
        const element = document.getElementById(id);
        if (element) releaseContent(element);
      }
      adapter.closeModal();
    }
  };
  return {
    ...controller,
    stop() {
      controller.stop();
      clearRoots();
    },
    destroy() {
      controller.destroy();
      clearRoots();
    },
  };
}

// Existing navigation and the Android bridge keep the same module contract.
Object.assign(window, {
  DISB_FORMS_UI: { create, engine, release: releaseContent },
});
