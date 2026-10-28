// JS で本文・画像を組み立てるサイトを Chromium で描画して HTML を取る(crawl.py の fetch_rendered から呼ぶ)。
// 使い方: node render.js <url> <出力 html> <User-Agent>   → 標準出力に JSON {status, url, headers}
// 画像・フォント・メディアはダウンロードしない(属性だけ要る)。robots.txt と 2 秒間隔は Python 側で守る。
'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs');
(async () => {
  const [url, out, ua] = process.argv.slice(2);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => (['image', 'font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
  let resp = null;
  try {
    resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(3000);
  }
  await page.waitForTimeout(800);
  const html = await page.content();
  fs.writeFileSync(out, html);
  console.log(JSON.stringify({ status: resp ? resp.status() : 0, url: page.url(), headers: resp ? resp.headers() : {} }));
  await browser.close();
})().catch(e => { console.error(String(e)); process.exit(1); });
