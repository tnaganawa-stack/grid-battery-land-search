/**
 * 中部電力パワーグリッド系統マッピングサイトの GeoJSON データを
 * TransmissionLine 形式に変換して src/data/transmission_lines_chubu.json に出力する。
 *
 * データソース: https://gridmap.powergrid.chuden.co.jp/geo_data/KRSIH001 (gzip)
 *
 * 使い方: node scripts/gen_transmission_chubu.mjs
 */

import https from 'https';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'src', 'data', 'transmission_lines_chubu.json');
const DATA_URL = 'https://gridmap.powergrid.chuden.co.jp/geo_data/KRSIH001';

// 全角電圧表記 → 数値 (kV)
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
  console.log('KRSIH001 ダウンロード中...');
  const raw = await fetchGzip(DATA_URL);

  // &&タイムスタンプ を除去
  const jsonText = raw.includes('&&') ? raw.slice(0, raw.indexOf('&&')) : raw;
  const geojson = JSON.parse(jsonText);

  const features = geojson.features;
  console.log(`総フィーチャ数: ${features.length}`);

  const lines = features.filter(f => f.geometry.type === 'LineString');
  console.log(`送電線フィーチャ数: ${lines.length}`);

  // 電圧分布
  const voltDist = {};
  for (const f of lines) {
    const v = f.properties['電圧階級'] || '?';
    voltDist[v] = (voltDist[v] || 0) + 1;
  }
  console.log('電圧分布:', voltDist);

  // TransmissionLine 形式に変換
  // 77kV以上のみ採用（33kV以下は配電系統）
  const MIN_KV = 66;
  const result = [];

  for (const f of lines) {
    const props = f.properties;
    const voltStr = props['電圧階級'] || '';
    const voltKv = VOLTAGE_MAP[voltStr];
    if (!voltKv || voltKv < MIN_KV) continue;

    const lineNo = props['送電線番号'] || '';
    const name = (props['設備名称'] || '').trim();
    if (!name) continue;

    const coords = f.geometry.coordinates; // [[lng, lat], ...]
    const pathArr = coords.map(([lng, lat]) => ({ lat, lng }));
    if (pathArr.length < 2) continue;

    result.push({
      id: `chubu-${lineNo}`,
      name,
      voltageKv: voltKv,
      path: pathArr,
      location: 'overhead',
    });
  }

  console.log(`\n変換後 (>=${MIN_KV}kV): ${result.length} 件`);
  const vDist = {};
  for (const l of result) {
    vDist[l.voltageKv] = (vDist[l.voltageKv] || 0) + 1;
  }
  console.log('電圧分布:', vDist);

  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n出力: ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
