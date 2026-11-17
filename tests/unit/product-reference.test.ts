import { describe, it, expect } from "vitest";
import { nextReference, formatReference } from "@/lib/products/reference";

describe("nextReference", () => {
  it("starts at REF-00001", () => expect(nextReference([])).toBe("REF-00001"));
  it("continues after the highest, ignoring gaps and custom refs", () => {
    expect(nextReference(["REF-00003", "REF-00010", "ABC-1", null, ""])).toBe("REF-00011");
  });
  it("is case/space tolerant", () => expect(nextReference([" ref-00007 "])).toBe("REF-00008"));
  it("grows past the padding", () => expect(nextReference(["REF-99999"])).toBe(formatReference(100000)));
});
