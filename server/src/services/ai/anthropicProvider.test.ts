import { describe, expect, it } from "vitest";
import { extractJson } from "./anthropicProvider.js";

describe("extractJson", () => {
  it("parses fenced json", () => {
    const v = extractJson('```json\n{"a":1}\n```');
    expect(v).toEqual({ a: 1 });
  });

  it("parses json arrays at the root", () => {
    const v = extractJson('[{"questionType":"SINGLE_MCQ","questionText":"x"}]');
    expect(Array.isArray(v)).toBe(true);
  });

  it("extracts the outer object when prose wraps json", () => {
    const v = extractJson('Here is the set:\n{"questions":[{"questionType":"SINGLE_MCQ"}]}\nThanks.');
    expect(v).toEqual({ questions: [{ questionType: "SINGLE_MCQ" }] });
  });

  it("throws on empty content", () => {
    expect(() => extractJson("   ")).toThrow("Model did not return JSON");
  });
});
