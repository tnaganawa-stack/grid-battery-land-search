"use client";

import "leaflet/dist/leaflet.css";
import React, { useEffect, useState, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Tooltip, Marker, GeoJSON, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import type { TransmissionLine } from "@/types";
import L from "leaflet";
import type { GeoJsonObject } from "geojson";
import capLookupRaw from "@/data/cap_lookup.json";
import demandCapLookupRaw from "@/data/demand_cap_lookup.json";
import kansaiUpperAreas from "@/data/kansai_upper_areas.json";
import dist6kvRaw from "@/data/distribution_6kv_geocoded.json";
import dist6kvGridRaw from "@/data/distribution_6kv_grid.json";
import { type HomesProperty } from "@/components/PropertyListModal";
import StatusEditModal from "@/components/StatusEditModal";
import type { StatusData, PropertyStatus, PropertyType } from "@/components/StatusEditModal";

// Leafletデフォルトアイコン修正
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// ─── 容量データルックアップ（静的フラットマップ使用） ──────────
type CapLookup = { exact: Record<string, number | null>; normalized: Record<string, number | null> };
type DemandCapLookup = { exact: Record<string, string | null>; normalized: Record<string, string | null> };

const capLookup = capLookupRaw as CapLookup;
const demandCapLookup = demandCapLookupRaw as DemandCapLookup;

function normalizeLineName(n: string): string {
  return n.replace(/[（(].*?[）)]/g, "").trim();
}

function lookupCapSingle(name: string): number | null | undefined {
  if (name in capLookup.exact) return capLookup.exact[name];
  const norm = normalizeLineName(name);
  if (norm in capLookup.normalized) return capLookup.normalized[norm];
  if (norm in capLookup.exact) return capLookup.exact[norm];
  // 部分一致はまれなので必要時のみスキャン
  for (const [k, v] of Object.entries(capLookup.exact)) {
    const kn = normalizeLineName(k);
    if (kn.startsWith(norm) || norm.startsWith(kn)) return v;
  }
  return undefined;
}

// OSMはセミコロン区切りで複数回線名を持つ場合がある → 各部分で試す
function lookupCap(name: string): number | null | undefined {
  const parts = name.split(";").map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const result = lookupCapSingle(part);
    if (result !== undefined) return result;
  }
  return undefined;
}

function lookupDemandCapSingle(name: string): string | null | undefined {
  if (name in demandCapLookup.exact) return demandCapLookup.exact[name];
  const norm = normalizeLineName(name);
  if (norm in demandCapLookup.normalized) return demandCapLookup.normalized[norm];
  if (norm in demandCapLookup.exact) return demandCapLookup.exact[norm];
  return undefined;
}

function lookupDemandCap(name: string): string | null | undefined {
  const parts = name.split(";").map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const result = lookupDemandCapSingle(part);
    if (result !== undefined) return result;
  }
  return undefined;
}

// ─── 距離計算ユーティリティ ──────────────────────────────────
const DEG_TO_M = 111320; // 1度≒111km

function ptSegDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const cosLat = Math.cos((py * Math.PI) / 180);
  const dx = (bx - ax) * cosLat * DEG_TO_M;
  const dy = (by - ay) * DEG_TO_M;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = (px - ax) * cosLat * DEG_TO_M;
    const ey = (py - ay) * DEG_TO_M;
    return Math.sqrt(ex * ex + ey * ey);
  }
  const t = Math.max(0, Math.min(1, (((px - ax) * cosLat * DEG_TO_M) * dx + ((py - ay) * DEG_TO_M) * dy) / len2));
  const projX = ax + t * (bx - ax);
  const projY = ay + t * (by - ay);
  const ex = (px - projX) * cosLat * DEG_TO_M;
  const ey = (py - projY) * DEG_TO_M;
  return Math.sqrt(ex * ex + ey * ey);
}

// ─── 変電所ルックアップ ───────────────────────────────────────
type SubstationItem = {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
  voltageKv: number;
};

// ─── 6.6kV変電所グリッドインデックス（最寄変電所の高速検索） ──
type GridCell = { n: string; la: number; lo: number; mw: number }[];
type Grid6kV = { cellSize: number; cells: Record<string, GridCell> };
const dist6kvGrid = dist6kvGridRaw as Grid6kV;
const GRID_CELL = dist6kvGrid.cellSize;

function nearestSubstation(
  lat: number, lng: number
): { name: string; kv: number; distM: number; capMw: number | null } {
  let best = { name: "", kv: 6.6, distM: Infinity, capMw: null as number | null };
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const baseLat = Math.floor(lat / GRID_CELL) * GRID_CELL;
  const baseLng = Math.floor(lng / GRID_CELL) * GRID_CELL;
  // 自セル＋隣接8セルのみ検索
  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlng = -1; dlng <= 1; dlng++) {
      const key = `${(baseLat + dlat * GRID_CELL).toFixed(2)}_${(baseLng + dlng * GRID_CELL).toFixed(2)}`;
      const cell = dist6kvGrid.cells[key];
      if (!cell) continue;
      for (const sub of cell) {
        const dx = (sub.lo - lng) * cosLat * DEG_TO_M;
        const dy = (sub.la - lat) * DEG_TO_M;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < best.distM) best = { name: sub.n, kv: 6.6, distM: d, capMw: sub.mw };
      }
    }
  }
  return best;
}

function nearestLine(
  lat: number, lng: number,
  lines: TransmissionLine[],
  capByLineId: Map<string, number | null | undefined>,
): { name: string; kv: number; distM: number; capMw: number | null } {
  let best = { name: "なし", kv: 0, distM: Infinity, capMw: null as number | null };
  for (const line of lines) {
    const path = line.path;
    for (let i = 0; i + 1 < path.length; i++) {
      const d = ptSegDist(lng, lat, path[i].lng, path[i].lat, path[i + 1].lng, path[i + 1].lat);
      if (d < best.distM) {
        best = {
          name: line.name || "送電線",
          kv: line.voltageKv,
          distM: d,
          capMw: (capByLineId.get(line.id) ?? null) as number | null,
        };
      }
    }
  }
  return best;
}

