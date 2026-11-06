/* =====================================================================
 * 順番全体で時間が最短になる選び方（動的計画法）
 *  - 回ごとに候補（車体の位置など）があり、隣り合う回の候補どうしの移動時間の合計が最小になる並びを選ぶ
 *  - 本当の移動時間（経路・当たりの確かめ）は重いので、まず軽い見積もりで選び、選んだ並びの上だけ本当の時間を計算する。
 *    見積もりと違えば、分かった本当の時間を使って選び直す（見積もりが本当の時間以下なら、最後に選ばれる並びは本当に最短）
 *  - 依存なし。ブラウザでは window.ROUTEOPT、Node では module.exports（テストと共有）
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ROUTEOPT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* sizes[k]: k 回目の候補の数（0 回目は開始の 1 つ、など）。
   * est(k, i, j): k 回目の候補 i → k+1 回目の候補 j の見積もり（本当の時間以下にする。行けなければ Infinity）。
   * real(k, i, j): 本当の時間（行けなければ Infinity）。同じ (k, i, j) では 1 回しか呼ばない。
   * 戻り値 { path: [各回の候補の番号], cost, rounds（選び直した回数） } か、行ける並びが無ければ null */
  function bestPath(sizes, est, real, maxRounds) {
    const known = new Map();
    const key = (k, i, j) => k + "," + i + "," + j;
    const cost = (k, i, j) => { const kk = key(k, i, j); return known.has(kk) ? known.get(kk) : est(k, i, j); };
    for (let round = 1; round <= (maxRounds || 10000); round++) {
      let d = new Array(sizes[0]).fill(0);
      const back = [];
      for (let k = 0; k + 1 < sizes.length; k++) {
        const nd = new Array(sizes[k + 1]).fill(Infinity), bk = new Array(sizes[k + 1]).fill(-1);
        for (let i = 0; i < sizes[k]; i++) {
          if (!isFinite(d[i])) continue;
          for (let j = 0; j < sizes[k + 1]; j++) {
            const c = d[i] + cost(k, i, j);
            if (c < nd[j]) { nd[j] = c; bk[j] = i; }
          }
        }
        back.push(bk); d = nd;
      }
      let j = 0;
      for (let i = 1; i < d.length; i++) if (d[i] < d[j]) j = i;
      if (!(d.length && isFinite(d[j]))) return null;
      const path = [j];
      for (let k = back.length - 1; k >= 0; k--) { j = back[k][j]; path.unshift(j); }
      // 選んだ並びの上だけ本当の時間を計算する。見積もりより長いものがあれば選び直す
      let changed = false;
      for (let k = 0; k + 1 < path.length; k++) {
        const kk = key(k, path[k], path[k + 1]);
        if (known.has(kk)) continue;
        const r = real(k, path[k], path[k + 1]);
        known.set(kk, r);
        if (!(r <= est(k, path[k], path[k + 1]) + 1e-9)) changed = true;
      }
      if (!changed) {
        let total = 0;
        for (let k = 0; k + 1 < path.length; k++) total += known.get(key(k, path[k], path[k + 1]));
        return { path, cost: total, rounds: round };
      }
    }
    return null;
  }

  /* 互いに離れたものから n 個選ぶ（候補が似た所に固まらないように）。dist(a, b): 2 つの違いの大きさ */
  function spread(list, n, dist) {
    if (list.length <= n) return list.slice();
    const out = [list[0]], md = list.map(x => dist(x, list[0]));
    while (out.length < n) {
      let k = 0;
      for (let i = 1; i < list.length; i++) if (md[i] > md[k]) k = i;
      if (!(md[k] > 0)) break;
      out.push(list[k]);
      for (let i = 0; i < list.length; i++) md[i] = Math.min(md[i], dist(list[i], list[k]));
    }
    return out;
  }

  return { bestPath, spread };
});
