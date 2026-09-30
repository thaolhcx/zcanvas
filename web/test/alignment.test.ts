import { describe, it, expect } from "vitest";
import { findAlignment } from "../src/alignment.ts";

describe("helper-line alignment in flow units", () => {
  const bounds = { x: 105, y: 200, width: 80, height: 60 };
  it("snaps at the inclusive 5-unit boundary and keeps the zero-coordinate guide", () => {
    expect(
      findAlignment({ ...bounds, x: 5 }, [
        { x: 0, y: 400, width: 80, height: 60 },
      ]),
    ).toEqual({ x: 0, dx: -5, dy: 0, left: 0 });
    expect(
      findAlignment({ ...bounds, x: 5.01 }, [
        { x: 0, y: 400, width: 80, height: 60 },
      ]),
    ).toEqual({ dx: 0, dy: 0 });
  });
  it("picks the closest match on each axis, including candidates later in the list", () => {
    expect(
      findAlignment(bounds, [
        { x: 100, y: 500, width: 80, height: 60 },
        { x: 103, y: 198, width: 80, height: 60 },
      ]),
    ).toEqual({ x: 103, y: 198, dx: -2, dy: -2, left: 103, top: 198 });
  });
  it("matches centers and opposite edges across different node sizes", () => {
    expect(
      findAlignment(bounds, [{ x: 23, y: 300, width: 120, height: 90 }]),
    ).toEqual({ x: 143, dx: -2, dy: 0, left: 103 });
    expect(
      findAlignment(bounds, [{ x: 10, y: 300, width: 173, height: 90 }]),
    ).toEqual({ x: 183, dx: -2, dy: 0, left: 103 });
  });
  it("has no guide or movement outside the threshold or without targets", () => {
    expect(
      findAlignment(bounds, [{ x: 500, y: 500, width: 80, height: 60 }]),
    ).toEqual({ dx: 0, dy: 0 });
    expect(findAlignment(bounds, [])).toEqual({ dx: 0, dy: 0 });
  });
  it("supports negative and fractional coordinates without rounding", () => {
    expect(
      findAlignment({ ...bounds, x: -104.5, y: -100.5 }, [
        { x: -100.25, y: -98.75, width: 80, height: 60 },
      ]),
    ).toEqual({
      x: -100.25,
      y: -98.75,
      dx: 4.25,
      dy: 1.75,
      left: -100.25,
      top: -98.75,
    });
  });
  it("keeps the first equivalent match when a multi-node box has floating-point noise", () => {
    const result = findAlignment(
      { x: 1082.0610687022902, y: 43, width: 999.9999999999998, height: 332 },
      [
        { x: 1080, y: 500, width: 280, height: 200 },
        { x: 1800, y: 500, width: 280, height: 200 },
      ],
    );
    expect(result.x).toBe(1080);
    expect(result.left).toBe(1080);
  });
});
