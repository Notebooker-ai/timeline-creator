// Self-contained view bundle for the timeline-creator "timeline.v1" artifact.
//
// Renders with vis-timeline (bundled, offline) instead of the previous
// hand-rolled absolute-positioning renderer, whose estimated label widths,
// full-height gridlines, and hard ellipsis truncation made dense timelines
// unreadable. vis-timeline measures real DOM, stacks without overlap, and
// gives zoom/pan for free.
//
// vis-timeline parses bare-year strings like "1956" as epoch milliseconds —
// the reason the first version avoided it — so every date goes through
// parseDate() below (bare years, BC/AD/BCE/CE eras, "circa" prefixes) and only
// real Date objects reach the library.
//
// Built by build.mjs into ../src/timeline_creator/view/index.html — do not edit
// the generated HTML by hand.
// The standalone build self-injects vis-timeline's CSS at runtime (after the
// shell's <style>), which is why the shell overrides use `html`-prefixed
// selectors — they must win on specificity, not order.
import { Timeline, DataSet } from "vis-timeline/standalone";

var root = document.getElementById("root");
var current = null; // live Timeline instance, destroyed on re-render

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// ---- date parsing (the vis-timeline bare-year shim) ------------------------

// Date supports BC via negative years. ISO dates/datetimes contain non-digits
// and are handed to the native parser.
function yearDate(y) {
  var d = new Date(0);
  d.setFullYear(y, 0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDate(value) {
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
  var t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

// Axis label for a (possibly astronomical/negative) year: 0 => "1 BC".
function yearLabel(y) {
  return y <= 0 ? 1 - y + " BC" : String(y);
}

// Axis formatting: moment renders negative years as "-000240"; label year-and-
// coarser scales ourselves, defer to moment's defaults for finer scales.
var MINOR_FMT = {
  millisecond: "SSS", second: "s", minute: "HH:mm", hour: "HH:mm",
  weekday: "ddd D", day: "D", week: "w", month: "MMM",
};
var MAJOR_FMT = {
  millisecond: "HH:mm:ss", second: "D MMMM HH:mm", minute: "ddd D MMMM",
  hour: "ddd D MMMM", weekday: "MMMM YYYY", day: "MMMM YYYY",
  week: "MMMM YYYY", month: "YYYY",
};

function momentYear(date) {
  return typeof date.year === "function"
    ? date.year()
    : new Date(date.valueOf()).getFullYear();
}

function minorLabel(date, scale) {
  if (scale in MINOR_FMT) return date.format(MINOR_FMT[scale]);
  return yearLabel(momentYear(date));
}

function majorLabel(date, scale) {
  if (scale in MAJOR_FMT) return date.format(MAJOR_FMT[scale]);
  return "";
}

// ---- per-schema renderers (keep old versions forever) ----------------------
var renderers = {
  "timeline.v1": renderTimelineV1,
};

function renderTimelineV1(data) {
  if (current) {
    try { current.destroy(); } catch (e) {}
    current = null;
  }
  root.innerHTML = "";
  var title = data && data.title;
  if (title) {
    var h = document.createElement("h1");
    h.className = "title";
    h.textContent = title;
    root.appendChild(h);
  }

  var raw = data && Array.isArray(data.items) ? data.items : [];
  var items = [];
  var usedGroups = {};
  raw.forEach(function (it, i) {
    it = it || {};
    var start = parseDate(it.start);
    if (!start || !it.content) return;
    var end = parseDate(it.end);
    if (end && end.getTime() <= start.getTime()) end = null;
    var item = {
      id: String(it.id || "e" + i),
      content: esc(it.content),
      title: esc(it.content),
      start: start,
    };
    if (end) {
      item.end = end;
      item.type = it.type === "background" ? "background" : "range";
    }
    if (typeof it.group === "string" && it.group) {
      item.group = it.group;
      usedGroups[it.group] = true;
    }
    items.push(item);
  });

  if (!items.length) {
    root.innerHTML += '<div class="empty">No dated events to show.</div>';
    return;
  }

  // Lane groups: declared ones (in order) that are actually used, then any
  // undeclared ids items reference. When lanes exist, ungrouped items get a
  // trailing anonymous lane — vis hides items whose group is missing.
  var declared = data && Array.isArray(data.groups) ? data.groups : [];
  var groups = [];
  declared.forEach(function (g) {
    if (g && g.id != null && usedGroups[g.id]) {
      groups.push({ id: g.id, content: esc(g.content || String(g.id)) });
      delete usedGroups[g.id];
    }
  });
  Object.keys(usedGroups).forEach(function (id) {
    groups.push({ id: id, content: esc(id) });
  });
  if (groups.length) {
    var hasUngrouped = false;
    items.forEach(function (it) {
      if (it.group == null) {
        it.group = "__other__";
        hasUngrouped = true;
      }
    });
    if (hasUngrouped) groups.push({ id: "__other__", content: "&nbsp;" });
  }

  // Initial window covers everything with a little padding; zoom-out is capped
  // just beyond it, zoom-in at a day.
  var min = Infinity, max = -Infinity;
  items.forEach(function (it) {
    min = Math.min(min, it.start.getTime());
    max = Math.max(max, (it.end || it.start).getTime());
  });
  if (min === max) { min -= 31536000000; max += 31536000000; }
  // Extra trailing room: box labels center over their dot, so events near the
  // right edge otherwise clip against the frame.
  var span = max - min;
  var padStart = span * 0.06;
  var pad = span * 0.14;

  var el = document.createElement("div");
  root.appendChild(el);

  var options = {
    stack: true,
    maxHeight: 560,
    minHeight: 220,
    start: new Date(min - padStart),
    end: new Date(max + pad),
    min: new Date(min - span * 0.5),
    max: new Date(max + span * 0.5),
    zoomMin: 1000 * 60 * 60 * 24,
    zoomKey: "ctrlKey",
    tooltip: { followMouse: true, overflowMethod: "flip" },
    margin: { item: { horizontal: 8, vertical: 8 }, axis: 10 },
    order: function (a, b) { return a.start - b.start; },
    format: { minorLabels: minorLabel, majorLabels: majorLabel },
    xss: { disabled: true }, // content is escaped above; vis's filter mangles entities
  };

  current = groups.length
    ? new Timeline(el, new DataSet(items), new DataSet(groups), options)
    : new Timeline(el, new DataSet(items), options);

  var hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Drag to pan · ctrl+scroll (or pinch) to zoom";
  root.appendChild(hint);
}

// ---- host handshake --------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
}

function resolveTheme(msg) {
  return msg.theme === "dark" ? "dark" : "light";
}

function onArtifact(msg) {
  applyTheme(resolveTheme(msg));
  var r = renderers[msg.schema_id];
  if (!r) {
    root.innerHTML = '<div class="empty">No renderer for "' + esc(msg.schema_id) + '".</div>';
    return;
  }
  try {
    r(msg.data || {});
  } catch (e) {
    var detail = e && e.message ? " (" + esc(e.message) + ")" : "";
    root.innerHTML = '<div class="empty">Failed to render this artifact.' + detail + "</div>";
  }
}

window.addEventListener("message", function (e) {
  var d = e.data;
  if (d && d.type === "open-notebook:artifact") onArtifact(d);
});
// Tell the host we're listening; it (re)posts the artifact in response.
try { parent.postMessage({ type: "open-notebook:ready" }, "*"); } catch (e) {}
