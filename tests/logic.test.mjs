import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveJobDate,
  isInRange,
  parseMoney,
  periodRange,
  shiftAnchor,
} from "../src/lib/utils.ts";

test("Türkçe para girişlerini kuruşa çevirir", () => {
  assert.equal(parseMoney("1.234,56"), 123456);
  assert.equal(parseMoney("250"), 25000);
  assert.equal(parseMoney("0"), null);
  assert.equal(parseMoney("0", true), 0);
});

test("hafta filtresi pazartesiden pazara hesaplanır", () => {
  const range = periodRange("week", "2026-09-03");
  assert.equal(range.start, "2026-08-31");
  assert.equal(range.end, "2026-09-06");
  assert.equal(isInRange("2026-09-01", range.start, range.end), true);
  assert.equal(isInRange("2026-09-07", range.start, range.end), false);
});

test("dönem okları doğru tarihe geçer", () => {
  assert.equal(shiftAnchor("2026-09-03", "day", 1), "2026-09-04");
  assert.equal(shiftAnchor("2026-09-03", "week", -1), "2026-08-27");
  assert.equal(shiftAnchor("2026-09-03", "month", 1), "2026-10-03");
  assert.equal(shiftAnchor("2026-09-03", "year", -1), "2025-09-03");
});

test("ödenmeyen eski iş bugüne, ödenen iş ödeme tarihine yazılır", () => {
  const openJob = { status: "open", plannedDate: "2026-08-25", paidDate: null };
  const paidJob = { status: "paid", plannedDate: "2026-08-25", paidDate: "2026-09-01" };
  assert.equal(effectiveJobDate(openJob, "2026-09-03"), "2026-09-03");
  assert.equal(effectiveJobDate(paidJob, "2026-09-03"), "2026-09-01");
});
