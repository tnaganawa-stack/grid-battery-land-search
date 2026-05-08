/**
 * FIT認定情報ポータルデータを CandidateSite[] に変換
 * FIT認定設備が集積している市区町村を系統用蓄電池の設置候補として提案
 * - 既存RE設備があるエリア = 電力系統への接続実績あり → 蓄電池設置適地として評価
 */

import { getFitSitesForPrefecture, FIT_PREFECTURES } from "./fitData";
import type { FitMunicipalityData } from "./fitData";
import { getSubstations, haversineKm } from "./osmData";
import { MOCK_SUBSTATIONS } from "./mockData";
import type { CandidateSite, LandUseCategory, ScoreBreakdown, Substation, FitVoltageClasses } from "@/types";

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
let _cache: CandidateSite[] | null = null;
let _cacheTime = 0;

// ────────────────────────────────────────────
// FIT施設種別 → 内部カテゴリ変換
// ────────────────────────────────────────────
function fitTypesToCategory(types: string[]): LandUseCategory {
  if (types.some(t => t.includes("バイオマス"))) return "industrial";
  if (types.some(t => t.includes("風力"))) return "forest";
  if (types.some(t => t.includes("太陽光"))) return "agricultural";
  return "other";
}

function fitTypesToJaLabel(types: string[]): string {
  if (types.length === 0) return "FIT認定区域";
  return `FIT認定区域（${types.slice(0, 3).join("・")}）`;
}

// ────────────────────────────────────────────
// FIT設備容量から面積推定
// 太陽光: 約1ha/1,000kW（地上設置型）
// 風力: 約500ha/MW（広域山地）
// バイオマス: 施設面積は小さい
// ────────────────────────────────────────────
function estimateAreaHa(totalCapacityKw: number, types: string[]): number {
  if (types.some(t => t.includes("風力"))) return Math.max(5, Math.round(totalCapacityKw / 500));
  if (types.some(t => t.includes("太陽光"))) return Math.max(1, Math.round(totalCapacityKw / 1_000));
  return Math.max(1, Math.round(totalCapacityKw / 2_000));
}

