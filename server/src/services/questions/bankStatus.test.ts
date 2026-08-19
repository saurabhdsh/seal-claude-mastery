import { describe, expect, it } from "vitest";
import { computeBankStatus } from "./bankStatus.js";

describe("computeBankStatus", () => {
  const now = new Date("2026-08-19T12:00:00Z");
  const gen = new Date("2026-08-19T10:00:00Z");

  it("returns new when drafts are pending review", () => {
    expect(computeBankStatus(3, null, gen)).toBe("new");
  });

  it("returns updated when approved after the latest generation", () => {
    const approved = new Date("2026-08-19T11:00:00Z");
    expect(computeBankStatus(0, approved, gen)).toBe("updated");
  });

  it("returns current when nothing recent needs action", () => {
    expect(computeBankStatus(0, null, null)).toBe("current");
  });
});
