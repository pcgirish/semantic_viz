import { describe, expect, it } from "vitest";
import { normalizeText, semanticHashInput } from "../src/normalize.js";

describe("normalizeText", () => {
  it("lowercases and trims", () => {
    expect(normalizeText("  Order Processing  ")).toBe("order processing");
  });

  it("collapses internal whitespace runs to one space", () => {
    expect(normalizeText("order\t\n  processing")).toBe("order processing");
  });

  it("strips trailing punctuation", () => {
    expect(normalizeText("Handles orders.")).toBe("handles orders");
    expect(normalizeText("Really?!")).toBe("really");
  });

  it("keeps punctuation that is not trailing", () => {
    expect(normalizeText("orders, billing, and shipping")).toBe("orders, billing, and shipping");
  });

  it("treats the two Unicode spellings of the same string as equal", () => {
    // "e-acute" as one code point vs "e" + combining acute. Built from escapes, not literals:
    // an editor saving this file would normalize both spellings to identical bytes and the test
    // would pass without exercising anything. Without NFC these hash differently, so a rename
    // that only changed the encoding would read as a real change.
    const composed = "Caf\u00e9";
    const decomposed = "Cafe\u0301";
    expect(composed).not.toBe(decomposed);
    expect(normalizeText(composed)).toBe(normalizeText(decomposed));
  });

  it("returns an empty string for an empty or punctuation-only input", () => {
    expect(normalizeText("")).toBe("");
    expect(normalizeText("...")).toBe("");
  });
});

describe("semanticHashInput", () => {
  it("does not depend on the key order the semantics object was built with", () => {
    const a = semanticHashInput("Orders", { what: "w", how: "h", when: "n", where: "e", why: "y" });
    const b = semanticHashInput("Orders", { why: "y", where: "e", when: "n", how: "h", what: "w" });
    expect(a).toBe(b);
  });

  it("renders absent semantics as empty strings rather than dropping the fields", () => {
    // Fixed arity matters: if nulls collapsed, a unit with only `what` set could serialize
    // identically to one with only `why` set.
    const onlyWhat = semanticHashInput("Orders", { what: "x", how: null, when: null, where: null, why: null });
    const onlyWhy = semanticHashInput("Orders", { what: null, how: null, when: null, where: null, why: "x" });
    expect(onlyWhat).not.toBe(onlyWhy);
  });

  it("is driven by the name alone when semantics are null", () => {
    expect(semanticHashInput("Orders", null)).not.toBe(semanticHashInput("Billing", null));
  });

  it("normalizes every field, so cosmetic differences do not read as changes", () => {
    expect(semanticHashInput("  ORDERS ", null)).toBe(semanticHashInput("orders", null));
  });
});
