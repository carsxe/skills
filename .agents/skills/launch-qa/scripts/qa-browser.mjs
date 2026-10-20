#!/usr/bin/env node
// qa-browser: one real, persistent Chromium per persona, driven from the shell.
//
// Each session is a small daemon holding a Playwright page with the persona's
// device, network, and locale applied. Commands talk to it over localhost HTTP,
// so five subagents can each drive their own isolated browser in parallel.
//
//   node qa-browser.mjs setup
//   node qa-browser.mjs start <session> --persona mobile --url <url> --out <dir> [--headed] [--video]
//   node qa-browser.mjs <session> <command> [args...]
//   node qa-browser.mjs list | stop-all | help

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const HOME = process.env.LAUNCH_QA_HOME || path.join(os.homedir(), ".cache", "launch-qa");
const SESSIONS = path.join(os.tmpdir(), "launch-qa-sessions");
const IDLE_MS = Number(process.env.LAUNCH_QA_IDLE_MS || 45 * 60 * 1000);
const ACTION_TIMEOUT = Number(process.env.LAUNCH_QA_ACTION_TIMEOUT || 15000);

// Chrome DevTools "Slow 3G" / "Fast 3G" presets.
const NETWORKS = {
  slow3g: { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 },
  fast3g: { offline: false, latency: 563, downloadThroughput: 180000, uploadThroughput: 84375 },
  none: null,
};

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const PERSONAS = {
  impatient: { viewport: { width: 1366, height: 768 }, network: "none", cpu: 1 },
  skeptic: { viewport: { width: 1440, height: 900 }, network: "none", cpu: 1 },
  mobile: {
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    network: "slow3g",
    cpu: 4,
  },
  nonnative: {
    viewport: { width: 1280, height: 800 },
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    acceptLanguage: "es-ES,es;q=0.9,en;q=0.5",
    network: "none",
    cpu: 1,
  },
  breaker: { viewport: { width: 1280, height: 800 }, network: "none", cpu: 1 },
  default: { viewport: { width: 1280, height: 800 }, network: "none", cpu: 1 },
};

// Layout/trust probes, shared with references/personas.md (keep in sync).
const PROBES = {
  "overflow": "(() => { const w = Math.min(innerWidth, screen.width); const off = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > w + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 8).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + ' right=' + Math.round(e.getBoundingClientRect().right)); return { screen: w, layoutViewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflows: document.documentElement.scrollWidth > w + 1, overflowing: off }; })()",
  "taps": "[...document.querySelectorAll('a,button,input,select,textarea,[role=button],[onclick]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && (r.width < 44 || r.height < 44); }).slice(0, 15).map(e => ({ text: (e.innerText || e.value || e.ariaLabel || e.placeholder || e.name || e.id || e.tagName.toLowerCase()).trim().slice(0, 30), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }))",
  "text-size": "({ zoomInputs: [...document.querySelectorAll('input,select,textarea')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => (e.name || e.id || e.type) + ':' + getComputedStyle(e).fontSize), tinyText: [...document.querySelectorAll('p,span,a,label,li,button')].filter(e => e.innerText?.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).length })",
  "images": "({ noAlt: [...document.images].filter(i => !i.hasAttribute('alt')).length, broken: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src.slice(0, 80)) })",
  "legal": "[...document.querySelectorAll('a')].filter(a => /pric|term|privacy|cookie|legal|about|contact|refund|security/i.test(a.innerText + a.href)).map(a => ({ text: a.innerText.trim().slice(0, 30), href: a.href }))",
  "perf": "(() => { const n = performance.getEntriesByType('navigation')[0]; const r = performance.getEntriesByType('resource'); return { ttfb: Math.round(n.responseStart), domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), requests: r.length, transferKB: Math.round(r.reduce((s, x) => s + (x.transferSize || 0), n.transferSize || 0) / 1024), lcp: (performance.getEntriesByType('largest-contentful-paint').at(-1) || {}).startTime }; })()",
};

