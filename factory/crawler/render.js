// JS 描画のページを Chromium(Playwright)で描画して HTML を標準出力に出す。使い方: node render.js <url> [timeout_ms]
// 画像・フォント・動画は読み込まない(相手サーバーの負荷を減らす)。
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2], timeout = +(process.argv[3] || 45000);
  const b = await chromium.launch();
  const ctx = await b.newContext({ userAgent: process.env.FACTORY_UA || 'Mozilla/5.0 (compatible; LexxPluss-factory-db/0.1; +https://lexxpluss.com)', locale: process.env.FACTORY_LOCALE || 'zh-TW' });
  const p = await ctx.newPage();
  await p.route('**/*', r => (['image', 'media', 'font'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
  try {
    await p.goto(url, { waitUntil: 'networkidle', timeout });
  } catch (e) { /* networkidle にならなくても今ある DOM を出す */ }
  await p.waitForTimeout(800);
  process.stdout.write(await p.content());
  await b.close();
})().catch(e => { console.error('ERR ' + e.message); process.exit(2); });
