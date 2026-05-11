"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Tooltip, Marker, ImageOverlay, useMap } from "react-leaflet";
import type { TransmissionLine } from "@/types";
import L from "leaflet";
import gridCapacityAll from "@/data/grid_capacity_all.json";
import gridCapacityDemand from "@/data/grid_capacity_demand.json";
import substationsData from "@/data/substations.json";
import subCapData from "@/data/substation_capacity.json";
import { type HomesProperty } from "@/components/PropertyListModal";

// Leafletデフォルトアイコン修正
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// ─── 容量データルックアップ ───────────────────────────────────
type RawLine = { name: string | null; voltageKv: number; availableMw: number | null };
type CapDataset = { area: string; lines: RawLine[] };
type DemandLine = { name: string | null; voltageKv: number; demandMw: string | null };
type DemandDataset = { area: string; lines: DemandLine[] };

function normalizeLineName(n: string): string {
  return n.replace(/[（(].*?[）)]/g, "").trim();
}

const CAP_MAP = new Map<string, number | null>(
  (gridCapacityAll as CapDataset[]).flatMap(ds =>
    ds.lines.filter(l => l.name).map(l => [l.name as string, l.availableMw])
  )
);

const DEMAND_CAP_MAP = new Map<string, string | null>(
  (gridCapacityDemand as DemandDataset[]).flatMap(ds =>
    ds.lines.filter(l => l.name).map(l => [l.name as string, l.demandMw])
  )
);

