import { Fragment, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

const roots = new Map<Element, { root: Root; revision: number }>();

export function releaseContent(container: Element): void {
  for (const [element, state] of roots) {
    if (
      element === container ||
      container.contains(element) ||
      !element.isConnected
    ) {
      flushSync(() => state.root.unmount());
      roots.delete(element);
    }
  }
}

export function renderContent(
  container: Element | null,
  content: ReactNode,
): void {
  if (!container) return;
  // Remove nested islands before replacing their parent, e.g. a schedule's people list.
  for (const [element, state] of roots) {
    if (
      element !== container &&
      (container.contains(element) || !element.isConnected)
    ) {
      flushSync(() => state.root.unmount());
      roots.delete(element);
    }
  }
  let state = roots.get(container);
  if (!state) {
    state = { root: createRoot(container), revision: 0 };
    roots.set(container, state);
  }
  state.revision += 1;
  // This is the synchronous boundary with the existing controller, which queries
  // controls immediately after painting. Components themselves do not call flushSync.
  flushSync(() =>
    state.root.render(<Fragment key={state.revision}>{content}</Fragment>),
  );
}
