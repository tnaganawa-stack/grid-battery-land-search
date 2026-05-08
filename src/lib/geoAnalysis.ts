/**
 * 地理空間分析ロジック (モック実装)
 * 実際の運用ではTurf.js + 衛星データ/GISデータを使用する
 */

import type { CandidateSite, FilterCriteria, LandUseCategory } from "@/types";

// ============================================================
// 検索・フィルタリング
// ============================================================

/**
 * 条件に合致する候補地を検索する
 * @param criteria フィルタ条件
 * @param allSites 全候補地リスト（実データ or モックを呼び出し側が渡す）
 */
export function searchCandidateSites(criteria: FilterCriteria, allSites: CandidateSite[]): CandidateSite[] {
  let results = [...allSites];

  // 都道府県フィルタ
  if (criteria.prefectures && criteria.prefectures.length > 0) {
    results = results.filter((s) =>
      criteria.prefectures!.some((p) => s.prefecture.includes(p))
    );
  }

  // 面積フィルタ
  if (criteria.minArea !== undefined) {
    results = results.filter((s) => s.area >= criteria.minArea!);
  }

  // 傾斜フィルタ
  if (criteria.maxSlope !== undefined) {
    results = results.filter((s) => s.slope <= criteria.maxSlope!);
  }

  // 変電所距離フィルタ
  if (criteria.maxDistanceFromSubstation !== undefined) {
    results = results.filter(
      (s) => s.nearestSubstation.distance <= criteria.maxDistanceFromSubstation!
    );
  }

  // 変電所電圧フィルタ
  if (criteria.minVoltageKv !== undefined) {
    results = results.filter(
      (s) => s.nearestSubstation.voltageKv >= criteria.minVoltageKv!
    );
  }

  // 系統空き容量フィルタ
  if (criteria.minAvailableCapacityMw !== undefined) {
    results = results.filter(
      (s) => s.nearestSubstation.availableCapacityMw >= criteria.minAvailableCapacityMw!
    );
  }

  // 土地利用カテゴリフィルタ
  if (criteria.landUseCategories && criteria.landUseCategories.length > 0) {
    results = results.filter((s) =>
      criteria.landUseCategories!.includes(s.landUseCategory)
    );
  }

  // 規制除外フィルタ
  if (criteria.excludeRegulations && criteria.excludeRegulations.length > 0) {
    results = results.filter((s) => {
      const hasExcludedReg = s.regulations.some((reg) =>
        criteria.excludeRegulations!.some((excReg) =>
          reg.includes(excReg) || excReg.includes(reg)
        )
      );
      return !hasExcludedReg;
    });
  }

  // 特定エリア除外
  if (criteria.excludeAreas && criteria.excludeAreas.length > 0) {
    results = results.filter((s) => {
      const shouldExclude = criteria.excludeAreas!.some((area) => {
        const areaLower = area.toLowerCase();
        return (
          s.prefecture.includes(area) ||
          s.municipality.includes(area) ||
          areaLower.includes(s.prefecture) ||
          areaLower.includes(s.municipality)
        );
      });
      return !shouldExclude;
    });
  }

  // 最小スコアフィルタ
  if (criteria.minScore !== undefined) {
    results = results.filter((s) => s.score >= criteria.minScore!);
  }

  // 現在候補IDでフィルタ（追加絞り込みの場合）
  if (criteria.currentCandidateIds && criteria.currentCandidateIds.length > 0) {
    results = results.filter((s) =>
      criteria.currentCandidateIds!.includes(s.id)
    );
  }

  // スコア順でソート
  return results.sort((a, b) => b.score - a.score);
}

/**
 * 候補地をスコアで再ランキング
 * 特定の重みを変えてスコアを再計算する
 */
export function rerankByPriority(
  sites: CandidateSite[],
  priority: "grid" | "terrain" | "land_use" | "regulation" | "cost"
): CandidateSite[] {
  const scored = sites.map((s) => {
    let adjustedScore = s.score;
    switch (priority) {
      case "grid":
        adjustedScore = s.score + s.scoreBreakdown.gridProximity * 0.5;
        break;
      case "terrain":
        adjustedScore = s.score + s.scoreBreakdown.terrain * 0.5;
        break;
      case "land_use":
        adjustedScore = s.score + s.scoreBreakdown.landUse * 0.5;
        break;
      case "regulation":
        adjustedScore = s.score + s.scoreBreakdown.regulation * 0.5;
        break;
      case "cost":
        // コスト優先: 推定工事費が低いものを上位に
        const cost = s.estimatedConstructionCost ?? 1000;
        adjustedScore = s.score - cost / 100;
        break;
    }
    return { ...s, _adjustedScore: adjustedScore };
  });

  return scored
    .sort((a, b) => (b as CandidateSite & { _adjustedScore: number })._adjustedScore -
                   (a as CandidateSite & { _adjustedScore: number })._adjustedScore)
    .map(({ ...site }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (site as any)._adjustedScore;
      return site as CandidateSite;
    });
}

// ============================================================
// 詳細情報取得
// ============================================================