// ─── 線のスタイル ──────────────────────────────────────────────
// OSMタイル上での視認性を最大化した高彩度カラー
function lineColor(mw: number | null | undefined): string {
  if (mw === undefined) return "#94a3b8";
  if (mw === null)      return "#64748b";
  if (mw === 0)         return "#ef4444"; // 赤（満杯）
  if (mw < 50)          return "#f97316"; // 橙（逼迫）
  if (mw < 200)         return "#eab308"; // 黄（中程度）
  return "#22c55e";                       // 緑（余裕）
}

function lineWeight(kv: number): number {
  if (kv >= 500) return 7;
  if (kv >= 275) return 6;
  if (kv >= 154) return 4;
  return 3;
}

// 白ケーシング幅 = 線幅 + 6（視認性確保）
function casingWeight(kv: number): number {
  return lineWeight(kv) + 6;
}

// ─── 県別バウンディングボックス ───────────────────────────────
const PREF_BOUNDS: { key: string; sw: [number, number]; ne: [number, number] }[] = [
  // 関東
  { key: "群馬", sw: [36.05, 138.4],  ne: [37.05, 139.75] },
  { key: "栃木", sw: [36.2,  139.2],  ne: [37.15, 140.35] },
  { key: "茨城", sw: [35.7,  139.65], ne: [36.95, 140.9]  },
  { key: "埼玉", sw: [35.7,  138.75], ne: [36.35, 139.95] },
  { key: "千葉", sw: [34.9,  139.7],  ne: [35.95, 140.95] },
  { key: "東京", sw: [35.5,  138.85], ne: [35.9,  139.95] },
  { key: "神奈川",sw: [35.1,  138.9],  ne: [35.65, 139.8]  },
  { key: "山梨", sw: [35.1,  138.1],  ne: [35.95, 139.1]  },
  { key: "長野", sw: [35.15, 137.3],  ne: [36.85, 138.95] },
  { key: "静岡", sw: [34.6,  137.35], ne: [35.55, 139.15] },
  // 東北
  { key: "青森", sw: [40.2,  139.7],  ne: [41.6,  141.7]  },
  { key: "岩手", sw: [38.8,  140.6],  ne: [40.5,  141.7]  },
  { key: "宮城", sw: [37.7,  140.1],  ne: [39.0,  141.7]  },
  { key: "秋田", sw: [38.8,  139.4],  ne: [40.5,  141.0]  },
  { key: "山形", sw: [37.7,  139.4],  ne: [39.0,  140.6]  },
  { key: "福島", sw: [36.8,  139.4],  ne: [37.9,  141.2]  },
  { key: "新潟", sw: [36.7,  137.6],  ne: [38.6,  139.8]  },
  // 中部
  { key: "愛知", sw: [34.5,  136.6],  ne: [35.5,  137.8]  },
  { key: "岐阜", sw: [35.1,  136.2],  ne: [36.5,  137.7]  },
  { key: "三重", sw: [33.7,  135.8],  ne: [35.3,  136.9]  },
  { key: "中部", sw: [33.7,  135.8],  ne: [36.5,  138.0]  },
];

function getAreaBounds(area: string): [[number, number], [number, number]] | null {
  const match = PREF_BOUNDS.find(({ key }) => area.includes(key));
  return match ? [match.sw, match.ne] : null;
}

// 全域表示時のデフォルトバウンド（関東+東北+中部）
const ALL_BOUNDS: [[number, number], [number, number]] = [[33.7, 135.8], [41.6, 141.7]];

// ─── ハザードマップレイヤー定義 (disaportaldata.gsi.go.jp) ────
// 正しいURL: https://disaportaldata.gsi.go.jp/raster/{layer_id}/{z}/{x}/{y}.png
const HAZARD_LAYERS = [
  {
    id: "flood_l2",
    label: "洪水（最大規模）",
    tileUrl: "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png",
    color: "#3b82f6",
  },
  {
    id: "flood_l1",
    label: "洪水（計画規模）",
    tileUrl: "https://disaportaldata.gsi.go.jp/raster/01_flood_l1_shinsuishin_newlegend_data/{z}/{x}/{y}.png",
    color: "#93c5fd",
  },
  {
    id: "tsunami",
    label: "津波浸水",
    tileUrl: "https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png",
    color: "#06b6d4",
  },
  {
    id: "hightide",
    label: "高潮浸水",
    tileUrl: "https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png",
    color: "#8b5cf6",
  },
  {
    id: "doseki",
    label: "土砂（土石流）",
    tileUrl: "https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png",
    color: "#ef4444",
  },
  {
    id: "kyukeisha",
    label: "土砂（急傾斜）",
    tileUrl: "https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png",
    color: "#f97316",
  },
  {
    id: "jisuberi",
    label: "地すべり",
    tileUrl: "https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png",
    color: "#a16207",
  },
] as const;


