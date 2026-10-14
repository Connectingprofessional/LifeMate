// End-to-end check in a real browser: the original page loads the real HeyGen
// catalog, HeyGen's session start is forced to fail (as it does with no credits),
// and the page must fall back to the free Gemini call with the 3D avatar.
// Writes a screenshot and a JSON report to ci-results/. No keys are printed.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
mkdirSync("ci-results", { recursive: true });
const report = { steps: [], ok: false };
const step = (name, data = {}) => { report.steps.push({ name, ...data }); console.log(name, JSON.stringify(data)); };

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
         "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
let endEnabled = false; let geminiFrames = 0, geminiAudioFrames = 0, geminiBytes = 0;
page.on("websocket", (ws) => {
  if (!ws.url().includes("generativelanguage.googleapis.com")) return;
  step("gemini websocket opened");
  ws.on("close", () => step("gemini websocket closed"));
  ws.on("socketerror", (e) => step("gemini websocket error", { e: String(e).slice(0, 200) }));
  ws.on("framereceived", (f) => {
    geminiFrames++;
    const s = typeof f.payload === "string" ? f.payload : f.payload.toString("utf8");
    if (!s.includes("inlineData") && s.length > 6) step("gemini frame", { head: s.replace(/"data":"[^"]{40,}"/g, '"data":"..."').slice(0, 300) });
    if (s.includes("inlineData")) { geminiAudioFrames++; geminiBytes += s.length; }
  });
});

// Force HeyGen's session start to fail like an out-of-credits account would.
await page.route("**/_serverFn/**", async (route) => {
  const body = route.request().postData() || "";
  if (route.request().method() === "POST" && body.includes("avatar_id") && body.includes("topic")) {
    // A dropped request makes startSession() reject, which is what the page sees when HeyGen refuses.
    return route.abort("failed");
  }
  return route.continue();
});

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByText("Load avatars & voices").click();
  await page.waitForFunction(() => document.querySelectorAll("select")[0]?.options.length > 20, null, { timeout: 60000 });
  const avatarCount = await page.locator("select").first().locator("option").count();
  step("real HeyGen catalog loaded", { avatarOptions: avatarCount });
  await page.locator("select").first().selectOption({ index: 1 });
  await page.getByText("Start video call").click();

  await page.waitForFunction(() => document.body.innerText.includes("Free call (Gemini)") || /could not start either/i.test(document.body.innerText), null, { timeout: 90000 });
  const status = await page.locator("p.min-h-5").innerText();
  step("status after start", { status });
  if (!status.includes("Free call (Gemini)")) throw new Error("fallback did not start: " + status);

  // Let the greeting play.
  await page.waitForTimeout(15000);
  const canvas = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  step("avatar canvas", { canvas });
  await page.screenshot({ path: "ci-results/hybrid-call.png" });
  step("gemini traffic", { geminiFrames, geminiAudioFrames, approxAudioChars: geminiBytes });

  const endBtn = page.getByRole("button", { name: /End/ });
  endEnabled = await endBtn.isEnabled();
  step("after greeting", { callStillLive: endEnabled, status: await page.locator("p.min-h-5").innerText() });
  if (endEnabled) {
    await endBtn.evaluate((el) => el.click());
    await page.waitForTimeout(1000);
    step("ended", { status: await page.locator("p.min-h-5").innerText() });
  }

  report.ok = Boolean(canvas && canvas.w > 100 && geminiAudioFrames > 0 && endEnabled);
} catch (e) {
  step("error", { message: String(e.message || e).slice(0, 400) });
  await page.screenshot({ path: "ci-results/hybrid-error.png" }).catch(() => {});
}
report.pageErrors = errors.slice(0, 10);
writeFileSync("ci-results/report.json", JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
