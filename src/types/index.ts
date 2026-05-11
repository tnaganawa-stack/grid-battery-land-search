// ============================================================
// 地理座標
// ============================================================
export interface Coordinates {
  lat: number;
  lng: number;
}

// ============================================================
// 変電所
// ============================================================
export type CapacityStatus = "十分" | "中程度" | "逼迫" | "ゼロ";

export interface Substation {
  id: string;
  name: string;
  coordinates: Coordinates;
  voltageKv: number;              // 電圧 (kV)
  capacityMva: number;            // 変電所容量 (MVA)
  operator: string;               // 管理事業者
  availableCapacityMw: number;    // 系統空き容量 (MW) ※モック値
  capacityStatus: CapacityStatus; // 空き容量ステータス
  capacityNote?: string;          // 空き容量の注記
}

// ============================================================
// 送電線
// ============================================================
export interface TransmissionLine {
  id: string;
  name: string;
  voltageKv: number;
  path: Coordinates[]; // GeoJSON LineString的に格納
  location?: "overhead" | "underground"; // 架空線 | 地中埋設
}

// ============================================================
// 候補地スコア内訳
// ============================================================
export interface ScoreBreakdown {
  gridProximity: number;  // 送電網近接性 (0-20)
  terrain: number;        // 地形適性 (0-20)
  landUse: number;        // 土地利用適性 (0-20)
  regulation: number;     // 規制クリア度 (0-20)
  accessibility: number;  // アクセス性 (0-20)
}

// ============================================================
// 候補地
// ============================================================
export type LandUseCategory =
  | "agricultural"  // 農地
  | "industrial"    // 工業地域
  | "wasteland"     // 雑種地・原野
  | "forest"        // 山林
  | "other";

export type AspectDirection =
  | "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "flat";

export interface FitVoltageClasses {
  低圧: number;   // kW (< 50kW)
  高圧: number;   // kW (50kW ~ 2000kW)
  特別高圧: number; // kW (>= 2000kW)
}

export interface CandidateSite {
  id: string;
  name: string;
  coordinates: Coordinates;
  area: number;           // 面積 (ha)
  slope: number;          // 平均傾斜 (度)
  elevation: number;      // 平均標高 (m)
  aspect: AspectDirection;
  landUse: string;        // 土地利用の詳細表記
  landUseCategory: LandUseCategory;
  prefecture: string;
  municipality: string;
  nearestSubstation: {
    id: string;
    name: string;
    distance: number;          // km
    voltageKv: number;
    availableCapacityMw: number;    // 系統空き容量 (MW)
    capacityStatus: CapacityStatus; // 空き容量ステータス
  };
  gridDistance: number;    // 最寄り送電線までの距離 (km)
  regulations: string[];   // 適用規制リスト
  score: number;           // 総合スコア (0-100)
  scoreBreakdown: ScoreBreakdown;
  estimatedConstructionCost?: number; // 概算工事費 (百万円) - AIが補完
  fitVoltageClasses?: FitVoltageClasses; // FITサイトのみ
  notes?: string;
}

// ============================================================
// フィルタ条件
// ============================================================
export interface FilterCriteria {
  prefectures?: string[];
  minArea?: number;                   // ha
  maxSlope?: number;                  // 度
  maxDistanceFromSubstation?: number; // km
  minVoltageKv?: number;              // kV (接続先変電所の最低電圧)
  minAvailableCapacityMw?: number;    // 最低系統空き容量 (MW)
  landUseCategories?: LandUseCategory[];
  excludeRegulations?: string[];
  excludeAreas?: string[];
  minScore?: number;
  currentCandidateIds?: string[];
}

// ============================================================
// AI思考ステップ
// ============================================================
export type ThinkingStepType =
  | "analysis"    // 条件分析
  | "tool-call"   // ツール呼び出し
  | "tool-result" // ツール結果
  | "reasoning"   // 推論
  | "conclusion"; // 結論

export interface ThinkingStep {
  type: ThinkingStepType;
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  timestamp: string;
}

// ============================================================
// チャットメッセージ
// ============================================================
export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  candidates?: CandidateSite[];
  thinkingSteps?: ThinkingStep[];
  isLoading?: boolean;
  mapAction?: {
    center?: Coordinates;
    zoom?: number;
    highlightIds?: string[];
  };
}

// ============================================================
// API リクエスト / レスポンス
// ============================================================
export interface ChatRequest {
  messages: Array<{ role: MessageRole; content: string }>;
  currentCandidateIds?: string[];
}

export interface ChatApiResponse {
  message: string;
  candidates: CandidateSite[];
  thinkingSteps: ThinkingStep[];
  mapAction?: {
    center?: Coordinates;
    zoom?: number;
    highlightIds?: string[];
  };
}

// ============================================================
// FIT個別設備
// ============================================================
export interface IndividualFitSite {
  id: string;
  t: string;    // 設備種別（太陽光/風力/バイオマス等）
  k: number;    // 出力kW
  v: string;    // 電圧クラス（低圧/高圧/特別高圧）
  y: number;    // 運転開始年
  la: number;   // 緯度
  lg: number;   // 経度
  m: string;    // 市区町村
  d?: number;   // 最寄変電所距離 (km)
  a?: string;   // 発電設備の所在地（代表住所）
  op?: string;  // 発電事業者名
  rp?: string;  // 代表者名
  oa?: string;  // 事業者住所
  tel?: string; // 事業者電話番号
}

