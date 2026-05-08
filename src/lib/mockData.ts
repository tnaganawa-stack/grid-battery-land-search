/**
 * 系統用蓄電池 用地選定 モックデータ
 * 対象エリア: 関東地方（茨城・栃木・群馬・埼玉・千葉・神奈川）および山梨・長野
 *
 * 【系統空き容量について】
 * 実際の「系統空き容量マップ」は東京電力パワーグリッドが公開している。
 * ここではそのデータを模したモック値を使用。
 * 空き容量が大きいほど、低コストで大容量蓄電池を連系できる。
 */

import type { Substation, TransmissionLine, CandidateSite, CapacityStatus } from "@/types";

// ============================================================
// ヘルパー: 空き容量ステータス判定
// ============================================================
function toCapacityStatus(mw: number): CapacityStatus {
  if (mw >= 50) return "十分";
  if (mw >= 10) return "中程度";
  if (mw >= 1) return "逼迫";
  return "ゼロ";
}

// ============================================================
// 変電所モックデータ (20箇所) — 系統空き容量付き
// ============================================================
export const MOCK_SUBSTATIONS: Substation[] = [
  {
    id: "sub-001", name: "茨城西変電所",
    coordinates: { lat: 36.341, lng: 139.987 },
    voltageKv: 275, capacityMva: 500, operator: "東京電力パワーグリッド",
    availableCapacityMw: 120, capacityStatus: "十分",
    capacityNote: "北関東幹線接続点。大型蓄電所の連系実績あり。",
  },
  {
    id: "sub-002", name: "常総変電所",
    coordinates: { lat: 36.023, lng: 139.997 },
    voltageKv: 154, capacityMva: 300, operator: "東京電力パワーグリッド",
    availableCapacityMw: 8, capacityStatus: "逼迫",
    capacityNote: "既設太陽光が集中し空き容量が逼迫。増強工事が必要な可能性。",
  },
  {
    id: "sub-003", name: "栃木変電所",
    coordinates: { lat: 36.555, lng: 139.883 },
    voltageKv: 275, capacityMva: 450, operator: "東京電力パワーグリッド",
    availableCapacityMw: 85, capacityStatus: "十分",
    capacityNote: "北部幹線接続。蓄電池連系向けに空き容量を確保済み。",
  },
  {
    id: "sub-004", name: "佐野変電所",
    coordinates: { lat: 36.314, lng: 139.595 },
    voltageKv: 154, capacityMva: 250, operator: "東京電力パワーグリッド",
    availableCapacityMw: 3, capacityStatus: "逼迫",
    capacityNote: "154kV系統が飽和状態。275kV昇圧工事なしでは大容量連系困難。",
  },
  {
    id: "sub-005", name: "群馬東変電所",
    coordinates: { lat: 36.391, lng: 139.060 },
    voltageKv: 275, capacityMva: 400, operator: "東京電力パワーグリッド",
    availableCapacityMw: 65, capacityStatus: "十分",
    capacityNote: "北関東幹線の中継点。工業地帯への連系実績豊富。",
  },
  {
    id: "sub-006", name: "熊谷変電所",
    coordinates: { lat: 36.147, lng: 139.388 },
    voltageKv: 275, capacityMva: 500, operator: "東京電力パワーグリッド",
    availableCapacityMw: 180, capacityStatus: "十分",
    capacityNote: "関東最大級の空き容量。系統増強計画で更に拡大見込み。",
  },
  {
    id: "sub-007", name: "千葉北変電所",
    coordinates: { lat: 35.743, lng: 140.128 },
    voltageKv: 275, capacityMva: 600, operator: "東京電力パワーグリッド",
    availableCapacityMw: 40, capacityStatus: "中程度",
    capacityNote: "都市近郊のため需要変動大。30〜50MW規模が適正。",
  },
  {
    id: "sub-008", name: "銚子変電所",
    coordinates: { lat: 35.726, lng: 140.826 },
    voltageKv: 154, capacityMva: 200, operator: "東京電力パワーグリッド",
    availableCapacityMw: 15, capacityStatus: "中程度",
    capacityNote: "洋上風力計画との競合に注意。早期申請が推奨される。",
  },
  {
    id: "sub-009", name: "相模原変電所",
    coordinates: { lat: 35.524, lng: 139.385 },
    voltageKv: 275, capacityMva: 450, operator: "東京電力パワーグリッド",
    availableCapacityMw: 95, capacityStatus: "十分",
    capacityNote: "南関東幹線接続。揚水発電との協調制御が可能な立地。",
  },
  {
    id: "sub-010", name: "小田原変電所",
    coordinates: { lat: 35.265, lng: 139.152 },
    voltageKv: 154, capacityMva: 300, operator: "東京電力パワーグリッド",
    availableCapacityMw: 5, capacityStatus: "逼迫",
    capacityNote: "観光地需要と再エネが競合。空き容量ほぼ枯渇。",
  },
  {
    id: "sub-011", name: "甲府変電所",
    coordinates: { lat: 35.664, lng: 138.568 },
    voltageKv: 275, capacityMva: 350, operator: "東京電力パワーグリッド",
    availableCapacityMw: 110, capacityStatus: "十分",
    capacityNote: "山梨県内の基幹変電所。広域系統調整機能を持つ。",
  },
  {
    id: "sub-012", name: "富士変電所",
    coordinates: { lat: 35.161, lng: 138.686 },
    voltageKv: 154, capacityMva: 280, operator: "東京電力パワーグリッド",
    availableCapacityMw: 0, capacityStatus: "ゼロ",
    capacityNote: "空き容量ゼロ。系統増強が完了するまで新規連系不可。",
  },
  {
    id: "sub-013", name: "新信濃変電所",
    coordinates: { lat: 36.125, lng: 137.954 },
    voltageKv: 500, capacityMva: 1000, operator: "東京電力パワーグリッド",
    availableCapacityMw: 350, capacityStatus: "十分",
    capacityNote: "500kV幹線の交直変換所。超大容量蓄電池（200MW超）の連系に対応可能。",
  },
  {
    id: "sub-014", name: "長野変電所",
    coordinates: { lat: 36.651, lng: 138.181 },
    voltageKv: 275, capacityMva: 400, operator: "東京電力パワーグリッド",
    availableCapacityMw: 75, capacityStatus: "十分",
    capacityNote: "長野北部の基幹点。再エネ導入余地が大きいエリア。",
  },
  {
    id: "sub-015", name: "水戸変電所",
    coordinates: { lat: 36.341, lng: 140.451 },
    voltageKv: 275, capacityMva: 500, operator: "東京電力パワーグリッド",
    availableCapacityMw: 160, capacityStatus: "十分",
    capacityNote: "茨城の基幹変電所。洋上風力計画の系統補完として蓄電池需要が高い。",
  },
  {
    id: "sub-016", name: "那珂変電所",
    coordinates: { lat: 36.452, lng: 140.489 },
    voltageKv: 154, capacityMva: 200, operator: "東京電力パワーグリッド",
    availableCapacityMw: 12, capacityStatus: "中程度",
    capacityNote: "那珂川沿いの分散型電源が多く、空き容量は中程度。",
  },
  {
    id: "sub-017", name: "鹿嶋変電所",
    coordinates: { lat: 35.969, lng: 140.643 },
    voltageKv: 275, capacityMva: 450, operator: "東京電力パワーグリッド",
    availableCapacityMw: 210, capacityStatus: "十分",
    capacityNote: "鹿島臨海工業地帯の基幹変電所。製鉄所の縮小で大量の空き容量が発生。",
  },
  {
    id: "sub-018", name: "石岡変電所",
    coordinates: { lat: 36.189, lng: 140.287 },
    voltageKv: 154, capacityMva: 250, operator: "東京電力パワーグリッド",
    availableCapacityMw: 0, capacityStatus: "ゼロ",
    capacityNote: "空き容量ゼロ。太陽光が飽和。275kV昇圧前提の申請が必要。",
  },
  {
    id: "sub-019", name: "古河変電所",
    coordinates: { lat: 36.131, lng: 139.706 },
    voltageKv: 154, capacityMva: 220, operator: "東京電力パワーグリッド",
    availableCapacityMw: 35, capacityStatus: "中程度",
    capacityNote: "埼玉・茨城・栃木の3県境。30MW前後の連系なら早期着工可能。",
  },
  {
    id: "sub-020", name: "狭山変電所",
    coordinates: { lat: 35.854, lng: 139.410 },
    voltageKv: 275, capacityMva: 500, operator: "東京電力パワーグリッド",
    availableCapacityMw: 55, capacityStatus: "十分",
    capacityNote: "首都圏西部の幹線。工場移転跡地への蓄電池誘致が進む地域。",
  },
];