// ─── ビューポートトラッカー（6.6kVカリング用） ───────────────
// React.memo 必須: setMapBounds による親の再レンダリングで useMapEvents が
// zoomend/moveend リスナーを削除→再登録するとタイル再読み込みが途切れるため
const ViewportTracker = React.memo(function ViewportTracker({ onBoundsChange }: { onBoundsChange: (b: { n: number; s: number; e: number; w: number; zoom: number }) => void }) {
  const updateBounds = (map: L.Map) => {
    const b = map.getBounds();
    onBoundsChange({ n: b.getNorth(), s: b.getSouth(), e: b.getEast(), w: b.getWest(), zoom: map.getZoom() });
  };
  const map = useMapEvents({
    moveend: () => updateBounds(map),
    zoomend: () => updateBounds(map),
  });
  useEffect(() => { updateBounds(map); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
});

// ─── 県フォーカスコントローラー ──────────────────────────────
// React.memo: area/fitTrigger が変わらない限り再レンダリングしない
const MapFlyController = React.memo(function MapFlyController({ area, fitTrigger }: { area?: string; fitTrigger?: number }) {
  const map = useMap();

  // 県選択変更時: アニメーションあり（ナビゲーション用）
  useEffect(() => {
    if (!area || area === "all") {
      map.flyToBounds(ALL_BOUNDS as L.LatLngBoundsExpression, { padding: [40, 40], maxZoom: 8, duration: 0.8 });
      return;
    }
    const bounds = getAreaBounds(area);
    if (bounds) {
      map.flyToBounds(bounds as L.LatLngBoundsExpression, { padding: [40, 40], maxZoom: 10, duration: 0.8 });
    }
  }, [map, area]);

  // 印刷前プリロード: 画面サイズでフィット → OSMタイルをキャッシュに乗せる
  useEffect(() => {
    if (!fitTrigger) return;
    map.invalidateSize({ animate: false });
    const bounds = (!area || area === "all") ? null : getAreaBounds(area);
    if (bounds) {
      map.fitBounds(bounds as L.LatLngBoundsExpression, { animate: false, padding: [30, 30], maxZoom: 10 });
    } else {
      map.fitBounds(ALL_BOUNDS, { animate: false, padding: [10, 10] });
    }
  }, [map, fitTrigger, area]);

  // @media print 適用後（用紙サイズのコンテナ）に invalidateSize + fitBounds
  // matchMedia change は @media print 直後に同期発火するため
  // キャッシュ済みタイルを使いながら用紙サイズで正確にフィットできる
  useEffect(() => {
    const fitForPrint = () => {
      map.invalidateSize({ animate: false });
      const bounds = (!area || area === "all") ? null : getAreaBounds(area);
      if (bounds) {
        map.fitBounds(bounds as L.LatLngBoundsExpression, { animate: false, padding: [30, 30], maxZoom: 10 });
      } else {
        map.fitBounds(ALL_BOUNDS, { animate: false, padding: [10, 10] });
      }
    };

    const mql = window.matchMedia("print");
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) fitForPrint();
    };
    mql.addEventListener("change", handleChange);
    window.addEventListener("beforeprint", fitForPrint); // Safari fallback

    return () => {
      mql.removeEventListener("change", handleChange);
      window.removeEventListener("beforeprint", fitForPrint);
    };
  }, [map, area]);

  return null;
});