// Breaker inputs, usable as `fill <target> @long` so no shell quoting is needed.
const JUNK = {
  "@long": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(36).slice(0, 2000),
  "@longemail": "a".repeat(240) + "@example.com",
  "@spaces": "   ",
  "@emoji": "👩🏽‍💻 Zoë 🚀",
  "@rtl": "مرحبا بالعالم",
  "@accents": "José Núñez García",
  "@xss": '"><img src=x onerror=alert(1)>',
  "@script": "<script>alert(1)</script>",
  "@sqli": "'; DROP TABLE users;--",
  "@bignum": "99999999999999999999",
  "@negative": "-1",
  "@inf": "1e309",
};

const HELP = `qa-browser — persistent per-persona browsers for launch QA

Lifecycle
  setup                                   install Playwright + Chromium into ${HOME}
  start <session> [opts]                  launch a browser daemon for one persona
      --persona impatient|skeptic|mobile|nonnative|breaker|default
      --url <url>        open this first        --out <dir>   screenshot folder
      --width N --height N --network slow3g|fast3g|none --cpu N --locale xx-XX
      --headed           show the window        --video       record a .webm
  list                                    running sessions
  stop-all                                stop every session

Per session:  qa-browser.mjs <session> <command> [args]
  goto <url>                 back | forward | reload
  click <target>             dblclick <target>        hover <target>
      add --during <ms> to any click/press/goto to also screenshot mid-action (loading state)
  fill <target> <text>       type <text>              press <key>
      <text> may be a junk token: ${Object.keys(JUNK).join(" ")}
  select <target> <value>    check <target>           upload <target> <file>
  scroll down|up|top|bottom|<px>
  wait <ms> | wait text:<text> | wait gone:<text>
  snapshot                   accessibility tree of the page (find targets here)
  text                       visible text of the page
  shot <name> [--full] [--highlight <target>]   screenshot, returns path
  console                    console errors/warnings + failed requests since last call
  probe <name|all>           built-in checks: overflow, taps, text-size, images, legal, perf
  eval <js>                  run JS in the page, returns the result
  state                      url, title, viewport, persona, timings
  network slow3g|fast3g|none switch throttling mid-run
  clear                      wipe cookies + storage (fresh first-time user)
  stop                       close the browser (finalizes video)

Targets
  role:button:Sign up   label:Email   placeholder:you@example.com   text:Get started
  testid:submit         alt:Logo      title:Close                   any CSS/Playwright selector
  Several matches -> the first visible one is used and the count is reported.
`;

// ---------- Playwright loading ----------

async function loadPlaywright() {
  const candidates = [
    () => import("playwright"),
    () => import(pathToFileURL(createRequire(path.join(HOME, "package.json")).resolve("playwright")).href),
    () => import(pathToFileURL(createRequire(path.join(process.cwd(), "package.json")).resolve("playwright")).href),
    () => import(pathToFileURL(createRequire(path.join(process.cwd(), "package.json")).resolve("@playwright/test")).href),
  ];
  for (const load of candidates) {
    try {
      const mod = await load();
      return mod.chromium ? mod : mod.default;
    } catch {}
  }
  fail(`Playwright not found. Run:  node ${process.argv[1]} setup`);
}

function setup() {
  fs.mkdirSync(HOME, { recursive: true });
  const pkg = path.join(HOME, "package.json");
  if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, JSON.stringify({ name: "launch-qa-runtime", private: true }, null, 2));
  const run = (cmd, args) =>
    new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { cwd: HOME, stdio: "inherit" });
      p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
    });
  return run("npm", ["install", "--no-audit", "--no-fund", "playwright@latest"])
    .then(() => run("npx", ["playwright", "install", "chromium"]))
    .then(() => console.log(`\nReady. Playwright installed in ${HOME}`));
}

// ---------- helpers ----------

function fail(msg, extra = {}) {
  console.log(JSON.stringify({ ok: false, error: msg, ...extra }, null, 2));
  process.exit(1);
}

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else flags[key] = argv[++i];
    } else rest.push(a);
  }
  return { flags, rest };
}

