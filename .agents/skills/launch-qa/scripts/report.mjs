#!/usr/bin/env node
// report: validate persona findings, rank merged issues, render the launch QA report.
//
//   node report.mjs check <findings.json>        validate one persona's file (personas run this before finishing)
//   node report.mjs collect <runDir> <round>     validate round-N/*/findings.json, print a flat table to cluster from
//   node report.mjs rank <runDir>                sort issues.json by users hit, then severity, then funnel position
//   node report.mjs render <runDir>              write report.md + report.html (before/after when round 2 exists)
//
// Layout (see references/findings.md):
//   <runDir>/run.json
//   <runDir>/round-1/<persona>/findings.json + screenshots
//   <runDir>/issues.json                          merged + ranked, written by the lead
//   <runDir>/round-2/<persona>/findings.json      rerun; may carry "verifies": [{ issue, status, screenshot }]

import fs from "node:fs";
import path from "node:path";

const PERSONAS = ["impatient", "skeptic", "mobile", "nonnative", "breaker"];
const SEVERITY = { blocker: 0, major: 1, minor: 2 };
const KINDS = ["stuck", "confused", "annoyed", "error", "trust"];

const readJSON = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const exists = (f) => fs.existsSync(f);
const die = (m) => {
  console.error(m);
  process.exit(1);
};

function personaDirs(runDir, round) {
  const dir = path.join(runDir, `round-${round}`);
  if (!exists(dir)) die(`missing ${dir}`);
  return fs
    .readdirSync(dir)
    .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
    .sort((a, b) => PERSONAS.indexOf(a) - PERSONAS.indexOf(b))
    .map((d) => path.join(dir, d));
}

function validate(file) {
  const problems = [];
  let data;
  try {
    data = readJSON(file);
  } catch (e) {
    return { problems: [`${file}: not valid JSON (${e.message})`] };
  }
  const base = path.dirname(file);
  if (!data.persona) problems.push("missing persona");
  if (typeof data.reachedSuccess !== "boolean") problems.push("reachedSuccess must be true/false");
  if (!Array.isArray(data.findings)) problems.push("findings must be an array");
  for (const f of data.findings || []) {
    const id = f.id || "(no id)";
    if (!f.id) problems.push("finding without id");
    if (!f.title) problems.push(`${id}: missing title`);
    if (!(f.severity in SEVERITY)) problems.push(`${id}: severity must be blocker|major|minor`);
    if (!KINDS.includes(f.kind)) problems.push(`${id}: kind must be ${KINDS.join("|")}`);
    if (!f.screenshot) problems.push(`${id}: no screenshot`);
    else if (!exists(path.resolve(base, f.screenshot))) problems.push(`${id}: screenshot not found: ${f.screenshot}`);
  }
  return { data, problems };
}

