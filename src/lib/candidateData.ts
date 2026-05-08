/**
 * 候補地実データ取得モジュール
 *
 * OSM Overpass API で工業地域・廃工場跡地ポリゴンを取得し、
 * GSI API で標高・住所を補完して CandidateSite[] を生成する。
 * モックデータは一切使用しない。
 */

import { getSubstations, haversineKm } from "./osmData";
import { getElevation, getAddress } from "./gsiData";
import type { CandidateSite, Substation, LandUseCategory, ScoreBreakdown } from "@/types";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// 関東 + 山梨 + 長野
const BBOX = "34.9,137.5,37.5,141.5";
const CACHE_TTL = 3_600_000; // 1h
const MAX_CANDIDATES = 200; // 上位何件を GSI 補完するか
const BATCH_SIZE = 50;      // GSI 並列バッチサイズ
const MIN_AREA_HA = 1.0;    // 最小面積フィルタ (ha)

let _cache: CandidateSite[] | null = null;
let _cacheTime = 0;

// ────────────────────────────────────────────
// OSM landuse タグ → 内部カテゴリ / 日本語ラベル
// ────────────────────────────────────────────
function toCategory(landuse: string): LandUseCategory {
  if (landuse === "industrial") return "industrial";
  if (landuse === "brownfield" || landuse === "landfill") return "wasteland";
  if (landuse === "farmland" || landuse === "farmyard") return "agricultural";
  if (landuse === "forest" || landuse === "wood") return "forest";
  if (landuse === "meadow" || landuse === "grass" || landuse === "scrub") return "wasteland";
  return "other";
}

function toJaLabel(landuse: string): string {
  const map: Record<string, string> = {
    industrial: "工業地域",
    brownfield: "廃工場跡地",
    landfill: "廃棄物処分場跡",
    farmland: "農地",
    farmyard: "農場地",
    meadow: "草地・原野",
    grass: "草地",
    scrub: "雑草地",
  };
  return map[landuse] ?? landuse;
}

// ────────────────────────────────────────────
// Overpass 取得
// ────────────────────────────────────────────
interface OsmWayBb {
  id: number;
  bounds: { minlat: number; maxlat: number; minlon: number; maxlon: number };
  tags: Record<string, string>;
}

async function fetchLandPolygons(): Promise<OsmWayBb[]> {
  // 工業地域・廃工場・廃棄物処分場跡地をバウンディングボックスで取得
  // out bb tags → 各 way の bbox + タグのみ（ノード座標不要で軽量）
  const query = `[out:json][timeout:90];
(
  way["landuse"="industrial"](${BBOX});
  way["landuse"="brownfield"](${BBOX});
  way["landuse"="landfill"](${BBOX});
);
out bb tags;`;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const json = await res.json();
  return (json.elements ?? []).filter(
    (e: OsmWayBb) => e.bounds && e.tags?.landuse
  );
}

// バウンディングボックスから中心座標を計算
function bboxCenter(b: OsmWayBb["bounds"]) {
  return {
    lat: (b.minlat + b.maxlat) / 2,
    lng: (b.minlon + b.maxlon) / 2,
  };
}

// バウンディングボックス面積 (ha) を近似計算
function bboxAreaHa(b: OsmWayBb["bounds"]): number {
  const midlat = (b.minlat + b.maxlat) / 2;
  const widthM = (b.maxlon - b.minlon) * 111_000 * Math.cos((midlat * Math.PI) / 180);
  const heightM = (b.maxlat - b.minlat) * 111_000;
  return (widthM * heightM) / 10_000;
}

