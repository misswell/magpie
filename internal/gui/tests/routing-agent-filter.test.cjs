// Run with Node's test runner and Playwright on the module path; see README.md.
// The Routing stage's agents are also the page's filter: clicking one shows
// its routes on the stage and its requests in the list below, and clicking
// the stage's empty space, the node again or Escape shows every agent
// again. A stage narrowed to one agent keeps that agent's last request, so
// the node clicked doesn't vanish. All five languages, wide and narrow,
// Chromium and WebKit; the API is faked.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");

const assets = path.resolve(process.env.MAGPIE_ROUTING_ASSETS || path.join(__dirname, "../assets"));
const AGENTS = [["alpha", "Alpha"], ["beta", "Beta"]];
const ago = (s) => new Date(Date.now() - s * 1e3).toISOString();

function routeOf(id, agent) {
  const seat = { id: `p${id}#k`, provider: `p${id}`, name: `Provider ${id}`, who: `key-${id}`, kind: "key", model: `model-${id}` };
  return {
    id, seq: id, time: ago(2), agent, model: seat.model, provider: seat.provider, done: true, status: 200, ms: 800,
    order: [seat],
    tries: [{ id: seat.id, model: seat.model, start: ago(3), done: true, status: 200, ms: 800 }],
  };
}

function serve(lang) {
  const routes = AGENTS.map(([id], i) => routeOf(i + 1, id));
  return async (request) => {
    const url = new URL(request.request().url());
    const json = (data) => request.fulfill({ json: data });
    if (url.pathname === "/boot.js") return request.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"dark",web:true};` });
    if (url.pathname === "/wails/runtime.js") return request.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: AGENTS.map(([id, name]) => ({ id, name, path: "", fields: [] })), profiles: [], settings: { lang, theme: "dark" } });
    if (url.pathname === "/api/gateway/trace") {
      return json({ mine: true, now: new Date().toISOString(), seq: 1, totals: { requests: routes.length, rerouted: 0, errors: 0 }, routes });
    }
    if (url.pathname === "/api/gateway/history") return json({ cut: false, days: [], routes: [] });
    if (url.pathname === "/api/groups") return json({ groups: [], pools: [] });
    if (url.pathname === "/api/providers") return json({ providers: [], excluded: [], gateway: { running: true, window: true } });
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    await request.fulfill({ body: await fs.readFile(file), contentType });
  };
}

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  for (const lang of ["en", "zh", "zh-TW", "ja", "de"]) {
    for (const width of [1100, 420]) {
      test(`${engine} ${lang} ${width}: clicking an agent shows its routes and requests alone`, async (t) => {
        const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
        t.after(() => browser.close());
        const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce", colorScheme: "dark" });
        page.setDefaultTimeout(5000);
        page.setDefaultNavigationTimeout(60000);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", serve(lang));
        await page.goto("http://magpie.test/?view=routing");
        await page.waitForFunction(() => document.querySelectorAll(".rt-src").length === 2);
        await page.waitForFunction(() => document.querySelectorAll(".rt-req").length === 2);

        const srcs = page.locator(".rt-src"), reqs = page.locator(".rt-req");
        const stat = page.locator(".rt-stats > span").first().locator("b");
        const alpha = srcs.filter({ hasText: "Alpha" });
        assert.equal(await stat.textContent(), "2");
        assert.match(await page.locator("#rt .rt-accts").textContent(), /key-1/);
        assert.match(await page.locator("#rt .rt-accts").textContent(), /key-2/);

        // one agent alone: its node on the stage, its routes beside it and
        // its requests below
        await alpha.click();
        await page.waitForFunction(() => document.querySelectorAll(".rt-src").length === 1);
        await page.waitForFunction(() => document.querySelectorAll(".rt-req").length === 1);
        assert.equal(await page.locator(".rt-src").getAttribute("aria-pressed"), "true");
        assert.equal(await stat.textContent(), "1");
        assert.match(await reqs.textContent(), /model-1/);
        assert.doesNotMatch(await reqs.textContent(), /model-2/);
        assert.match(await page.locator("#rt .rt-accts").textContent(), /key-1/);
        assert.doesNotMatch(await page.locator("#rt .rt-accts").textContent(), /key-2/);
        // the line under the stage tells of this agent's route, not the one before it
        assert.match(await page.locator(".rt-cap").textContent(), /Provider 1/);
        assert.doesNotMatch(await page.locator(".rt-cap").textContent(), /Provider 2/);

        // the empty space lets every agent back
        await page.locator(".rt-stage").click({ position: { x: 3, y: 3 } });
        await page.waitForFunction(() => document.querySelectorAll(".rt-src").length === 2);
        await page.waitForFunction(() => document.querySelectorAll(".rt-req").length === 2);
        assert.equal(await stat.textContent(), "2");

        // the node again, and Escape, do the same
        await alpha.click();
        await page.waitForFunction(() => document.querySelectorAll(".rt-src").length === 1);
        await page.locator(".rt-src").click();
        await page.waitForFunction(() => document.querySelectorAll(".rt-src").length === 2);
        await alpha.click();
        await page.waitForFunction(() => document.querySelectorAll(".rt-src").length === 1);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelectorAll(".rt-src").length === 2);
        assert.deepEqual(errors, []);
      });
    }
  }
}