// ============================================================
// 変電所IDから取得
// ============================================================
const substationMap = new Map(MOCK_SUBSTATIONS.map((s) => [s.id, s]));
function sub(id: string) {
  const s = substationMap.get(id)!;
  return {
    id: s.id,
    name: s.name,
    distance: 0, // 後で各サイトに実際の距離を設定
    voltageKv: s.voltageKv,
    availableCapacityMw: s.availableCapacityMw,
    capacityStatus: s.capacityStatus,
  };
}

// ============================================================
// 送電線モックデータ
// ============================================================
export const MOCK_TRANSMISSION_LINES: TransmissionLine[] = [
  {
    id: "tl-001", name: "北関東幹線", voltageKv: 275,
    path: [
      { lat: 36.651, lng: 138.181 }, { lat: 36.391, lng: 139.060 },
      { lat: 36.147, lng: 139.388 }, { lat: 36.341, lng: 139.987 },
      { lat: 36.555, lng: 139.883 }, { lat: 36.341, lng: 140.451 },
    ],
  },
  {
    id: "tl-002", name: "東関東幹線", voltageKv: 275,
    path: [
      { lat: 36.341, lng: 140.451 }, { lat: 35.969, lng: 140.643 },
      { lat: 35.743, lng: 140.128 },
    ],
  },
  {
    id: "tl-003", name: "南関東幹線", voltageKv: 275,
    path: [
      { lat: 36.147, lng: 139.388 }, { lat: 35.854, lng: 139.410 },
      { lat: 35.524, lng: 139.385 }, { lat: 35.265, lng: 139.152 },
    ],
  },
];