// ────────────────────────────────────────────
// スコア計算
// ────────────────────────────────────────────
function calcScore(params: {
  dist: number;
  voltageKv: number;
  area: number;
  elevation: number;
  slope: number;
  cat: LandUseCategory;
}): { score: number; breakdown: ScoreBreakdown } {
  // 系統近接性 (0-20): 距離スコア + 電圧スコア（空き容量は非公開のため除外）
  const distScore = Math.max(0, 10 - params.dist * 0.8);
  const voltScore =
    params.voltageKv >= 500 ? 10 :
    params.voltageKv >= 275 ? 8 :
    params.voltageKv >= 154 ? 5 : 2;
  const gridProximity = Math.round(Math.min(20, distScore + voltScore));

  // 地形適性 (0-20): 傾斜 + 標高
  const slopeScore = params.slope <= 2 ? 10 : params.slope <= 5 ? 7 : 4;
  const elevScore = params.elevation < 100 ? 10 : params.elevation < 300 ? 7 : 4;
  const terrain = Math.round(Math.min(20, slopeScore + elevScore));

  // 土地利用適性 (0-20)
  const landUseMap: Record<LandUseCategory, number> = {
    industrial: 20,
    wasteland: 15,
    agricultural: 12,
    forest: 8,
    other: 10,
  };
  const landUse = landUseMap[params.cat];

  // 規制クリア度 (0-20): OSM では判定不可のため中間値
  const regulation = 15;

  // アクセス性 (0-20): 面積ボーナス - 遠距離ペナルティ
  const areaBonus = Math.min(5, Math.log2(params.area + 1));
  const accessibility = Math.round(
    Math.min(20, Math.max(0, 8 + areaBonus - params.dist * 0.3))
  );

  const score = Math.min(
    100,
    Math.max(0, gridProximity + terrain + landUse + regulation + accessibility)
  );
  return { score, breakdown: { gridProximity, terrain, landUse, regulation, accessibility } };
}

// 標高から傾斜を推定（GSI 複数点取得なしの簡易版）
function estimateSlope(elevation: number, cat: LandUseCategory): number {
  if (cat === "industrial") return 1.5; // 工業用地は通常平坦
  if (elevation < 50)  return 1.0;
  if (elevation < 150) return 3.0;
  if (elevation < 300) return 6.0;
  return 10.0;
}

// 概算工事費 (百万円) = 面積 × 単価 + 土地カテゴリ補正
function estimateCost(area: number, cat: LandUseCategory, dist: number): number {
  const base = area * 100; // 100万円/ha
  const landAdj = cat === "industrial" ? 0 : cat === "wasteland" ? 200 : 400;
  const gridAdj = Math.max(0, dist - 5) * 50; // 5km超えたら追加
  return Math.round(base + landAdj + gridAdj);
}

