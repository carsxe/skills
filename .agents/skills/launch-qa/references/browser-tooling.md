# Browser tooling

Every persona must drive a real browser. Pick one backend in Phase 0 and give every subagent its exact instructions.

## Choosing a backend

| Backend | Parallel personas | Mobile throttling | Pick it when |
| --- | --- | --- | --- |
| **Bundled driver** `scripts/qa-browser.mjs` | ✅ isolated browser per persona | ✅ Slow 3G + 4× CPU + touch built in | **Default.** Anything with a shell and Node 18+. |
| **Chrome DevTools MCP** | ⚠️ one browser; `--isolated` gives fresh profiles, but personas share it in one session | ✅ native network/CPU emulation | Already connected, or you want performance traces and a network panel |
| **Playwright MCP** | ⚠️ one browser per server instance | ⚠️ viewport only, unless `browser_run_code` is available | Already connected and the driver can't be installed |
| **Host in-app browser** (e.g. an IDE's embedded browser tools) | ❌ one shared browser | viewport resize only | The user wants to watch the run inside their app |
| **Claude in Chrome / the user's own browser** | ❌ | ❌ | Avoid. It carries the user's cookies and logins, so it isn't a first-time user. Last resort, and only in a fresh logged-out profile. |

Rules:

- **The bundled driver makes the parallel run real.** Even when an MCP is connected, prefer the driver for the five persona subagents, and use the MCP for your own smoke checks and for viewing the report.
- If you must use a **single shared browser**, run personas **one at a time** and reset between them: close all tabs, clear cookies and storage, reset the viewport and throttling. Note it in the final report.
- Subagents may not inherit MCP tools in every agent host. Shell access to the driver works everywhere.
- **Mobile persona without real throttling:** if the backend can't throttle, say so in the findings (`"network": "unthrottled"`) and make up for it by measuring with the Performance API (see the end of this file). Don't pretend you tested Slow 3G.

---

## Bundled driver: `qa-browser.mjs`

One-time install (Playwright + Chromium into `~/.cache/launch-qa`, outside the project):

```bash
node $SKILL_DIR/scripts/qa-browser.mjs setup
```

If the project already depends on `playwright` or `@playwright/test`, the driver uses that copy, and setup is only needed if Chromium itself is missing.

**Persona start commands** (one session per persona; the session name must be unique per round):

```bash
QA=$SKILL_DIR/scripts/qa-browser.mjs
node $QA start r1-impatient --persona impatient --url "$URL" --out "$RUN/round-1/impatient"
node $QA start r1-skeptic   --persona skeptic   --url "$URL" --out "$RUN/round-1/skeptic"
node $QA start r1-mobile    --persona mobile    --url "$URL" --out "$RUN/round-1/mobile"
node $QA start r1-nonnative --persona nonnative --url "$URL" --out "$RUN/round-1/nonnative"
node $QA start r1-breaker   --persona breaker   --url "$URL" --out "$RUN/round-1/breaker"
```

Add `--headed` to watch the windows or `--video` to record a `.webm` (the file is finalized on `stop`).

**Text to paste into a persona's prompt** (fill in the session name and paths):

```
Drive your browser ONLY through this command (it is already started for you, or start
it with the command below). Every command prints JSON; read "ok", "url", "ms", and any
"newErrors" / "newFailedRequests" / "dialogs".

  QA={SKILL_DIR}/scripts/qa-browser.mjs
  node $QA start {session} --persona {persona} --url "{url}" --out "{outdir}"

  node $QA {session} snapshot               # what's on the page (accessibility tree), use it to pick targets
  node $QA {session} text                   # visible text
  node $QA {session} click "role:button:Sign up"     # also: dblclick, hover, check
  node $QA {session} click "role:button:Sign up" --during 800   # + screenshot 800ms in: is there a loading state?
  node $QA {session} fill "label:Email" "qa+x@example.com"   # or a junk token: @long @xss @emoji @rtl …
  node $QA {session} press Enter            # also: type <text>, select <target> <option>
  node $QA {session} scroll down            # up | top | bottom | <px>
  node $QA {session} back                   # forward | reload | goto <url>
  node $QA {session} wait 2000              # or: wait text:Welcome | wait gone:Loading
  node $QA {session} shot "signup-error-jargon" --highlight "text:Error 422"   # add --full for full page
  node $QA {session} console                # console errors + failed requests since last call
  node $QA {session} probe all            # layout/trust checks: overflow, taps, text-size, images, legal, perf
  node $QA {session} eval "<js>"            # run any other JS in the page
  node $QA {session} clear                  # wipe cookies/storage (breaker: session expiry)
  node $QA {session} state                  # persona, viewport, network, slowest actions
  node $QA {session} stop                   # when you are done

Targets: role:<role>:<name>, label:<text>, placeholder:<text>, text:<text>, testid:<id>,
alt:<text>, title:<text>, or a CSS selector. Pick them from `snapshot`.
"ms" is what a user waited: until the new page was ready if the action navigated
("navigated": true), otherwise until the action completed. "settledMs" adds the driver's
own wait for network quiet, so don't report it as user wait time. On a failed action the driver saves a debug
screenshot in {outdir}/_errors/ and returns its path. Those are for you; findings use your own `shot`.
`shot` numbers files itself (`07-cookie-banner.png`); give it a plain name and copy the
returned file name into findings.json.
```

Notes:

- The browser follows new tabs automatically (`"tabs": 2` appears in replies). `back` works within the current tab.
- Dialogs (`alert`, `confirm`, `beforeunload`) are auto-accepted and reported in `dialogs`. For the breaker, any dialog containing `1` after an XSS payload means the payload executed.
- `network slow3g|fast3g|none` changes throttling mid-run.
- Sessions auto-close after 45 idle minutes. `list` and `stop-all` manage them.
- If a session dies (`not responding`), start it again with the same name. The page state is lost, so resume from the last step in your journey.

---

## Chrome DevTools MCP

Tool names vary slightly by version. Use whichever of these the server exposes:

| Need | Tool |
| --- | --- |
| Open / switch / list pages | `new_page`, `select_page`, `list_pages`, `close_page`, `navigate_page` (url, or back/forward/reload) |
| Read the page | `take_snapshot` (elements have `uid`s), `take_screenshot` (`filePath`, `fullPage`) |
| Act | `click` (uid, `dblClick`), `fill`, `fill_form`, `hover`, `press_key`, `upload_file`, `handle_dialog`, `wait_for` |
| Mobile | `resize_page` 375×812 or `emulate` with a viewport; `emulate` / `emulate_network` with **Slow 3G**; `emulate_cpu` / `emulate` with throttling rate 4 |
| Evidence | `list_console_messages`, `list_network_requests`, `get_network_request`, `evaluate_script` |
| Performance | `performance_start_trace` / `performance_stop_trace` (useful for the mobile persona's landing load) |

Start the server with `--isolated` so the profile is fresh. Personas share one browser, so run them sequentially and `navigate_page` to the URL with storage cleared between them (`evaluate_script` for `localStorage.clear(); sessionStorage.clear()`, and clear cookies by starting a new isolated session where the server allows it).

Save screenshots straight into the persona's output directory with `take_screenshot`'s `filePath`. For a highlight, `evaluate_script` to set `outline: 4px solid #ff2d55` on the element first, and remove it after.

## Playwright MCP

| Need | Tool |
| --- | --- |
| Navigate | `browser_navigate`, `browser_navigate_back`, `browser_tabs` |
| Read | `browser_snapshot` (elements have `ref`s), `browser_take_screenshot` (`filename`, `fullPage`, or `element` + `ref` for one element) |
| Act | `browser_click` (`doubleClick: true` for the breaker), `browser_type`, `browser_fill_form`, `browser_press_key`, `browser_select_option`, `browser_hover`, `browser_file_upload`, `browser_handle_dialog`, `browser_wait_for` |
| Evidence | `browser_console_messages`, `browser_network_requests`, `browser_evaluate` |
| Mobile | `browser_resize` 375×812. For throttling and touch, use `browser_run_code` if available: `async (page) => { const c = await page.context().newCDPSession(page); await c.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 }); await c.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }`. Alternatively, start a second server with `--device "iPhone 15"`. |

Screenshots land in the server's output directory. Move or copy them into the persona's output directory before writing `findings.json`, because the report needs them there.

## Host in-app browser

Some hosts provide their own browser tools (for example `browser_open`, `browser_navigate`, `browser_resize`, `browser_screenshot`, `browser_run`, `browser_logs`). Use them the same way: resize to the persona's viewport, run the probe snippets through the eval/run tool, save screenshots into the persona's output directory, and read logs for console errors. Run personas sequentially and reset state between them. If the host's screenshot tool returns an artifact path outside the run directory, copy the file in.

## Measuring load without network throttling

For the mobile persona on a backend that can't throttle, run this after each navigation and report the numbers. Multiply by ~8–10 to estimate Slow 3G, and say it's an estimate.

```js
(() => { const n = performance.getEntriesByType('navigation')[0]; const r = performance.getEntriesByType('resource'); return { ttfb: Math.round(n.responseStart), domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), requests: r.length, transferKB: Math.round(r.reduce((s, x) => s + (x.transferSize || 0), n.transferSize || 0) / 1024), lcp: (performance.getEntriesByType('largest-contentful-paint').at(-1) || {}).startTime }; })()
```
