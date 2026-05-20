/**
 * kansai_upper_areas.json の座標を Douglas-Peucker で間引く
 * 100,908点 → ~2,000点程度に削減し、小数点4桁に丸める
 *
 * 使い方: node scripts/simplify_kansai.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "src", "data");

// ─── Douglas-Peucker ────────────────────────────────────────────
function perpDist(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function dp(pts, tol) {
  if (pts.length <= 2) return pts;
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > tol) {
    const L = dp(pts.slice(0, idx + 1), tol);
    const R = dp(pts.slice(idx), tol);
    return [...L.slice(0, -1), ...R];
  }
  return [pts[0], pts[pts.length - 1]];
}

const P = 4; // 小数点以下桁数
const round = v => Math.round(v * 10 ** P) / 10 ** P;
const roundPt = ([x, y]) => [round(x), round(y)];

function simplifyRing(ring, tol) {
  const s = dp(ring, tol).map(roundPt);
  // ポリゴンを閉じる
  if (s.length && (s[0][0] !== s[s.length - 1][0] || s[0][1] !== s[s.length - 1][1])) {
    s.push(s[0]);
  }
  return s;
}

function simplifyGeom(geom, tol) {
  if (geom.type === "Polygon") {
    return { ...geom, coordinates: geom.coordinates.map(r => simplifyRing(r, tol)) };
  }
  if (geom.type === "MultiPolygon") {
    return { ...geom, coordinates: geom.coordinates.map(poly => poly.map(r => simplifyRing(r, tol))) };
  }
  return geom;
}

// ─── 実行 ────────────────────────────────────────────────────────
const TOL = 0.0005; // ~50m精度（形状崩れを防ぎつつ点数を削減）

const src = JSON.parse(fs.readFileSync(path.join(DATA, "kansai_upper_areas.json"), "utf-8"));

let before = 0, after = 0;
const out = {
  ...src,
  features: src.features.map(f => {
    const b = (JSON.stringify(f.geometry).match(/\[-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?\]/g) || []).length;
    before += b;
    const newGeom = simplifyGeom(f.geometry, TOL);
    const a = (JSON.stringify(newGeom).match(/\[-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?\]/g) || []).length;
    after += a;
    console.log(`  ${f.properties?.name ?? "??"}: ${b} → ${a} 点`);
    return { ...f, geometry: newGeom };
  }),
};

fs.writeFileSync(path.join(DATA, "kansai_upper_areas.json"), JSON.stringify(out));

const origSize = fs.statSync(path.join(DATA, "kansai_upper_areas.json")).size;
console.log(`\n座標点: ${before.toLocaleString()} → ${after.toLocaleString()} (${((1 - after / before) * 100).toFixed(1)}% 削減)`);
console.log(`ファイルサイズ: ${(origSize / 1024).toFixed(0)} KB`);
console.log("完了");