const sessionFile = (name) => path.join(SESSIONS, `${name.replace(/[^\w.-]/g, "_")}.json`);

function readSession(name) {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(name), "utf8"));
  } catch {
    return null;
  }
}

function request(port, body, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port, method: "POST", path: "/", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) }, timeout },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve({ ok: false, error: buf });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    req.end(data);
  });
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "shot";

// ---------- daemon ----------

async function daemon(name, config) {
  const pw = await loadPlaywright();
  const persona = { ...PERSONAS[config.persona || "default"] };
  if (config.width) persona.viewport = { ...persona.viewport, width: Number(config.width) };
  if (config.height) persona.viewport = { ...persona.viewport, height: Number(config.height) };
  if (config.network) persona.network = config.network;
  if (config.cpu) persona.cpu = Number(config.cpu);
  if (config.locale) persona.locale = config.locale;

  const out = path.resolve(config.out || path.join(process.cwd(), ".launch-qa", name));
  fs.mkdirSync(out, { recursive: true });

  const browser = await pw.chromium.launch({ headless: !config.headed });
  const contextOpts = {
    viewport: persona.viewport,
    deviceScaleFactor: persona.deviceScaleFactor,
    isMobile: persona.isMobile,
    hasTouch: persona.hasTouch,
    userAgent: persona.userAgent,
    locale: persona.locale,
    timezoneId: persona.timezoneId,
    extraHTTPHeaders: persona.acceptLanguage ? { "Accept-Language": persona.acceptLanguage } : undefined,
    recordVideo: config.video ? { dir: out, size: persona.viewport } : undefined,
  };
  for (const k of Object.keys(contextOpts)) if (contextOpts[k] === undefined) delete contextOpts[k];
  const context = await browser.newContext(contextOpts);

  const log = { console: [], failed: [], dialogs: [] };
  let shotCount = 0;
  let errorCount = 0;
  let network = persona.network;
  const timings = [];

  async function applyEmulation(page) {
    try {
      const cdp = await context.newCDPSession(page);
      const cond = NETWORKS[network];
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", cond || { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: persona.cpu || 1 });
      page.__cdp = cdp;
    } catch (e) {
      log.console.push({ type: "qa-browser", text: `emulation failed: ${e.message}` });
    }
  }

  const pendingNav = new Set();
  let lastDcl = 0;

  function watch(page) {
    const isDoc = (r) => r.resourceType() === "document" && r.frame() === page.mainFrame();
    page.on("request", (r) => isDoc(r) && pendingNav.add(r));
    page.on("requestfinished", (r) => pendingNav.delete(r));
    page.on("requestfailed", (r) => pendingNav.delete(r));
    page.on("domcontentloaded", () => (lastDcl = Date.now()));
    page.on("console", (m) => {
      if (["error", "warning"].includes(m.type())) log.console.push({ type: m.type(), text: m.text().slice(0, 500), url: page.url() });
    });
    page.on("pageerror", (e) => log.console.push({ type: "pageerror", text: String(e.message || e).slice(0, 500), url: page.url() }));
    page.on("requestfailed", (r) => log.failed.push({ url: r.url().slice(0, 300), error: r.failure()?.errorText }));
    page.on("response", (r) => {
      if (r.status() >= 400) log.failed.push({ url: r.url().slice(0, 300), status: r.status() });
    });
    page.on("close", () => {
      if (current === page) current = context.pages().at(-1) || current;
    });
    page.on("dialog", async (d) => {
      log.dialogs.push({ type: d.type(), message: d.message() });
      await d.accept().catch(() => {});
    });
  }

  context.on("page", async (p) => {
    watch(p);
    await applyEmulation(p);
    current = p;
  });

  let current = await context.newPage();
  // context "page" event fires for newPage too; the handler above wires it up.
  await new Promise((r) => setTimeout(r, 50));

  const page = () => current;

  function resolveTarget(target) {
    const p = page();
    const m = /^(role|label|placeholder|text|testid|alt|title):(.*)$/s.exec(target);
    if (!m) return p.locator(target);
    const [, kind, value] = m;
    if (kind === "role") {
      const idx = value.indexOf(":");
      const role = idx === -1 ? value : value.slice(0, idx);
      const nameStr = idx === -1 ? undefined : value.slice(idx + 1);
      return p.getByRole(role, nameStr ? { name: nameStr } : {});
    }
    return {
      label: () => p.getByLabel(value),
      placeholder: () => p.getByPlaceholder(value),
      text: () => p.getByText(value),
      testid: () => p.getByTestId(value),
      alt: () => p.getByAltText(value),
      title: () => p.getByTitle(value),
    }[kind]();
  }

  async function locate(target) {
    const loc = resolveTarget(target);
    const count = await loc.count();
    if (count === 0) throw new Error(`no element matches ${target}`);
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) return { el, count };
    }
    return { el: loc.first(), count, hidden: true };
  }

  // A click can start a navigation that hasn't committed yet (common on slow 3G),
  // so give it a moment to begin, then wait for whichever document is in flight.
  async function settle() {
    const slow = network !== "none";
    await new Promise((r) => setTimeout(r, slow ? 600 : 250));
    const deadline = Date.now() + (slow ? 90000 : 30000);
    while (pendingNav.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const p = page();
    await p.waitForLoadState("domcontentloaded", { timeout: ACTION_TIMEOUT }).catch(() => {});
    await p.waitForLoadState("networkidle", { timeout: slow ? 12000 : 3000 }).catch(() => {});
  }

  async function shot(nameArg, flags = {}) {
    const p = page();
    shotCount++;
    const file = path.join(out, `${String(shotCount).padStart(2, "0")}-${slug(nameArg).replace(/^\d+-/, "")}.png`);
    let undo;
    if (flags.highlight) {
      const { el } = await locate(flags.highlight);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      undo = await el.evaluate((node) => {
        const prev = node.style.outline + "|" + node.style.outlineOffset;
        node.style.outline = "4px solid #ff2d55";
        node.style.outlineOffset = "2px";
        return prev;
      });
      await p.screenshot({ path: file, fullPage: !!flags.full });
      await el.evaluate((node, prev) => {
        const [o, off] = prev.split("|");
        node.style.outline = o;
        node.style.outlineOffset = off;
      }, undo);
    } else {
      await p.screenshot({ path: file, fullPage: !!flags.full });
    }
    return file;
  }

  async function act(cmd, args, flags) {
    const p = page();
    switch (cmd) {
      case "goto": {
        let url = args[0];
        if (!/^[a-z]+:/i.test(url)) url = new URL(url, p.url() === "about:blank" ? config.url : p.url()).href;
        await p.goto(url, { waitUntil: "domcontentloaded", timeout: network === "none" ? 30000 : 90000 });
        return {};
      }
      case "back":
        await p.goBack({ timeout: ACTION_TIMEOUT }).catch(() => {});
        return {};
      case "forward":
        await p.goForward({ timeout: ACTION_TIMEOUT }).catch(() => {});
        return {};
      case "reload":
        await p.reload({ timeout: 60000 });
        return {};
      case "click":
      case "dblclick":
      case "hover":
      case "check": {
        const { el, count, hidden } = await locate(args.join(" "));
        if (cmd === "click" && persona.hasTouch) await el.tap({ timeout: ACTION_TIMEOUT }).catch(() => el.click({ timeout: ACTION_TIMEOUT }));
        else await el[cmd]({ timeout: ACTION_TIMEOUT });
        return { matches: count, ...(hidden ? { warning: "only hidden matches; used the first" } : {}) };
      }
      case "fill": {
        const [target, ...text] = args;
        const { el, count } = await locate(target);
        const raw = text.join(" ");
        const value = JUNK[raw] ?? raw;
        await el.fill(value, { timeout: ACTION_TIMEOUT });
        const kept = await el.inputValue().catch(() => null);
        return { matches: count, ...(kept !== null && kept !== value ? { note: `field kept ${kept.length} of ${value.length} chars` } : {}) };
      }
      case "type":
        await p.keyboard.type(args.join(" "), { delay: 20 });
        return {};
      case "press":
        await p.keyboard.press(args[0]);
        return {};
      case "select": {
        const [target, ...value] = args;
        const { el } = await locate(target);
        const v = value.join(" ");
        await el.selectOption([{ label: v }]).catch(() => el.selectOption(v));
        return {};
      }
      case "upload": {
        const { el } = await locate(args[0]);
        await el.setInputFiles(args[1]);
        return {};
      }
      case "scroll": {
        const where = args[0] || "down";
        await p.evaluate((w) => {
          const h = window.innerHeight * 0.85;
          if (w === "down") window.scrollBy(0, h);
          else if (w === "up") window.scrollBy(0, -h);
          else if (w === "top") window.scrollTo(0, 0);
          else if (w === "bottom") window.scrollTo(0, document.documentElement.scrollHeight);
          else window.scrollBy(0, Number(w) || 0);
        }, where);
        const pos = await p.evaluate(() => ({ y: Math.round(window.scrollY), max: document.documentElement.scrollHeight - window.innerHeight }));
        return { scroll: pos };
      }
      case "wait": {
        const a = args.join(" ");
        if (/^\d+$/.test(a)) await p.waitForTimeout(Number(a));
        else if (a.startsWith("gone:")) await p.getByText(a.slice(5)).first().waitFor({ state: "hidden", timeout: 60000 });
        else await p.getByText(a.replace(/^text:/, "")).first().waitFor({ state: "visible", timeout: 60000 });
        return {};
      }
      case "snapshot": {
        const tree = await p.locator("body").ariaSnapshot({ timeout: ACTION_TIMEOUT });
        return { snapshot: tree.length > 20000 ? tree.slice(0, 20000) + "\n…(truncated)" : tree };
      }
      case "text": {
        const t = await p.evaluate(() => document.body?.innerText || "");
        return { text: t.length > 15000 ? t.slice(0, 15000) + "\n…(truncated)" : t };
      }
      case "shot": {
        const file = await shot(args.join(" ") || "shot", flags);
        return { screenshot: file };
      }
      case "console": {
        const dedupe = (items) => {
          const seen = new Map();
          for (const it of items) {
            const k = JSON.stringify(it);
            seen.set(k, { ...it, count: (seen.get(k)?.count || 0) + 1 });
          }
          return [...seen.values()].map((it) => (it.count === 1 ? (({ count, ...r }) => r)(it) : it));
        };
        return { console: dedupe(log.console.splice(0)), failedRequests: dedupe(log.failed.splice(0)), dialogs: log.dialogs.splice(0) };
      }
      case "probe": {
        const which = args[0] || "all";
        const names = which === "all" ? Object.keys(PROBES) : [which];
        const results = {};
        for (const n of names) {
          if (!PROBES[n]) throw new Error(`unknown probe "${n}". One of: ${Object.keys(PROBES).join(", ")}, all`);
          results[n] = await p.evaluate((src) => (0, eval)(src), PROBES[n]).catch((e) => ({ error: e.message }));
        }
        return { probes: which === "all" ? results : results[which] };
      }
      case "eval": {
        const result = await p.evaluate((src) => {
          // eslint-disable-next-line no-eval
          const v = (0, eval)(src);
          return v instanceof Promise ? v.then((x) => JSON.parse(JSON.stringify(x ?? null))) : JSON.parse(JSON.stringify(v ?? null));
        }, args.join(" "));
        return { result };
      }
      case "network": {
        if (!(args[0] in NETWORKS)) throw new Error(`network must be one of ${Object.keys(NETWORKS).join(", ")}`);
        network = args[0];
        for (const pg of context.pages()) if (pg.__cdp) await pg.__cdp.send("Network.emulateNetworkConditions", NETWORKS[network] || { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        return { network };
      }
      case "clear": {
        await context.clearCookies();
        await p.evaluate(() => {
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch {}
        }).catch(() => {});
        return {};
      }
      case "state":
        return {
          persona: config.persona || "default",
          viewport: persona.viewport,
          network: network === "none" ? "unthrottled" : network,
          cpu: persona.cpu,
          locale: persona.locale || "en-US",
          out,
          screenshots: shotCount,
          slowestActions: [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5),
        };
      default:
        throw new Error(`unknown command "${cmd}". Run: qa-browser.mjs help`);
    }
  }

  const NAV = new Set(["goto", "back", "forward", "reload", "click", "dblclick", "press", "check", "select"]);
  let idle = setTimeout(shutdown, IDLE_MS);
  let closing = false;

  async function shutdown() {
    if (closing) return;
    closing = true;
    try {
      await context.close();
      await browser.close();
    } catch {}
    try {
      fs.unlinkSync(sessionFile(name));
    } catch {}
    process.exit(0);
  }

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      clearTimeout(idle);
      idle = setTimeout(shutdown, IDLE_MS);
      let reply;
      const { cmd, args = [], flags = {} } = JSON.parse(body || "{}");
      if (cmd === "stop") {
        const v = page().video();
        const video = v ? await v.path().catch(() => null) : null;
        res.end(JSON.stringify({ ok: true, stopped: name, out, video: video || undefined }));
        return shutdown();
      }
      const started = Date.now();
      // --during <ms>: screenshot the in-between state (spinner? disabled button? blank?)
      // while the action is still settling, e.g. a slow submit on 3G.
      let during;
      if (flags.during && NAV.has(cmd)) {
        const wait = flags.during === true ? 800 : Number(flags.during);
        // Raw CDP frame grab: Playwright's screenshot would wait for the pending navigation
        // and capture a blank new document, while the user still sees the old page.
        during = new Promise((r) => setTimeout(r, wait)).then(async () => {
          try {
            const pg = page();
            const { data } = await pg.__cdp.send("Page.captureScreenshot", { format: "png" });
            shotCount++;
            const file = path.join(out, `${String(shotCount).padStart(2, "0")}-${slug(`${cmd}-during-${wait}ms`)}.png`);
            fs.writeFileSync(file, Buffer.from(data, "base64"));
            return file;
          } catch (e) {
            return `failed: ${String(e.message).split("\n")[0]}`;
          }
        });
      }
      try {
        const extra = await act(cmd, args, flags);
        const acted = Date.now();
        if (NAV.has(cmd)) await settle();
        if (during) extra.duringScreenshot = await during;
        // ms = what the user waited: until the new page's DOM was ready if this navigated,
        // otherwise until the action itself completed. settledMs includes our idle waits.
        const navigated = lastDcl > started;
        const ms = (navigated ? lastDcl : acted) - started;
        const settledMs = Date.now() - started;
        if (NAV.has(cmd)) timings.push({ cmd: `${cmd} ${args.join(" ")}`.slice(0, 80), ms, navigated });
        const p = page();
        reply = {
          ok: true,
          url: p.url(),
          title: await p.title().catch(() => ""),
          ms,
          ...(NAV.has(cmd) ? { navigated, settledMs } : {}),
          ...extra,
          newErrors: log.console.filter((c) => c.type !== "warning").length || undefined,
          newFailedRequests: log.failed.length || undefined,
          dialogs: log.dialogs.length ? [...log.dialogs] : undefined,
          tabs: context.pages().length > 1 ? context.pages().length : undefined,
        };
        if (cmd !== "console" && cmd !== "state") log.dialogs.length = 0;
      } catch (e) {
        let screenshot;
        try {
          errorCount++;
          const dir = path.join(out, "_errors");
          fs.mkdirSync(dir, { recursive: true });
          screenshot = path.join(dir, `${String(errorCount).padStart(2, "0")}-${slug(cmd)}.png`);
          await page().screenshot({ path: screenshot });
        } catch {}
        reply = { ok: false, error: String(e.message || e).split("\n")[0], url: page().url(), ms: Date.now() - started, screenshot };
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(reply));
    });
  });

  server.listen(0, "127.0.0.1", async () => {
    if (config.url) {
      try {
        await act("goto", [config.url], {});
        await settle();
      } catch (e) {
        log.console.push({ type: "qa-browser", text: `initial goto failed: ${e.message}` });
      }
    }
    fs.mkdirSync(SESSIONS, { recursive: true });
    fs.writeFileSync(sessionFile(name), JSON.stringify({ name, port: server.address().port, pid: process.pid, persona: config.persona || "default", out, startedAt: new Date().toISOString() }));
  });

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// ---------- CLI ----------

