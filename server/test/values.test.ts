import { it, expect } from "vitest";
import { checkValues } from "../src/values.ts";
import type { Asset } from "../../contracts/index.ts";
it("resolves asset unions to real input kinds before invoking a model", () => {
  const video = { id: "asset", kind: "video" } as Asset;
  expect(() =>
    checkValues([{ key: "image", kind: "image", required: true }], {
      image: video,
    }),
  ).toThrow("received video");
  expect(() =>
    checkValues([{ key: "media", kind: ["video", "audio"] }], { media: video }),
  ).not.toThrow();
});
it("bounds inline outputs and rejects scalar/list mismatches", () => {
  expect(() =>
    checkValues([{ key: "text", kind: "text" }], {
      text: { value: "x".repeat(65537) },
    }),
  ).toThrow("64 KB");
  expect(() =>
    checkValues([{ key: "text", kind: "text" }], { text: [{ value: "x" }] }),
  ).toThrow("one value");
});
it("accepts local browser origins and rejects remote or opaque origins", async () => {
  const { isLocalOrigin } = await import("../src/origin.ts");
  expect(isLocalOrigin("http://127.0.0.1:4173")).toBe(true);
  expect(isLocalOrigin(undefined)).toBe(true);
  expect(isLocalOrigin("https://unrelated.example")).toBe(false);
  expect(isLocalOrigin("null")).toBe(false);
});
