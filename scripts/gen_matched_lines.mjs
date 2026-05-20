/**
 * ビルドスクリプト: 送電線マップ描画用の静的JSONを生成
 *
 * 処理内容:
 *   - すべての地域送電線JSONをマージ（API route と同一ロジック）
 *   - 空き容量 > 0 MW かつ 66kV 以上の線のみ抽出
 *   - パスを Douglas-Peucker で簡略化（Leaflet の再計算コストを削減）
 *   - 各線に availableMw / demandCap を付与
 *
 * 出力: src/data/matched_lines.json
 * 使い方: node scripts/gen_matched_lines.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "src", "data");

// ─── Douglas-Peucker ────────────────────────────────────────────
function perpDist(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
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

function simplifyPath(path, tol) {
  if (!path || path.length <= 2) return path;
  const pts = path.map(p => [p.lng, p.lat]);
  const simplified = dp(pts, tol);
  return simplified.map(([lng, lat]) => ({ lat, lng }));
}

// ─── ルックアップ ────────────────────────────────────────────────
const capLookup    = JSON.parse(fs.readFileSync(path.join(DATA, "cap_lookup.json"), "utf-8"));
const demandLookup = JSON.parse(fs.readFileSync(path.join(DATA, "demand_cap_lookup.json"), "utf-8"));

function normalizeName(n) {
  return n.replace(/[（(].*?[）)]/g, "").trim();
}

function lookupCap(name) {
  if (!name) return undefined;
  for (const part of name.split(";").map(s => s.trim()).filter(Boolean)) {
    if (part in capLookup.exact) return capLookup.exact[part];
    const norm = normalizeName(part);
    if (norm in capLookup.normalized) return capLookup.normalized[norm];
  }
  return undefined;
}

function lookupDemandCap(name) {
  if (!name) return null;
  for (const part of name.split(";").map(s => s.trim()).filter(Boolean)) {
    if (part in demandLookup.exact) return demandLookup.exact[part];
    const norm = normalizeName(part);
    if (norm in demandLookup.normalized) return demandLookup.normalized[norm];
  }
  return null;
}

function loadLines(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); }
  catch { return []; }
}

// ─── マージ（API route と同一ロジック）──────────────────────────
const kantoLines = loadLines(path.join(DATA, "transmission_lines_kanto.json"));
const seen = new Set(kantoLines.map(l => l.id));
const allLines = [...kantoLines];

// 県別 66kV/77kV（voltageKv < 154 のみ: kanto との重複防止）
const PREF_FILES = [
  "transmission_lines_gunma.json",
  "transmission_lines_66kv_kanto.json",
  "transmission_lines_66kv_chiba.json",
  "transmission_lines_66kv_saitama.json",
  "transmission_lines_66kv_yamanashi.json",
  "transmission_lines_66kv_tochigi.json",
  "transmission_lines_66kv_kanagawa.json",
  "transmission_lines_66kv_ibaraki.json",
  "transmission_lines_66kv_nagano.json",
  "transmission_lines_66kv_shizuoka.json",
];
for (const f of PREF_FILES) {
  for (const l of loadLines(path.join(DATA, f)).filter(l => l.voltageKv < 154)) {
    if (!seen.has(l.id)) { seen.add(l.id); allLines.push(l); }
  }
}

// 東北・中部・関西（全電圧）
const MULTI_FILES = [
  "transmission_lines_tohoku_aomori.json",
  "transmission_lines_tohoku_iwate.json",
  "transmission_lines_tohoku_miyagi.json",
  "transmission_lines_tohoku_akita.json",
  "transmission_lines_tohoku_yamagata.json",
  "transmission_lines_tohoku_fukushima.json",
  "transmission_lines_tohoku_niigata.json",
  "transmission_lines_chubu.json",
  "transmission_lines_kansai_fukui.json",
  "transmission_lines_kansai_shiga.json",
  "transmission_lines_kansai_kyoto.json",
  "transmission_lines_kansai_osaka.json",
  "transmission_lines_kansai_hyogo.json",
  "transmission_lines_kansai_nara.json",
  "transmission_lines_kansai_wakayama.json",
];
for (const f of MULTI_FILES) {
  for (const l of loadLines(path.join(DATA, f))) {
    if (!seen.has(l.id)) { seen.add(l.id); allLines.push(l); }
  }
}

console.log(`全送電線: ${allLines.length}件`);

// ─── フィルタ・エンリッチ・簡略化 ───────────────────────────────
const TOL = 0.005; // ~550m精度（ズーム8〜12の送電線表示で十分）
const P = 4;       // 小数点4桁（~11m）
const r = v => Math.round(v * 10 ** P) / 10 ** P;

const matched = [];
let totalPtsBefore = 0, totalPtsAfter = 0;

for (const line of allLines) {
  if (line.voltageKv < 66) continue;
  const cap = lookupCap(line.name);
  if (typeof cap !== "number" || cap <= 0) continue;

  const demandCap = lookupDemandCap(line.name) ?? null;
  const pathBefore = line.path?.length ?? 0;
  const simplified = simplifyPath(line.path, TOL);
  const pathAfter = simplified?.length ?? 0;

  totalPtsBefore += pathBefore;
  totalPtsAfter  += pathAfter;

  // パスを [[lat, lng], ...] 配列形式で保存（{lat,lng} より ~40% 小さい）
  matched.push({
    id: line.id,
    name: line.name ?? null,
    kv: line.voltageKv,
    ug: line.location === "underground" ? 1 : 0,
    path: simplified.map(p => [r(p.lat), r(p.lng)]),
    mw: cap,
    dm: demandCap,
  });
}

const outPath = path.join(DATA, "matched_lines.json");
fs.writeFileSync(outPath, JSON.stringify(matched));

const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(0);
const ptReduction = ((1 - totalPtsAfter / totalPtsBefore) * 100).toFixed(1);
console.log(`matched_lines.json: ${matched.length}件, ${sizeKb} KB`);
console.log(`パス点数: ${totalPtsBefore.toLocaleString()} → ${totalPtsAfter.toLocaleString()} (${ptReduction}% 削減)`);
console.log("完了");
