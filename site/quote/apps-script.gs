/**
 * LexxMoMa 3D 見積依頼の受け口(Google Apps Script)
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
const HEAD = ['id', 'createdAt', 'status', 'company', 'name', 'email', 'channel', 'sier', 'trader', 'message',
              'qty', 'body', 'extra', 'total', 'options', 'later', 'outside', 'catalog', 'v'];

// catalog.js の QUOTE_CHANNELS / QUOTE_OPTIONS と合わせる
const CHANNEL = { direct: 'LexxPluss と直接', sier: 'SIer と', trader: '商社を通して', undecided: '未定・相談' };
const OPTION = { charger: '充電器', tablet: '操作用タブレット', ee: 'ハンド・治具', camera: 'ビジョンカメラ', panel: '工程盤', estop: '無線非常停止' };
const LIMIT = { company: 100, name: 60, email: 120, sier: 100, trader: 100, message: 1500 };

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
function names_(arr) { return (Array.isArray(arr) ? arr : []).slice(0, 20).map(id => OPTION[id] || '').filter(String).join('、'); }

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
    if (!t.company || !t.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email)) return json_({ ok: false, error: '会社名・お名前・メールアドレスを確かめてください' });
    if (!CHANNEL[d.channel]) return json_({ ok: false, error: '進めたい経路を選んでください' });

    const options = (Array.isArray(d.items) ? d.items : []).slice(0, 20)
      .map(x => (OPTION[x && x.id] || '') + ' ×' + (Number(x && x.qty) || 0)).filter(s => s[0] !== ' ').join('、');
    const later = names_(d.later), outside = names_(d.outside);
    const yen = v => '¥' + (Number(v) || 0).toLocaleString();
    const id = 'Q-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();

    sheet_().appendRow([
      id, new Date(), 'new', t.company, t.name, t.email, CHANNEL[d.channel], t.sier, t.trader, t.message,
      Number(d.qty) || 0, Number(d.body) || 0, Number(d.extra) || 0, Number(d.total) || 0,
      options, later, outside, safe_(d.catalog, 20), Number(d.v) || 1,
    ]);

    if (NOTIFY_TO) {
      MailApp.sendEmail({
        to: NOTIFY_TO,
        subject: '[3D 見積依頼] ' + id + ' ' + t.company,
        body: [
          '3D 見積依頼ツールから見積依頼が届きました。', '',
          '受付番号: ' + id,
          '会社名: ' + t.company, 'お名前: ' + t.name, 'メール: ' + t.email,
          '希望の経路: ' + CHANNEL[d.channel],
          'お付き合いのある SIer: ' + (t.sier || '-'),
          'お付き合いのある商社: ' + (t.trader || '-'), '',
          'LexxMoMa 本体 × ' + (Number(d.qty) || 0) + ' 台: ' + yen(d.body),
          '別途費用(金額あり): ' + yen(d.extra) + (options ? '(' + options + ')' : ''),
          'ヒアリング後に提示: ' + (later || '-'),
          'SIer・パートナーが用意: ' + (outside || '-'),
          '表示した合計(税別): ' + yen(d.total), '',
          'ご相談内容:', t.message || '-', '',
          '一覧: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl(),
        ].join('\n'),
      });
    }
    return json_({ ok: true, id: id });
  } finally {
    lock.releaseLock();
  }
}