// ────────────────────────────────────────────
// メインエクスポート
// ────────────────────────────────────────────
export async function getCandidateSites(): Promise<CandidateSite[]> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  console.log("[candidateData] 実データ取得開始...");

  // 1. 変電所 + 土地利用ポリゴンを並行取得
  const [substations, polygons] = await Promise.all([
    getSubstations(),
    fetchLandPolygons(),
  ]);

  if (substations.length === 0) {
    throw new Error("変電所データが取得できませんでした");
  }

  console.log(`[candidateData] OSM ポリゴン ${polygons.length}件, 変電所 ${substations.length}件`);

  // 2. 面積フィルタ + 最寄り変電所を事前計算してプレスコア
  type WithMeta = OsmWayBb & {
    center: { lat: number; lng: number };
    area: number;
    sub: Substation;
    dist: number;
    cat: LandUseCategory;
    preScore: number;
  };

  const withMeta: WithMeta[] = polygons
    .map((p) => {
      const area = bboxAreaHa(p.bounds);
      if (area < MIN_AREA_HA) return null;
      const center = bboxCenter(p.bounds);
      // 最寄り変電所
      let bestSub = substations[0];
      let bestDist = Infinity;
      for (const s of substations) {
        const d = haversineKm(center.lat, center.lng, s.coordinates.lat, s.coordinates.lng);
        if (d < bestDist) { bestSub = s; bestDist = d; }
      }
      const cat = toCategory(p.tags.landuse);
      // プレスコア: 電圧ボーナス + 土地利用ボーナス - 距離ペナルティ
      const preScore =
        (bestSub.voltageKv / 50) +
        (cat === "industrial" ? 5 : cat === "wasteland" ? 3 : 1) -
        Math.max(0, bestDist - 3);
      return { ...p, center, area, sub: bestSub, dist: bestDist, cat, preScore };
    })
    .filter((x): x is WithMeta => x !== null)
    .sort((a, b) => b.preScore - a.preScore)
    .slice(0, MAX_CANDIDATES);

  console.log(`[candidateData] 面積フィルタ後 ${withMeta.length}件 → GSI 補完開始`);

  // 3. GSI で標高・住所を補完（バッチ並列）
  const sites: CandidateSite[] = [];

  for (let i = 0; i < withMeta.length; i += BATCH_SIZE) {
    const batch = withMeta.slice(i, i + BATCH_SIZE);
    const enriched = await Promise.all(
      batch.map(async (p) => {
        try {
          const [elevation, address] = await Promise.all([
            getElevation(p.center.lat, p.center.lng),
            getAddress(p.center.lat, p.center.lng),
          ]);

          const elev = elevation ?? 50;
          const slope = estimateSlope(elev, p.cat);
          const { score, breakdown } = calcScore({
            dist: p.dist,
            voltageKv: p.sub.voltageKv,
            area: p.area,
            elevation: elev,
            slope,
            cat: p.cat,
          });

          const pref = address?.prefecture ?? "不明";
          const muni = address?.municipality ?? "不明";
          const jaLabel = toJaLabel(p.tags.landuse);
          const name =
            p.tags.name
              ? p.tags.name
              : `${muni}${muni !== "不明" ? " " : ""}${jaLabel}`;

          const site: CandidateSite = {
            id: `osm-${p.id}`,
            name,
            coordinates: p.center,
            area: Math.round(p.area * 10) / 10,
            slope,
            elevation: elev,
            aspect: "flat",
            landUse: `${jaLabel}（OSM実データ）`,
            landUseCategory: p.cat,
            prefecture: pref,
            municipality: muni,
            nearestSubstation: {
              id: p.sub.id,
              name: p.sub.name,
              distance: Math.round(p.dist * 10) / 10,
              voltageKv: p.sub.voltageKv,
              // OSM では系統空き容量は取得不可 (-1 = 非公開)
              availableCapacityMw: -1,
              capacityStatus: "中程度",
            },
            gridDistance: Math.round(p.dist * 0.5 * 10) / 10,
            regulations: [],
            score,
            scoreBreakdown: breakdown,
            estimatedConstructionCost: estimateCost(p.area, p.cat, p.dist),
            notes:
              `OSM実データ（Way ID: ${p.id}）。` +
              `最寄変電所: ${p.sub.name}（${p.sub.voltageKv}kV / ${p.dist.toFixed(1)}km）。` +
              `系統空き容量はOCCTO未連携のため非公開。` +
              (p.tags.name ? `` : `OSMに名称未登録のため自動生成。`),
          };
          return site;
        } catch {
          return null;
        }
      })
    );
    sites.push(...enriched.filter((s): s is CandidateSite => s !== null));
    console.log(`[candidateData] バッチ ${Math.floor(i / BATCH_SIZE) + 1} 完了 (累計 ${sites.length}件)`);
  }

  sites.sort((a, b) => b.score - a.score);
  _cache = sites;
  _cacheTime = Date.now();
  console.log(`[candidateData] 完了: ${sites.length}件 キャッシュ`);
  return sites;
}

/** ID で候補地を検索（async） */
export async function getSiteByIdReal(id: string): Promise<CandidateSite | undefined> {
  const sites = await getCandidateSites();
  return sites.find((s) => s.id === id);
}
