import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

async function waitForHttpOk(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await delay(250);
  }
  throw new Error(`Timeout esperando ${url}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  const port = process.env.PORT || "4173";
  const url = `http://localhost:${port}/`;

  const server = spawn("node", ["dist/server.js"], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(port) }
  });

  try {
    await waitForHttpOk(url);

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 980, height: 720 },
      colorScheme: "light"
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    const outPath = path.join(process.cwd(), "docs", "screenshot.png");
    ensureDir(path.dirname(outPath));
    await page.screenshot({ path: outPath, fullPage: true });

    await browser.close();
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

