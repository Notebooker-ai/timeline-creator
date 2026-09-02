// Self-contained view bundle for the timeline-creator "timeline.v1" artifact.
//
// A vertical, scrolling timeline: one event per row, read top to bottom.
//
// It replaces a horizontal vis-timeline render, which had three problems that
// were all the same problem — a horizontal axis spends its width on elapsed
// time rather than on labels. Real notebook timelines are lumpy: the published
// "Black Prince" timeline put 17 of its 18 events inside six years and one
// outlier 17 years earlier, so almost the whole axis was empty and the events
// were an unreadable pile at one end. In a 557px embed card there was no room
// for labels at all, and the library's own measure-then-unhide redraw could
// leave the whole thing blank.
//
// Vertical fixes all three: every row gets the full width for its text, rows
// are evenly spaced so density is set by how many events there are rather than
// by how they clump, and a long jump between consecutive events is called out
// explicitly instead of being drawn as empty space. It is also plain DOM, so
// there is no library to leave content hidden and nothing to bundle.
//
// Built by build.mjs into ../src/timeline_creator/view/index.html — do not edit
// the generated HTML by hand.

var root = document.getElementById("root");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

import {
  YEAR_MS,
  formatDate,
  gapLabel,
  parseDate,
  precisionOf,
} from "./lib.js";

// ---- per-schema renderers (keep old versions forever) ----------------------
var renderers = {
  "timeline.v1": renderTimelineV1,
};

function renderTimelineV1(data) {
  root.innerHTML = "";

  var raw = data && Array.isArray(data.items) ? data.items : [];
  var events = [];
  raw.forEach(function (it, i) {
    it = it || {};
    var start = parseDate(it.start);
    if (!start || !it.content) return;
    var end = parseDate(it.end);
    if (end && end.getTime() <= start.getTime()) end = null;
    events.push({
      content: String(it.content),
      detail: typeof it.detail === "string" ? it.detail.trim() : "",
      group: typeof it.group === "string" ? it.group.trim() : "",
      start: start,
      end: end,
      startPrecision: precisionOf(it.start),
      endPrecision: precisionOf(it.end),
      order: i,
    });
  });

  if (data && data.title) {
    var h = document.createElement("h1");
    h.className = "title";
    h.textContent = data.title;
    root.appendChild(h);
  }

  if (!events.length) {
    var empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No dated events to show.";
    root.appendChild(empty);
    return;
  }

  // Chronological, ties broken by the order the model listed them in.
  events.sort(function (a, b) {
    return a.start - b.start || a.order - b.order;
  });

  // Lane labels, when the artifact declares them.
  var groupNames = {};
  var declared = data && Array.isArray(data.groups) ? data.groups : [];
  declared.forEach(function (g) {
    if (g && g.id != null) groupNames[String(g.id)] = String(g.content || g.id);
  });

  // A gap earns a marker when it is several times the typical step between
  // events — measured against the median so one huge outlier cannot raise the
  // bar above every other gap.
  var steps = [];
  for (var i = 1; i < events.length; i++) {
    steps.push(events[i].start - events[i - 1].start);
  }
  var sorted = steps.slice().sort(function (a, b) { return a - b; });
  var median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  var threshold = Math.max(median * 4, YEAR_MS);

  var list = document.createElement("ol");
  list.className = "tl";

  events.forEach(function (ev, idx) {
    if (idx > 0) {
      var delta = ev.start - events[idx - 1].start;
      var label = delta > threshold ? gapLabel(delta) : null;
      if (label) {
        var gap = document.createElement("li");
        gap.className = "gap";
        gap.setAttribute("aria-hidden", "true");
        gap.innerHTML = '<span class="tick"></span><span class="gap-label">' + esc(label) + "</span>";
        list.appendChild(gap);
      }
    }

    var when = formatDate(ev.start, ev.startPrecision);
    if (ev.end) when += " – " + formatDate(ev.end, ev.endPrecision);

    var row = document.createElement("li");
    row.className = "row";
    var html =
      '<time class="when">' + esc(when) + "</time>" +
      '<span class="tick" aria-hidden="true"><i class="dot"></i></span>' +
      '<div class="body"><p class="what">' + esc(ev.content) + "</p>";
    if (ev.detail) html += '<p class="detail">' + esc(ev.detail) + "</p>";
    if (ev.group) {
      html += '<span class="lane">' + esc(groupNames[ev.group] || ev.group) + "</span>";
    }
    html += "</div>";
    row.innerHTML = html;
    list.appendChild(row);
  });

  root.appendChild(list);
}

// ---- host handshake --------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
}

function onArtifact(msg) {
  applyTheme(msg.theme === "dark" ? "dark" : "light");
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
