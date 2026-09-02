import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDate, gapLabel, parseDate, precisionOf, YEAR_MS } from "./lib.js";

test("parses the date shapes a source actually writes", () => {
  assert.equal(parseDate("1356").getFullYear(), 1356);
  assert.equal(parseDate("1356-09-19").getFullYear(), 1356);
  assert.equal(parseDate("c. 1450").getFullYear(), 1450);
  assert.equal(parseDate("circa 1450").getFullYear(), 1450);
  // Date carries BC as year <= 0: 240 BC is astronomical year -239.
  assert.equal(parseDate("240 BC").getFullYear(), -239);
  assert.equal(parseDate("240 BCE").getFullYear(), -239);
  assert.equal(parseDate("AD 79").getFullYear(), 79);
  assert.equal(parseDate("79 CE").getFullYear(), 79);
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("sometime later"), null);
});

test("keeps each date to the precision the source stated", () => {
  // A bare year must never be shown as 1 January — that is a fact the sources
  // never asserted. The old horizontal axis lost this distinction entirely.
  assert.equal(precisionOf("1356"), "year");
  assert.equal(precisionOf("240 BC"), "year");
  assert.equal(precisionOf("1356-09"), "month");
  assert.equal(precisionOf("1356-09-19"), "day");

  assert.equal(formatDate(parseDate("1356"), "year"), "1356");
  assert.equal(formatDate(parseDate("1356-09"), "month"), "Sep 1356");
  assert.equal(formatDate(parseDate("1356-09-19"), "day"), "19 Sep 1356");
  assert.equal(formatDate(parseDate("240 BC"), "year"), "240 BC");
});

test("describes a long jump in units a reader can hold", () => {
  assert.equal(gapLabel(17 * YEAR_MS), "17 years");
  assert.equal(gapLabel(4 * 30.44 * 24 * 3600 * 1000), "4 months");
  assert.equal(gapLabel(9 * 24 * 3600 * 1000), "9 days");
  // Short hops get no marker at all; a timeline of consecutive days should not
  // sprout a label between every row.
  assert.equal(gapLabel(6 * 3600 * 1000), null);
});

test("reads a calendar date as the day the source wrote", () => {
  // Date.parse treats "1356-09-19" as UTC midnight, so anywhere behind UTC it
  // renders as the 18th. The published Black Prince timeline dated the Battle
  // of Poitiers a day early across the whole US.
  const d = parseDate("1356-09-19");
  assert.equal(d.getFullYear(), 1356);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 19);
  assert.equal(formatDate(d, "day"), "19 Sep 1356");
  assert.equal(formatDate(parseDate("1356-09"), "month"), "Sep 1356");
});