function collect(runDir, round) {
  const rows = [];
  let bad = 0;
  for (const dir of personaDirs(runDir, round)) {
    const file = path.join(dir, "findings.json");
    if (!exists(file)) {
      console.log(`!! ${path.basename(dir)}: no findings.json`);
      bad++;
      continue;
    }
    const { data, problems } = validate(file);
    if (problems.length) {
      bad++;
      console.log(`!! ${path.basename(dir)}:\n   - ${problems.join("\n   - ")}`);
    }
    if (!data) continue;
    const verdict = data.reachedSuccess ? "reached success" : `STOPPED at: ${data.stoppedAt || "?"}`;
    console.log(`\n## ${data.persona} — ${verdict} — ${data.findings?.length || 0} findings`);
    for (const f of data.findings || []) rows.push({ persona: data.persona, ...f });
    for (const v of data.verifies || []) console.log(`   verify ${v.issue}: ${v.status}${v.note ? ` — ${v.note}` : ""}`);
  }
  rows.sort((a, b) => (a.step ?? 99) - (b.step ?? 99) || String(a.url).localeCompare(String(b.url)));
  console.log("\n| step | persona | id | sev | kind | url | title |\n|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.step ?? ""} | ${r.persona} | ${r.id} | ${r.severity} | ${r.kind} | ${r.url || ""} | ${String(r.title).replace(/\|/g, "\\|")} |`);
  console.log(`\n${rows.length} findings from ${personaDirs(runDir, round).length} personas${bad ? `, ${bad} with problems (fix before merging)` : ""}`);
  if (bad) process.exit(2);
}

function rank(runDir) {
  const file = path.join(runDir, "issues.json");
  const issues = readJSON(file);
  for (const i of issues) {
    i.personas = [...new Set(i.personas || [])];
    i.usersHit = i.personas.length;
  }
  issues.sort(
    (a, b) =>
      b.usersHit - a.usersHit ||
      SEVERITY[a.severity] - SEVERITY[b.severity] ||
      (a.funnelStep ?? 99) - (b.funnelStep ?? 99),
  );
  issues.forEach((i, n) => (i.rank = n + 1));
  fs.writeFileSync(file, JSON.stringify(issues, null, 2) + "\n");
  console.log("| # | users | sev | key | title |\n|---|---|---|---|---|");
  for (const i of issues) console.log(`| ${i.rank} | ${i.usersHit}/5 ${i.personas.join(", ")} | ${i.severity} | ${i.key} | ${i.title} |`);
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function loadRound(runDir, round) {
  const dir = path.join(runDir, `round-${round}`);
  if (!exists(dir)) return null;
  const out = {};
  for (const d of personaDirs(runDir, round)) {
    const f = path.join(d, "findings.json");
    if (exists(f)) out[path.basename(d)] = { dir: d, ...readJSON(f) };
  }
  return out;
}

function render(runDir) {
  runDir = path.resolve(runDir);
  const run = exists(path.join(runDir, "run.json")) ? readJSON(path.join(runDir, "run.json")) : {};
  const issues = exists(path.join(runDir, "issues.json")) ? readJSON(path.join(runDir, "issues.json")) : [];
  const r1 = loadRound(runDir, 1) || {};
  const r2 = loadRound(runDir, 2);
  const findingById = {};
  for (const [p, d] of Object.entries(r1)) for (const f of d.findings || []) findingById[f.id] = { ...f, persona: p, abs: path.resolve(d.dir, f.screenshot || "") };

  const verdicts = {};
  if (r2) for (const [p, d] of Object.entries(r2)) for (const v of d.verifies || []) (verdicts[v.issue] ||= []).push({ persona: p, ...v, abs: v.screenshot ? path.resolve(d.dir, v.screenshot) : null });
  const newInR2 = r2 ? Object.entries(r2).flatMap(([p, d]) => (d.findings || []).map((f) => ({ ...f, persona: p, abs: path.resolve(d.dir, f.screenshot || "") }))) : [];

  const status = (i) => {
    const vs = verdicts[i.key] || [];
    if (!r2) return i.status || "open";
    if (vs.some((v) => v.status === "still-broken")) return "still broken";
    if (vs.length && vs.every((v) => v.status === "fixed")) return "fixed";
    return i.status === "fixed" && !vs.length ? "fixed (unverified)" : i.status || "open";
  };
  const rel = (abs) => (abs ? path.relative(runDir, abs) : "");

  const funnel = (round) =>
    PERSONAS.filter((p) => round?.[p]).map((p) => `${p}: ${round[p].reachedSuccess ? "✅ success" : `❌ quit at ${round[p].stoppedAt || "?"}`}`);

  // Markdown
  const md = [];
  md.push(`# Launch QA — ${run.app || run.url || path.basename(runDir)}`, "");
  if (run.url) md.push(`- URL: ${run.url}`);
  if (run.firstSuccess) md.push(`- First success: ${run.firstSuccess}`);
  md.push(`- Round 1: ${funnel(r1).join(" · ")}`);
  if (r2) md.push(`- Round 2: ${funnel(r2).join(" · ")}`);
  md.push("", "| # | Users hit | Severity | Issue | Status | Fix |", "|---|---|---|---|---|---|");
  for (const i of issues) md.push(`| ${i.rank ?? ""} | ${i.personas.length}/5 (${i.personas.join(", ")}) | ${i.severity} | ${i.title} | ${status(i)} | ${(i.fix?.summary || "").replace(/\|/g, "\\|")} |`);
  if (newInR2.length) {
    md.push("", "## New in round 2", "");
    for (const f of newInR2) md.push(`- **${f.persona}** · ${f.severity} · ${f.title} — ${rel(f.abs)}`);
  }
  fs.writeFileSync(path.join(runDir, "report.md"), md.join("\n") + "\n");

  // HTML
  const card = (i) => {
    const before = (i.findingIds || []).map((id) => findingById[id]).filter(Boolean);
    const after = verdicts[i.key] || [];
    const st = status(i);
    return `<section class="issue">
  <header><span class="rank">#${i.rank ?? ""}</span><h2>${esc(i.title)}</h2>
  <span class="pill sev-${esc(i.severity)}">${esc(i.severity)}</span><span class="pill users">${i.personas.length}/5 users</span>
  <span class="pill st-${esc(st.split(" ")[0])}">${esc(st)}</span></header>
  <p class="who">${i.personas.map((p) => `<b>${esc(p)}</b>`).join(" · ")}${i.where ? ` — ${esc(i.where)}` : ""}</p>
  ${i.rootCause ? `<p><b>Root cause:</b> ${esc(i.rootCause)}</p>` : ""}
  ${i.fix?.summary ? `<p><b>Fix:</b> ${esc(i.fix.summary)}${i.fix.files?.length ? ` <code>${i.fix.files.map(esc).join("</code> <code>")}</code>` : ""}</p>` : ""}
  <div class="grid">
    ${before.map((f) => `<figure><img src="${esc(rel(f.abs))}" loading="lazy"><figcaption><b>Before · ${esc(f.persona)}</b> ${f.quote ? `“${esc(f.quote)}”` : esc(f.title)}</figcaption></figure>`).join("")}
    ${after.filter((v) => v.abs).map((v) => `<figure class="after-${esc(v.status)}"><img src="${esc(rel(v.abs))}" loading="lazy"><figcaption><b>After · ${esc(v.persona)} · ${esc(v.status)}</b> ${esc(v.note || "")}</figcaption></figure>`).join("")}
  </div>
</section>`;
  };
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Launch QA — ${esc(run.app || run.url || "")}</title>
<style>
body{font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0;background:#f6f6f7;color:#111}
main{max-width:1200px;margin:0 auto;padding:32px}
h1{margin:0 0 4px}.meta{color:#555;margin:0 0 24px}
.funnel{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0}.funnel span{background:#fff;border:1px solid #ddd;border-radius:6px;padding:2px 8px;font-size:13px}
.issue{background:#fff;border:1px solid #e3e3e6;border-radius:10px;padding:16px 20px;margin:16px 0}
.issue header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.issue h2{font-size:17px;margin:0;flex:1;min-width:0}
.rank{font-weight:700;color:#888;font-variant-numeric:tabular-nums}
.pill{font-size:12px;border-radius:999px;padding:2px 9px;background:#eee;white-space:nowrap}
.sev-blocker{background:#ffd7d9}.sev-major{background:#ffe8c7}.sev-minor{background:#e8eefc}
.st-fixed{background:#d4f5dd}.st-still{background:#ffd7d9}.users{background:#111;color:#fff}
.who{color:#444;margin:8px 0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:12px;align-items:start}
figure{margin:0;border:1px solid #e3e3e6;border-radius:8px;overflow:hidden;background:#fafafa}
figure img{width:100%;max-height:420px;object-fit:contain;object-position:top;display:block;background:#fff;cursor:zoom-in}
figcaption{font-size:13px;padding:8px 10px}.after-fixed{border-color:#34c759}.after-still-broken{border-color:#ff3b30}
code{font-size:12px;background:#f0f0f2;padding:1px 4px;border-radius:4px}
</style></head><body><main>
<h1>Launch QA — ${esc(run.app || run.url || "")}</h1>
<p class="meta">${esc(run.firstSuccess ? `First success = ${run.firstSuccess}` : "")} ${run.date ? `· ${esc(run.date)}` : ""}</p>
<div class="funnel"><b>Round 1</b>${funnel(r1).map((s) => `<span>${esc(s)}</span>`).join("")}</div>
${r2 ? `<div class="funnel"><b>Round 2</b>${funnel(r2).map((s) => `<span>${esc(s)}</span>`).join("")}</div>` : ""}
${issues.map(card).join("\n")}
${newInR2.length ? `<h2>New in round 2</h2><div class="grid">${newInR2.map((f) => `<figure><img src="${esc(rel(f.abs))}"><figcaption><b>${esc(f.persona)} · ${esc(f.severity)}</b> ${esc(f.title)}</figcaption></figure>`).join("")}</div>` : ""}
</main><script>document.querySelectorAll("figure img").forEach(i=>i.onclick=()=>window.open(i.src))</script></body></html>`;
  fs.writeFileSync(path.join(runDir, "report.html"), html);
  console.log(`wrote ${path.join(runDir, "report.md")}\nwrote ${path.join(runDir, "report.html")}`);
}

const [cmd, runDir, round] = process.argv.slice(2);
if (!cmd || !runDir) die("usage: report.mjs check <findings.json> | collect <runDir> <round> | rank <runDir> | render <runDir>");
if (cmd === "check") {
  const { data, problems } = validate(path.resolve(runDir));
  if (problems.length) die(`${problems.length} problem(s):\n - ${problems.join("\n - ")}`);
  console.log(`ok: ${data.persona}, ${data.findings.length} findings, reachedSuccess=${data.reachedSuccess}`);
} else if (cmd === "collect") collect(runDir, Number(round || 1));
else if (cmd === "rank") rank(runDir);
else if (cmd === "render") render(runDir);
else die(`unknown command ${cmd}`);
