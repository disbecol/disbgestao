import { describe, expect, it } from "vitest";
import { Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Input,
  Option,
  Select,
  TextArea,
  attributeProps,
  btn,
  field,
  head,
  nonEmpty,
  options,
  styleProps,
} from "../src/shared/ui";

describe("shared React controls", () => {
  it("keeps label associations, existing IDs and siblings such as a datalist", () => {
    const html = renderToStaticMarkup(
      field(
        "Área",
        <>
          <Input id="area" list="areas" />
          <datalist id="areas">
            <Option value="Entrega" />
          </datalist>
        </>,
      ),
    );
    expect(html).toContain('for="area"');
    expect(html).toContain('id="area"');
    expect(html).toContain('list="areas"');
    expect(html).toContain('<datalist id="areas">');
  });
  it("selects the stored value through nested fragments without leaking selected to DOM options", () => {
    const html = renderToStaticMarkup(
      <Select>
        {options(
          [
            { value: "a", label: "Um" },
            { value: "b", label: "Dois" },
          ],
          "b",
        )}
      </Select>,
    );
    expect(html).toMatch(/<option value="b" selected="">Dois<\/option>/);
    expect(html).not.toMatch(/value="a" selected/);
  });
  it("preserves zero and empty values instead of substituting a default option", () => {
    const html = renderToStaticMarkup(
      <Fragment>
        <Input value={0} />
        <Select value="">
          <Option value="">Todos</Option>
          <Option value="other">Outro</Option>
        </Select>
      </Fragment>,
    );
    expect(html).toContain('value="0"');
    expect(html).toContain('value="" selected=""');
  });
  it("keeps multiline responses literal and escapes markup", () => {
    const html = renderToStaticMarkup(
      <TextArea>{"Linha 1\n<img src=x> & resposta"}</TextArea>,
    );
    expect(html).toContain("Linha 1\n&lt;img src=x&gt; &amp; resposta");
    expect(html).not.toContain("<img");
  });
  it("preserves checkbox and readonly semantics", () => {
    const html = renderToStaticMarkup(
      <Input type="checkbox" checked readOnly />,
    );
    expect(html).toContain('checked=""');
    expect(html).toContain('readOnly=""');
  });
  it("escapes action metadata and titles without interpreting HTML", () => {
    const html = renderToStaticMarkup(
      head(
        "Dados",
        "<script>texto</script>",
        "Descrição",
        btn("edit", "Editar", {
          "data-id": 'a" data-fm-action="delete',
          "aria-label": 'Cliente "A"',
        }),
      ),
    );
    expect(html).toContain("&lt;script&gt;texto&lt;/script&gt;");
    expect(html).toContain('data-fm-action="edit"');
    expect(html).toContain('data-id="a&quot; data-fm-action=&quot;delete"');
    expect(html).not.toContain('data-fm-action="delete"');
  });
  it("limits the attribute compatibility boundary to form metadata and native flags", () => {
    expect(
      attributeProps(
        'data-id="abc" disabled aria-label="Um &amp; dois" onclick="alert(1)" src="https://invalid.example"',
      ),
    ).toEqual({ "data-id": "abc", disabled: true, "aria-label": "Um & dois" });
  });
  it("converts simple inline styles and supports CSS variables", () => {
    expect(
      styleProps("width:40%; background-color: red; --progress:0.4"),
    ).toEqual({ width: "40%", backgroundColor: "red", "--progress": "0.4" });
  });
  it("allows empty lists to reach their empty-state fallback", () => {
    expect(nonEmpty([])).toBeNull();
    expect(nonEmpty(["Item"])).toEqual(["Item"]);
  });
});
