"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  SlidersHorizontal, MapPin, BarChart3, RefreshCw, Layers, Download,
  Search, X, Cpu, GitBranch,
} from "lucide-react";
import type { AppState, AppAction, CandidateSite, LandUseCategory, IndividualFitSite, Substation, TransmissionLine } from "@/types";
import CandidateCard from "./CandidateCard";
import { calcCentroid } from "@/lib/geoAnalysis";
import gridCapacityAll from "@/data/grid_capacity_all.json";
import clsx from "clsx";

// ─── 送電線容量ルックアップ（FilterPanel用） ─────────────────────
type CapRawLine = { name: string | null; availableMw: number | null };
const _capMap = new Map<string, number | null>(
  (gridCapacityAll as { lines: CapRawLine[] }[])
    .flatMap(ds => ds.lines)
    .filter(l => l.name)
    .map(l => [l.name as string, l.availableMw])
);
function _normName(n: string) { return n.replace(/[（(].*?[）)]/g, "").trim(); }
function lookupLineCap(name: string): number | null | undefined {
  if (_capMap.has(name)) return _capMap.get(name);
  const norm = _normName(name);
  for (const [k, v] of _capMap) {
    if (_normName(k) === norm) return v;
  }
  for (const [k, v] of _capMap) {
    const kn = _normName(k);
    if (kn.startsWith(norm) || norm.startsWith(kn)) return v;
  }
  return undefined;
}

