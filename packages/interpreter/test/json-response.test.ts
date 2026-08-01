import { describe, expect, it } from "vitest";
import { parseJsonResponse } from "../src/json-response.js";

describe("parseJsonResponse", () => {
  it("parses plain JSON", () => {
    expect(parseJsonResponse('{"a":1}', "label")).toEqual({ a: 1 });
  });

  it("strips a ```json fence some models wrap JSON in despite instructions", () => {
    expect(parseJsonResponse('```json\n{"a":1}\n```', "label")).toEqual({ a: 1 });
  });

  it("strips a bare ``` fence", () => {
    expect(parseJsonResponse('```\n{"a":1}\n```', "label")).toEqual({ a: 1 });
  });

  it("throws a labeled error on non-JSON", () => {
    expect(() => parseJsonResponse("not json", "pass X")).toThrow(/pass x/i);
  });

  it("strips a fence even when the model adds trailing prose after the closing ```", () => {
    expect(parseJsonResponse('```json\n{"a":1}\n```\n\nLet me know if you need anything else!', "label")).toEqual({ a: 1 });
  });

  it("strips a fence even when the model adds leading prose before the opening ```", () => {
    expect(parseJsonResponse('Here is the JSON:\n\n```json\n{"a":1}\n```', "label")).toEqual({ a: 1 });
  });

  it("extracts JSON from an unclosed fence (response truncated mid-stream)", () => {
    expect(parseJsonResponse('```json\n{"a":1,"b":[1,2,3]}', "label")).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("prefers the last balanced JSON block over an earlier one — reasoning models draft an example before the real answer", () => {
    const text = 'Thinking... maybe something like {"a": "draft example"} then the real one:\n\n{"a":2}';
    expect(parseJsonResponse(text, "label")).toEqual({ a: 2 });
  });

  it("prefers the last well-formed JSON block even when an earlier one is syntactically valid too", () => {
    const text = 'Draft: {"a":1}\n\nFinal answer: {"a":2}';
    expect(parseJsonResponse(text, "label")).toEqual({ a: 2 });
  });

  it("repairs a comma written in place of a colon after an object key", () => {
    const text = '{\n"what": "x",\n"when", "y",\n"where": "z"\n}';
    expect(parseJsonResponse(text, "label")).toEqual({ what: "x", when: "y", where: "z" });
  });
});
