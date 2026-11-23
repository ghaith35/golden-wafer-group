import { describe, it, expect } from "vitest";
import { decodeJpegDataUrl } from "@/lib/closed-visits/service";
import { syncOpSchema } from "@/lib/sync/validation";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const url = (b: Buffer, mime = "image/jpeg") => `data:${mime};base64,${b.toString("base64")}`;

describe("closed-shop photo decoding", () => {
  it("accepts a real JPEG data URL", () => {
    expect(decodeJpegDataUrl(url(jpeg))?.length).toBe(jpeg.length);
  });
  it("rejects non-JPEG bytes, other mime types and junk", () => {
    expect(decodeJpegDataUrl(url(Buffer.from("<script>alert(1)</script>")))).toBeNull();
    expect(decodeJpegDataUrl(url(jpeg, "image/png"))).toBeNull();
    expect(decodeJpegDataUrl("not a data url")).toBeNull();
    expect(decodeJpegDataUrl(null)).toBeNull();
  });
  it("rejects oversize photos", () => {
    const big = Buffer.concat([jpeg, Buffer.alloc(2 * 1024 * 1024 + 1)]);
    expect(decodeJpegDataUrl(url(big))).toBeNull();
  });
});

describe("sync op envelope", () => {
  it("knows the client-closed kind", () => {
    const r = syncOpSchema.safeParse({ opId: "abcdefgh1", kind: "client-closed", payload: { clientId: "c1", photos: [] } });
    expect(r.success).toBe(true);
  });
});
