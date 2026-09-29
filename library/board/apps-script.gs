/**
 * LexxMoMa 見学ツアー「みんなのアイデアボード」保存先(Google Apps Script)
 *
 * このコードを、保存先スプレッドシートの「拡張機能 > Apps Script」に貼り付けて
 * Web アプリとしてデプロイする(手順は SETUP.md)。
 *
 *   GET  ?action=list  … 公開状態(status=public)の投稿を新しい順に返す
 *   POST (本文=JSON)    … 投稿を1行追加する
 *
 * シートの status 列: public=ボードに表示 / pending=確認待ち(非表示) / hidden=非表示にした
 * 表示をやめたい投稿は、status を hidden に書き換えるだけでよい(反映まで最大30秒)。
 */

const SHEET_NAME = 'posts';
const AUTO_PUBLISH = true;      // false にすると全件 pending(人が確認して public にしたものだけ表示)
const LIST_MAX = 600;           // ボードに返す最大件数
const LIST_CACHE_SEC = 30;      // 一覧を控えておく秒数(大勢が自動更新しても重くならないように)
const RATE_PER_MIN = 20;        // 全体で1分あたり受け付ける上限(いたずら対策)
const HEAD = ['id', 'createdAt', 'status', 'process', 'processText', 'shift', 'industry',
              'reaction', 'impression', 'plus', 'plusText', 'flags', 'v'];

const ALLOW = {
  process: ['machine', 'feed', 'assy', 'inspect', 'pack', 'logi', 'other'],
  shift: ['', 'day', 'two', 'night', '24h'],
  industry: ['', 'auto', 'elec', 'metal', 'resin', 'food', 'logi', 'other'],
  reaction: ['wow', 'fun', 'more', 'meh'],
  plus: ['unmanned', 'multi', 'changeover', 'noretrofit', 'narrow', 'cowork', 'roi', 'trial'],
};
const LIMIT = { processText: 120, impression: 200, plusText: 120 };

// 個人・法人を特定しうる表現(当たったら pending にして表示しない)
const PII = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/,
  /(?:\+81|0)\d{1,4}[-(（\s]?\d{1,4}[-)）\s]?\d{3,4}/,
  /https?:\/\/|www\./i,
  /〒|\b\d{3}-\d{4}\b/,
  /株式会社|有限会社|合同会社|合資会社|\(株\)|（株）|㈱|\(有\)|（有）|㈲|Inc\.?\b|Co\.,?\s?Ltd|Corporation|Corp\./i,
  /(?:北海道|東京都|大阪府|京都府|.{2,3}県).{1,8}[市区町村郡]/,
];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.appendRow(HEAD); sh.setFrozenRows(1); }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// スプレッドシートの数式として解釈されないようにする(=, +, -, @ 始まり)
function safe_(s, max) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function pick_(v, allow) { return allow.indexOf(v) >= 0 ? v : ''; }
function picks_(arr, allow) { return (Array.isArray(arr) ? arr : []).filter(v => allow.indexOf(v) >= 0).slice(0, 8); }

function doGet(e) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('list');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const values = sheet_().getDataRange().getValues();
  values.shift();
  const posts = [];
  for (let i = values.length - 1; i >= 0 && posts.length < LIST_MAX; i--) {
    const r = values[i];
    if (r[2] !== 'public') continue;
    const d = new Date(r[1]);
    posts.push({
      id: r[0], at: Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM'),
      process: String(r[3]).split(',').filter(String), processText: String(r[4]).replace(/^'/, ''),
      shift: r[5], industry: r[6], reaction: r[7], impression: String(r[8]).replace(/^'/, ''),
      plus: String(r[9]).split(',').filter(String), plusText: String(r[10]).replace(/^'/, ''),
    });
  }
  const body = JSON.stringify({ ok: true, posts: posts });
  if (body.length < 95000) cache.put('list', body, LIST_CACHE_SEC);   // キャッシュは1件100KBまで
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return json_({ ok: false, error: '混み合っています。少し待ってからもう一度お試しください。' });
  try {
    // 流量制限(全体)
    const cache = CacheService.getScriptCache();
    const key = 'rate-' + Math.floor(Date.now() / 60000);
    const n = Number(cache.get(key) || 0);
    if (n >= RATE_PER_MIN) return json_({ ok: false, error: '投稿が集中しています。1分ほど待ってからお試しください。' });
    cache.put(key, String(n + 1), 120);

    let d;
    try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '形式が正しくありません' }); }
    if (d.website) return json_({ ok: true, id: 'x', status: 'pending' });   // ボット用のおとり欄に入力があれば捨てる

    const process = picks_(d.process, ALLOW.process);
    const reaction = pick_(d.reaction, ALLOW.reaction);
    if (!process.length || !reaction) return json_({ ok: false, error: '工程と感想を選んでください' });

    const texts = {
      processText: safe_(d.processText, LIMIT.processText),
      impression: safe_(d.impression, LIMIT.impression),
      plusText: safe_(d.plusText, LIMIT.plusText),
    };
    const all = texts.processText + ' ' + texts.impression + ' ' + texts.plusText;
    const flagged = PII.some(re => re.test(all));
    const status = flagged || !AUTO_PUBLISH ? 'pending' : 'public';
    const id = Utilities.getUuid().slice(0, 8);

    sheet_().appendRow([
      id, new Date(), status, process.join(','), texts.processText,
      pick_(d.shift || '', ALLOW.shift), pick_(d.industry || '', ALLOW.industry),
      reaction, texts.impression, picks_(d.plus, ALLOW.plus).join(','), texts.plusText,
      flagged ? 'pii?' : '', Number(d.v) || 1,
    ]);
    if (status === 'public') cache.remove('list');   // 新しい投稿をすぐ一覧に出す
    return json_({ ok: true, id: id, status: status });
  } finally {
    lock.releaseLock();
  }
}
