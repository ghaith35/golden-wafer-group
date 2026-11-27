import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExpenseTypePicker, expenseTypeStyle } from "@/components/expenses/ExpenseTypePicker";

const types = [
  { id: "t1", name: "Carburant" },
  { id: "t2", name: "Repas" },
  { id: "t3", name: "Truc inconnu" },
];

describe("ExpenseTypePicker", () => {
  it("renders one radio per type and marks the selected one", () => {
    const html = renderToStaticMarkup(
      createElement(ExpenseTypePicker, { types, value: "t2", onChange: () => {}, label: "Types", required: true, emptyText: "none" })
    );
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain("Repas");
    expect(html).toContain("text-red-500"); // required star
  });

  it("shows the empty message when the company has no types", () => {
    const html = renderToStaticMarkup(createElement(ExpenseTypePicker, { types: [], value: "", onChange: () => {}, emptyText: "Ask the admin" }));
    expect(html).toContain("Ask the admin");
    expect(html).not.toContain('role="radio"');
  });

  it("guesses styles across languages and is stable for unknown names", () => {
    expect(expenseTypeStyle("Carburant").tone).toBe(expenseTypeStyle("وقود").tone);
    expect(expenseTypeStyle("Essence").tone).toBe(expenseTypeStyle("fuel").tone);
    expect(expenseTypeStyle("Réparation").tone).toBe(expenseTypeStyle("صيانة").tone);
    expect(expenseTypeStyle("Truc inconnu")).toEqual(expenseTypeStyle("Truc inconnu"));
  });
});
