/**
 * LexxMoMa 3D 見積「見積依頼」の受け口(Google Apps Script)
 *
 * このコードを、保存先スプレッドシートの「拡張機能 > Apps Script」に貼り付けて
 * Web アプリとしてデプロイする(手順は SETUP.md)。
 *
 *   POST (本文=JSON) … 見積依頼を 1 行追加し、NOTIFY_TO にメールで知らせる
 *   GET               … 受け付けていない(依頼の一覧は返さない。個人情報を含むため)
 *
 * シートの status 列: new=未対応 / doing=対応中 / done=見積送付済み / spam=いたずら
 */

const SHEET_NAME = 'requests';
const NOTIFY_TO = '';            // 依頼が来たら知らせる宛先(カンマ区切りで複数可)。空なら知らせない
const RATE_PER_MIN = 10;         // 全体で 1 分あたり受け付ける上限(いたずら対策)
const HEAD = ['id', 'createdAt', 'status', 'company', 'dept', 'name', 'email', 'tel', 'timing',
              'channel', 'partner', 'partnerContact', 'sierRelations', 'message',
              'total', 'quoteItems', 'items', 'terms', 'catalog', 'v'];

// catalog.js の QUOTE_CHANNELS / QUOTE_TIMINGS と合わせる
const CHANNEL = { direct: 'LexxPluss から直接', sier: 'SIer 経由', dealer: '商社・販売店経由', undecided: '未定・相談' };
const TIMING = { '': '', '3m': '3 か月以内', '6m': '半年以内', '1y': '1 年以内', later: '1 年以上先' };
const LIMIT = { company: 100, dept: 100, name: 60, email: 120, tel: 30, partner: 100, partnerContact: 60, sierRelations: 200, message: 1500 };

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
  s = String(s == null ? '' : s).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function doGet() { return json_({ ok: false, error: 'POST で送ってください' }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return json_({ ok: false, error: '混み合っています。少し待ってからもう一度お試しください。' });
  try {
    const cache = CacheService.getScriptCache();
    const key = 'rate-' + Math.floor(Date.now() / 60000);
    const n = Number(cache.get(key) || 0);
    if (n >= RATE_PER_MIN) return json_({ ok: false, error: '送信が集中しています。1 分ほど待ってからお試しください。' });
    cache.put(key, String(n + 1), 120);

    let d;
    try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '形式が正しくありません' }); }
    if (d.website) return json_({ ok: true, id: 'Q-0' });   // ボット用のおとり欄に入力があれば捨てる

    const t = {};
    Object.keys(LIMIT).forEach(k => { t[k] = safe_(d[k], LIMIT[k]); });
    if (!t.company || !t.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email)) return json_({ ok: false, error: '会社名・お名前・メールアドレスを確認してください' });
    if (!CHANNEL[d.channel]) return json_({ ok: false, error: '商流を選んでください' });

    const items = (Array.isArray(d.items) ? d.items : []).slice(0, 40)
      .map(x => safe_(x && x.id, 40) + ' ×' + (Number(x && x.qty) || 0) + (x && x.note ? '(' + safe_(x.note, 60) + ')' : '')).join('\n');
    const terms = (Array.isArray(d.terms) ? d.terms : []).slice(0, 10).map(x => safe_(x, 40)).join(',');
    const id = 'Q-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();

    sheet_().appendRow([
      id, new Date(), 'new', t.company, t.dept, t.name, t.email, t.tel, TIMING[d.timing] || '',
      CHANNEL[d.channel], t.partner, t.partnerContact, t.sierRelations, t.message,
      Number(d.total) || 0, Number(d.quoteItems) || 0, items, terms, safe_(d.catalog, 20), Number(d.v) || 1,
    ]);

    if (NOTIFY_TO) {
      MailApp.sendEmail({
        to: NOTIFY_TO,
        subject: '[3D 見積] 見積依頼 ' + id + ' ' + t.company,
        body: [
          '3D 見積ツールから見積依頼が届きました。', '',
          '受付番号: ' + id,
          '会社名: ' + t.company + (t.dept ? ' / ' + t.dept : ''),
          'お名前: ' + t.name, 'メール: ' + t.email, '電話: ' + t.tel,
          '導入時期: ' + (TIMING[d.timing] || '-'),
          '商流: ' + CHANNEL[d.channel] + (t.partner ? '(' + t.partner + (t.partnerContact ? ' / ' + t.partnerContact : '') + ')' : ''),
          'お付き合いのある SIer: ' + (t.sierRelations || '-'), '',
          '参考価格の合計(税抜): ¥' + (Number(d.total) || 0).toLocaleString() + (Number(d.quoteItems) ? '(ほかに個別見積 ' + d.quoteItems + ' 件)' : ''),
          '構成:', items, '', 'ご相談内容:', t.message || '-', '',
          '一覧: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl(),
        ].join('\n'),
      });
    }
    return json_({ ok: true, id: id });
  } finally {
    lock.releaseLock();
  }
}