/**
 * 候補地の詳細レポートを生成する
 * (実際はGISデータから動的生成するが、ここではモック)
 */
export function generateSiteDetailReport(site: CandidateSite): string {
  const regText =
    site.regulations.length > 0
      ? site.regulations.join("、")
      : "特になし";

  const costEstimate = site.estimatedConstructionCost
    ? `約${site.estimatedConstructionCost}百万円`
    : "試算中";

  return `
【${site.name}】詳細レポート
━━━━━━━━━━━━━━━━━━━━━━━━━━━
所在地    : ${site.prefecture} ${site.municipality}
座標      : 北緯${site.coordinates.lat.toFixed(4)}° 東経${site.coordinates.lng.toFixed(4)}°
━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 地形条件
  面積     : ${site.area} ha
  平均傾斜 : ${site.slope}°（${site.slope <= 3 ? "優良" : site.slope <= 7 ? "良好" : "要造成"}）
  標高     : ${site.elevation} m
  方位     : ${site.aspect}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 土地利用
  区分     : ${site.landUse}
  カテゴリ : ${getLandUseCategoryLabel(site.landUseCategory)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 系統接続条件
  最寄変電所: ${site.nearestSubstation.name}（${site.nearestSubstation.voltageKv}kV）
  変電所距離: ${site.nearestSubstation.distance.toFixed(1)} km
  送電線距離: ${site.gridDistance.toFixed(1)} km
  系統空き容量: ${site.nearestSubstation.availableCapacityMw < 0 ? "非公開（OCCTO未連携）" : `${site.nearestSubstation.availableCapacityMw}MW（${site.nearestSubstation.capacityStatus}）`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 法規制
  ${regText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 概算コスト
  工事費   : ${costEstimate}
  ※ 連系費・土地取得費は別途
━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 総合スコア : ${site.score}/100
  系統近接性 : ${site.scoreBreakdown.gridProximity}/20
  地形適性   : ${site.scoreBreakdown.terrain}/20
  土地利用   : ${site.scoreBreakdown.landUse}/20
  規制       : ${site.scoreBreakdown.regulation}/20
  アクセス   : ${site.scoreBreakdown.accessibility}/20
━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 備考
  ${site.notes ?? "なし"}
  `.trim();
}

// ============================================================
// 比較分析
// ============================================================

/**
 * 複数候補地の比較サマリーを生成する
 */
export function compareSites(sites: CandidateSite[]): string {
  if (sites.length === 0) return "比較対象なし";
  if (sites.length === 1)
    return `候補地が1件のみです。${sites[0].name}の詳細を確認してください。`;

  const best = sites.reduce((a, b) => (a.score > b.score ? a : b));
  const cheapest = sites.reduce((a, b) =>
    (a.estimatedConstructionCost ?? 9999) < (b.estimatedConstructionCost ?? 9999) ? a : b
  );
  const closest = sites.reduce((a, b) =>
    a.nearestSubstation.distance < b.nearestSubstation.distance ? a : b
  );
  const flattest = sites.reduce((a, b) => (a.slope < b.slope ? a : b));
  const mostCapacity = sites.reduce((a, b) =>
    a.nearestSubstation.availableCapacityMw > b.nearestSubstation.availableCapacityMw ? a : b
  );

  const capacityText = (mw: number, status: string) =>
    mw < 0 ? "非公開" : `${mw}MW(${status})`;

  return `
【${sites.length}候補地 比較分析】
━━━━━━━━━━━━━━━━━━━━━━━━━━━
総合スコア最高  : ${best.name}（${best.score}点）
最低コスト      : ${cheapest.name}（${cheapest.estimatedConstructionCost ?? "未試算"}百万円）
変電所最近接    : ${closest.name}（${closest.nearestSubstation.distance.toFixed(1)}km）
最平坦地        : ${flattest.name}（傾斜${flattest.slope}°）
━━━━━━━━━━━━━━━━━━━━━━━━━━━
候補地スコア比較:
${sites
  .sort((a, b) => b.score - a.score)
  .map(
    (s, i) =>
      `  ${i + 1}位 ${s.name} / ${s.score}点 / 系統空き:${capacityText(s.nearestSubstation.availableCapacityMw, s.nearestSubstation.capacityStatus)} / ${s.nearestSubstation.distance.toFixed(1)}km / ${s.slope}°`
  )
  .join("\n")}
  `.trim();
}

// ============================================================
// ユーティリティ
// ============================================================

export function getLandUseCategoryLabel(cat: LandUseCategory): string {
  const map: Record<LandUseCategory, string> = {
    agricultural: "農地",
    industrial: "工業地域",
    wasteland: "雑種地・原野",
    forest: "山林",
    other: "その他",
  };
  return map[cat] ?? cat;
}

/** 候補地の中心座標（重心）を計算 */
export function calcCentroid(
  sites: CandidateSite[]
): { lat: number; lng: number } | null {
  if (sites.length === 0) return null;
  const lat = sites.reduce((s, c) => s + c.coordinates.lat, 0) / sites.length;
  const lng = sites.reduce((s, c) => s + c.coordinates.lng, 0) / sites.length;
  return { lat, lng };
}
