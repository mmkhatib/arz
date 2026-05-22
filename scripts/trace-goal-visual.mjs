// Visual trace of /goal loop. Opens dashboard, creates session, sets a
// goal that forces multiple iterations, screenshots every 500ms.
//
//   node scripts/trace-goal-visual.mjs
//
// Outputs ./goal-trace/{NNN}.png + ./goal-trace/events.log

import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync, appendFileSync } from "fs";

const URL = process.env.ARZ_URL || "http://127.0.0.1:7777";
const GOAL = process.env.ARZ_GOAL || "list exactly 8 distinct citrus fruits with one-sentence flavor note each";
const OUT = "./goal-trace";
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/events.log`, "");

const ts = () => new Date().toISOString().slice(11, 23);
const log = (m) => {
  const line = `[${ts()}] ${m}`;
  console.log(line);
  appendFileSync(`${OUT}/events.log`, line + "\n");
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

// Echo console / network errors.
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    log(`console.${msg.type()}: ${msg.text().slice(0, 200)}`);
  }
});
page.on("pageerror", (err) => log(`pageerror: ${err.message}`));

log(`navigating ${URL}`);
await page.goto(URL, { waitUntil: "networkidle" });

// Create a session via API, then navigate to it.
const sid = await page.evaluate(async () => {
  const r = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "claude-code", model: "claude-opus-4-7" }),
  });
  return (await r.json()).id;
});
log(`session ${sid}`);
// Page accepts `?sid=<id>` query param.
await page.goto(`${URL}/?sid=${sid}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// Snap N — title each frame with timestamp + a snapshot tag.
let frame = 0;
const snap = async (tag) => {
  const name = String(frame++).padStart(3, "0");
  const path = `${OUT}/${name}-${tag.replace(/\s+/g, "_")}.png`;
  await page.screenshot({ path, fullPage: false });
  log(`snap ${name} ${tag}`);
};

await snap("pre-goal");

// Set the goal via API (same call path the UI uses).
log(`setting goal: ${GOAL}`);
await page.evaluate(
  async ({ sid, goal }) => {
    await fetch(`/api/sessions/${sid}/goal`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal }),
    });
  },
  { sid, goal: GOAL },
);

// Poll every 1.5s. Only snapshot on state transition + every 6th frame
// so the trace stays small but state changes are captured.
const start = Date.now();
let lastStatus = "";
let frameNum = 0;
while (Date.now() - start < 120_000) {
  const s = await page.evaluate(async (id) => {
    const r = await fetch(`/api/sessions/${id}`);
    return await r.json();
  }, sid);
  const status = `streaming=${s.streaming} status=${s.goal_status} iters=${s.goal_iterations}/${s.goal_max_iterations} msgs=${s.message_count}`;
  if (status !== lastStatus) {
    log(`STATE: ${status}`);
    await snap(`change-${status.replace(/[^\w]/g, "_").slice(0, 50)}`);
    lastStatus = status;
  } else if (frameNum % 6 === 0) {
    await snap(`t${Math.round((Date.now() - start) / 1000)}s`);
  }
  frameNum++;
  if (s.goal_status === "done") {
    log("goal done — final snap then exit");
    await page.waitForTimeout(800);
    await snap("done");
    break;
  }
  await page.waitForTimeout(1500);
}

await browser.close();
log("trace complete");
