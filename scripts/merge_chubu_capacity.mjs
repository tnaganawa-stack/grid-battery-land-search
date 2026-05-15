/**
 * 中部電力パワーグリッドの GeoJSON から空き容量データを抽出し
 * grid_capacity_all.json に追加する。
 *
 * データソース: https://gridmap.powergrid.chuden.co.jp/geo_data/KRSIH001 (gzip)
 * 容量値: N-1電制適用可能量 を availableMw として使用
 *
 * 使い方: node scripts/merge_chubu_capacity.mjs
 */

import https from 'https';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAP_ALL_PATH = path.join(__dirname, '..', 'src', 'data', 'grid_capacity_all.json');
const DATA_URL = 'https://gridmap.powergrid.chuden.co.jp/geo_data/KRSIH001';

const VOLTAGE_MAP = {
  '５００ｋＶ': 500,
  '２７５ｋＶ': 275,
  '１５４ｋＶ': 154,
  '７７ｋＶ':   77,
  '６６ｋＶ':   66,
  '４４ｋＶ':   44,
  '３３ｋＶ':   33,
  '２２ｋＶ':   22,
  '１１ｋＶ':   11,
  '６ｋＶ':      6,
};

// KRSIH002 から更新日を取得
function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function fetchGzip(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      const gunzip = zlib.createGunzip();
      res.pipe(gunzip);
      gunzip.on('data', c => chunks.push(c));
      gunzip.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      gunzip.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseN1Mw(s) {
  if (!s) return null;
  const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return v < 0 ? 0 : v;
}

async function main() {
  // 更新日取得
  console.log('パラメータファイル取得中...');
  const paramRaw = await fetchText('https://gridmap.powergrid.chuden.co.jp/geo_data/KRSIH002');
  const paramJson = paramRaw.includes('&&') ? paramRaw.slice(0, paramRaw.indexOf('&&')) : paramRaw;
  const params = JSON.parse(paramJson);
  const taishobi = params.taishobi || '';
  // "2026年05月13日時点" → "2026-05-13"
  const dateMatch = taishobi.match(/(\d{4})年(\d{2})月(\d{2})日/);
  const dateStr = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : new Date().toISOString().slice(0, 10);
  console.log(`対象日: ${taishobi} → ${dateStr}`);

  console.log('KRSIH001 ダウンロード中...');
  const raw = await fetchGzip(DATA_URL);
  const jsonText = raw.includes('&&') ? raw.slice(0, raw.indexOf('&&')) : raw;
  const geojson = JSON.parse(jsonText);

  const lines = geojson.features.filter(f => f.geometry.type === 'LineString');

  // 77kV以上の送電線のみ抽出
  const MIN_KV = 77;
  const entries = [];
  const seen = new Set();
  let no = 1;

  for (const f of lines) {
    const props = f.properties;
    const voltStr = props['電圧階級'] || '';
    const voltKv = VOLTAGE_MAP[voltStr];
    if (!voltKv || voltKv < MIN_KV) continue;

    const name = (props['設備名称'] || '').trim();
    if (!name) continue;

    const key = `${name}-${voltKv}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const avail = parseN1Mw(props['N-1電制適用可能量']);

    entries.push({
      no,
      name,
      voltageKv: voltKv,
      availableMw: avail,
      n1AvailableMw: avail,
    });
    no++;
  }

  console.log(`\n抽出: ${entries.length} 件 (>=${MIN_KV}kV, 重複除去後)`);
  const hasAvail = entries.filter(e => e.availableMw !== null).length;
  console.log(`空き容量データあり: ${hasAvail} / ${entries.length}`);

  // grid_capacity_all.json を更新
  const existing = JSON.parse(fs.readFileSync(CAP_ALL_PATH, 'utf-8'));
  const filtered = existing.filter(ds => ds.area !== '中部電力（77kV〜500kV）');

  const newDataset = {
    source: '中部電力パワーグリッド株式会社 系統予想潮流・空容量マッピング',
    date: dateStr,
    area: '中部電力（77kV〜500kV）',
    lines: entries,
  };

  const merged = [...filtered, newDataset];
  fs.writeFileSync(CAP_ALL_PATH, JSON.stringify(merged, null, 2), 'utf-8');

  console.log(`\n=== 統合完了 ===`);
  console.log(`エリア数: ${merged.length}`);
  console.log(`中部電力: ${entries.length} 件追加`);

  // 電圧分布
  const vDist = {};
  for (const e of entries) {
    vDist[e.voltageKv] = (vDist[e.voltageKv] || 0) + 1;
  }
  console.log('電圧分布:', vDist);

  // 容量分布
  const avails = entries.filter(e => e.availableMw !== null).map(e => e.availableMw);
  if (avails.length > 0) {
    const zero  = avails.filter(v => v === 0).length;
    const lt50  = avails.filter(v => v > 0 && v < 50).length;
    const lt200 = avails.filter(v => v >= 50 && v < 200).length;
    const over  = avails.filter(v => v >= 200).length;
    console.log(`容量分布: 0MW=${zero}, ~50=${lt50}, 50~200=${lt200}, 200+=${over}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
