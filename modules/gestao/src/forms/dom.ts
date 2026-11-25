export type FormControl =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement;

export function isElement(target: EventTarget | null): target is HTMLElement {
  return (
    !!target &&
    "tagName" in target &&
    typeof target.tagName === "string" &&
    "closest" in target
  );
}
export function isControl(target: EventTarget | null): target is FormControl {
  return (
    isElement(target) &&
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}
export function isInput(target: FormControl): target is HTMLInputElement {
  return target.tagName === "INPUT";
}
export function controlValue(id: string): string {
  const element = document.getElementById(id);
  if (!isControl(element))
    throw Error(
      "Este campo não está mais disponível. Reabra a tela para continuar.",
    );
  return element.value;
}
export function closestElement(
  element: Element,
  selector: string,
): HTMLElement | null {
  return element.closest<HTMLElement>(selector);
}