// ============================================================
// 候補地モックデータ（30箇所）
// スコア内訳:
//   gridProximity (0-20) = 距離スコア(0-10) + 空き容量スコア(0-10)
//   terrain (0-20), landUse (0-20), regulation (0-20), accessibility (0-20)
// ============================================================
export const MOCK_CANDIDATE_SITES: CandidateSite[] = [
  // ---- 茨城県 ----
  {
    id: "site-001", name: "笠間市 北山工業団地隣接地",
    coordinates: { lat: 36.348, lng: 140.298 },
    area: 4.2, slope: 2.1, elevation: 78, aspect: "S",
    landUse: "工業用地（一部未利用）", landUseCategory: "industrial",
    prefecture: "茨城県", municipality: "笠間市",
    nearestSubstation: { ...sub("sub-018"), distance: 12.3 },
    gridDistance: 1.8, regulations: [],
    score: 70,
    scoreBreakdown: { gridProximity: 5, terrain: 18, landUse: 18, regulation: 20, accessibility: 9 },
    estimatedConstructionCost: 850,
    notes: "石岡変電所は空き容量ゼロのため、現状では連系不可。275kV昇圧工事（別途費用）が完了すれば有力候補に浮上。",
  },
  {
    id: "site-002", name: "常陸大宮市 那珂川沿い農地",
    coordinates: { lat: 36.532, lng: 140.408 },
    area: 6.8, slope: 0.8, elevation: 52, aspect: "flat",
    landUse: "農地（転用可能性あり）", landUseCategory: "agricultural",
    prefecture: "茨城県", municipality: "常陸大宮市",
    nearestSubstation: { ...sub("sub-016"), distance: 8.7 },
    gridDistance: 3.2, regulations: ["農業振興地域（農振除外要検討）"],
    score: 65,
    scoreBreakdown: { gridProximity: 11, terrain: 20, landUse: 12, regulation: 13, accessibility: 9 },
    estimatedConstructionCost: 620,
    notes: "那珂変電所は中程度の空き。農振除外後に速やかに連系申請することで先行確保が可能。",
  },
  {
    id: "site-003", name: "鹿嶋市 工業地域空地",
    coordinates: { lat: 35.962, lng: 140.669 },
    area: 3.5, slope: 1.2, elevation: 12, aspect: "flat",
    landUse: "工業地域（未活用地）", landUseCategory: "industrial",
    prefecture: "茨城県", municipality: "鹿嶋市",
    nearestSubstation: { ...sub("sub-017"), distance: 2.1 },
    gridDistance: 0.8, regulations: [],
    score: 90,
    scoreBreakdown: { gridProximity: 19, terrain: 18, landUse: 18, regulation: 20, accessibility: 15 },
    estimatedConstructionCost: 480,
    notes: "鹿嶋変電所は210MWの空き容量（関東トップクラス）。製鉄所縮小による余剰系統を活用できる最有力候補。",
  },
  {
    id: "site-004", name: "行方市 霞ヶ浦沿岸雑種地",
    coordinates: { lat: 36.071, lng: 140.511 },
    area: 5.1, slope: 1.5, elevation: 8, aspect: "SE",
    landUse: "雑種地", landUseCategory: "wasteland",
    prefecture: "茨城県", municipality: "行方市",
    nearestSubstation: { ...sub("sub-017"), distance: 15.8 },
    gridDistance: 6.2, regulations: ["霞ヶ浦湖岸保全区域（要協議）"],
    score: 65,
    scoreBreakdown: { gridProximity: 13, terrain: 19, landUse: 16, regulation: 10, accessibility: 7 },
    estimatedConstructionCost: 720,
    notes: "鹿嶋変電所の大容量空きを利用できるが距離がやや遠い。湖岸保全区域の協議が必要。",
  },
  {
    id: "site-005", name: "小美玉市 農地・雑種地混在エリア",
    coordinates: { lat: 36.189, lng: 140.362 },
    area: 7.3, slope: 2.8, elevation: 35, aspect: "S",
    landUse: "農地・雑種地混在", landUseCategory: "wasteland",
    prefecture: "茨城県", municipality: "小美玉市",
    nearestSubstation: { ...sub("sub-018"), distance: 7.4 },
    gridDistance: 2.9, regulations: [],
    score: 67,
    scoreBreakdown: { gridProximity: 7, terrain: 17, landUse: 15, regulation: 18, accessibility: 10 },
    estimatedConstructionCost: 680,
    notes: "石岡変電所は空き容量ゼロ。百里基地の航空制限もあり、連系と高さ制限の双方に課題。",
  },

  // ---- 栃木県 ----
  {
    id: "site-006", name: "那須塩原市 工業団地拡張予定地",
    coordinates: { lat: 36.967, lng: 139.985 },
    area: 8.5, slope: 3.2, elevation: 342, aspect: "SW",
    landUse: "工業専用地域", landUseCategory: "industrial",
    prefecture: "栃木県", municipality: "那須塩原市",
    nearestSubstation: { ...sub("sub-003"), distance: 28.4 },
    gridDistance: 9.8, regulations: [],
    score: 64,
    scoreBreakdown: { gridProximity: 9, terrain: 16, landUse: 18, regulation: 20, accessibility: 1 },
    estimatedConstructionCost: 980,
    notes: "栃木変電所は85MW空きで容量は問題なし。ただし変電所まで28kmと遠く、専用送電線の建設費がネック。",
  },
  {
    id: "site-007", name: "壬生町 壬生産業団地隣接",
    coordinates: { lat: 36.437, lng: 139.806 },
    area: 3.8, slope: 1.9, elevation: 98, aspect: "flat",
    landUse: "工業地域", landUseCategory: "industrial",
    prefecture: "栃木県", municipality: "壬生町",
    nearestSubstation: { ...sub("sub-003"), distance: 9.6 },
    gridDistance: 2.4, regulations: [],
    score: 82,
    scoreBreakdown: { gridProximity: 15, terrain: 18, landUse: 18, regulation: 20, accessibility: 11 },
    estimatedConstructionCost: 560,
    notes: "栃木変電所に85MW空きあり。産業団地内で電力インフラ整備済み。コスト・容量ともに優良。",
  },
  {
    id: "site-008", name: "佐野市 旧工場跡地",
    coordinates: { lat: 36.324, lng: 139.577 },
    area: 2.9, slope: 0.5, elevation: 65, aspect: "flat",
    landUse: "工業地域（遊休）", landUseCategory: "industrial",
    prefecture: "栃木県", municipality: "佐野市",
    nearestSubstation: { ...sub("sub-004"), distance: 3.2 },
    gridDistance: 1.1, regulations: [],
    score: 72,
    scoreBreakdown: { gridProximity: 10, terrain: 19, landUse: 17, regulation: 20, accessibility: 6 },
    estimatedConstructionCost: 520,
    notes: "佐野変電所は空き容量3MWで逼迫。旧工場の電気設備を再利用できるが、大容量連系には275kV増強が必要。",
  },
  {
    id: "site-009", name: "足利市 郊外農地",
    coordinates: { lat: 36.332, lng: 139.451 },
    area: 4.1, slope: 5.3, elevation: 120, aspect: "SE",
    landUse: "農地", landUseCategory: "agricultural",
    prefecture: "栃木県", municipality: "足利市",
    nearestSubstation: { ...sub("sub-004"), distance: 11.7 },
    gridDistance: 4.8, regulations: ["農業振興地域"],
    score: 42,
    scoreBreakdown: { gridProximity: 6, terrain: 13, landUse: 11, regulation: 12, accessibility: 0 },
    estimatedConstructionCost: 810,
    notes: "佐野変電所の空き容量逼迫＋農振除外＋傾斜大と三重苦。優先度低。",
  },

  // ---- 群馬県 ----
  {
    id: "site-010", name: "太田市 工業地域空地",
    coordinates: { lat: 36.292, lng: 139.382 },
    area: 5.6, slope: 1.3, elevation: 52, aspect: "flat",
    landUse: "工業専用地域", landUseCategory: "industrial",
    prefecture: "群馬県", municipality: "太田市",
    nearestSubstation: { ...sub("sub-006"), distance: 14.2 },
    gridDistance: 3.7, regulations: [],
    score: 77,
    scoreBreakdown: { gridProximity: 14, terrain: 19, landUse: 18, regulation: 20, accessibility: 6 },
    estimatedConstructionCost: 740,
    notes: "熊谷変電所に180MWの大容量空きあり。14km先だが大規模蓄電池なら十分採算が合う立地。",
  },
  {
    id: "site-011", name: "伊勢崎市 廃棄物処分場跡地",
    coordinates: { lat: 36.312, lng: 139.196 },
    area: 3.3, slope: 2.0, elevation: 68, aspect: "S",
    landUse: "雑種地（廃棄物処分場跡）", landUseCategory: "wasteland",
    prefecture: "群馬県", municipality: "伊勢崎市",
    nearestSubstation: { ...sub("sub-005"), distance: 9.8 },
    gridDistance: 2.6, regulations: ["廃棄物処分場跡地（土壌調査要）"],
    score: 69,
    scoreBreakdown: { gridProximity: 15, terrain: 17, landUse: 14, regulation: 14, accessibility: 9 },
    estimatedConstructionCost: 650,
    notes: "群馬東変電所に65MW空きあり。土壌調査クリア後は連系コスト優位の立地。",
  },
  {
    id: "site-012", name: "前橋市 郊外農地（転用候補）",
    coordinates: { lat: 36.389, lng: 139.063 },
    area: 9.2, slope: 1.8, elevation: 104, aspect: "SE",
    landUse: "農地", landUseCategory: "agricultural",
    prefecture: "群馬県", municipality: "前橋市",
    nearestSubstation: { ...sub("sub-005"), distance: 4.1 },
    gridDistance: 1.5, regulations: ["農業振興地域（要除外申請）"],
    score: 74,
    scoreBreakdown: { gridProximity: 17, terrain: 18, landUse: 12, regulation: 13, accessibility: 14 },
    estimatedConstructionCost: 580,
    notes: "群馬東変電所至近で65MW空き。農振除外さえ済めば系統連系コストが最低水準の有力候補。",
  },

  // ---- 埼玉県 ----
  {
    id: "site-013", name: "本庄市 工業団地内空き区画",
    coordinates: { lat: 36.248, lng: 139.189 },
    area: 2.7, slope: 0.9, elevation: 88, aspect: "flat",
    landUse: "工業地域", landUseCategory: "industrial",
    prefecture: "埼玉県", municipality: "本庄市",
    nearestSubstation: { ...sub("sub-006"), distance: 18.3 },
    gridDistance: 5.2, regulations: [],
    score: 71,
    scoreBreakdown: { gridProximity: 12, terrain: 19, landUse: 18, regulation: 20, accessibility: 2 },
    estimatedConstructionCost: 690,
    notes: "熊谷変電所の180MW大容量空きを活用可能。18kmは長いが大規模案件なら許容範囲内。",
  },
  {
    id: "site-014", name: "秩父市 廃鉱山跡地",
    coordinates: { lat: 35.987, lng: 139.072 },
    area: 12.4, slope: 8.7, elevation: 412, aspect: "N",
    landUse: "山林・原野", landUseCategory: "forest",
    prefecture: "埼玉県", municipality: "秩父市",
    nearestSubstation: { ...sub("sub-009"), distance: 42.1 },
    gridDistance: 18.5, regulations: ["急傾斜地崩壊危険区域（一部）", "保安林（一部）"],
    score: 30,
    scoreBreakdown: { gridProximity: 8, terrain: 8, landUse: 9, regulation: 8, accessibility: -3 },
    estimatedConstructionCost: 2100,
    notes: "相模原変電所に95MW空きがあるが42km先。傾斜・規制・アクセス不良の三重苦で開発優先度最低。",
  },
  {
    id: "site-015", name: "加須市 田園地帯雑種地",
    coordinates: { lat: 36.131, lng: 139.600 },
    area: 4.8, slope: 0.3, elevation: 14, aspect: "flat",
    landUse: "雑種地", landUseCategory: "wasteland",
    prefecture: "埼玉県", municipality: "加須市",
    nearestSubstation: { ...sub("sub-019"), distance: 6.8 },
    gridDistance: 2.3, regulations: [],
    score: 77,
    scoreBreakdown: { gridProximity: 13, terrain: 19, landUse: 16, regulation: 20, accessibility: 9 },
    estimatedConstructionCost: 510,
    notes: "古河変電所に35MW空き。洪水ハザード確認は必要だが、コスト・地形は最優秀水準。",
  },

  // ---- 千葉県 ----
  {
    id: "site-016", name: "銚子市 旧食品工場跡地",
    coordinates: { lat: 35.734, lng: 140.796 },
    area: 3.6, slope: 1.1, elevation: 28, aspect: "SE",
    landUse: "工業地域", landUseCategory: "industrial",
    prefecture: "千葉県", municipality: "銚子市",
    nearestSubstation: { ...sub("sub-008"), distance: 3.4 },
    gridDistance: 1.2, regulations: [],
    score: 77,
    scoreBreakdown: { gridProximity: 13, terrain: 18, landUse: 17, regulation: 20, accessibility: 9 },
    estimatedConstructionCost: 460,
    notes: "銚子変電所の15MW空きは早い者勝ちの状況。洋上風力の計画が進む前に申請が推奨される。",
  },
  {
    id: "site-017", name: "旭市 九十九里浜背後地",
    coordinates: { lat: 35.712, lng: 140.621 },
    area: 6.2, slope: 0.6, elevation: 18, aspect: "flat",
    landUse: "農地・砂丘地", landUseCategory: "wasteland",
    prefecture: "千葉県", municipality: "旭市",
    nearestSubstation: { ...sub("sub-008"), distance: 18.6 },
    gridDistance: 7.4, regulations: ["農振地域（一部）", "砂防指定地（一部）"],
    score: 54,
    scoreBreakdown: { gridProximity: 7, terrain: 17, landUse: 12, regulation: 11, accessibility: 7 },
    estimatedConstructionCost: 820,
    notes: "銚子変電所まで遠く、15MWの空き容量は小規模連系しか対応できない。津波リスク評価も必要。",
  },
  {
    id: "site-018", name: "成田市 物流施設隣接地",
    coordinates: { lat: 35.778, lng: 140.318 },
    area: 4.5, slope: 2.4, elevation: 42, aspect: "S",
    landUse: "工業地域", landUseCategory: "industrial",
    prefecture: "千葉県", municipality: "成田市",
    nearestSubstation: { ...sub("sub-007"), distance: 21.4 },
    gridDistance: 8.2, regulations: ["航空障害（成田空港近傍・高さ制限）"],
    score: 60,
    scoreBreakdown: { gridProximity: 9, terrain: 17, landUse: 16, regulation: 12, accessibility: 6 },
    estimatedConstructionCost: 870,
    notes: "千葉北変電所に40MW空きあり。高さ制限（45m以下）はコンテナ型蓄電池なら適合可能。",
  },

  // ---- 神奈川県 ----
  {
    id: "site-019", name: "相模原市 工業団地跡地",
    coordinates: { lat: 35.549, lng: 139.412 },
    area: 3.2, slope: 1.7, elevation: 158, aspect: "SE",
    landUse: "工業専用地域", landUseCategory: "industrial",
    prefecture: "神奈川県", municipality: "相模原市",
    nearestSubstation: { ...sub("sub-009"), distance: 4.8 },
    gridDistance: 1.6, regulations: [],
    score: 85,
    scoreBreakdown: { gridProximity: 17, terrain: 17, landUse: 18, regulation: 20, accessibility: 13 },
    estimatedConstructionCost: 510,
    notes: "相模原変電所に95MW空きあり。揚水発電との協調制御で調整力を高めたい東電PGが積極誘致中の立地。",
  },
  {
    id: "site-020", name: "秦野市 郊外農地",
    coordinates: { lat: 35.389, lng: 139.212 },
    area: 5.7, slope: 6.8, elevation: 285, aspect: "S",
    landUse: "農地", landUseCategory: "agricultural",
    prefecture: "神奈川県", municipality: "秦野市",
    nearestSubstation: { ...sub("sub-010"), distance: 16.3 },
    gridDistance: 7.9, regulations: ["農業振興地域", "土砂災害警戒区域（一部）"],
    score: 36,
    scoreBreakdown: { gridProximity: 5, terrain: 12, landUse: 10, regulation: 9, accessibility: 0 },
    estimatedConstructionCost: 1150,
    notes: "小田原変電所は空き容量ゼロに近い（5MW）。傾斜・土砂リスク・農振の三重苦。開発優先度低。",
  },

  // ---- 山梨県 ----
  {
    id: "site-021", name: "甲府市 リニア沿線工業地域",
    coordinates: { lat: 35.691, lng: 138.543 },
    area: 4.9, slope: 2.3, elevation: 282, aspect: "SE",
    landUse: "工業地域", landUseCategory: "industrial",
    prefecture: "山梨県", municipality: "甲府市",
    nearestSubstation: { ...sub("sub-011"), distance: 5.6 },
    gridDistance: 2.1, regulations: [],
    score: 81,
    scoreBreakdown: { gridProximity: 17, terrain: 17, landUse: 18, regulation: 20, accessibility: 9 },
    estimatedConstructionCost: 590,
    notes: "甲府変電所に110MW空きあり。リニア工事の残土処分地を転用できればコスト削減も見込める。",
  },
  {
    id: "site-022", name: "南アルプス市 農地・工業混在",
    coordinates: { lat: 35.618, lng: 138.472 },
    area: 8.1, slope: 3.9, elevation: 248, aspect: "SE",
    landUse: "農地・工業混在", landUseCategory: "agricultural",
    prefecture: "山梨県", municipality: "南アルプス市",
    nearestSubstation: { ...sub("sub-011"), distance: 12.1 },
    gridDistance: 4.6, regulations: ["農業振興地域（一部）"],
    score: 65,
    scoreBreakdown: { gridProximity: 14, terrain: 15, landUse: 12, regulation: 14, accessibility: 10 },
    estimatedConstructionCost: 720,
    notes: "甲府変電所の110MW空きを利用できる。工業ゾーンのみ先行開発で農振除外を回避する戦略が有効。",
  },

  // ---- 長野県 ----
  {
    id: "site-023", name: "上田市 廃工場跡地",
    coordinates: { lat: 36.401, lng: 138.249 },
    area: 3.1, slope: 1.6, elevation: 436, aspect: "S",
    landUse: "工業地域（遊休）", landUseCategory: "industrial",
    prefecture: "長野県", municipality: "上田市",
    nearestSubstation: { ...sub("sub-014"), distance: 22.8 },
    gridDistance: 8.7, regulations: [],
    score: 66,
    scoreBreakdown: { gridProximity: 11, terrain: 17, landUse: 17, regulation: 20, accessibility: 1 },
    estimatedConstructionCost: 820,
    notes: "長野変電所に75MW空きあり。22.8km先だが、送電インフラ整備で採算ラインに乗る可能性。",
  },
  {
    id: "site-024", name: "飯田市 リニア建設残土処分地",
    coordinates: { lat: 35.514, lng: 137.821 },
    area: 7.8, slope: 4.2, elevation: 522, aspect: "SW",
    landUse: "原野（リニア関連整備地）", landUseCategory: "wasteland",
    prefecture: "長野県", municipality: "飯田市",
    nearestSubstation: { ...sub("sub-013"), distance: 38.7 },
    gridDistance: 14.2, regulations: ["急傾斜地崩壊危険区域（周辺部）"],
    score: 49,
    scoreBreakdown: { gridProximity: 10, terrain: 13, landUse: 13, regulation: 12, accessibility: 1 },
    estimatedConstructionCost: 1450,
    notes: "新信濃変電所は500kVで350MWという圧倒的な空き容量。ただし38.7kmと遠く、超大規模案件（100MW超）でないと採算が合わない。",
  },
  {
    id: "site-025", name: "佐久市 平地農地（大規模）",
    coordinates: { lat: 36.248, lng: 138.476 },
    area: 15.3, slope: 1.2, elevation: 712, aspect: "flat",
    landUse: "農地（大規模）", landUseCategory: "agricultural",
    prefecture: "長野県", municipality: "佐久市",
    nearestSubstation: { ...sub("sub-014"), distance: 26.4 },
    gridDistance: 9.8, regulations: ["農業振興地域", "標高によるコスト増"],
    score: 57,
    scoreBreakdown: { gridProximity: 9, terrain: 18, landUse: 10, regulation: 12, accessibility: 8 },
    estimatedConstructionCost: 1100,
    notes: "長野変電所75MW空き。農振除外と連系コストが課題だが、最大面積の候補地として大規模案件には検討価値あり。",
  },

  // ---- 追加候補 ----
  {
    id: "site-026", name: "古河市 産業廃棄物施設跡",
    coordinates: { lat: 36.158, lng: 139.718 },
    area: 4.3, slope: 0.4, elevation: 11, aspect: "flat",
    landUse: "雑種地（産廃施設跡）", landUseCategory: "wasteland",
    prefecture: "茨城県", municipality: "古河市",
    nearestSubstation: { ...sub("sub-019"), distance: 2.8 },
    gridDistance: 0.9, regulations: ["産廃施設跡地（土壌調査要）"],
    score: 76,
    scoreBreakdown: { gridProximity: 15, terrain: 19, landUse: 14, regulation: 15, accessibility: 13 },
    estimatedConstructionCost: 530,
    notes: "古河変電所に35MW空きあり。至近距離で連系コスト最小。土壌調査クリアが前提条件。",
  },
  {
    id: "site-027", name: "結城市 工業地域隣接農地",
    coordinates: { lat: 36.302, lng: 139.871 },
    area: 3.9, slope: 1.1, elevation: 22, aspect: "S",
    landUse: "農地（工業地域隣接）", landUseCategory: "agricultural",
    prefecture: "茨城県", municipality: "結城市",
    nearestSubstation: { ...sub("sub-002"), distance: 9.2 },
    gridDistance: 3.4, regulations: ["農業振興地域（要除外）"],
    score: 57,
    scoreBreakdown: { gridProximity: 9, terrain: 19, landUse: 12, regulation: 14, accessibility: 3 },
    estimatedConstructionCost: 600,
    notes: "常総変電所は空き容量8MWで逼迫。農振除外しても大容量連系が困難なため優先度を下げる。",
  },
  {
    id: "site-028", name: "高崎市 郊外工業団地空き地",
    coordinates: { lat: 36.291, lng: 139.004 },
    area: 4.0, slope: 2.1, elevation: 115, aspect: "SE",
    landUse: "工業専用地域", landUseCategory: "industrial",
    prefecture: "群馬県", municipality: "高崎市",
    nearestSubstation: { ...sub("sub-005"), distance: 7.3 },
    gridDistance: 2.8, regulations: [],
    score: 81,
    scoreBreakdown: { gridProximity: 15, terrain: 17, landUse: 18, regulation: 20, accessibility: 11 },
    estimatedConstructionCost: 540,
    notes: "群馬東変電所に65MW空きあり。北関東道インター近傍で物流・建設アクセス良好。バランス優秀な候補。",
  },
  {
    id: "site-029", name: "館林市 旧工場用地",
    coordinates: { lat: 36.245, lng: 139.541 },
    area: 2.8, slope: 0.7, elevation: 28, aspect: "flat",
    landUse: "工業地域", landUseCategory: "industrial",
    prefecture: "群馬県", municipality: "館林市",
    nearestSubstation: { ...sub("sub-006"), distance: 11.4 },
    gridDistance: 4.1, regulations: [],
    score: 76,
    scoreBreakdown: { gridProximity: 14, terrain: 19, landUse: 17, regulation: 20, accessibility: 6 },
    estimatedConstructionCost: 490,
    notes: "熊谷変電所の180MW大容量を活用できる。平坦で造成費最小。小規模蓄電池の先行立地に最適。",
  },
  {
    id: "site-030", name: "下妻市 常総用水路沿農地",
    coordinates: { lat: 36.192, lng: 139.965 },
    area: 5.5, slope: 0.9, elevation: 18, aspect: "flat",
    landUse: "農地", landUseCategory: "agricultural",
    prefecture: "茨城県", municipality: "下妻市",
    nearestSubstation: { ...sub("sub-002"), distance: 5.1 },
    gridDistance: 2.0, regulations: ["農業振興地域（要除外申請）"],
    score: 61,
    scoreBreakdown: { gridProximity: 10, terrain: 19, landUse: 12, regulation: 14, accessibility: 6 },
    estimatedConstructionCost: 550,
    notes: "常総変電所の空き容量8MWが最大の制約。農振除外に先行し、増強計画完了を待つ戦略が現実的。",
  },
];

// ============================================================
// ヘルパー関数
// ============================================================

/** 2点間の距離 (km) を計算 (Haversine) */
export function calcDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aVal = sinDLat * sinDLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
}

/** 都道府県の一覧を返す */
export function getPrefectures(): string[] {
  return Array.from(new Set(MOCK_CANDIDATE_SITES.map((s) => s.prefecture))).sort();
}

/** IDで候補地を取得 */
export function getSiteById(id: string): CandidateSite | undefined {
  return MOCK_CANDIDATE_SITES.find((s) => s.id === id);
}
