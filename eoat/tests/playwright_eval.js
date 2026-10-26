// エンドエフェクタ事例DB の UI 評価(7-3): 1440px / 390px × ライト / ダーク で開き、速さ・コンソールエラー・横スクロール・外部画像リクエストを測る。
// 使い方: python3 scripts/serve.py 8750 を起動してから  EOAT_PW=… node eoat/tests/playwright_eval.js [出力ディレクトリ]
// 結果は <出力ディレクトリ>/eval.json とスクリーンショット。CI では動かさない(手元・セッションでの確認用)。
'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.EOAT_BASE || 'http://localhost:8750/members/eoat-db/';
const PW = process.env.EOAT_PW || 'pilot-test';
const OUT = process.argv[2] || path.join(__dirname, '..', 'data', 'eval');
fs.mkdirSync(OUT, { recursive: true });

async function session(browser, opts) {
  const ctx = await browser.newContext({ viewport: opts.viewport, colorScheme: opts.scheme, deviceScaleFactor: 1, isMobile: opts.mobile, hasTouch: opts.mobile });
  await ctx.addInitScript((pw) => { try { sessionStorage.setItem('lx_members_pw_v1', pw); } catch (e) { } }, PW);
  if (opts.throttle) {
    const cdp = await ctx.newCDPSession(await ctx.newPage());
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  }
  const page = opts.throttle ? ctx.pages()[0] : await ctx.newPage();
  const errors = [], external = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { const u = r.url(); if (!u.startsWith('http://localhost') && !u.startsWith('https://fonts.g')) external.push(u); });
  const t0 = Date.now();
  await page.goto(BASE + (opts.hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__eoat && window.__eoat.marks.firstGrid != null, null, { timeout: 30000 }).catch(() => { });
  const marks = await page.evaluate(() => window.__eoat ? window.__eoat.marks : null);
  const r = { name: opts.name, wall_ms: Date.now() - t0, marks, errors, external_image_requests: external.filter(u => /\.(png|jpe?g|webp|gif|bin)(\?|$)/i.test(u)), external_all: external.length };
  r.hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  r.cards = await page.evaluate(() => document.querySelectorAll('.card img.ok').length);
  r.title = await page.title();
  await page.screenshot({ path: path.join(OUT, opts.name + '.png'), fullPage: false });
  return { page, ctx, r };
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  // 1) デスクトップ・ライト: 初回(Cache Storage 無し)
  let s = await session(browser, { name: 'desktop-light', viewport: { width: 1440, height: 900 }, scheme: 'light' });
  results.push(s.r);
  // タスク①: TPポリ箱・協働・20kg以下 の傾向を 3 操作以内で(検索欄に入れる → 協働タブ → 可搬の絞り込み)
  {
    const page = s.page; const t = Date.now();
    await page.fill('#q', 'TPポリ箱'); await page.keyboard.press('Enter');
    await page.click('#rcTabs button[data-rc="協働"]');
    await page.waitForTimeout(400);
    const trend = await page.evaluate(() => Array.from(document.querySelectorAll('.tb')).map(b => b.querySelector('.tb-name').textContent + ' ' + b.querySelector('.tb-pct').textContent));
    const n = await page.evaluate(() => document.querySelector('#res').textContent);
    results.push({ name: 'task1-tote-cobot', ops: 3, trend, res: n, ms: Date.now() - t, hash: await page.evaluate(() => location.hash) });
    await page.screenshot({ path: path.join(OUT, 'task1.png') });
  }
  // タスク②: 事例を開いて出典・SIer に到達(検索 → 絞り込み変更の速さも測る)
  {
    const page = s.page;
    await page.fill('#q', ''); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const t1 = Date.now();
    await page.click('#facetList .fo[data-f="pl"]').catch(() => { });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.card img')).slice(0, 12).every(i => i.classList.contains('ok')), null, { timeout: 5000 }).catch(() => { });
    const filterMs = Date.now() - t1;
    await page.hover('.card');
    await page.waitForTimeout(200);
    const t2 = Date.now();
    await page.click('.card');
    await page.waitForFunction(() => { const i = document.querySelector('.gal img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => { });
    const detailMs = Date.now() - t2;
    const links = await page.evaluate(() => ({ source: !!document.querySelector('.drawer .btn.p'), credit: document.querySelectorAll('.credit a').length, sier: !!document.querySelector('[data-track="sier/open"]'), interp: !!document.querySelector('.interp .spec') }));
    results.push({ name: 'task2-detail', filter_to_images_ms: filterMs, detail_image_ms: detailMs, links });
    await page.screenshot({ path: path.join(OUT, 'task2-detail.png') });
    // タスク④: 条件付きリンク → 開き直すと同じ画面
    const hash = await page.evaluate(() => location.hash);
    const p2 = await s.ctx.newPage();
    await p2.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
    await p2.waitForFunction(() => window.__eoat && window.__eoat.marks.firstGrid != null, null, { timeout: 20000 }).catch(() => { });
    const same = await p2.evaluate(() => ({ hash: location.hash, drawer: !document.querySelector('#drawer').hidden, title: document.querySelector('#dTitle') && document.querySelector('#dTitle').textContent }));
    results.push({ name: 'task4-link', hash, reopened: same });
    // 2 回目の訪問(Cache Storage あり)
    const p3 = await s.ctx.newPage(); const t3 = Date.now();
    await p3.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p3.waitForFunction(() => window.__eoat && window.__eoat.marks.firstGrid != null, null, { timeout: 20000 }).catch(() => { });
    results.push({ name: 'desktop-light-2nd-visit', wall_ms: Date.now() - t3, marks: await p3.evaluate(() => window.__eoat.marks) });
  }
  await s.ctx.close();
  // 2) デスクトップ・ダーク
  s = await session(browser, { name: 'desktop-dark', viewport: { width: 1440, height: 900 }, scheme: 'dark' }); results.push(s.r); await s.ctx.close();
  // 3) スマホ(390px) ライト・ダーク + タスク③: 段ボールを検索 → 詳細 → 戻る
  s = await session(browser, { name: 'mobile-light', viewport: { width: 390, height: 844 }, scheme: 'light', mobile: true }); results.push(s.r);
  {
    const page = s.page;
    await page.fill('#q', '段ボール'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'mobile-search.png') });
    await page.click('#filterBtn'); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'mobile-facets.png') });
    await page.click('#facetsClose');
    await page.click('.card'); await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'mobile-detail.png') });
    const open = await page.evaluate(() => !document.querySelector('#drawer').hidden);
    await page.click('#dClose'); await page.waitForTimeout(200);
    const closed = await page.evaluate(() => document.querySelector('#drawer').hidden && !!document.querySelector('.card'));
    results.push({ name: 'task3-mobile', opened: open, back_ok: closed, hscroll: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) });
  }
  await s.ctx.close();
  s = await session(browser, { name: 'mobile-dark', viewport: { width: 390, height: 844 }, scheme: 'dark', mobile: true }); results.push(s.r); await s.ctx.close();
  // 4) Fast 3G 相当
  s = await session(browser, { name: 'desktop-fast3g', viewport: { width: 1440, height: 900 }, scheme: 'light', throttle: true }); results.push(s.r); await s.ctx.close();
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'eval.json'), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
})();