// パス上の最近傍点までの距離(km)を高速計算
function minDistToPath(lat: number, lng: number, path: { lat: number; lng: number }[]): number {
  let minSq = Infinity, best = path[0];
  for (const pt of path) {
    const sq = (pt.lat - lat) ** 2 + (pt.lng - lng) ** 2;
    if (sq < minSq) { minSq = sq; best = pt; }
  }
  // 正確なHaversine距離は最近傍点のみ計算
  const R = 6371;
  const dLat = (best.lat - lat) * Math.PI / 180;
  const dLng = (best.lng - lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat * Math.PI / 180) * Math.cos(best.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function exportExcel(sites: CandidateSite[]) {
  // 動的インポート（ブラウザ用 xlsx）
  import("xlsx").then((XLSX) => {
    const headers = [
      "ランク", "候補地名", "都道府県", "市区町村",
      "総合スコア", "系統近接性", "地形", "土地利用スコア", "規制", "アクセス性",
      "面積(ha)", "傾斜(°)", "標高(m)", "土地利用",
      "最寄変電所", "変電所距離(km)", "変電所電圧(kV)",
      "FIT低圧(kW)", "FIT高圧(kW)", "FIT特別高圧(kW)",
      "推定建設費(百万円)", "緯度", "経度", "備考",
    ];

    const rows = sites.map((s, i) => [
      i + 1,
      s.name,
      s.prefecture,
      s.municipality,
      s.score,
      s.scoreBreakdown.gridProximity,
      s.scoreBreakdown.terrain,
      s.scoreBreakdown.landUse,
      s.scoreBreakdown.regulation,
      s.scoreBreakdown.accessibility,
      s.area,
      s.slope,
      s.elevation,
      s.landUse,
      s.nearestSubstation.name,
      s.nearestSubstation.distance,
      s.nearestSubstation.voltageKv,
      s.fitVoltageClasses?.低圧 ?? "",
      s.fitVoltageClasses?.高圧 ?? "",
      s.fitVoltageClasses?.特別高圧 ?? "",
      s.estimatedConstructionCost ?? "",
      s.coordinates.lat,
      s.coordinates.lng,
      s.notes ?? "",
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // 列幅設定
    ws["!cols"] = [
      { wch: 6 }, { wch: 36 }, { wch: 8 }, { wch: 10 },
      { wch: 8 }, { wch: 8 }, { wch: 6 }, { wch: 10 }, { wch: 6 }, { wch: 8 },
      { wch: 8 }, { wch: 6 }, { wch: 6 }, { wch: 24 },
      { wch: 16 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 14 },
      { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 60 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "候補地一覧");

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grid_battery_candidates_${date}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }).catch(console.error);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function exportIndividualExcel(sites: IndividualFitSite[], substations: Substation[], transmissionLines: TransmissionLine[]) {
  // 空き容量 > 0 の送電線のみ対象
  const capLines = transmissionLines.filter(l => l.name && (lookupLineCap(l.name) ?? 0) > 0);

  import("xlsx").then((XLSX) => {
    const headers = [
      "No.", "発電事業者名", "代表者名", "事業者住所", "事業者電話番号",
      "設備種別", "電圧クラス", "発電出力(kW)", "運転開始年",
      "発電設備の所在地（代表住所）",
      "最寄変電所名", "変電所距離(km)", "変電所電圧(kV)",
      "変電所空き容量(MW)", "容量ステータス",
      "最寄送電線名（空き容量>0）", "送電線距離(km)", "送電線空き容量(MW)",
    ];
    const rows = sites.map((s, i) => {
      // 最寄変電所を計算
      let nearestName = "", nearestDist = "", nearestVolt = "", nearestCap = "", nearestStatus = "";
      if (substations.length > 0) {
        let bestSub = substations[0];
        let bestDist = Infinity;
        for (const sub of substations) {
          const d = haversineKm(s.la, s.lg, sub.coordinates.lat, sub.coordinates.lng);
          if (d < bestDist) { bestSub = sub; bestDist = d; }
        }
        nearestName = bestSub.name;
        nearestDist = bestDist.toFixed(1);
        nearestVolt = String(bestSub.voltageKv);
        nearestCap = bestSub.availableCapacityMw < 0 ? "非公開" : String(bestSub.availableCapacityMw);
        nearestStatus = bestSub.availableCapacityMw < 0 ? "非公開（OCCTO未連携）" : bestSub.capacityStatus;
      }

      // 最寄送電線（空き容量>0）を計算
      let lineNameOut = "", lineDistOut = "", lineCapOut = "";
      if (capLines.length > 0) {
        // 粗いbboxフィルタ（±0.5°）で候補を絞ってから正確距離計算
        const PAD = 0.5;
        const nearby = capLines.filter(l =>
          l.path.some(pt => Math.abs(pt.lat - s.la) < PAD && Math.abs(pt.lng - s.lg) < PAD)
        );
        const candidates = nearby.length > 0 ? nearby : capLines;
        let bestLine = candidates[0];
        let bestLineDist = Infinity;
        for (const line of candidates) {
          const d = minDistToPath(s.la, s.lg, line.path);
          if (d < bestLineDist) { bestLine = line; bestLineDist = d; }
        }
        lineNameOut = bestLine.name ?? "";
        lineDistOut = bestLineDist.toFixed(1);
        const cap = lookupLineCap(bestLine.name ?? "");
        lineCapOut = cap == null ? "" : String(cap);
      }

      return [
        i + 1, s.op ?? "", s.rp ?? "", s.oa ?? "", s.tel ?? "",
        s.t, s.v, s.k, s.y,
        s.a ?? s.m,
        nearestName, nearestDist, nearestVolt, nearestCap, nearestStatus,
        lineNameOut, lineDistOut, lineCapOut,
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [
      { wch: 6 }, { wch: 30 }, { wch: 16 }, { wch: 40 }, { wch: 16 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
      { wch: 50 },
      { wch: 20 }, { wch: 14 }, { wch: 14 },
      { wch: 16 }, { wch: 24 },
      { wch: 28 }, { wch: 14 }, { wch: 16 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "個別FIT設備");
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fit_individual_sites_${date}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }).catch(console.error);
}

// ─── 定数 ────────────────────────────────────────────────────
const PREFECTURES = [
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","山梨県","長野県","静岡県",
];

const LAND_PRICE_LEVEL: Record<string, "低" | "中" | "高"> = {
  東京都: "高", 神奈川県: "高",
  埼玉県: "中", 千葉県: "中", 静岡県: "中",
  茨城県: "低", 栃木県: "低", 群馬県: "低", 山梨県: "低", 長野県: "低",
};

const LAND_PRICE_SORT_SCORE: Record<string, number> = {
  東京都: 50000, 神奈川県: 12000,
  埼玉県: 5000, 千葉県: 4000, 静岡県: 3000,
  茨城県: 1500, 栃木県: 1200, 群馬県: 1000, 山梨県: 800, 長野県: 700,
};

const CAT_PRICE_MOD: Record<LandUseCategory, number> = {
  industrial: 1.0, wasteland: 0.5, agricultural: 0.6, forest: 0.2, other: 0.4,
};

const CAT_LABELS: Record<LandUseCategory, string> = {
  industrial: "工業地域",
  wasteland: "廃工場跡地",
  agricultural: "農地・太陽光FIT",
  forest: "山林・風力FIT",
  other: "その他",
};

function estimateLandPrice(site: CandidateSite): number {
  return (LAND_PRICE_SORT_SCORE[site.prefecture] ?? 1000) * (CAT_PRICE_MOD[site.landUseCategory] ?? 0.4);
}

// ─── フィルター型 ─────────────────────────────────────────────
type FitVoltageClass = "低圧" | "高圧" | "特別高圧";
type FitIndividualType = "太陽光" | "風力" | "バイオマス" | "水力" | "その他";

interface LocalFilters {
  prefectures: string[];
  minVoltageKv: 0 | 66 | 154 | 275;
  maxDistanceKm: number;
  maxSlope: number;
  minAreaHa: number;
  landUseCategories: LandUseCategory[];
  landPriceLevels: ("低" | "中" | "高")[];
  minScore: number;
  dataSource: "all" | "osm" | "fit";
  sortBy: "score" | "distance" | "area" | "landPrice";
  fitVoltageClasses: FitVoltageClass[];
  excludeAgricultural: boolean;
  // 個別設備レイヤーフィルター
  indivPrefectures: string[];
  indivKwMin: number;
  indivKwMax: number;
  indivMaxDistKm: number;
  indivVoltageClasses: FitVoltageClass[];
  indivTypes: FitIndividualType[];
}

const DEFAULT_FILTERS: LocalFilters = {
  prefectures: [],
  minVoltageKv: 0,
  maxDistanceKm: 30,
  maxSlope: 30,
  minAreaHa: 0,
  landUseCategories: [],
  landPriceLevels: [],
  minScore: 0,
  dataSource: "all",
  sortBy: "score",
  fitVoltageClasses: [],
  excludeAgricultural: true,
  indivPrefectures: [],
  indivKwMin: 0,
  indivKwMax: 999999,
  indivMaxDistKm: 0,
  indivVoltageClasses: [],
  indivTypes: [],
};

// ─── フィルタ適用ロジック ──────────────────────────────────────
function applyFilters(sites: CandidateSite[], f: LocalFilters): CandidateSite[] {
  let r = sites;
  if (f.dataSource !== "all")
    r = r.filter(s => f.dataSource === "osm" ? s.id.startsWith("osm-") : s.id.startsWith("fit-"));
  if (f.prefectures.length > 0)
    r = r.filter(s => f.prefectures.includes(s.prefecture));
  if (f.minVoltageKv > 0)
    r = r.filter(s => s.nearestSubstation.voltageKv >= f.minVoltageKv);
  r = r.filter(s => s.nearestSubstation.distance <= f.maxDistanceKm);
  r = r.filter(s => s.slope <= f.maxSlope);
  r = r.filter(s => s.area >= f.minAreaHa);
  if (f.excludeAgricultural)
    r = r.filter(s => s.landUseCategory !== "agricultural");
  if (f.landUseCategories.length > 0)
    r = r.filter(s => f.landUseCategories.includes(s.landUseCategory));
  if (f.landPriceLevels.length > 0)
    r = r.filter(s => f.landPriceLevels.includes(LAND_PRICE_LEVEL[s.prefecture] ?? "低"));
  if (f.fitVoltageClasses.length > 0)
    r = r.filter(s => {
      if (!s.fitVoltageClasses) return true; // OSMサイトは通過
      return f.fitVoltageClasses.some(cls => (s.fitVoltageClasses![cls] ?? 0) > 0);
    });
  r = r.filter(s => s.score >= f.minScore);

  const out = [...r];
  switch (f.sortBy) {
    case "score":     out.sort((a, b) => b.score - a.score); break;
    case "distance":  out.sort((a, b) => a.nearestSubstation.distance - b.nearestSubstation.distance); break;
    case "area":      out.sort((a, b) => b.area - a.area); break;
    case "landPrice": out.sort((a, b) => estimateLandPrice(a) - estimateLandPrice(b)); break;
  }
  return out;
}

// ─── 送電線・変電所検索ボックス ──────────────────────────────
type SearchResult =
  | { kind: "substation"; id: string; name: string; voltageKv: number; lat: number; lng: number; cap: number }
  | { kind: "line"; id: string; name: string; voltageKv: number; lat: number; lng: number; cap: number | null };

function GridSearchBox({
  substations,
  transmissionLines,
  dispatch,
}: {
  substations: import("@/types").Substation[];
  transmissionLines: import("@/types").TransmissionLine[];
  dispatch: React.Dispatch<import("@/types").AppAction>;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim();
    if (q.length < 1) return [];
    const lq = q.toLowerCase();

    const subResults: SearchResult[] = substations
      .filter(s => s.name.toLowerCase().includes(lq))
      .slice(0, 6)
      .map(s => ({
        kind: "substation",
        id: s.id,
        name: s.name,
        voltageKv: s.voltageKv,
        lat: s.coordinates.lat,
        lng: s.coordinates.lng,
        cap: s.availableCapacityMw,
      }));

    const lineResults: SearchResult[] = transmissionLines
      .filter(l => l.name && l.name.toLowerCase().includes(lq) && l.path.length > 0)
      .slice(0, 6)
      .map(l => {
        const mid = l.path[Math.floor(l.path.length / 2)];
        return {
          kind: "line",
          id: l.id,
          name: l.name,
          voltageKv: l.voltageKv,
          lat: mid.lat,
          lng: mid.lng,
          cap: lookupLineCap(l.name) ?? null,
        };
      });

    return [...subResults, ...lineResults];
  }, [query, substations, transmissionLines]);

  // 外クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function flyTo(r: SearchResult) {
    dispatch({ type: "SET_MAP_CENTER", payload: { center: [r.lat, r.lng], zoom: 13 } });
    if (r.kind === "substation") {
      dispatch({ type: "SET_FOCUSED_SUBSTATION", payload: r.id });
      dispatch({ type: "SET_FOCUSED_LINE", payload: null });
    } else {
      dispatch({ type: "SET_FOCUSED_LINE", payload: r.id });
      dispatch({ type: "SET_FOCUSED_SUBSTATION", payload: null });
    }
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div ref={containerRef} className="relative px-3 py-2 border-b border-slate-800/70">
      <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/50 rounded-lg px-2.5 py-1.5 focus-within:border-sky-500/60 transition-colors">
        <Search size={12} className="text-slate-500 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="変電所・送電線を検索..."
          className="flex-1 bg-transparent text-[11px] text-slate-200 placeholder-slate-600 outline-none min-w-0"
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query) setOpen(true); }}
        />
        {query && (
          <button onClick={() => { setQuery(""); setOpen(false); }} className="text-slate-600 hover:text-slate-400 transition-colors">
            <X size={11} />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-slate-900 border border-slate-700/60 rounded-lg shadow-xl overflow-hidden max-h-72 overflow-y-auto">
          {/* 変電所グループ */}
          {results.filter(r => r.kind === "substation").length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[9px] text-slate-600 font-semibold uppercase tracking-wider border-b border-slate-800 flex items-center gap-1.5">
                <Cpu size={9} /> 変電所
              </div>
              {results.filter(r => r.kind === "substation").map(r => (
                <button
                  key={r.id}
                  onClick={() => flyTo(r)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-800/70 transition-colors text-left"
                >
                  <div className={clsx(
                    "w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-[8px] font-bold text-white",
                    r.voltageKv >= 275 ? "bg-sky-600" : "bg-indigo-600"
                  )}>⚡</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-slate-200 truncate">{r.name}</p>
                    <p className="text-[9px] text-slate-500">
                      {r.voltageKv}kV
                      {r.cap >= 0 && <span className="ml-2 text-emerald-400">{r.cap}MW</span>}
                    </p>
                  </div>
                  <MapPin size={10} className="text-slate-600 flex-shrink-0" />
                </button>
              ))}
            </>
          )}
          {/* 送電線グループ */}
          {results.filter(r => r.kind === "line").length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[9px] text-slate-600 font-semibold uppercase tracking-wider border-b border-slate-800 flex items-center gap-1.5 mt-0.5">
                <GitBranch size={9} /> 送電線
              </div>
              {results.filter(r => r.kind === "line").map(r => (
                <button
                  key={r.id}
                  onClick={() => flyTo(r)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-800/70 transition-colors text-left"
                >
                  <div className={clsx(
                    "w-5 h-2 rounded flex-shrink-0",
                    r.voltageKv >= 500 ? "bg-amber-400" :
                    r.voltageKv >= 275 ? "bg-sky-400" :
                    r.voltageKv >= 154 ? "bg-indigo-400" : "bg-violet-400"
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-slate-200 truncate">{r.name}</p>
                    <p className="text-[9px] text-slate-500">
                      {r.voltageKv}kV
                      {r.cap != null && r.cap > 0 && <span className="ml-2 text-emerald-400">{r.cap}MW</span>}
                      {r.cap === 0 && <span className="ml-2 text-rose-400">空き容量なし</span>}
                    </p>
                  </div>
                  <MapPin size={10} className="text-slate-600 flex-shrink-0" />
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {open && query.length > 0 && results.length === 0 && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-slate-900 border border-slate-700/60 rounded-lg shadow-xl px-3 py-3 text-[11px] text-slate-500 text-center">
          「{query}」に一致する施設が見つかりません
        </div>
      )}
    </div>
  );
}

// ─── 住所検索ボックス ─────────────────────────────────────────
function AddressSearchBox({
  dispatch,
}: {
  dispatch: React.Dispatch<import("@/types").AppAction>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleInput(v: string) {
    setQuery(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v.trim().length < 2) {
      setResults([]);
      setOpen(false);
      dispatch({ type: "SET_ADDRESS_PIN", payload: null });
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(v)}&limit=5&countrycodes=jp&accept-language=ja`
        );
        const data = await res.json();
        setResults(data);
        setOpen(data.length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 700);
  }

  function selectResult(r: { display_name: string; lat: string; lon: string }) {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    const label = r.display_name.split(",")[0].trim();
    dispatch({ type: "SET_ADDRESS_PIN", payload: { lat, lng, label } });
    dispatch({ type: "SET_MAP_CENTER", payload: { center: [lat, lng], zoom: 14 } });
    setQuery(label);
    setOpen(false);
    inputRef.current?.blur();
  }

  function clear() {
    setQuery("");
    setResults([]);
    setOpen(false);
    dispatch({ type: "SET_ADDRESS_PIN", payload: null });
  }

  return (
    <div ref={containerRef} className="relative px-3 py-2 border-b border-slate-800/70">
      <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/50 rounded-lg px-2.5 py-1.5 focus-within:border-emerald-500/60 transition-colors">
        <MapPin size={12} className="text-slate-500 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="住所・場所名を検索してマップに表示..."
          className="flex-1 bg-transparent text-[11px] text-slate-200 placeholder-slate-600 outline-none min-w-0"
          onChange={e => handleInput(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
        />
        {loading && (
          <div className="w-3 h-3 border border-slate-500/40 border-t-emerald-400 rounded-full animate-spin flex-shrink-0" />
        )}
        {query && !loading && (
          <button onClick={clear} className="text-slate-600 hover:text-slate-400 transition-colors">
            <X size={11} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-slate-900 border border-slate-700/60 rounded-lg shadow-xl overflow-hidden max-h-60 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => selectResult(r)}
              className="w-full flex items-start gap-2 px-3 py-2 hover:bg-slate-800/70 transition-colors text-left"
            >
              <MapPin size={10} className="text-emerald-500 flex-shrink-0 mt-0.5" />
              <span className="text-[11px] text-slate-200 leading-snug">{r.display_name}</span>
            </button>
          ))}
        </div>
      )}
      {open && !loading && query.length >= 2 && results.length === 0 && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-slate-900 border border-slate-700/60 rounded-lg shadow-xl px-3 py-3 text-[11px] text-slate-500 text-center">
          「{query}」が見つかりません
        </div>
      )}
    </div>
  );
}

// ─── サブコンポーネント ───────────────────────────────────────
function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-800/70">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[10px] text-slate-500 font-semibold uppercase tracking-wider hover:text-slate-400 transition-colors"
      >
        <span>{title}</span>
        <span className={clsx("text-slate-700 transition-transform duration-150", open && "rotate-180")}>
          ▾
        </span>
      </button>
      {open && <div className="px-4 pb-3 space-y-2.5">{children}</div>}
    </div>
  );
}

function RangeRow({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-[10px] text-slate-500">{label}</span>
        <span className="text-[10px] text-sky-300 font-medium">{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        className="w-full accent-sky-500 cursor-pointer"
        style={{ height: "4px" }}
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px] text-slate-700">{min}{unit}</span>
        <span className="text-[9px] text-slate-700">{max}{unit}</span>
      </div>
    </div>
  );
}

function ChipButton({ active, onClick, children, color = "sky" }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
  color?: "sky" | "amber" | "emerald" | "rose" | "violet";
}) {
  const activeClass = {
    sky:     "bg-sky-500/20 border-sky-500/50 text-sky-300",
    amber:   "bg-amber-500/20 border-amber-500/50 text-amber-300",
    emerald: "bg-emerald-500/20 border-emerald-500/50 text-emerald-300",
    rose:    "bg-rose-500/20 border-rose-500/50 text-rose-300",
    violet:  "bg-violet-500/20 border-violet-500/50 text-violet-300",
  }[color];
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-2.5 py-1 rounded-md text-[10px] font-medium border transition-all",
        active ? activeClass : "bg-slate-800/50 border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600/50"
      )}
    >
      {children}
    </button>
  );
}

// ─── メインコンポーネント ──────────────────────────────────────
export default function FilterPanel({
  state, dispatch,
}: {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}) {
  const [filters, setFilters] = useState<LocalFilters>(DEFAULT_FILTERS);
  const [showAll, setShowAll] = useState(false);
  const [indivError, setIndivError] = useState<string | null>(null);

  const fetchIndividualSites = useCallback(async () => {
    const prefs = filters.indivPrefectures.length > 0 ? filters.indivPrefectures : PREFECTURES;
    dispatch({ type: "SET_FIT_INDIVIDUAL_LOADING", payload: true });
    dispatch({ type: "SET_FIT_INDIVIDUAL_VISIBLE", payload: true });
    setIndivError(null);
    try {
      const results = await Promise.all(
        prefs.map(async (pref) => {
          const params = new URLSearchParams({ prefecture: pref });
          if (filters.indivKwMin > 0) params.set("kwMin", String(filters.indivKwMin));
          if (filters.indivKwMax < 999999) params.set("kwMax", String(filters.indivKwMax));
          if (filters.indivVoltageClasses.length > 0) params.set("voltageClass", filters.indivVoltageClasses.join(","));
          if (filters.indivTypes.length > 0) params.set("types", filters.indivTypes.join(","));
          if (filters.indivMaxDistKm > 0) params.set("maxDistKm", String(filters.indivMaxDistKm));
          const res = await fetch(`/api/real-data/fit-individual?${params}`);
          if (!res.ok) return [];
          return res.json();
        })
      );
      const all = results.flat();
      dispatch({ type: "SET_FIT_INDIVIDUAL_SITES", payload: all });
      if (all.length === 0) setIndivError("条件に合う設備がありません");
    } catch {
      setIndivError("データ取得エラー");
    } finally {
      dispatch({ type: "SET_FIT_INDIVIDUAL_LOADING", payload: false });
    }
  }, [filters.indivPrefectures, filters.indivKwMin, filters.indivKwMax, filters.indivMaxDistKm, filters.indivVoltageClasses, filters.indivTypes, dispatch]);

  const setF = <K extends keyof LocalFilters>(key: K, val: LocalFilters[K]) =>
    setFilters(f => ({ ...f, [key]: val }));

  const toggle = <T extends string>(arr: T[], item: T): T[] =>
    arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];

  // フィルタ適用（メモ化・即時）
  const filtered = useMemo(
    () => applyFilters(state.allCandidates, filters),
    [state.allCandidates, filters]
  );

  // 候補地を地図に反映
  useEffect(() => {
    dispatch({ type: "SET_CANDIDATES", payload: filtered });
    if (filtered.length > 0) {
      const centroid = calcCentroid(filtered.slice(0, 30));
      if (centroid) {
        dispatch({
          type: "SET_MAP_CENTER",
          payload: {
            center: [centroid.lat, centroid.lng],
            zoom: filtered.length <= 5 ? 11 : filtered.length <= 20 ? 9 : 8,
          },
        });
      }
    }
  }, [filtered, dispatch]);

  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS);
  const selectedCount = state.selectedForComparison.length;
  const displayCards = showAll ? filtered : filtered.slice(0, 8);

  // OSM/FIT件数
  const osmCount = state.allCandidates.filter(s => s.id.startsWith("osm-")).length;
  const fitCount = state.allCandidates.filter(s => s.id.startsWith("fit-")).length;

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* ヘッダー */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-600 to-violet-600 flex items-center justify-center shadow-sm">
          <SlidersHorizontal size={13} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-slate-200 leading-tight">用地フィルター</p>
          <p className="text-[9px] text-slate-600">
            {state.allCandidatesLoading
              ? "データ取得中..."
              : `全${state.allCandidates.length}件 → ${filtered.length}件表示`}
          </p>
        </div>
        {filtered.length > 0 && (
          <button
            onClick={() => exportExcel(filtered)}
            className="flex items-center gap-1 px-2 py-1.5 bg-emerald-700/80 hover:bg-emerald-600 text-white text-[11px] font-medium rounded-lg transition-all shadow-sm"
            title={`フィルター済み ${filtered.length}件をExcel出力`}
          >
            <Download size={11} />
            Excel
          </button>
        )}
        {selectedCount > 0 && (
          <button
            onClick={() => dispatch({ type: "SET_SHOW_COMPARISON", payload: true })}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-violet-600/90 hover:bg-violet-500 text-white text-[11px] font-medium rounded-lg transition-all shadow-sm"
          >
            <BarChart3 size={11} />
            比較表 ({selectedCount})
          </button>
        )}
      </div>

      {/* 送電線・変電所検索 */}
      <GridSearchBox
        substations={state.realSubstations ?? []}
        transmissionLines={state.realTransmissionLines ?? []}
        dispatch={dispatch}
      />

      {/* 住所検索 */}
      <AddressSearchBox dispatch={dispatch} />

      {/* ローディング */}
      {state.allCandidatesLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-sky-500/60 border-t-sky-400 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[12px] text-slate-500 mb-1">FIT認定データを取得中...</p>
            <p className="text-[10px] text-slate-600">まもなく表示されます</p>
          </div>
        </div>
      )}

      {/* エラー */}
      {state.allCandidatesError && !state.allCandidatesLoading && (
        <div className="p-4">
          <div className="bg-rose-500/8 border border-rose-500/25 rounded-xl p-3 text-[11px] text-rose-300">
            データ取得エラー: {state.allCandidatesError}
          </div>
        </div>
      )}

      {/* フィルター + 結果 */}
      {!state.allCandidatesLoading && state.allCandidates.length > 0 && (
        <div className="flex-1 overflow-y-auto scrollbar-thin">

          {/* データソース */}
          <div className="px-4 py-2.5 border-b border-slate-800/70 flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] text-slate-600 mr-0.5">データソース</span>
            {([
              ["all",  `全候補 (${state.allCandidates.length})`],
              ["osm",  `OSM工業 (${osmCount})`],
              ["fit",  `FIT再エネ (${fitCount})`],
            ] as const).map(([src, label]) => (
              <ChipButton key={src} active={filters.dataSource === src} onClick={() => setF("dataSource", src)}>
                {label}
              </ChipButton>
            ))}
          </div>

          {/* 都道府県 */}
          <Section title="都道府県">
            <div className="flex flex-wrap gap-1">
              {PREFECTURES.map(pref => (
                <ChipButton
                  key={pref}
                  active={filters.prefectures.includes(pref)}
                  onClick={() => setFilters(f => ({ ...f, prefectures: toggle(f.prefectures, pref) }))}
                >
                  {pref.replace("県", "")}
                </ChipButton>
              ))}
            </div>
            {filters.prefectures.length > 0 && (
              <button
                onClick={() => setF("prefectures", [])}
                className="text-[9px] text-slate-600 hover:text-slate-400 transition-colors"
              >
                選択解除
              </button>
            )}
          </Section>

          {/* 系統接続条件 */}
          <Section title="系統接続条件">
            <div>
              <p className="text-[9px] text-slate-600 mb-1.5">変電所電圧（最低）</p>
              <div className="flex flex-wrap gap-1">
                {([
                  [0,   "指定なし"],
                  [66,  "66kV以上"],
                  [154, "154kV以上"],
                  [275, "275kV以上"],
                ] as [0|66|154|275, string][]).map(([v, label]) => (
                  <ChipButton
                    key={v} active={filters.minVoltageKv === v}
                    onClick={() => setF("minVoltageKv", v)}
                    color="sky"
                  >
                    {label}
                  </ChipButton>
                ))}
              </div>
            </div>
            <RangeRow
              label="変電所距離（最大）"
              value={filters.maxDistanceKm} min={1} max={50} step={1} unit="km"
              onChange={v => setF("maxDistanceKm", v)}
            />
          </Section>

          {/* 個別設備レイヤー */}
          <Section title="個別FIT設備レイヤー" defaultOpen={false}>
            <p className="text-[9px] text-slate-600 mb-2">
              フィルターで絞り込んで地図にピン表示します（2024年以前・全136,652件）
            </p>

            {/* 都道府県 */}
            <div>
              <p className="text-[9px] text-slate-500 mb-1">都道府県（未選択=全て）</p>
              <div className="flex flex-wrap gap-1">
                {PREFECTURES.map(pref => (
                  <ChipButton
                    key={pref}
                    active={filters.indivPrefectures.includes(pref)}
                    onClick={() => setFilters(f => ({ ...f, indivPrefectures: toggle(f.indivPrefectures, pref) }))}
                    color="sky"
                  >
                    {pref.replace(/[都道府県]$/, "")}
                  </ChipButton>
                ))}
              </div>
            </div>

            {/* 電圧クラス */}
            <div>
              <p className="text-[9px] text-slate-500 mb-1">電圧クラス（未選択=全て）</p>
              <div className="flex gap-1">
                {(["低圧", "高圧", "特別高圧"] as FitVoltageClass[]).map(cls => (
                  <ChipButton
                    key={cls}
                    active={filters.indivVoltageClasses.includes(cls)}
                    onClick={() => setFilters(f => ({ ...f, indivVoltageClasses: toggle(f.indivVoltageClasses, cls) }))}
                    color={cls === "特別高圧" ? "violet" : cls === "高圧" ? "sky" : "emerald"}
                  >
                    {cls}
                  </ChipButton>
                ))}
              </div>
            </div>

            {/* 設備種別 */}
            <div>
              <p className="text-[9px] text-slate-500 mb-1">設備種別（未選択=全て）</p>
              <div className="flex flex-wrap gap-1">
                {(["太陽光", "風力", "バイオマス", "水力"] as FitIndividualType[]).map(t => (
                  <ChipButton
                    key={t}
                    active={filters.indivTypes.includes(t)}
                    onClick={() => setFilters(f => ({ ...f, indivTypes: toggle(f.indivTypes, t) }))}
                    color="amber"
                  >
                    {t}
                  </ChipButton>
                ))}
              </div>
            </div>

            {/* kW範囲 */}
            <RangeRow
              label="最小出力"
              value={filters.indivKwMin} min={0} max={2000} step={50} unit="kW"
              onChange={v => setFilters(f => ({ ...f, indivKwMin: v }))}
            />

            {/* 変電所距離 */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[10px] text-slate-500">変電所距離（最大）</span>
                <span className="text-[10px] text-sky-300 font-medium">
                  {filters.indivMaxDistKm === 0 ? "指定なし" : `${filters.indivMaxDistKm}km`}
                </span>
              </div>
              <input
                type="range" min={0} max={50} step={1} value={filters.indivMaxDistKm}
                onChange={e => setFilters(f => ({ ...f, indivMaxDistKm: +e.target.value }))}
                className="w-full accent-sky-500 cursor-pointer"
                style={{ height: "4px" }}
              />
              <div className="flex justify-between mt-0.5">
                <span className="text-[9px] text-slate-700">指定なし</span>
                <span className="text-[9px] text-slate-700">50km</span>
              </div>
            </div>

            {/* 取得ボタン */}
            <button
              onClick={fetchIndividualSites}
              disabled={state.fitIndividualLoading}
              className="w-full py-2 mt-1 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-2 bg-emerald-600/80 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-wait"
            >
              <Layers size={11} />
              {state.fitIndividualLoading
                ? "取得中..."
                : state.fitIndividualVisible
                ? `再取得（現在 ${state.fitIndividualSites.length.toLocaleString()}件）`
                : "地図に表示"}
            </button>

            {state.fitIndividualVisible && !state.fitIndividualLoading && (
              <div className="flex gap-1.5">
                <button
                  onClick={() => exportIndividualExcel(state.fitIndividualSites, state.realSubstations ?? [], state.realTransmissionLines ?? [])}
                  className="flex-1 py-1.5 rounded-lg text-[10px] font-medium flex items-center justify-center gap-1 bg-emerald-700/70 hover:bg-emerald-600 text-white transition-colors"
                  title={`${state.fitIndividualSites.length.toLocaleString()}件をExcel出力`}
                >
                  <Download size={10} />
                  Excel ({state.fitIndividualSites.length.toLocaleString()}件)
                </button>
                <button
                  onClick={() => {
                    dispatch({ type: "SET_FIT_INDIVIDUAL_VISIBLE", payload: false });
                    dispatch({ type: "SET_FIT_INDIVIDUAL_SITES", payload: [] });
                  }}
                  className="flex-1 py-1.5 rounded-lg text-[10px] text-slate-500 hover:text-slate-300 border border-slate-800 transition-colors"
                >
                  非表示
                </button>
              </div>
            )}

            {indivError && (
              <p className="text-[10px] text-rose-400 text-center">{indivError}</p>
            )}
          </Section>

          {/* FIT出力クラス */}
          <Section title="FIT出力クラス（2024年以前実績）" defaultOpen={false}>
            <p className="text-[9px] text-slate-600 mb-1.5">
              FIT認定設備の出力規模（複数選択可・OSM候補は全て通過）
            </p>
            <div className="flex flex-wrap gap-1">
              {([
                ["低圧",     "低圧 (<50kW)",     "emerald"],
                ["高圧",     "高圧 (50~2000kW)", "sky"],
                ["特別高圧", "特別高圧 (2MW+)",  "violet"],
              ] as [FitVoltageClass, string, "emerald"|"sky"|"violet"][]).map(([cls, label, color]) => (
                <ChipButton
                  key={cls}
                  active={filters.fitVoltageClasses.includes(cls)}
                  onClick={() => setFilters(f => ({ ...f, fitVoltageClasses: toggle(f.fitVoltageClasses, cls) }))}
                  color={color}
                >
                  {label}
                </ChipButton>
              ))}
            </div>
            {filters.fitVoltageClasses.length > 0 && (
              <button
                onClick={() => setF("fitVoltageClasses", [])}
                className="text-[9px] text-slate-600 hover:text-slate-400 transition-colors"
              >
                選択解除
              </button>
            )}
          </Section>

          {/* 土地・地形条件 */}
          <Section title="土地・地形条件">
            <RangeRow
              label="傾斜（最大）"
              value={filters.maxSlope} min={1} max={30} step={1} unit="°"
              onChange={v => setF("maxSlope", v)}
            />
            <RangeRow
              label="面積（最小）"
              value={filters.minAreaHa} min={0} max={20} step={0.5} unit="ha"
              onChange={v => setF("minAreaHa", v)}
            />
            <div>
              <p className="text-[9px] text-slate-600 mb-1.5">土地利用（複数選択可）</p>
              <div className="flex flex-wrap gap-1">
                {(Object.entries(CAT_LABELS) as [LandUseCategory, string][]).map(([cat, label]) => (
                  <ChipButton
                    key={cat}
                    active={filters.landUseCategories.includes(cat)}
                    onClick={() => setFilters(f => ({ ...f, landUseCategories: toggle(f.landUseCategories, cat) }))}
                    color="amber"
                  >
                    {label}
                  </ChipButton>
                ))}
              </div>
              <div className="mt-2">
                <button
                  onClick={() => setFilters(f => ({ ...f, excludeAgricultural: !f.excludeAgricultural }))}
                  className={clsx(
                    "flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-md border transition-all",
                    filters.excludeAgricultural
                      ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                      : "bg-slate-800/50 border-slate-700/50 text-slate-500 hover:text-slate-300"
                  )}
                >
                  <span>{filters.excludeAgricultural ? "✕" : "○"}</span>
                  農地を除外
                </button>
              </div>
            </div>
          </Section>

          {/* 土地価格帯 */}
          <Section title="土地価格帯（都道府県推計）">
            <div className="flex gap-1.5">
              {([
                ["低", "emerald", "低コスト", "茨城/栃木/群馬/山梨/長野"],
                ["中", "amber",   "中価格帯", "埼玉/千葉"],
                ["高", "rose",    "高価格帯", "神奈川"],
              ] as const).map(([lv, color, label, hint]) => (
                <button
                  key={lv}
                  onClick={() => setFilters(f => ({ ...f, landPriceLevels: toggle(f.landPriceLevels, lv) }))}
                  className={clsx(
                    "flex-1 py-2 rounded-lg text-[10px] font-medium border transition-all text-center",
                    filters.landPriceLevels.includes(lv)
                      ? color === "emerald" ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
                        : color === "amber" ? "bg-amber-500/15 border-amber-500/50 text-amber-300"
                        : "bg-rose-500/15 border-rose-500/50 text-rose-300"
                      : "bg-slate-800/50 border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600/50"
                  )}
                  title={hint}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-slate-700">
              低: 茨城/栃木/群馬/山梨/長野 ｜ 中: 埼玉/千葉 ｜ 高: 神奈川
            </p>
          </Section>

          {/* スコア・並び順 */}
          <Section title="スコア・並び順">
            <RangeRow
              label="最低スコア"
              value={filters.minScore} min={0} max={90} step={5} unit="点"
              onChange={v => setF("minScore", v)}
            />
            <div>
              <p className="text-[9px] text-slate-600 mb-1.5">並び順</p>
              <div className="grid grid-cols-2 gap-1">
                {([
                  ["score",     "総合スコア順"],
                  ["distance",  "変電所距離順"],
                  ["area",      "面積（大）順"],
                  ["landPrice", "土地単価（安）順"],
                ] as const).map(([key, label]) => (
                  <ChipButton
                    key={key} active={filters.sortBy === key}
                    onClick={() => setF("sortBy", key)} color="violet"
                  >
                    {label}
                  </ChipButton>
                ))}
              </div>
            </div>
          </Section>

          {/* オークション物件 */}
          {state.auctionProperties.length > 0 && (
            <Section title={`公売・オークション物件 (${state.auctionProperties.length}件)`} defaultOpen={true}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] text-slate-600">地図上にオレンジマーカーで表示</p>
                <button
                  onClick={() => dispatch({ type: "TOGGLE_AUCTION_VISIBLE" })}
                  className={clsx(
                    "px-2 py-0.5 rounded text-[10px] font-medium border transition-all",
                    state.auctionVisible
                      ? "bg-orange-500/20 border-orange-500/50 text-orange-300"
                      : "bg-slate-800/50 border-slate-700/50 text-slate-500"
                  )}
                >
                  {state.auctionVisible ? "表示中" : "非表示"}
                </button>
              </div>
              <div className="space-y-2">
                {state.auctionProperties.map(prop => (
                  <div
                    key={prop.id}
                    className="bg-orange-500/8 border border-orange-500/25 rounded-xl p-3 cursor-pointer hover:bg-orange-500/12 transition-colors"
                    onClick={() => dispatch({
                      type: "SET_MAP_CENTER",
                      payload: { center: [prop.coordinates.lat, prop.coordinates.lng], zoom: 15 }
                    })}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div>
                        <p className="text-[11px] font-semibold text-orange-300">{prop.name}</p>
                        <p className="text-[9px] text-slate-500">{prop.saleNumber} / {prop.source}</p>
                      </div>
                      <span className="text-[10px] font-bold text-orange-400 whitespace-nowrap">
                        ¥{(prop.estimatedPrice / 10000).toFixed(0)}万
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {[
                        ["面積", `${prop.areaM2.toLocaleString()}㎡`],
                        ["地目", prop.landType],
                        ["都市計画", prop.zoningType],
                        ["形状", prop.shape],
                        ...(prop.nearestSubstation ? [
                          ["最寄変電所", `${prop.nearestSubstation.distance}km`],
                          ["電圧", `${prop.nearestSubstation.voltageKv}kV`],
                        ] : []),
                      ].map(([k, v]) => (
                        <p key={k} className="text-[9px] text-slate-500">
                          <span className="text-slate-600">{k}: </span>
                          <span className="text-slate-400">{v}</span>
                        </p>
                      ))}
                    </div>
                    {!prop.sewer && (
                      <p className="text-[9px] text-amber-500/80 mt-1">⚠ 下水道なし</p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 結果リスト */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <MapPin size={10} className="text-sky-500/70" />
                <strong className="text-sky-300">{filtered.length}</strong>
                <span className="text-slate-600">件</span>
              </span>
              <div className="flex items-center gap-2">
                {!isDefault && (
                  <button
                    onClick={() => { setFilters(DEFAULT_FILTERS); setShowAll(false); }}
                    className="text-[10px] text-slate-600 hover:text-slate-400 flex items-center gap-0.5 transition-colors"
                  >
                    <RefreshCw size={8} /> リセット
                  </button>
                )}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-[12px] text-slate-600">条件に合う候補地がありません</p>
                <p className="text-[10px] text-slate-700 mt-1">フィルターを緩めてみてください</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {displayCards.map((site, idx) => (
                    <CandidateCard
                      key={site.id}
                      site={site}
                      rank={idx + 1}
                      isSelected={state.selectedForComparison.includes(site.id)}
                      isHighlighted={state.highlightedSiteId === site.id}
                      onSelect={id => dispatch({ type: "TOGGLE_COMPARISON_SELECT", payload: id })}
                      onHover={id => dispatch({ type: "SET_HIGHLIGHTED_SITE", payload: id })}
                      onFocus={s => dispatch({
                        type: "SET_MAP_CENTER",
                        payload: { center: [s.coordinates.lat, s.coordinates.lng], zoom: 13 },
                      })}
                    />
                  ))}
                </div>
                {filtered.length > 8 && (
                  <button
                    onClick={() => setShowAll(v => !v)}
                    className="w-full mt-3 py-2 text-[10px] text-slate-600 hover:text-slate-400 border border-slate-800 rounded-lg transition-colors"
                  >
                    {showAll
                      ? "▲ 折りたたむ"
                      : `▼ 残り ${filtered.length - 8} 件を表示`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
