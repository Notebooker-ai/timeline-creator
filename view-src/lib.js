// Pure helpers for the timeline view: date parsing, the precision a source
// actually stated, and how a long jump between events is described.
//
// Split out of main.js so they can be tested directly (see lib.test.mjs) —
// they carry the fiddly cases (BC years, bare years, era suffixes) that a
// rendering test would never reach.

// Date supports BC via negative years. Bare years, eras and "circa" prefixes
// are parsed here; anything else goes to the native parser.
export function yearDate(y) {
  var d = new Date(0);
  d.setFullYear(y, 0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parseDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  var s = String(value).trim().replace(/^(?:c\.?|ca\.?|circa)\s+/i, "");
  if (!s) return null;
  var ym = /^(-?\d{1,4})$/.exec(s);
  if (ym) return yearDate(parseInt(ym[1], 10));
  var bc = /^(\d{1,5})\s*(?:BCE?|B\.C\.(?:E\.)?)$/i.exec(s);
  if (bc) return yearDate(1 - parseInt(bc[1], 10));
  var ad =
    /^(\d{1,5})\s*(?:AD|A\.D\.|CE|C\.E\.)$/i.exec(s) ||
    /^(?:AD|A\.D\.|CE|C\.E\.)\s*(\d{1,5})$/i.exec(s);
  if (ad) return yearDate(parseInt(ad[1], 10));
  // A date with no time is a calendar date, not an instant. Date.parse reads
  // "1356-09-19" as UTC midnight, which every timezone behind UTC then renders
  // as the 18th — the Battle of Poitiers was dated a day early on the whole
  // west coast. Build these as local dates so the day that is displayed is the
  // day the source wrote.
  var ymd = /^(-?\d{1,4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
  if (ymd) {
    var d = yearDate(parseInt(ymd[1], 10));
    d.setMonth(parseInt(ymd[2], 10) - 1, ymd[3] ? parseInt(ymd[3], 10) : 1);
    return isNaN(d.getTime()) ? null : d;
  }
  var t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

export function yearLabel(y) {
  return y <= 0 ? 1 - y + " BC" : String(y);
}

export var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// How precisely the source stated this date. A bare "1356" must not be shown as
// "1 Jan 1356" — that is a fact the sources never asserted.
export function precisionOf(raw) {
  var s = String(raw == null ? "" : raw).trim().replace(/^(?:c\.?|ca\.?|circa)\s+/i, "");
  if (/^-?\d{1,4}$/.test(s)) return "year";
  if (/^\d{1,5}\s*(?:BCE?|B\.C\.(?:E\.)?|AD|A\.D\.|CE|C\.E\.)$/i.test(s)) return "year";
  if (/^(?:AD|A\.D\.|CE|C\.E\.)\s*\d{1,5}$/i.test(s)) return "year";
  if (/^-?\d{1,4}-\d{2}$/.test(s)) return "month";
  return "day";
}

export function formatDate(date, precision) {
  var y = yearLabel(date.getFullYear());
  if (precision === "year") return y;
  if (precision === "month") return MONTHS[date.getMonth()] + " " + y;
  return date.getDate() + " " + MONTHS[date.getMonth()] + " " + y;
}

export var YEAR_MS = 365.2425 * 24 * 3600 * 1000;

// A gap is worth calling out only when it dwarfs the timeline's normal step, so
// that a steady march of years does not sprout a marker between every row.
export function gapLabel(ms) {
  var years = ms / YEAR_MS;
  if (years >= 1.5) return Math.round(years) + " years";
  var days = ms / (24 * 3600 * 1000);
  if (days >= 60) return Math.round(days / 30.44) + " months";
  if (days >= 2) return Math.round(days) + " days";
  return null;
}

