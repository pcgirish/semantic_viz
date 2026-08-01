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
});
