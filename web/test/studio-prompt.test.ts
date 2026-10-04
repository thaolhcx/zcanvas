import { describe, it, expect } from "vitest";
import { toDisplay, toStored, uniqueLabels } from "../src/studio/prompt.ts";
describe("Studio @ references", () => {
  const refs = [
    { assetId: "ast_1", label: "Logo" },
    { assetId: "ast_2", label: "Logo 2" },
  ];
  it("shows labels and stores ids, both ways, exactly", () => {
    const display = "Put @Logo 2 and @Logo on a bag, mail@Logo.com stays";
    const stored = toStored(display, refs);
    expect(stored).toBe(
      "Put @[Logo 2](asset:ast_2) and @[Logo](asset:ast_1) on a bag, mail@[Logo](asset:ast_1).com stays",
    );
    expect(toDisplay(stored, refs)).toBe(display);
  });
  it("keeps a link when the file is renamed, and shows a removed one as plain text", () => {
    const stored = "Use @[Logo](asset:ast_1)";
    expect(toDisplay(stored, [{ assetId: "ast_1", label: "Brand mark" }])).toBe(
      "Use @Brand mark",
    );
    expect(toDisplay(stored, [])).toBe("Use @Logo");
  });
  it("gives repeated file names their own labels", () => {
    expect(
      uniqueLabels([
        { name: "logo.png" },
        { name: "logo.jpg" },
        { name: "[x].png" },
      ]).map((r) => r.label),
    ).toEqual(["logo", "logo 2", "x"]);
  });
});
