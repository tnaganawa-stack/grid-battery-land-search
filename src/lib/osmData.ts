/**
 * OSM (OpenStreetMap) Overpass API データ取得
 * 変電所・送電線の実位置情報を取得する（サーバーサイドのみ）
 */

import * as fs from "fs";
import * as path from "path";
import type { Substation, TransmissionLine } from "@/types";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// 関東 + 山梨 + 長野 のバウンディングボックス
const BBOX = "34.9,137.5,37.2,141.0";
const CACHE_TTL = 3_600_000; // 1時間

const STATIC_SUBSTATIONS_PATH = path.join(process.cwd(), "src", "data", "substations.json");

type Cache<T> = { data: T; ts: number };
let subCache: Cache<Substation[]> | null = null;
let lineCache: Cache<TransmissionLine[]> | null = null;

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

async function overpassPost(query: string): Promise<{ elements: OsmElement[] }> {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
}

/**
 * 154kV以上の変電所を取得
 * 優先順位: 静的JSON → Overpass API
 */
export async function getSubstations(): Promise<Substation[]> {
  if (subCache && Date.now() - subCache.ts < CACHE_TTL) return subCache.data;

  // 静的JSONが存在すれば即時返却（Overpass不要）
  if (fs.existsSync(STATIC_SUBSTATIONS_PATH)) {
    try {
      const raw = fs.readFileSync(STATIC_SUBSTATIONS_PATH, "utf-8");
      const data = JSON.parse(raw) as Substation[];
      if (data.length > 0) {
        subCache = { data, ts: Date.now() };
        console.log(`[OSM] 変電所 ${data.length}件 (静的JSON)`);
        return data;
      }
    } catch (e) {
      console.warn("[OSM] substations.json 読み込みエラー、Overpassへフォールバック:", e);
    }
  }

  // 静的JSONがなければOverpass APIから取得
  const query = `[out:json][timeout:60];
(
  node["power"="substation"]["voltage"~"154000|220000|275000|500000"](${BBOX});
  way["power"="substation"]["voltage"~"154000|220000|275000|500000"](${BBOX});
  relation["power"="substation"]["voltage"~"154000|220000|275000|500000"](${BBOX});
);
out center;`;

  const json = await overpassPost(query);

  const data: Substation[] = (json.elements
    .map((el, i) => {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (!lat || !lng) return null;

      // voltageは "275000" や "275000;154000" の形式
      const voltStr = (el.tags?.voltage ?? "").split(";")[0].trim();
      const voltKv = Math.round(parseInt(voltStr) / 1000);
      if (isNaN(voltKv) || voltKv < 154) return null;

      const name =
        el.tags?.name ??
        el.tags?.["name:ja"] ??
        `変電所${i + 1}`;

      const sub: Substation = {
        id: `osm-${el.id}`,
        name,
        coordinates: { lat, lng },
        voltageKv: voltKv,
        capacityMva: voltKv >= 500 ? 1500 : voltKv >= 275 ? 750 : 300,
        operator: el.tags?.operator ?? el.tags?.["operator:ja"] ?? "不明",
        availableCapacityMw: -1,
        capacityStatus: "中程度",
        capacityNote: "空き容量はOCCTO未連携のため表示できません",
      };
      return sub;
    })
    .filter((x) => x !== null) as Substation[]);

  subCache = { data, ts: Date.now() };
  console.log(`[OSM] 変電所 ${data.length}件 取得完了 (Overpass)`);
  return data;
}

// パスのダウンサンプリング（ポイント数削減）
function downsample<T>(arr: T[], step: number): T[] {
  if (arr.length <= 4) return arr;
  return arr.filter((_, i) => i % step === 0 || i === arr.length - 1);
}

/**
 * 275kV以上の送電線を取得 (1時間キャッシュ)
 */
export async function getTransmissionLines(): Promise<TransmissionLine[]> {
  if (lineCache && Date.now() - lineCache.ts < CACHE_TTL) return lineCache.data;

  // 154kV以上を取得（群馬県エリア限定でPDF空き容量データと照合できるよう拡張）
  const query = `[out:json][timeout:90];
way["power"="line"]["voltage"~"154000|275000|500000"](${BBOX});
out geom;`;

  const json = await overpassPost(query);

  const data: TransmissionLine[] = json.elements
    .filter((el) => el.geometry && el.geometry.length >= 2)
    .map((el) => {
      const voltStr = (el.tags?.voltage ?? "275000").split(";")[0].trim();
      const voltKv = Math.round(parseInt(voltStr) / 1000);

      // 154kVは多いので20点おき、275kV+は10点おきにダウンサンプリング
      const step = voltKv >= 275 ? 10 : 20;
      const path = downsample(
        el.geometry!.map((g) => ({ lat: g.lat, lng: g.lon })),
        step
      );

      return {
        id: `osm-line-${el.id}`,
        name: el.tags?.name ?? el.tags?.["name:ja"] ?? "",
        voltageKv: isNaN(voltKv) ? 275 : voltKv,
        path,
      } satisfies TransmissionLine;
    })
    .filter((l) => l.path.length >= 2);

  lineCache = { data, ts: Date.now() };
  console.log(`[OSM] 送電線 ${data.length}件 取得完了`);
  return data;
}

// ============================================================
// ユーティリティ
// ============================================================

/** Haversine距離 (km) */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 候補座標から最寄り変電所を検索 */
export function findNearestSubstation(
  lat: number,
  lng: number,
  substations: Substation[]
): { sub: Substation; distKm: number } | null {
  if (substations.length === 0) return null;
  let nearest = substations[0];
  let minDist = haversineKm(lat, lng, substations[0].coordinates.lat, substations[0].coordinates.lng);
  for (const sub of substations.slice(1)) {
    const d = haversineKm(lat, lng, sub.coordinates.lat, sub.coordinates.lng);
    if (d < minDist) { minDist = d; nearest = sub; }
  }
  return { sub: nearest, distKm: Math.round(minDist * 10) / 10 };
}
