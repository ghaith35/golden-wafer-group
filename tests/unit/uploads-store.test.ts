import { describe, expect, it } from "vitest";
import { isSafeUploadName, uploadsRoot, findLegacyUpload } from "@/lib/uploads/store";

describe("uploads store", () => {
  it("accepts minted names, rejects traversal", () => {
    expect(isSafeUploadName("a1b2c3d4e5f60718293a4b5c.jpg")).toBe(true);
    expect(isSafeUploadName("A1B2C3D4E5F60718293A4B5C.PNG")).toBe(true);
    expect(isSafeUploadName("../../etc/passwd")).toBe(false);
    expect(isSafeUploadName("x.webp")).toBe(false);
    expect(isSafeUploadName("photo.svg")).toBe(false);
  });
  it("resolves under userData when set", () => {
    process.env.DISTRIBUILI_USERDATA = "/tmp/ud-test";
    expect(uploadsRoot()).toBe("/tmp/ud-test/uploads");
    delete process.env.DISTRIBUILI_USERDATA;
    expect(uploadsRoot().endsWith("public/uploads")).toBe(true);
  });
  it("never finds garbage", () => {
    expect(findLegacyUpload("products", "../../x.jpg")).toBeNull();
    expect(findLegacyUpload("nope", "a1b2c3d4e5f60718293a4b5c.jpg")).toBeNull();
    expect(findLegacyUpload("products", "a1b2c3d4e5f60718293a4b5c.jpg")).toBeNull();
  });
});