function lookupCapSingle(name: string): number | null | undefined {
  if (CAP_MAP.has(name)) return CAP_MAP.get(name);
  const norm = normalizeLineName(name);
  for (const [k, v] of CAP_MAP) {
    if (normalizeLineName(k) === norm) return v;
  }
  for (const [k, v] of CAP_MAP) {
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
  if (DEMAND_CAP_MAP.has(name)) return DEMAND_CAP_MAP.get(name);
  const norm = normalizeLineName(name);
  for (const [k, v] of DEMAND_CAP_MAP) {
    if (normalizeLineName(k) === norm) return v;
  }
  for (const [k, v] of DEMAND_CAP_MAP) {
    const kn = normalizeLineName(k);
    if (kn.startsWith(norm) || norm.startsWith(kn)) return v;
  }
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

const SUB_CAP_MAP = new Map<string, number>(
  Object.entries(subCapData as Record<string, number>)
);

function lookupSubCap(name: string): number {
  const key = name.replace(/変電所$/, '').trim();
  const v = SUB_CAP_MAP.get(key);
  return v !== undefined ? v : -1; // -1 = データなし（未収録変電所）
}

function nearestSubstation(
  lat: number, lng: number
): { name: string; kv: number; distM: number; capMw: number | null } {
  let best = { name: "", kv: 0, distM: Infinity, capMw: -1 as number };
  for (const sub of substationsData as SubstationItem[]) {
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const dx = (sub.coordinates.lng - lng) * cosLat * DEG_TO_M;
    const dy = (sub.coordinates.lat - lat) * DEG_TO_M;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < best.distM) {
      best = { name: sub.name, kv: sub.voltageKv, distM: d, capMw: lookupSubCap(sub.name) };
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
];

function getAreaBounds(area: string): [[number, number], [number, number]] | null {
  const match = PREF_BOUNDS.find(({ key }) => area.includes(key));
  return match ? [match.sw, match.ne] : null;
}

// 全県表示時のデフォルトバウンド（関東全域）
const ALL_BOUNDS: [[number, number], [number, number]] = [[34.5, 136.8], [37.5, 141.2]];

// 順潮流マップ画像のジオリファレンス範囲（TEPG管内全域）
// 画像ファイル: /public/forward-flow-66kv.png
const FORWARD_FLOW_BOUNDS: [[number, number], [number, number]] = [
  [34.15, 136.95],
  [37.45, 141.25],
];

// ─── 県フォーカスコントローラー ──────────────────────────────
function MapFlyController({ area, fitTrigger }: { area?: string; fitTrigger?: number }) {
  const map = useMap();

  // 県選択変更時: アニメーションあり（ナビゲーション用）
  useEffect(() => {
    if (!area || area === "all") {
      map.flyTo([36.2, 139.5], 8, { duration: 0.8 });
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
}

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

// 物件マーカーアイコン
function createPropertyIcon(priceMen: number | null): L.DivIcon {
  const label = priceMen != null ? `${priceMen.toLocaleString()}万` : "物件";
  return L.divIcon({
    className: "",
    html: `<div style="
      background:#6366f1;color:#fff;
      border:2px solid #fff;
      border-radius:8px;
      padding:3px 7px;
      font-size:10px;font-weight:700;
      white-space:nowrap;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
    ">🏠 ${label}</div>`,
    iconSize: undefined,
    iconAnchor: [0, 0],
  });
}

export default function CapacityMapView({ selectedArea, fitTrigger }: CapacityMapViewProps) {
  const [lines, setLines]       = useState<TransmissionLine[]>([]);
  const [loading, setLoading]   = useState(true);
  const [addressPin, setAddressPin] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [properties, setProperties] = useState<HomesProperty[]>([]);
  const [show66kv, setShow66kv]   = useState(false);
  const [show154kv, setShow154kv] = useState(false);
  const [forwardFlowOpacity, setForwardFlowOpacity] = useState(0.65);

  useEffect(() => {
    fetch('/api/homes-properties')
      .then(r => r.json())
      .then(data => setProperties(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/real-data/transmission-lines", { cache: "no-store" })
      .then(r => r.json())
      .then((data: TransmissionLine[]) => {
        const kv66 = data.filter(l => l.voltageKv === 66).length;
        console.log(`[CapacityMap] 取得: ${data.length}件 (66kV: ${kv66}件)`);
        setLines(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
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
        p.nearestSubCapMw === null
      )
    );
    if (!needsEnrich) return;
    const enriched = properties.map(p => {
      if (p.lat === 0) return p;
      const needsLine   = p.nearestDistM === 0;
      const needsSub    = p.nearestSubDistM === 0;
      const needsSubCap = p.nearestSubCapMw === null;
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
          orig?.nearestSubCapMw === null
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

  // 66kV以上 かつ 空き容量あり（> 0 MW）の線のみ描画
  const matchedLines = useMemo(() => {
    const result = lines.filter(line => {
      if (line.voltageKv < 66) return false;
      const cap = capByLineId.get(line.id);
      return typeof cap === "number" && cap > 0;
    });
    console.log(`[CapacityMap] matchedLines: ${result.length}件 (66/77kV: ${result.filter(l => l.voltageKv < 154).length}件)`);
    return result;
  }, [lines, capByLineId]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-100">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-amber-500/60 border-t-amber-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[12px] text-slate-500">送電線データ取得中...</p>
          <p className="text-[10px] text-slate-400 mt-1">初回は数秒かかります</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* 住所検索オーバーレイ（印刷時は非表示） */}
      <AddressSearchOverlay onSelect={setAddressPin} />



      {/* 順潮流トグルパネル */}
      <div
        className="no-print"
        style={{
          position: "absolute", top: 10, right: 12, zIndex: 1000,
          background: "rgba(255,255,255,0.97)",
          border: (show66kv || show154kv) ? "1.5px solid #0ea5e9" : "1.5px solid #cbd5e1",
          borderRadius: 10,
          padding: "8px 12px",
          boxShadow: "0 3px 12px rgba(0,0,0,0.18)",
          minWidth: 210,
        }}
      >
        <p style={{ fontSize: 11, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
          需要家向け順潮流マップ
        </p>

        {/* 電圧クラス選択 */}
        {([
          { label: "66kV", state: show66kv, set: setShow66kv },
          { label: "154kV", state: show154kv, set: setShow154kv },
        ] as const).map(({ label, state, set }) => (
          <button
            key={label}
            onClick={() => set(v => !v)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              background: state ? "#f0f9ff" : "none",
              border: state ? "1px solid #bae6fd" : "1px solid #e2e8f0",
              borderRadius: 7, cursor: "pointer", padding: "5px 8px", marginBottom: 5,
            }}
          >
            <span style={{ fontSize: 11, color: "#0f172a" }}>{label}</span>
            <span style={{
              fontSize: 10, fontWeight: 700,
              background: state ? "#0ea5e9" : "#e2e8f0",
              color: state ? "white" : "#64748b",
              borderRadius: 5, padding: "1px 7px",
            }}>
              {state ? "ON" : "OFF"}
            </span>
          </button>
        ))}

        {/* 透明度・凡例（いずれかON時に表示） */}
        {(show66kv || show154kv) && (
          <div style={{ marginTop: 6, borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: "#64748b", whiteSpace: "nowrap" }}>透明度</span>
              <input
                type="range" min={0.1} max={1} step={0.05}
                value={forwardFlowOpacity}
                onChange={e => setForwardFlowOpacity(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: "#0ea5e9" }}
              />
              <span style={{ fontSize: 10, color: "#64748b", width: 28, textAlign: "right" }}>
                {Math.round(forwardFlowOpacity * 100)}%
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <p style={{ fontSize: 9, color: "#9ca3af", marginBottom: 2 }}>空き容量【MW】</p>
              {[
                { color: "#60a5fa", label: "100MW以上" },
                { color: "#22d3ee", label: "75〜100MW" },
                { color: "#facc15", label: "50〜75MW" },
                { color: "#f97316", label: "〜50MW" },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 24, height: 5, background: color, borderRadius: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: "#374151" }}>{label}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 9, color: "#9ca3af", marginTop: 6 }}>
              ※ 東京電力PG 順潮流マップ参照
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

        {/* 順潮流マップ画像オーバーレイ（66kV 需要家向け） */}
        {show66kv && (
          <ImageOverlay
            url="/forward-flow-66kv.png"
            bounds={FORWARD_FLOW_BOUNDS}
            opacity={forwardFlowOpacity}
          />
        )}

        {/* 順潮流マップ画像オーバーレイ（154kV 需要家向け） */}
        {show154kv && (
          <ImageOverlay
            url="/forward-flow-154kv.png"
            bounds={FORWARD_FLOW_BOUNDS}
            opacity={forwardFlowOpacity}
          />
        )}


        {/* 系統データあり: パス1 = 白ケーシング */}
        {matchedLines.map(line => (
          <Polyline
            key={`casing-${line.id}`}
            positions={line.path.map(p => [p.lat, p.lng])}
            color="white"
            weight={casingWeight(line.voltageKv)}
            opacity={0.85}
            interactive={false}
          />
        ))}

        {/* 系統データあり: パス2 = 容量色の本線 */}
        {matchedLines.map(line => {
          const cap       = capByLineId.get(line.id);
          const demandCap = line.name ? lookupDemandCap(line.name) : undefined;
          const color     = lineColor(cap);
          return (
            <Polyline
              key={`line-${line.id}`}
              positions={line.path.map(p => [p.lat, p.lng])}
              color={color}
              weight={lineWeight(line.voltageKv)}
              opacity={0.95}
            >
              <Tooltip sticky opacity={0.97} direction="top">
                <div style={{ fontSize: 11, lineHeight: "1.7", minWidth: 180 }}>
                  <p style={{ fontWeight: 700, color: "#0f172a", marginBottom: 3, fontSize: 12 }}>
                    {line.name || "送電線"}
                  </p>
                  <p style={{ color: "#475569", marginBottom: 6 }}>{line.voltageKv} kV</p>

                  {/* 逆潮流（発電設備向け） */}
                  <div style={{ marginBottom: 4 }}>
                    <p style={{ fontSize: 9, color: "#94a3b8", marginBottom: 1 }}>逆潮流（発電設備向け）</p>
                    <p style={{
                      color: cap == null ? "#475569"
                        : cap === 0 ? "#ef4444"
                        : cap < 50 ? "#f97316"
                        : cap < 200 ? "#d97706"
                        : "#16a34a",
                      fontWeight: 700, fontSize: 13,
                    }}>
                      {cap == null ? "データなし" : `${cap} MW`}
                    </p>
                  </div>

                  {/* 順潮流（需要家向け） */}
                  <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 4 }}>
                    <p style={{ fontSize: 9, color: "#94a3b8", marginBottom: 1 }}>順潮流（需要家向け）</p>
                    <p style={{
                      color: !demandCap ? "#94a3b8"
                        : demandCap === "~50MW"    ? "#f97316"
                        : demandCap === "50~75MW"  ? "#eab308"
                        : demandCap === "75~100MW" ? "#22d3ee"
                        : "#60a5fa",
                      fontWeight: 700, fontSize: 13,
                    }}>
                      {demandCap ?? "—"}
                    </p>
                  </div>
                </div>
              </Tooltip>
            </Polyline>
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

        {/* 物件マーカー */}
        {properties.map(p => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={createPropertyIcon(p.priceMen)}
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

        <p style={{ color: "#9ca3af", fontSize: 9, marginTop: 8, paddingTop: 6, borderTop: "1px solid #e2e8f0" }}>
          東京電力PG / 2026年4月時点
        </p>
      </div>
    </div>
  );
}
