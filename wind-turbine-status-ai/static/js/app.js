/* WindWatch AI – front-end logic (vanilla JS, no build step) */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
const COLORS = { 0: "var(--ok)", 3: "var(--warn)", 5: "var(--bad)" };
const KEY_COUNT = 10;

let SCHEMA = null;
const inputs = {};          // feature name -> <input>/<select>
let lastRows = [];          // last upload results (for CSV download)

/* ------------------------------------------------------------ boot */
fetch("/api/schema").then(r => r.json()).then(s => {
  SCHEMA = s;
  buildHeroStats(); buildForm(); buildSamples(); buildModelSection();
}).catch(() => { $("#keyFields").innerHTML = '<div class="error">Could not load the model schema. Is the server running?</div>'; });

function labelOf(code) { return SCHEMA.labels[String(code)] || ("Status " + code); }
const statusClass = code => "s" + code;

/* ------------------------------------------------------------ hero + model section */
function buildHeroStats() {
  const best = SCHEMA.metrics.find(m => m.Model === SCHEMA.model_name) || SCHEMA.metrics[0];
  const items = [
    [SCHEMA.train_rows.toLocaleString(), "training readings"],
    [SCHEMA.features.length, "sensor features"],
    [SCHEMA.codes.length, "status classes"],
    [best["Test macro-F1"].toFixed(2), "hold-out macro-F1"],
  ];
  $("#heroStats").innerHTML = items.map(([a, b]) => `<div class="stat"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join("");
  $("#nAll").textContent = SCHEMA.features.length;
}

function buildModelSection() {
  const rows = SCHEMA.metrics;
  $("#metricsTable").innerHTML =
    "<thead><tr><th>Model</th><th>Accuracy</th><th>Macro recall</th><th>Macro-F1</th><th>Train macro-F1</th></tr></thead><tbody>" +
    rows.map(m => `<tr class="${m.Model === SCHEMA.model_name ? "best" : ""}"><td>${m.Model === SCHEMA.model_name ? "🏆 " : ""}${esc(m.Model)}</td>
      <td>${m["Test accuracy"].toFixed(3)}</td><td>${m["Test recall (macro)"].toFixed(3)}</td><td>${m["Test macro-F1"].toFixed(3)}</td><td>${m["Train macro-F1"].toFixed(3)}</td></tr>`).join("") + "</tbody>";
  const best = rows.find(m => m.Model === SCHEMA.model_name) || rows[0];
    $("#whyBest").innerHTML = `<b>${esc(best.Model)}</b> is deployed because it has the highest hold-out <b>macro-F1</b> (${best["Test macro-F1"].toFixed(3)}) –
    the fairest score when one status dominates the data. Train macro-F1 ${best["Train macro-F1"].toFixed(3)} vs hold-out ${best["Test macro-F1"].toFixed(3)} – nearly equal, so the model is not overfitting.
    Tree-based models score higher plain accuracy but miss more of the rare abnormal states.`;
  const top = SCHEMA.features.slice(0, 10), mx = Math.max(...top.map(f => f.importance), 1e-9);
  $("#importanceBars").innerHTML = top.map(f => `<div class="imp-row"><code title="${esc(f.name)}">${esc(f.name)}</code>
    <div class="bar"><div style="width:${Math.max(3, f.importance / mx * 100)}%"></div></div></div>`).join("") +
    '<p class="muted small" style="margin-top:12px">Permutation importance: how much the macro-F1 drops when a sensor is shuffled.</p>';
}

/* ------------------------------------------------------------ single-reading form */
function fmt(v) { return String(Number(Number(v).toPrecision(6))); }

function makeField(f) {
  const wrap = document.createElement("div"); wrap.className = "field";
  let el;
  if (f.name === "asset_id") {
    el = document.createElement("select");
    [f.min, f.max].forEach(v => { const o = document.createElement("option"); o.value = v; o.textContent = "Turbine " + v; el.appendChild(o); });
    el.value = fmt(f.default) === fmt(f.max) ? f.max : f.min;
    f.default = Number(el.value);
  } else {
    el = document.createElement("input"); el.type = "number"; el.step = "any";
    el.value = fmt(f.default);
    if (f.name === "hour") { el.min = 0; el.max = 23; el.step = 1; }
    if (f.name === "month") { el.min = 1; el.max = 12; el.step = 1; }
    el.title = `Training range: ${fmt(f.min)} to ${fmt(f.max)}`;
  }
  el.dataset.default = fmt(f.default);
  el.addEventListener("input", () => el.classList.toggle("changed", el.value !== el.dataset.default));
  inputs[f.name] = el;
  wrap.innerHTML = `<label title="${esc(f.name)}">${esc(f.name)}</label>`; wrap.appendChild(el);
  return wrap;
}

function buildForm() {
  const key = $("#keyFields"), all = $("#allFields");
  key.innerHTML = ""; all.innerHTML = "";
  SCHEMA.features.forEach((f, i) => (i < KEY_COUNT ? key : all).appendChild(makeField(f)));
  $("#resultSingle").innerHTML = placeholder();
  $("#resultPaste").innerHTML = placeholder();
}

function placeholder() {
  return '<div class="placeholder"><span class="big">📡</span>Your prediction will appear here.<br><small>Enter sensor values and press Predict.</small></div>';
}
function loading() { return '<div class="spinner"></div>'; }

function buildSamples() {
  const sel = $("#sampleSelect"), counter = {};
  SCHEMA.samples.forEach((s, i) => {
    counter[s.actual_status] = (counter[s.actual_status] || 0) + 1;
    const o = document.createElement("option"); o.value = i;
    o.textContent = `${labelOf(s.actual_status)} – sample ${counter[s.actual_status]}`; sel.appendChild(o);
  });
  sel.addEventListener("change", () => {
    if (sel.value === "") return;
    const vals = SCHEMA.samples[+sel.value].values;
    Object.entries(vals).forEach(([k, v]) => { const el = inputs[k]; if (el) { el.value = fmt(v); el.dispatchEvent(new Event("input")); } });
    if (vals.asset_id !== undefined) inputs.asset_id.value = vals.asset_id;
  });
  $("#resetBtn").addEventListener("click", () => {
    Object.values(inputs).forEach(el => { el.value = el.dataset.default; el.classList.remove("changed"); });
    sel.value = ""; $("#resultSingle").innerHTML = placeholder();
  });
  $("#toggleAll").addEventListener("click", e => {
    const box = $("#allFields"); box.classList.toggle("hidden");
    e.target.innerHTML = box.classList.contains("hidden") ? `Show all <span>${SCHEMA.features.length}</span> features ▾` : "Hide extra features ▴";
  });
}

function collectValues() {
  const out = {};
  Object.entries(inputs).forEach(([k, el]) => { const v = parseFloat(el.value); if (!Number.isNaN(v)) out[k] = v; });
  return out;
}

/* ------------------------------------------------------------ prediction result */
async function postJSON(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || "Request failed"); return j;
}

function renderResult(box, r) {
  const code = r.code, cls = statusClass(code), conf = Math.round(r.confidence * 100);
  const probs = SCHEMA.codes.map(c => {
    const p = r.probabilities[String(c)] || 0;
    return `<div class="prob-row"><span>${esc(labelOf(c))}</span><div class="bar"><div class="c${c}" style="width:${p * 100}%"></div></div><b>${pct(p)}</b></div>`;
  }).join("");
  const mx = Math.max(...(r.factors || []).map(f => Math.abs(f.impact)), 1e-9);
  const factors = (r.factors || []).length ? `<div class="factors"><h4 class="mini" style="margin:16px 0 6px">Why this prediction</h4>` +
    r.factors.map(f => `<div class="factor"><span><code>${esc(f.feature)}</code> = ${esc(fmt(f.value))}</span>
      <div class="fbar"><div style="width:${Math.abs(f.impact) / mx * 100}%;background:${f.impact >= 0 ? "var(--accent)" : "var(--bad)"}"></div></div></div>`).join("") +
    `<div class="note">Cyan bars push towards “${esc(r.label)}”, red bars push away from it.</div></div>` : "";
  const filled = r.filled_defaults ? `<div class="note">${r.filled_defaults} of ${r.total_features} features were not provided and were filled with typical (median) values.</div>` : "";
  box.innerHTML = `
    <div class="badge ${cls}">
      <div class="ring" style="--p:${conf};--c:${COLORS[code]}"><i>${conf}%</i></div>
      <div><div class="code">Predicted status · code ${code}</div><h3>${esc(r.label)}</h3></div>
    </div>
    <div class="prob">${probs}</div>${factors}${filled}`;
}

async function predictFrom(box, getValues) {
  box.innerHTML = loading();
  try { renderResult(box, await postJSON("/api/predict", { values: getValues() })); }
  catch (e) { box.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}
$("#predictBtn").addEventListener("click", () => predictFrom($("#resultSingle"), collectValues));

/* ------------------------------------------------------------ paste a row */
function parsePasted(text) {
  text = text.trim(); if (!text) throw new Error("Paste a row first.");
  if (text[0] === "{" || text[0] === "[") {
    let o = JSON.parse(text); if (Array.isArray(o)) o = o[0]; return o;
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("For CSV paste two lines: a header line and a value line.");
  const split = l => l.split(/[,\t;]/).map(s => s.trim());
  const h = split(lines[0]), v = split(lines[1]), o = {};
  h.forEach((k, i) => { const n = Number(v[i]); o[k] = v[i] !== "" && !Number.isNaN(n) ? n : v[i]; });
  return o;
}
$("#pasteBtn").addEventListener("click", () => {
  const box = $("#resultPaste");
  try { const obj = parsePasted($("#pasteBox").value); predictFrom(box, () => obj); }
  catch (e) { box.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
});
$("#pasteSample").addEventListener("click", () => {
  const s = SCHEMA && SCHEMA.samples[2]; if (!s) return;
  $("#pasteBox").value = JSON.stringify(s.values, null, 1);
});

/* ------------------------------------------------------------ tabs */
$$(".tab").forEach(t => t.addEventListener("click", () => {
  $$(".tab").forEach(x => x.classList.remove("active")); t.classList.add("active");
  $$(".panel").forEach(p => p.classList.remove("active")); $("#tab-" + t.dataset.tab).classList.add("active");
}));

/* ------------------------------------------------------------ upload dataset */
let chosenFile = null;
function setFile(f) {
  chosenFile = f; $("#fileName").textContent = f ? `${f.name} · ${(f.size / 1024 / 1024).toFixed(2)} MB` : "CSV or Excel · up to 40 MB · first 50,000 rows are scored";
  $("#uploadBtn").disabled = !f;
}
$("#fileInput").addEventListener("change", e => setFile(e.target.files[0]));
const drop = $("#drop");
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

$("#uploadBtn").addEventListener("click", async () => {
  const out = $("#uploadResult"); out.innerHTML = loading();
  const fd = new FormData(); fd.append("file", chosenFile);
  try {
    const r = await fetch("/api/predict_file", { method: "POST", body: fd });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "Upload failed");
    renderUpload(out, j);
  } catch (e) { out.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
});

function renderUpload(out, { summary: s, rows }) {
  lastRows = rows;
  const total = s.rows;
  const kp = SCHEMA.codes.map(c => `<div class="kpi"><b style="color:${COLORS[c]}">${pct(s.counts[c] / total)}</b><span>${esc(labelOf(c))} · ${s.counts[c].toLocaleString()} rows</span></div>`).join("");
  const acc = s.accuracy !== undefined ? `<div class="kpi"><b>${pct(s.accuracy)}</b><span>Accuracy vs your status column</span></div><div class="kpi"><b>${s.macro_f1.toFixed(3)}</b><span>Macro-F1 vs your status column</span></div>` : "";
  const stack = SCHEMA.codes.map(c => `<div class="c${c}" style="width:${s.counts[c] / total * 100}%" title="${esc(labelOf(c))}"></div>`).join("");
  const legend = SCHEMA.codes.map(c => `<span><i class="c${c}"></i>${esc(labelOf(c))}</span>`).join("");
  const warn = (s.missing_columns ? `<div class="note">${s.missing_columns} of ${s.total_features} model columns were not in your file and were filled with typical values.</div>` : "") +
    (s.truncated ? `<div class="note">Only the first 50,000 rows were scored.</div>` : "");
  out.innerHTML = `
    <div class="kpis"><div class="kpi"><b>${total.toLocaleString()}</b><span>Rows scored</span></div>${kp}${acc}</div>
    <div class="stack">${stack}</div><div class="legend">${legend}</div>
    <div class="toolbar"><button class="btn small primary" id="dlBtn" type="button">⬇ Download predictions (CSV)</button></div>${warn}
    <div class="table-wrap" style="margin-top:14px"><table class="tbl" id="resTable"></table></div>
    <div class="toolbar center"><button class="btn small ghost" id="moreBtn" type="button">Show more rows</button></div>`;
  let shown = 0; const hasActual = rows[0] && "actual" in rows[0];
  const cols = ["row", ...(rows[0].time_stamp !== undefined ? ["time_stamp"] : []), ...(rows[0].asset_id !== undefined ? ["asset_id"] : []), "label", "confidence", ...(hasActual ? ["actual"] : [])];
  $("#resTable").innerHTML = `<thead><tr>${cols.map(c => `<th>${c === "label" ? "predicted status" : c.replace("_", " ")}</th>`).join("")}</tr></thead><tbody></tbody>`;
  const body = $("#resTable tbody");
  function more() {
    rows.slice(shown, shown + 100).forEach(r => {
      body.insertAdjacentHTML("beforeend", "<tr>" + cols.map(c => {
        if (c === "label") return `<td><span class="tag t${r.predicted}">${esc(r.label)}</span></td>`;
        if (c === "confidence") return `<td>${pct(r.confidence)}</td>`;
        if (c === "actual") return `<td>${r.actual === null ? "–" : esc(labelOf(r.actual)) + (r.actual === r.predicted ? " ✓" : " ✗")}</td>`;
        return `<td>${esc(r[c])}</td>`;
      }).join("") + "</tr>");
    });
    shown += 100; if (shown >= rows.length) $("#moreBtn").classList.add("hidden");
  }
  more(); $("#moreBtn").addEventListener("click", more); $("#dlBtn").addEventListener("click", downloadCSV);
}

function downloadCSV() {
  if (!lastRows.length) return;
  const cols = Object.keys(lastRows[0]);
  const q = v => { v = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = [cols.join(","), ...lastRows.map(r => cols.map(c => q(r[c])).join(","))].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "windwatch_predictions.csv"; a.click(); URL.revokeObjectURL(a.href);
}
