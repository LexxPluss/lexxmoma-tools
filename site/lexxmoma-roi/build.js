#!/usr/bin/env node
/* build.js — src/ を単一HTML（dist/lexxmoma_roi.html）にインライン結合する。
 * 依存なし。 `node build.js` で実行。 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'dist', 'lexxmoma_roi.html');

let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

// <link rel="stylesheet" href="x.css"> → <style>…</style>
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/g, (_, href) => {
  const css = fs.readFileSync(path.join(SRC, href), 'utf8');
  return `<style>\n${css}\n</style>`;
});
// <script src="x.js"></script> → <script>…</script>
html = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (tag, src) => {
  if (src.startsWith('../')) return tag; // サイト共通の assets/theme.js 等は外部参照のまま（無くても動く）
  const js = fs.readFileSync(path.join(SRC, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script>\n${js}\n</script>`;
});

// <img src="x.png"> → data URI（ロゴ等。外部参照を残さない）
html = html.replace(/(<img\b[^>]*\bsrc=")([^"]+\.(png|webp|svg|jpg))(")/g, (_, pre, src, ext, post) => {
  const mime = { png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg' }[ext];
  const b64 = fs.readFileSync(path.join(SRC, src)).toString('base64');
  return `${pre}data:${mime};base64,${b64}${post}`;
});

// 外部参照が残っていないか検査（CDN・フォント等の禁止）
const leftovers = html.match(/(src|href)="(https?:)?\/\//g);
if (leftovers) {
  console.error('外部リソース参照が残っています:', leftovers);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(`built: ${path.relative(process.cwd(), OUT)} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)`);