// ============================================================
// FIT認定設備（市区町村集計）
// ============================================================
export interface FitMunicipalityData {
  prefecture: string;
  municipality: string;
  coordinates: Coordinates;
  siteCount: number;
  totalCapacityKw: number;
  facilityTypes: string[];
  capacityKwByClass?: FitVoltageClasses;
}

// ============================================================
// オークション物件
// ============================================================
export interface AuctionProperty {
  id: string;
  saleNumber: string;
  name: string;
  coordinates: Coordinates;
  prefecture: string;
  municipality: string;
  address: string;
  areaM2: number;
  areaHa: number;
  landType: string;
  estimatedPrice: number;
  depositAmount: number;
  zoningType: string;
  zoningUse: string;
  buildingCoverage: number;
  floorAreaRatio: number;
  accessRoad: string;
  shape: string;
  topography: string;
  waterSupply: boolean;
  sewer: boolean;
  gas: boolean;
  currentUse: string;
  notes: string;
  source: string;
  contact: string;
  nearestSubstation?: { name: string; distance: number; voltageKv: number };
}

// ============================================================
// アプリ全体の状態
// ============================================================
export interface AppState {
  messages: ChatMessage[];
  // 全候補地（未フィルタ・起動時に一括ロード）
  allCandidates: CandidateSite[];
  allCandidatesLoading: boolean;
  allCandidatesError: string | null;
  // フィルタ済み候補地（地図・カードに表示）
  candidates: CandidateSite[];
  selectedForComparison: string[];
  showComparison: boolean;
  mapCenter: [number, number];
  mapZoom: number;
  highlightedSiteId: string | null;
  streetViewSite: CandidateSite | null;
  // 検索フォーカス（送電線・変電所）
  focusedSubstationId: string | null;
  focusedLineId: string | null;
  // 実データ (OSM/GSI から取得)
  realSubstations: Substation[] | null;       // null = 未取得
  realTransmissionLines: TransmissionLine[] | null;
  realDataSource: "loading" | "osm" | "mock-fallback" | "error";
  // FIT認定設備レイヤー（市区町村集計）
  fitSites: FitMunicipalityData[];
  fitLayerVisible: boolean;
  fitLayerLoading: boolean;
  fitLoadedPrefectures: string[];
  // FIT個別設備レイヤー
  fitIndividualSites: IndividualFitSite[];
  fitIndividualVisible: boolean;
  fitIndividualLoading: boolean;
  // オークション物件レイヤー
  auctionProperties: AuctionProperty[];
  auctionVisible: boolean;
  // 住所検索ピン
  addressPin: { lat: number; lng: number; label: string } | null;
}

export type AppAction =
  | { type: "ADD_MESSAGE"; payload: ChatMessage }
  | { type: "UPDATE_LAST_MESSAGE"; payload: Partial<ChatMessage> }
  | { type: "SET_ALL_CANDIDATES"; payload: CandidateSite[] }
  | { type: "SET_ALL_CANDIDATES_LOADING"; payload: boolean }
  | { type: "SET_ALL_CANDIDATES_ERROR"; payload: string | null }
  | { type: "SET_CANDIDATES"; payload: CandidateSite[] }
  | { type: "TOGGLE_COMPARISON_SELECT"; payload: string }
  | { type: "SET_SHOW_COMPARISON"; payload: boolean }
  | { type: "SET_MAP_CENTER"; payload: { center: [number, number]; zoom?: number } }
  | { type: "SET_HIGHLIGHTED_SITE"; payload: string | null }
  | { type: "SET_STREET_VIEW_SITE"; payload: CandidateSite | null }
  | { type: "SET_REAL_SUBSTATIONS"; payload: { data: Substation[]; source: "osm" | "mock-fallback" } }
  | { type: "SET_REAL_TRANSMISSION_LINES"; payload: TransmissionLine[] }
  | { type: "SET_REAL_DATA_SOURCE"; payload: AppState["realDataSource"] }
  | { type: "APPEND_FIT_SITES"; payload: { prefecture: string; data: FitMunicipalityData[] } }
  | { type: "TOGGLE_FIT_LAYER" }
  | { type: "SET_FIT_LAYER_LOADING"; payload: boolean }
  | { type: "SET_FIT_INDIVIDUAL_SITES"; payload: IndividualFitSite[] }
  | { type: "SET_FIT_INDIVIDUAL_VISIBLE"; payload: boolean }
  | { type: "SET_FIT_INDIVIDUAL_LOADING"; payload: boolean }
  | { type: "SET_FOCUSED_SUBSTATION"; payload: string | null }
  | { type: "SET_FOCUSED_LINE"; payload: string | null }
  | { type: "CLEAR_COMPARISON" }
  | { type: "SET_AUCTION_PROPERTIES"; payload: AuctionProperty[] }
  | { type: "TOGGLE_AUCTION_VISIBLE" }
  | { type: "SET_ADDRESS_PIN"; payload: { lat: number; lng: number; label: string } | null };