async function start(name, flags) {
  if (!name) fail("usage: start <session> --persona <p> --url <url> --out <dir>");
  const existing = readSession(name);
  if (existing) {
    try {
      process.kill(existing.pid, 0);
      fail(`session "${name}" already running (pid ${existing.pid}). Stop it first: qa-browser.mjs ${name} stop`);
    } catch {
      fs.unlinkSync(sessionFile(name));
    }
  }
  if (flags.persona && !PERSONAS[flags.persona]) fail(`unknown persona "${flags.persona}". One of: ${Object.keys(PERSONAS).join(", ")}`);
  await loadPlaywright();
  const config = { ...flags, out: flags.out ? path.resolve(flags.out) : undefined };
  const logFile = path.join(os.tmpdir(), `launch-qa-${slug(name)}.log`);
  const fd = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [process.argv[1], "__daemon", name, JSON.stringify(config)], { detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const s = readSession(name);
    if (s) {
      const state = await request(s.port, { cmd: "state" });
      const first = await request(s.port, { cmd: "console" });
      console.log(JSON.stringify({ ok: true, session: name, ...state, startupIssues: first.console?.length || first.failedRequests?.length ? first : undefined }, null, 2));
      return;
    }
    try {
      process.kill(child.pid, 0);
    } catch {
      fail(`browser daemon exited during startup; see ${logFile}`, { log: fs.readFileSync(logFile, "utf8").slice(-2000) });
    }
  }
  fail(`timed out starting session; see ${logFile}`);
}

