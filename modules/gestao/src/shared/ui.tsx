import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export type Tone = "neutral" | "good" | "bad" | "warn" | "brand";
export function rowKey(item: unknown, index: number): string | number {
  if (
    item &&
    typeof item === "object" &&
    "id" in item &&
    (typeof item.id === "string" || typeof item.id === "number")
  ) {
    const evaluated =
      "evaluated_user_id" in item ? String(item.evaluated_user_id ?? "") : "";
    return String(item.id) + (evaluated ? ":" + evaluated : "");
  }
  return index;
}
type AttributeValue = string | number | boolean;
type Attributes = Record<string, AttributeValue | undefined>;
type OptionItem = string | { value: string; label?: string };
let controlId = 0;

// Compatibility at the controller boundary only. React always escapes the resulting values.
// Never interpret markup or event handlers supplied in an attribute fragment.
export function attributeProps(
  fragment: string | Attributes | false | null | undefined,
): Attributes {
  if (!fragment) return {};
  if (typeof fragment !== "string") return fragment;
  const attrs: Attributes = {};
  const aliases: Record<string, string> = {
    readonly: "readOnly",
    maxlength: "maxLength",
    minlength: "minLength",
    tabindex: "tabIndex",
    class: "className",
  };
  const pattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of fragment.matchAll(pattern)) {
    const key = match[1];
    if (
      /^on/i.test(key) ||
      !/^(data-[\w-]+|aria-[\w-]+|id|name|title|type|role|class|readonly|required|disabled|checked|selected|multiple|min|max|step|maxlength|minlength|placeholder|rows|tabindex|value|list|accept|capture)$/.test(
        key,
      )
    )
      continue;
    const value = match[2] ?? match[3] ?? match[4];
    attrs[aliases[key] ?? key] =
      value === undefined ? true : decodeAttribute(value);
  }
  return attrs;
}

function decodeAttribute(text: string): string {
  return text.replace(
    /&(amp|lt|gt|quot|#39|#x27);/g,
    (entity) =>
      ({
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&#39;": "'",
        "&#x27;": "'",
      })[entity] ?? entity,
  );
}

export function styleProps(value: string): CSSProperties {
  const result: Record<string, string> = {};
  for (const declaration of value.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim();
    if (!property) continue;
    const key = property.startsWith("--")
      ? property
      : property.replace(/-([a-z])/g, (_, letter: string) =>
          letter.toUpperCase(),
        );
    result[key] = declaration.slice(colon + 1).trim();
  }
  return result;
}

export function nonEmpty(node: ReactNode): ReactNode {
  return Array.isArray(node) && node.length === 0 ? null : node;
}

// The existing autosave controller receives bubbled input events. These controls are
// intentionally uncontrolled; a repaint replaces the page with the saved model.
export function Input({
  value,
  checked,
  defaultValue,
  defaultChecked,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      defaultValue={defaultValue ?? value}
      defaultChecked={defaultChecked ?? checked}
    />
  );
}
export function TextArea({
  value,
  children,
  defaultValue,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const text =
    children == null ? undefined : Children.toArray(children).join("");
  return <textarea {...props} defaultValue={defaultValue ?? value ?? text} />;
}
type OptionProps = {
  value?: string | number;
  selected?: boolean;
  children?: ReactNode;
  disabled?: boolean;
};
export function Option({ selected: _selected, ...props }: OptionProps) {
  return <option {...props} />;
}
function selectedOption(children: ReactNode): string | number | undefined {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<OptionProps>(child)) continue;
    if (child.type === Option && child.props.selected) return child.props.value;
    if (child.type === Fragment) {
      const result = selectedOption(child.props.children);
      if (result !== undefined) return result;
    }
  }
  return undefined;
}
export function Select({
  value,
  defaultValue,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      defaultValue={defaultValue ?? value ?? selectedOption(children)}
    >
      {children}
    </select>
  );
}

export function badge(text: ReactNode, kind: Tone = "neutral") {
  return <span className={`fm-badge ${kind}`}>{text}</span>;
}
export function empty(title: ReactNode, detail: ReactNode = "") {
  return (
    <div className="fm-empty">
      <span aria-hidden="true">▤</span>
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}
export function field(label: ReactNode, control: ReactNode, wide = false) {
  let id = "";
  function identify(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (node) => {
      if (!isValidElement<{ id?: string; children?: ReactNode }>(node))
        return node;
      if (
        [Input, Select, TextArea, "input", "select", "textarea"].includes(
          node.type as typeof Input,
        ) &&
        !id
      ) {
        id = node.props.id || `forms-control-${++controlId}`;
        return cloneElement(node, { id });
      }
      return node.type === Fragment
        ? cloneElement(node, { children: identify(node.props.children) })
        : node;
    });
  }
  const controls = identify(control);
  return (
    <div className={`field ${wide ? "fm-wide" : ""}`}>
      <label htmlFor={id || undefined}>{label}</label>
      {controls}
    </div>
  );
}
export function input(
  name: string,
  value: string | number = "",
  attrs: string | Attributes = "",
) {
  return <Input data-fm-meta={name} value={value} {...attributeProps(attrs)} />;
}
export function options(
  items: OptionItem[],
  value?: string | number | null,
  placeholder = "Todos",
) {
  return (
    <>
      <Option value="">{placeholder}</Option>
      {items.map((item) => {
        const key = typeof item === "string" ? item : item.value;
        return (
          <Option
            key={key}
            value={key}
              selected={value != null && String(key) === String(value)}
          >
            {typeof item === "string" ? item : (item.label ?? item.value)}
          </Option>
        );
      })}
    </>
  );
}
export function btn(
  action: string,
  label: ReactNode,
  attrs: string | Attributes = "",
  kind = "secondary",
) {
  return (
    <button
      type="button"
      className={`btn ${kind}`}
      data-fm-action={action}
      {...attributeProps(attrs)}
    >
      {label}
    </button>
  );
}
export function head(
  label: string,
  title: string,
  text: string,
  actions: ReactNode = "",
) {
  return (
    <div className="page-head">
      <div>
        <div className="breadcrumb">FORMULÁRIOS / {label}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