// ─── 旗アイコン ──────────────────────────────────────────────
function createFlagIcon(label: string): L.DivIcon {
  const safe = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:0;height:0;">
        <div style="
          position:absolute;
          left:0; bottom:0;
          transform:translateX(-3px);
          display:flex; flex-direction:column; align-items:flex-start;
          pointer-events:none;
        ">
          <div style="
            display:flex; align-items:center; gap:5px;
            background:white;
            border:2.5px solid #15803d;
            border-radius:8px;
            padding:4px 10px 4px 7px;
            box-shadow:0 3px 12px rgba(0,0,0,0.22);
            white-space:nowrap;
            max-width:240px;
            margin-bottom:0;
          ">
            <span style="font-size:14px; line-height:1;">🚩</span>
            <span style="font-size:11px; font-weight:700; color:#0f172a; overflow:hidden; text-overflow:ellipsis;">${safe}</span>
          </div>
          <div style="width:3px; height:22px; background:#15803d; margin-left:4px; border-radius:0 0 2px 2px;"></div>
          <div style="width:9px; height:9px; background:#15803d; border-radius:50%; margin-left:1px;"></div>
        </div>
      </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

// ─── 住所検索（マップ内オーバーレイ） ───────────────────────
function AddressSearchOverlay({
  onSelect,
}: {
  onSelect: (pin: { lat: number; lng: number; label: string } | null) => void;
}) {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);
  const [pinLabel, setPinLabel] = useState("");
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    if (v.trim().length < 2) { setResults([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(v)}&limit=5&countrycodes=jp&accept-language=ja`
        );
        const data = await res.json();
        setResults(data);
        setOpen(data.length > 0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 700);
  }

  function select(r: { display_name: string; lat: string; lon: string }) {
    const lat   = parseFloat(r.lat);
    const lng   = parseFloat(r.lon);
    const label = r.display_name.split(",")[0].trim();
    onSelect({ lat, lng, label });
    setPinLabel(label);
    setQuery(label);
    setOpen(false);
  }

  function clear() {
    setQuery(""); setResults([]); setOpen(false); setPinLabel("");
    onSelect(null);
  }

  return (
    <div
      ref={containerRef}
      className="no-print"
      style={{
        position: "absolute", top: 10, left: 10, zIndex: 1000,
        width: 280,
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "white",
        border: "1.5px solid #cbd5e1",
        borderRadius: 10,
        padding: "7px 10px",
        boxShadow: "0 3px 12px rgba(0,0,0,0.18)",
        transition: "border-color 0.15s",
      }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>🔍</span>
        <input
          type="text"
          value={query}
          placeholder="住所・地点名を入力して旗を立てる..."
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            fontSize: 12, color: "#0f172a", minWidth: 0,
          }}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
        />
        {loading && (
          <div style={{ width: 13, height: 13, border: "2px solid #cbd5e1", borderTop: "2px solid #15803d", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
        )}
        {pinLabel && !loading && (
          <button onClick={clear} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {open && results.length > 0 && (
        <div style={{
          marginTop: 4, background: "white", border: "1.5px solid #e2e8f0",
          borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
          overflow: "hidden", maxHeight: 220, overflowY: "auto",
        }}>
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => select(r)}
              style={{
                width: "100%", display: "flex", alignItems: "flex-start", gap: 8,
                padding: "9px 12px", background: "none", border: "none", cursor: "pointer",
                textAlign: "left", borderBottom: i < results.length - 1 ? "1px solid #f1f5f9" : "none",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}
            >
              <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>🚩</span>
              <span style={{ fontSize: 11, color: "#334155", lineHeight: 1.5 }}>{r.display_name}</span>
            </button>
          ))}
        </div>
      )}
      {open && !loading && query.length >= 2 && results.length === 0 && (
        <div style={{
          marginTop: 4, background: "white", border: "1.5px solid #e2e8f0",
          borderRadius: 10, padding: "12px", textAlign: "center",
          fontSize: 12, color: "#94a3b8",
        }}>
          「{query}」が見つかりません
        </div>
      )}
    </div>
  );
}

// ─── メインコンポーネント ─────────────────────────────────────
export interface CapacityMapViewProps {
  selectedArea?: string;
  /** 印刷前プリロードトリガー：インクリメントで発火 */
  fitTrigger?: number;
}

// ─── 6.6kV 配電用変電所データ ─────────────────────────────────
type Dist6kVSubstation = {
  name: string;
  prefecture: string;
  primaryKv: number;
  secondaryKv: number;
  availableMw: number;
  source: string;
  lat: number;
  lng: number;
  geocodeMethod?: string; // "approximate" or "default-region" = 推定位置
};
// default-region（府県中心配置）は表示対象外とし件数を削減
const dist6kvData = (dist6kvRaw as Dist6kVSubstation[]).filter(
  s => s.geocodeMethod !== "default-region"
);

// 共有Canvasレンダラー（マーカー全体で1インスタンス）
let _canvasRenderer: L.Renderer | undefined;
function getCanvasRenderer(): L.Renderer {
  if (!_canvasRenderer) _canvasRenderer = L.canvas({ padding: 0.5 });
  return _canvasRenderer;
}

function dist6kvColor(mw: number): string {
  if (mw >= 20) return "#16a34a";
  if (mw >= 10) return "#ca8a04";
  return "#f97316";
}

// 物件マーカーアイコン（ステータス×種別で色・アイコン変化）
const STATUS_MARKER_COLORS: Record<string, string> = {
  "未着手": "#6366f1",
  "進捗中": "#ca8a04",
  "失注":   "#dc2626",
};

function createPropertyIcon(id: string, priceMen: number | null, status?: string, type?: string): L.DivIcon {
  const label    = priceMen != null ? `${priceMen.toLocaleString()}万` : "物件";
  const bg       = STATUS_MARKER_COLORS[status ?? "未着手"] ?? "#6366f1";
  const typeTag  = type === "低圧" ? "低" : "高";
  return L.divIcon({
    className: "",
    html: `<div data-prop-id="${id}" style="
      background:${bg};color:#fff;
      border:2px solid rgba(255,255,255,0.8);
      border-radius:8px;
      padding:0;
      font-size:10px;font-weight:700;
      white-space:nowrap;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      cursor:pointer;
      display:inline-flex;align-items:stretch;overflow:hidden;
    ">
      <span style="
        background:rgba(0,0,0,0.22);
        padding:3px 5px;
        font-size:9px;font-weight:900;
        letter-spacing:0;
      ">${typeTag}</span>
      <span style="padding:3px 7px;">${label}</span>
    </div>`,
    iconSize: undefined,
    iconAnchor: [0, 0],
  });
}

// ─── 送電線描画用静的データ（ビルド済みJSON・モジュールキャッシュ） ────────
interface MatchedLine {
  id: string;
  name: string | null;
  kv: number;
  ug: number;           // 1=地中埋設, 0=架空線
  path: [number, number][]; // [[lat, lng], ...]
  mw: number;
  dm: string | null;
}
let _mlCache: MatchedLine[] | null = null;
let _mlPromise: Promise<MatchedLine[]> | null = null;
function fetchMatchedLines(): Promise<MatchedLine[]> {
  if (_mlCache) return Promise.resolve(_mlCache);
  if (!_mlPromise) {
    _mlPromise = fetch("/data/matched_lines.json")
      .then(r => r.json() as Promise<MatchedLine[]>)
      .then(d => { _mlCache = d; return d; });
  }
  return _mlPromise;
}

function dmColor(dm: string | null): string {
  if (!dm) return "#94a3b8";
  const m: Record<string, string> = {
    "~50MW": "#f97316", "50~75MW": "#eab308", "75~100MW": "#22d3ee",
    "31~100MW": "#d97706", "101~200MW": "#60a5fa", "201~300MW": "#4ade80",
    "301~1000MW": "#22c55e", "1001MW~": "#15803d",
  };
  return m[dm] ?? "#60a5fa";
}

// 生 Leaflet API で GeoJSON + Canvas の2レイヤーのみ作成
// react-leaflet の Polyline コンポーネントを使わないため再レンダリングがゼロ
const TransmissionLinesLayer = React.memo(function TransmissionLinesLayer({
  lines,
}: {
  lines: MatchedLine[];
}) {
  const map = useMap();

  useEffect(() => {
    if (!lines.length) return;

    let casingLayer: L.GeoJSON | undefined;
    let colorLayer:  L.GeoJSON | undefined;
    let sharedTip:   L.Tooltip | undefined;

    // 初期タイル読み込みをブロックしないよう 2 秒遅延してから GeoJSON レイヤーを生成
    const timer = setTimeout(() => {
      const renderer = L.canvas({ padding: 0.5 });
      const toCoords = (path: [number, number][]) => path.map(([lat, lng]) => [lng, lat]);

      type GeoJSONOptsExt = L.GeoJSONOptions & { renderer?: L.Renderer };

      casingLayer = L.geoJSON(
        {
          type: "FeatureCollection",
          features: lines.map(line => ({
            type: "Feature",
            geometry: { type: "LineString", coordinates: toCoords(line.path) },
            properties: { kv: line.kv },
          })),
        } as GeoJSON.FeatureCollection,
        {
          renderer,
          interactive: false,
          style: (f) => ({
            color: "white",
            weight: casingWeight(f!.properties.kv),
            opacity: 0.85,
            fillOpacity: 0,
          }),
        } as GeoJSONOptsExt
      ).addTo(map);

      colorLayer = L.geoJSON(
        {
          type: "FeatureCollection",
          features: lines.map(line => ({
            type: "Feature",
            geometry: { type: "LineString", coordinates: toCoords(line.path) },
            properties: line,
          })),
        } as GeoJSON.FeatureCollection,
        ({
          renderer,
          style: (f) => ({
            color: lineColor(f!.properties.mw),
            weight: lineWeight(f!.properties.kv),
            opacity: 0.95,
            fillOpacity: 0,
          }),
        } as GeoJSONOptsExt)
      ).addTo(map);

      // 共有ツールチップ: bindTooltip を 3,992 回呼ぶ代わりに mousemove 1 リスナーで処理
      type MouseEvtWithFrom = L.LeafletMouseEvent & {
        propagatedFrom?: L.Layer & { feature?: GeoJSON.Feature };
      };
      sharedTip = L.tooltip({ sticky: true, opacity: 0.97 });
      colorLayer.on("mousemove", (ev: L.LeafletEvent) => {
        const e = ev as MouseEvtWithFrom;
        const src = e.propagatedFrom;
        if (!src?.feature) return;
        const p = src.feature.properties as MatchedLine;
        const c = lineColor(p.mw);
        const dc = dmColor(p.dm);
        sharedTip!
          .setLatLng(e.latlng)
          .setContent(
            `<div style="font-size:11px;line-height:1.7;min-width:180px">
              <p style="font-weight:700;color:#0f172a;margin:0 0 3px;font-size:12px">${p.name ?? "送電線"}</p>
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                <span style="color:#475569">${p.kv} kV</span>
                <span style="font-size:9px;font-weight:700;background:${p.ug ? "#e0f2fe" : "#f0fdf4"};color:${p.ug ? "#0369a1" : "#166534"};border-radius:4px;padding:1px 5px">${p.ug ? "地中埋設" : "架空線"}</span>
              </div>
              <div style="margin-bottom:4px">
                <p style="font-size:9px;color:#94a3b8;margin:0 0 1px">逆潮流（発電設備向け）</p>
                <p style="color:${c};font-weight:700;font-size:13px;margin:0">${p.mw} MW</p>
              </div>
              ${p.dm ? `<div style="border-top:1px solid #f1f5f9;padding-top:4px">
                <p style="font-size:9px;color:#94a3b8;margin:0 0 1px">順潮流（需要家向け）</p>
                <p style="color:${dc};font-weight:700;font-size:13px;margin:0">${p.dm}</p>
              </div>` : ""}
            </div>`
          );
        if (!map.hasLayer(sharedTip!)) sharedTip!.addTo(map);
      });
      colorLayer.on("mouseout", () => {
        if (sharedTip && map.hasLayer(sharedTip)) map.removeLayer(sharedTip);
      });
    }, 2000);

    return () => {
      clearTimeout(timer);
      casingLayer?.remove();
      colorLayer?.remove();
      if (sharedTip && map.hasLayer(sharedTip)) map.removeLayer(sharedTip);
    };
  }, [lines, map]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
});

export default function CapacityMapView({ selectedArea, fitTrigger }: CapacityMapViewProps) {
  const [lines, setLines]         = useState<TransmissionLine[]>([]);
  const [matchedLines, setMatchedLines] = useState<MatchedLine[]>(_mlCache ?? []);
  const [addressPin, setAddressPin] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [properties, setProperties] = useState<HomesProperty[]>([]);
  const [statusTarget, setStatusTarget] = useState<HomesProperty | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(["未着手", "進捗中", "失注"]));
  const [typeFilter, setTypeFilter]     = useState<Set<string>>(new Set(["高圧", "低圧"]));
  const [show6kV, setShow6kV]           = useState(false);
  const [mapBounds, setMapBounds]       = useState<{ n: number; s: number; e: number; w: number; zoom: number } | null>(null);
  const [hazardVisibility, setHazardVisibility] = useState<Record<string, boolean>>({});
  const [hazardOpacity, setHazardOpacity] = useState(0.7);
  const toggleHazard = (id: string) => setHazardVisibility(prev => ({ ...prev, [id]: !prev[id] }));
  const anyHazardOn = HAZARD_LAYERS.some(l => hazardVisibility[l.id]);

  // 物件マーカークリック: document capture フェーズで直接拾う
  // react-leaflet の eventHandlers は再レンダー後にリスナー差し替えが失敗し、
  // map.getContainer() の capture でも Leaflet 内部処理に干渉されるため、
  // document レベルで data-prop-id を拾う方式にする
  const propertiesRef = useRef<HomesProperty[]>(properties);
  propertiesRef.current = properties;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const el = target.closest("[data-prop-id]") as HTMLElement | null;
      if (!el) return;
      const id = el.getAttribute("data-prop-id");
      if (!id) return;
      e.stopPropagation(); // Leaflet にクリックを渡さない
      const prop = propertiesRef.current.find(p => p.id === id);
      if (prop) setStatusTarget(prop);
    };
    document.addEventListener("click", handler, true); // capture フェーズ
    return () => document.removeEventListener("click", handler, true);
  }, []); // propertiesRef・setStatusTarget は安定参照なので依存不要 // eslint-disable-line react-hooks/exhaustive-deps

  function handleStatusSave(id: string, data: StatusData) {
    setProperties(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
  }

  useEffect(() => {
    fetch('/api/homes-properties')
      .then(r => r.json())
      .then(data => setProperties(data))
      .catch(() => {});
  }, []);

  // 送電線の全データ（物件の nearestLine 計算用）
  // マップ安定後に実行（タイル読み込みをブロックしないよう5秒遅延）
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/real-data/transmission-lines", { cache: "no-store" })
        .then(r => r.json())
        .then((data: TransmissionLine[]) => setLines(data))
        .catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // 描画用送電線（ビルド済み静的JSON・一回のみ取得）
  useEffect(() => {
    if (_mlCache) { setMatchedLines(_mlCache); return; }
    fetchMatchedLines().then(setMatchedLines).catch(() => {});
  }, []);

  const capByLineId = useMemo(() => {
    const m = new Map<string, number | null | undefined>();
    for (const line of lines) {
      m.set(line.id, line.name ? lookupCap(line.name) : undefined);
    }
    return m;
  }, [lines]);

  // 送電線データ読み込み後、未計算の物件を自動補完して DB に書き戻す（送電線 + 変電所）
  // null = 未計算, -1 = 計算済みだがデータなし（無限ループ防止）
  useEffect(() => {
    if (lines.length === 0 || properties.length === 0) return;
    const needsEnrich = properties.some(
      p => p.lat !== 0 && (
        p.nearestDistM === 0 ||
        p.nearestSubDistM === 0 ||
        p.nearestSubCapMw === null ||
        (p.nearestSubKv !== undefined && p.nearestSubKv !== 6.6)
      )
    );
    if (!needsEnrich) return;
    const enriched = properties.map(p => {
      if (p.lat === 0) return p;
      const needsLine   = p.nearestDistM === 0;
      // 6.6kV以外のkV（旧送変電所ベース）なら再計算
      const needsSub    = p.nearestSubDistM === 0 || (p.nearestSubKv !== undefined && p.nearestSubKv !== 6.6);
      const needsSubCap = p.nearestSubCapMw === null || (p.nearestSubKv !== undefined && p.nearestSubKv !== 6.6);
      if (!needsLine && !needsSub && !needsSubCap) return p;
      const nb  = needsLine              ? nearestLine(p.lat, p.lng, lines, capByLineId) : null;
      const sub = (needsSub || needsSubCap) ? nearestSubstation(p.lat, p.lng)            : null;
      return {
        ...p,
        ...(nb  ? { nearestLineName: nb.name, nearestLineKv: nb.kv, nearestDistM: nb.distM, nearestCapMw: nb.capMw } : {}),
        ...(sub ? { nearestSubName: sub.name, nearestSubKv: sub.kv, nearestSubDistM: sub.distM, nearestSubCapMw: sub.capMw } : {}),
      };
    });
    setProperties(enriched);
    enriched
      .filter((p, i) => {
        const orig = properties[i];
        return p.lat !== 0 && (
          orig?.nearestDistM === 0 ||
          orig?.nearestSubDistM === 0 ||
          orig?.nearestSubCapMw === null ||
          (orig?.nearestSubKv !== undefined && orig?.nearestSubKv !== 6.6)
        );
      })
      .forEach(p => {
        fetch('/api/homes-properties', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: p.id,
            nearestLineName:  p.nearestLineName,
            nearestLineKv:    p.nearestLineKv,
            nearestDistM:     p.nearestDistM,
            nearestCapMw:     p.nearestCapMw,
            nearestSubName:   p.nearestSubName,
            nearestSubDistM:  p.nearestSubDistM,
            nearestSubKv:     p.nearestSubKv,
            nearestSubCapMw:  p.nearestSubCapMw,
          }),
        }).catch(() => {});
      });
  }, [lines, capByLineId, properties]); // eslint-disable-line react-hooks/exhaustive-deps

  // 物件フィルター適用
  const filteredProperties = useMemo(() =>
    properties.filter(p =>
      statusFilter.has(p.status ?? "未着手") &&
      typeFilter.has(p.type ?? "高圧")
    ),
    [properties, statusFilter, typeFilter]
  );

  // 6.6kV変電所：ビューポート内かつズームレベル条件を満たすもののみ（メモ化）
  const visible6kVSubs = useMemo(() => {
    if (!show6kV || !mapBounds) return [];
    const { n, s, e, w, zoom } = mapBounds;
    // ズーム9未満は高容量(≥10MW)のみ、7未満は非表示
    const minMw = zoom < 7 ? Infinity : zoom < 9 ? 10 : 0;
    return dist6kvData.filter(sub =>
      sub.availableMw >= minMw &&
      sub.lat <= n && sub.lat >= s &&
      sub.lng <= e && sub.lng >= w
    );
  }, [show6kV, mapBounds]);

  return (
    <div className="relative w-full h-full">
      {/* 住所検索オーバーレイ（印刷時は非表示） */}
      <AddressSearchOverlay onSelect={setAddressPin} />

      {/* 物件フィルターパネル */}
      {properties.length > 0 && (
        <div
          className="no-print"
          style={{
            position: "absolute", top: 10, left: 300, zIndex: 1000,
            background: "rgba(255,255,255,0.97)",
            border: "1.5px solid #cbd5e1",
            borderRadius: 10,
            padding: "8px 12px",
            boxShadow: "0 3px 12px rgba(0,0,0,0.18)",
            minWidth: 210,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <p style={{ fontSize: 10, fontWeight: 700, color: "#475569", marginBottom: 2 }}>物件フィルター</p>

          {/* ステータス */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            <span style={{ fontSize: 9, color: "#94a3b8", minWidth: 36 }}>ステータス</span>
            {(["未着手", "進捗中", "失注"] as const).map(s => {
              const colors: Record<string, { color: string; bg: string; border: string }> = {
                "未着手": { color: "#6366f1", bg: "#eef2ff", border: "#a5b4fc" },
                "進捗中": { color: "#b45309", bg: "#fef9c3", border: "#fde047" },
                "失注":   { color: "#dc2626", bg: "#fef2f2", border: "#fca5a5" },
              };
              const c = colors[s];
              const active = statusFilter.has(s);
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(prev => {
                    const next = new Set(prev);
                    active ? next.delete(s) : next.add(s);
                    return next;
                  })}
                  style={{
                    padding: "2px 8px",
                    borderRadius: 12,
                    fontSize: 10,
                    fontWeight: 700,
                    border: `1.5px solid ${active ? c.border : "#e2e8f0"}`,
                    color: active ? c.color : "#94a3b8",
                    background: active ? c.bg : "white",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>

          {/* 種別 */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 9, color: "#94a3b8", minWidth: 36 }}>種別</span>
            {(["高圧", "低圧"] as const).map(t => {
              const colors: Record<string, { color: string; bg: string; border: string }> = {
                "高圧": { color: "#b45309", bg: "#fff7ed", border: "#fdba74" },
                "低圧": { color: "#1d4ed8", bg: "#eff6ff", border: "#93c5fd" },
              };
              const c = colors[t];
              const active = typeFilter.has(t);
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(prev => {
                    const next = new Set(prev);
                    active ? next.delete(t) : next.add(t);
                    return next;
                  })}
                  style={{
                    padding: "2px 8px",
                    borderRadius: 12,
                    fontSize: 10,
                    fontWeight: 700,
                    border: `1.5px solid ${active ? c.border : "#e2e8f0"}`,
                    color: active ? c.color : "#94a3b8",
                    background: active ? c.bg : "white",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {t === "高圧" ? "高圧" : "低圧"}
                </button>
              );
            })}
          </div>

          <p style={{ fontSize: 9, color: "#94a3b8" }}>
            表示: {filteredProperties.length} / {properties.length} 件
          </p>

          {/* 6.6kV 配電用変電所トグル */}
          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 6, marginTop: 2 }}>
            <button
              onClick={() => setShow6kV(v => !v)}
              style={{
                padding: "3px 10px",
                borderRadius: 12,
                fontSize: 10,
                fontWeight: 700,
                border: `1.5px solid ${show6kV ? "#16a34a" : "#e2e8f0"}`,
                color: show6kV ? "#16a34a" : "#94a3b8",
                background: show6kV ? "#f0fdf4" : "white",
                cursor: "pointer",
                transition: "all 0.15s",
                width: "100%",
              }}
            >
              {show6kV ? "▼ " : "▶ "}6.6kV変電所（{dist6kvData.length}件）
            </button>
          </div>
        </div>
      )}



      {/* ハザードマップトグルパネル */}
      <div
        className="no-print"
        style={{
          position: "absolute", bottom: 140, left: 10, zIndex: 1000,
          background: "rgba(255,255,255,0.97)",
          border: anyHazardOn ? "1.5px solid #ef4444" : "1.5px solid #cbd5e1",
          borderRadius: 10,
          padding: "8px 12px",
          boxShadow: "0 3px 12px rgba(0,0,0,0.18)",
          minWidth: 190,
          maxHeight: "60vh",
          overflowY: "auto",
        }}
      >
        <p style={{ fontSize: 11, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
          ハザードマップ
        </p>

        {HAZARD_LAYERS.map(layer => (
          <button
            key={layer.id}
            onClick={() => toggleHazard(layer.id)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              background: hazardVisibility[layer.id] ? "#fef2f2" : "none",
              border: hazardVisibility[layer.id] ? `1px solid ${layer.color}40` : "1px solid #e2e8f0",
              borderRadius: 7, cursor: "pointer", padding: "5px 8px", marginBottom: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: layer.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#0f172a", textAlign: "left" }}>{layer.label}</span>
            </div>
            <span style={{
              fontSize: 10, fontWeight: 700,
              background: hazardVisibility[layer.id] ? layer.color : "#e2e8f0",
              color: hazardVisibility[layer.id] ? "white" : "#64748b",
              borderRadius: 5, padding: "1px 7px", flexShrink: 0,
            }}>
              {hazardVisibility[layer.id] ? "ON" : "OFF"}
            </span>
          </button>
        ))}

        {anyHazardOn && (
          <div style={{ marginTop: 6, borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: "#64748b", whiteSpace: "nowrap" }}>透明度</span>
              <input
                type="range" min={0.1} max={1} step={0.05}
                value={hazardOpacity}
                onChange={e => setHazardOpacity(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: "#ef4444" }}
              />
              <span style={{ fontSize: 10, color: "#64748b", width: 28, textAlign: "right" }}>
                {Math.round(hazardOpacity * 100)}%
              </span>
            </div>
            <p style={{ fontSize: 9, color: "#9ca3af", marginTop: 6 }}>
              出典: <a href="https://disaportal.gsi.go.jp/" target="_blank" rel="noreferrer"
                style={{ color: "#9ca3af" }}>ハザードマップポータルサイト</a>
            </p>
          </div>
        )}
      </div>

      <MapContainer
        center={[36.2, 139.5]}
        zoom={8}
        style={{ width: "100%", height: "100%" }}
        zoomControl={true}
      >
        {/* OpenStreetMap */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        {/* 県フォーカスコントローラー */}
        <MapFlyController area={selectedArea} fitTrigger={fitTrigger} />
        <ViewportTracker onBoundsChange={setMapBounds} />

        {/* ハザードマップタイルレイヤー */}
        {HAZARD_LAYERS.map(layer => hazardVisibility[layer.id] && (
          <TileLayer
            key={layer.id}
            url={layer.tileUrl}
            opacity={hazardOpacity}
            maxZoom={17}
            attribution='<a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータルサイト</a>'
          />
        ))}


        {/* 送電線レイヤー（生Leaflet GeoJSON+Canvas、React再レンダリングなし） */}
        <TransmissionLinesLayer lines={matchedLines} />

        {/* 関西 上位系統増強必要地域（赤枠） */}
        <GeoJSON
          key="kansai-upper"
          data={kansaiUpperAreas as GeoJsonObject}
          style={{
            color: "#ef4444",
            weight: 2.5,
            opacity: 0.9,
            fill: false,
            dashArray: "6 4",
          }}
          onEachFeature={(feature, layer) => {
            if (feature.properties?.name) {
              layer.bindTooltip(
                `<div style="font-size:11px;font-weight:700;color:#dc2626;">
                  ⚠ ${feature.properties.name}<br/>
                  <span style="font-size:9px;color:#6b7280;font-weight:400;">${feature.properties.region} — 上位系統増強必要</span>
                </div>`,
                { sticky: true, opacity: 0.95 }
              );
            }
          }}
        />

        {/* 6.6kV 配電用変電所マーカー（共有Canvas・ビューポート＋ズーム間引き済み） */}
        {visible6kVSubs.map((sub, i) => {
          const color = dist6kvColor(sub.availableMw);
          const isApprox = sub.geocodeMethod === "approximate";
          return (
            <CircleMarker
              key={`6kv-${i}`}
              center={[sub.lat, sub.lng]}
              radius={isApprox ? 4 : 5}
              renderer={getCanvasRenderer()}
              pathOptions={{
                fillColor: color,
                fillOpacity: isApprox ? 0.35 : 0.85,
                color: isApprox ? color : "#fff",
                weight: isApprox ? 1.5 : 1.2,
                dashArray: isApprox ? "3 3" : undefined,
              }}
            >
              <Tooltip sticky opacity={0.97}>
                <div style={{ fontSize: 11, lineHeight: 1.6 }}>
                  <p style={{ fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>
                    {sub.name}変電所
                    {isApprox && (
                      <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4, fontSize: 10 }}>
                        (位置推定)
                      </span>
                    )}
                  </p>
                  <p style={{ color: "#374151" }}>
                    二次電圧: <b>6.6kV</b>　一次: {sub.primaryKv}kV
                  </p>
                  <p style={{ color: "#374151" }}>
                    空き容量: <b style={{ color }}>
                      {sub.availableMw} MW
                    </b>
                  </p>
                  <p style={{ color: "#6b7280", fontSize: 10 }}>
                    {sub.prefecture}　{sub.source}
                    {isApprox && " ※位置は推定"}
                  </p>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {/* 住所ピン（旗） */}
        {addressPin && (
          <Marker
            position={[addressPin.lat, addressPin.lng]}
            icon={createFlagIcon(addressPin.label)}
            zIndexOffset={5000}
          />
        )}

        {/* 物件マーカー（フィルター適用済み） */}
        {filteredProperties.map(p => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={createPropertyIcon(p.id, p.priceMen, p.status, p.type)}
            zIndexOffset={4000}
          >
            <Tooltip permanent={false} direction="top" opacity={0.97}>
              <div style={{ fontSize: 11, lineHeight: "1.7", minWidth: 200 }}>
                <p style={{ fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>{p.address}</p>
                <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
                  {p.priceMen != null && <span style={{ color: "#6366f1", fontWeight: 700 }}>{p.priceMen.toLocaleString()}万円</span>}
                  {p.areaSqm != null && <span style={{ color: "#475569" }}>{p.areaSqm.toLocaleString()}m²</span>}
                </div>
                {p.nearestDistM > 0 && (
                  <>
                    <p style={{ color: "#374151", marginTop: 4 }}>🔌 最寄送電線: <b>{p.nearestLineName}</b>（{p.nearestLineKv}kV）</p>
                    <p style={{ color: "#374151" }}>
                      　距離: <b style={{ color: p.nearestDistM < 500 ? "#16a34a" : p.nearestDistM < 2000 ? "#f97316" : "#ef4444" }}>
                        {p.nearestDistM < 1000 ? `${Math.round(p.nearestDistM)}m` : `${(p.nearestDistM / 1000).toFixed(1)}km`}
                      </b>
                    </p>
                    <p style={{ color: "#374151" }}>
                      　空き容量: <b style={{ color: p.nearestCapMw && p.nearestCapMw > 0 ? "#16a34a" : "#ef4444" }}>
                        {p.nearestCapMw != null ? `${p.nearestCapMw}MW` : "不明"}
                      </b>
                    </p>
                  </>
                )}
                {p.nearestSubDistM > 0 && (
                  <>
                    <p style={{ color: "#374151", marginTop: 4 }}>🏭 最寄変電所: <b>{p.nearestSubName}</b>（{p.nearestSubKv}kV）</p>
                    <p style={{ color: "#374151" }}>
                      　距離: <b style={{ color: p.nearestSubDistM < 500 ? "#16a34a" : p.nearestSubDistM < 2000 ? "#f97316" : "#ef4444" }}>
                        {p.nearestSubDistM < 1000 ? `${Math.round(p.nearestSubDistM)}m` : `${(p.nearestSubDistM / 1000).toFixed(1)}km`}
                      </b>
                    </p>
                    <p style={{ color: "#374151" }}>
                      　空き容量: <b style={{ color: p.nearestSubCapMw == null || p.nearestSubCapMw < 0 ? "#9ca3af" : p.nearestSubCapMw > 0 ? "#16a34a" : "#ef4444" }}>
                        {p.nearestSubCapMw == null ? "未計算" : p.nearestSubCapMw < 0 ? "要確認" : `${p.nearestSubCapMw} MW`}
                      </b>
                    </p>
                  </>
                )}
              </div>
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>

      {/* 物件ステータス編集モーダル */}
      {statusTarget && (
        <StatusEditModal
          propertyId={statusTarget.id}
          address={statusTarget.address}
          initialStatus={(statusTarget.status ?? "未着手") as PropertyStatus}
          initialComment={statusTarget.comment ?? ""}
          initialType={(statusTarget.type ?? "高圧") as PropertyType}
          onSave={handleStatusSave}
          onClose={() => setStatusTarget(null)}
        />
      )}

      {/* 凡例パネル */}
      <div style={{
        position: "absolute", bottom: 32, right: 12, zIndex: 1000,
        background: "rgba(255,255,255,0.97)",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: "14px 16px",
        fontSize: 10,
        minWidth: 190,
        boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
      }}>
        <p style={{ fontWeight: 700, fontSize: 12, color: "#0f172a", marginBottom: 10 }}>系統空き容量</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 10 }}>
          {[
            { color: "#22c55e", label: "200MW以上（余裕あり）" },
            { color: "#eab308", label: "50〜199MW（中程度）" },
            { color: "#f97316", label: "1〜49MW（逼迫）" },
            { color: "#ef4444", label: "0MW（満杯）" },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 6, background: color, borderRadius: 2, flexShrink: 0,
                outline: "3px solid white", outlineOffset: "1px",
                boxShadow: `0 0 0 3.5px ${color}60`,
              }} />
              <span style={{ color: "#374151" }}>{label}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 1.5, background: "#94a3b8", borderRadius: 1, flexShrink: 0 }} />
            <span style={{ color: "#9ca3af" }}>系統データなし</span>
          </div>
        </div>

        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          <p style={{ color: "#9ca3af", fontSize: 9, marginBottom: 2 }}>電圧クラス（線の太さ）</p>
          {[
            { weight: 6,   label: "500kV" },
            { weight: 5,   label: "275kV" },
            { weight: 3.5, label: "154kV" },
            { weight: 2.5, label: "66kV以下" },
          ].map(({ weight, label }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: weight, background: "#64748b", borderRadius: 1, flexShrink: 0 }} />
              <span style={{ color: "#6b7280" }}>{label}</span>
            </div>
          ))}
        </div>

        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 8, marginTop: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 26, height: 14,
              border: "2.5px dashed #ef4444",
              borderRadius: 3,
              background: "rgba(239,68,68,0.08)",
              flexShrink: 0,
            }} />
            <span style={{ color: "#374151", fontSize: 9, lineHeight: 1.4 }}>
              上位系統増強必要地域<br/>
              <span style={{ color: "#9ca3af" }}>（関西電力 2026年2月）</span>
            </span>
          </div>
        </div>

        {show6kV && (
          <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 8, marginTop: 6 }}>
            <p style={{ color: "#475569", fontSize: 10, fontWeight: 700, marginBottom: 5 }}>6.6kV 配電変電所</p>
            {[
              { color: "#16a34a", label: "20MW以上" },
              { color: "#ca8a04", label: "10〜19MW" },
              { color: "#f97316", label: "1〜9MW" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{
                  width: 10, height: 10,
                  borderRadius: "50%",
                  background: color,
                  border: "1.5px solid white",
                  flexShrink: 0,
                }} />
                <span style={{ color: "#374151", fontSize: 9 }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        <p style={{ color: "#9ca3af", fontSize: 9, marginTop: 8, paddingTop: 6, borderTop: "1px solid #e2e8f0" }}>
          東京電力PG / 2026年4月時点
        </p>
      </div>
    </div>
  );
}