async function main() {
  const [first, ...restArgs] = process.argv.slice(2);
  if (!first || first === "help" || first === "--help") return console.log(HELP);
  if (first === "setup") return setup();
  if (first === "__daemon") return daemon(restArgs[0], JSON.parse(restArgs[1]));
  if (first === "start") {
    const { flags, rest } = parseFlags(restArgs);
    return start(rest[0], flags);
  }
  if (first === "list" || first === "stop-all") {
    fs.mkdirSync(SESSIONS, { recursive: true });
    const sessions = fs.readdirSync(SESSIONS).map((f) => readSession(f.replace(/\.json$/, ""))).filter(Boolean);
    if (first === "list") return console.log(JSON.stringify(sessions, null, 2));
    for (const s of sessions) await request(s.port, { cmd: "stop" }).catch(() => {});
    return console.log(JSON.stringify({ ok: true, stopped: sessions.map((s) => s.name) }));
  }

  const name = first;
  const s = readSession(name);
  if (!s) fail(`no session "${name}". Start one: qa-browser.mjs start ${name} --persona <p> --url <url>`);
  const { flags, rest } = parseFlags(restArgs);
  const [cmd, ...args] = rest;
  if (!cmd) fail("missing command. Run: qa-browser.mjs help");
  try {
    const reply = await request(s.port, { cmd, args, flags });
    console.log(JSON.stringify(reply, null, 2));
    if (!reply.ok) process.exit(1);
  } catch (e) {
    try {
      fs.unlinkSync(sessionFile(name));
    } catch {}
    fail(`session "${name}" is not responding (${e.message}); it was cleaned up. Start it again.`);
  }
}

main().catch((e) => fail(String(e.stack || e)));
