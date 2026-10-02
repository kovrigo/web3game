import { expect, test } from "bun:test";
import { fmtDate } from "../src/config";

test("dates read 02 Oct 2026 in UTC, September included", () => {
  expect(fmtDate(Date.parse("2026-10-02T23:59:00Z"))).toBe("02 Oct 2026");
  expect(fmtDate(Date.parse("2026-09-29T00:00:00Z"))).toBe("29 Sep 2026");
  expect(fmtDate(Date.parse("2026-09-29T00:00:00Z"), false)).toBe("29 Sep");
});