// ────────────────────────────────────────────
// スコア計算
// FIT認定実績 = 電力系統接続・許認可取得実績があるエリアとして評価
// ────────────────────────────────────────────
function calcFitScore(params: {
  dist: number;
  voltageKv: number;
  area: number;
  totalCapacityKw: number;
  cat: LandUseCategory;
}): { score: number; breakdown: ScoreBreakdown } {
  // 系統近接性 (0-20): 距離 + 電圧 + FIT連系実績ボーナス
  const distScore = Math.max(0, 10 - params.dist * 0.8);
  const voltScore =
    params.voltageKv >= 500 ? 10 :
    params.voltageKv >= 275 ? 8 :
    params.voltageKv >= 154 ? 5 : 2;
  // FIT設備があるということは電力系統への既存接続実績がある → ボーナス
  const fitBonus = Math.min(3, params.totalCapacityKw / 10_000);
  const gridProximity = Math.round(Math.min(20, distScore + voltScore + fitBonus));

  // 地形適性 (0-20): FIT施設が既にある = 施工可能な地形の証明
  const terrain = params.cat === "forest" ? 11 : 14;

  // 土地利用適性 (0-20)
  const landUseMap: Record<LandUseCategory, number> = {
    industrial: 18,
    wasteland: 15,
    agricultural: 13, // 農地だが転用実績あり
    forest: 10,
    other: 12,
  };
  const landUse = landUseMap[params.cat];

  // 規制クリア度 (0-20): FIT認定取得実績 = ある程度の許認可クリア実績あり
  const regulation = 16;

  // アクセス性 (0-20)
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

// ────────────────────────────────────────────
// ID のサニタイズ
// ────────────────────────────────────────────
function sanitizeId(str: string): string {
  return str.replace(/[\s\u3000\/\\()（）・]/g, "_");
}

// ────────────────────────────────────────────
// メインエクスポート
// ────────────────────────────────────────────
export async function getFitCandidateSites(): Promise<CandidateSite[]> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  console.log("[fitCandidateData] FIT候補地データ取得開始...");

  // 変電所と全都道府県FITデータを並列取得
  // Overpass 障害時はモック変電所にフォールバックして FIT 候補地生成を継続する
  const [substations, allFitData] = await Promise.all([
    getSubstations().catch((e) => {
      console.warn("[fitCandidateData] 変電所取得失敗 → モック変電所使用:", e instanceof Error ? e.message : e);
      return MOCK_SUBSTATIONS as Substation[];
    }),
    Promise.all(
      Object.keys(FIT_PREFECTURES).map((pref) =>
        getFitSitesForPrefecture(pref).catch((e) => {
          console.warn(`[fitCandidateData] ${pref} 取得失敗:`, e);
          return [] as FitMunicipalityData[];
        })
      )
    ).then((arrays) => arrays.flat()),
  ]);

  console.log(
    `[fitCandidateData] FIT市区町村 ${allFitData.length}件, 変電所 ${substations.length}件`
  );

  const sites: CandidateSite[] = allFitData
    .filter((m) => m.totalCapacityKw > 100) // 100kW 未満の零細は除外
    .map((m): CandidateSite => {
      // 最寄り変電所
      let bestSub = substations[0];
      let bestDist = Infinity;
      for (const s of substations) {
        const d = haversineKm(
          m.coordinates.lat, m.coordinates.lng,
          s.coordinates.lat, s.coordinates.lng
        );
        if (d < bestDist) { bestSub = s; bestDist = d; }
      }

      const cat = fitTypesToCategory(m.facilityTypes);
      const area = estimateAreaHa(m.totalCapacityKw, m.facilityTypes);
      const totalMw = m.totalCapacityKw / 1_000;
      const { score, breakdown } = calcFitScore({
        dist: bestDist,
        voltageKv: bestSub.voltageKv,
        area,
        totalCapacityKw: m.totalCapacityKw,
        cat,
      });

      // 傾斜・標高はカテゴリで推定（FITは施設設置実績あり）
      const slope = cat === "forest" ? 8.0 : 2.0;
      const elevation = cat === "forest" ? 250 : 40;

      return {
        id: `fit-${sanitizeId(m.prefecture)}-${sanitizeId(m.municipality)}`,
        name: `${m.municipality}（FIT認定 ${totalMw.toFixed(0)}MW / ${m.siteCount}件）`,
        coordinates: m.coordinates,
        area,
        slope,
        elevation,
        aspect: "flat",
        landUse: `${fitTypesToJaLabel(m.facilityTypes)}（FIT実データ）`,
        landUseCategory: cat,
        prefecture: m.prefecture,
        municipality: m.municipality,
        nearestSubstation: {
          id: bestSub.id,
          name: bestSub.name,
          distance: Math.round(bestDist * 10) / 10,
          voltageKv: bestSub.voltageKv,
          availableCapacityMw: -1,  // OCCTO未連携
          capacityStatus: "中程度",
        },
        gridDistance: Math.round(bestDist * 0.4 * 10) / 10,
        regulations: [],
        score,
        scoreBreakdown: breakdown,
        estimatedConstructionCost: Math.round(area * 100 + Math.max(0, bestDist - 5) * 50),
        fitVoltageClasses: m.capacityKwByClass as FitVoltageClasses | undefined,
        notes:
          `FIT認定設備集積エリア（${m.facilityTypes.join("・")}）。` +
          `認定件数: ${m.siteCount}件, 総容量: ${totalMw.toFixed(1)}MW。` +
          `RE連系実績があるため電力系統接続が期待できます。` +
          `最寄変電所: ${bestSub.name}（${bestSub.voltageKv}kV / ${bestDist.toFixed(1)}km）。` +
          `面積は総容量から推計した参考値です。`,
      };
    });

  sites.sort((a, b) => b.score - a.score);
  // 空結果はキャッシュしない（次回リクエストで再試行できるようにする）
  if (sites.length > 0) {
    _cache = sites;
    _cacheTime = Date.now();
  }
  console.log(`[fitCandidateData] 完了: ${sites.length}件${sites.length > 0 ? " キャッシュ" : " (キャッシュスキップ)"}`);
  return sites;
}
