"use client";

/**
 * MapComponent - Leafletを使う実際のマップ実装
 * このコンポーネントはSSRを無効にしてdynamic importで読み込む必要がある
 */

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  useMap,
  useMapEvents,
  Tooltip,
} from "react-leaflet";
import type { IndividualFitSite, AuctionProperty } from "@/types";
import L from "leaflet";
import type { CandidateSite, AppState, AppAction } from "@/types";
import { MOCK_SUBSTATIONS, MOCK_TRANSMISSION_LINES } from "@/lib/mockData";
import gridCapacityAll from "@/data/grid_capacity_all.json";
import clsx from "clsx";

function googleEarthUrl(lat: number, lng: number) {
  return `https://earth.google.com/web/@${lat},${lng},0a,800d,35y,0h,60t,0r`;
}

// Leafletのデフォルトアイコン修正
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// スコアに応じたマーカー色
function getMarkerColor(score: number): string {
  if (score >= 80) return "#10b981"; // emerald
  if (score >= 65) return "#f59e0b"; // amber
  return "#ef4444"; // red
}

// カスタムDivIcon（スコア表示）
function createSiteIcon(site: CandidateSite, isHighlighted: boolean): L.DivIcon {
  const color = getMarkerColor(site.score);
  const size = isHighlighted ? 38 : 30;
  const border = isHighlighted ? "3px solid white" : "2px solid rgba(255,255,255,0.7)";

  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;
      height:${size}px;
      background:${color};
      border:${border};
      border-radius:50%;
      display:flex;
      align-items:center;
      justify-content:center;
      font-weight:700;
      font-size:${isHighlighted ? 12 : 10}px;
      color:white;
      box-shadow:0 2px 10px rgba(0,0,0,0.4)${isHighlighted ? ",0 0 0 4px rgba(255,255,255,0.2)" : ""};
      transition:all 0.2s;
      cursor:pointer;
    ">${site.score}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

// 変電所アイコン
function createSubstationIcon(voltageKv: number): L.DivIcon {
  const color = voltageKv >= 275 ? "#0ea5e9" : "#6366f1";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:18px;height:18px;
      background:${color};
      border:2px solid white;
      border-radius:3px;
      display:flex;align-items:center;justify-content:center;
      font-size:8px;color:white;font-weight:700;
      box-shadow:0 1px 4px rgba(0,0,0,0.5);
    ">⚡</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

/** 個別FIT設備の種別色（高彩度） */
function getIndividualFitColor(type: IndividualFitSite["t"]): string {
  if (type === "太陽光") return "#f97316";   // orange-500
  if (type === "風力")   return "#06b6d4";   // cyan-500
  if (type === "バイオマス") return "#22c55e"; // green-500
  if (type === "水力")   return "#3b82f6";   // blue-500
  return "#a855f7";                          // purple-500
}

// 検索でフォーカスされた変電所のパルスリングアイコン
function createSubstationFocusIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <style>
        @keyframes sub-focus-pulse {
          0%   { transform:translate(-50%,-50%) scale(1); opacity:0.9; }
          100% { transform:translate(-50%,-50%) scale(2.4); opacity:0; }
        }
      </style>
      <div style="position:relative;width:0;height:0;">
        <div style="
          position:absolute;left:0;top:0;
          width:52px;height:52px;
          transform:translate(-50%,-50%);
          border-radius:50%;
          border:3px solid #38bdf8;
          box-shadow:0 0 16px rgba(56,189,248,0.7);
          animation:sub-focus-pulse 1.6s ease-out infinite;
          pointer-events:none;
        "></div>
        <div style="
          position:absolute;left:0;top:0;
          width:34px;height:34px;
          transform:translate(-50%,-50%);
          border-radius:50%;
          border:2.5px solid #ffffff;
          background:rgba(56,189,248,0.25);
          box-shadow:0 0 10px rgba(56,189,248,0.9),inset 0 0 6px rgba(56,189,248,0.4);
          pointer-events:none;
        "></div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

// 住所検索ピンアイコン
function createAddressPinIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <style>
        @keyframes addr-ripple {
          0%   { transform:translate(-50%,-50%) scale(1);   opacity:0.55; }
          100% { transform:translate(-50%,-50%) scale(2.8); opacity:0; }
        }
      </style>
      <div style="position:relative;width:0;height:0;">
        <div style="position:absolute;left:0;top:0;width:60px;height:60px;transform:translate(-50%,-50%);border-radius:50%;background:rgba(16,185,129,0.18);animation:addr-ripple 2s ease-out infinite;pointer-events:none;"></div>
        <div style="position:absolute;left:0;top:0;width:40px;height:40px;transform:translate(-50%,-50%);background:linear-gradient(135deg,#10b981,#0ea5e9);border:3px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 4px 16px rgba(16,185,129,0.65);cursor:pointer;">📍</div>
      </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [0, -24],
  });
}

// オークション物件アイコン
function createAuctionIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:34px;height:34px;
      background:linear-gradient(135deg,#f97316,#ea580c);
      border:2px solid white;
      border-radius:6px;
      display:flex;align-items:center;justify-content:center;
      font-size:16px;
      box-shadow:0 2px 8px rgba(234,88,12,0.6);
      cursor:pointer;
    ">🏠</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -20],
  });
}

// 送電線パス全体から最寄変電所を最大N件返す（空き容量あり優先）
function nearestSubstationsToLine(
  path: { lat: number; lng: number }[],
  substations: import("@/types").Substation[],
  count = 2
): import("@/types").Substation[] {
  if (!path.length || !substations.length) return [];
  // 全パス点からの最小距離で変電所をスコアリング
  return [...substations]
    .map(s => {
      const minDist = Math.min(...path.map(p =>
        Math.hypot(s.coordinates.lat - p.lat, s.coordinates.lng - p.lng)
      ));
      return { s, d: minDist };
    })
    .sort((a, b) => {
      // 空き容量あり（>=0）を優先し、次に距離でソート
      const aHas = a.s.availableCapacityMw >= 0 ? 0 : 1;
      const bHas = b.s.availableCapacityMw >= 0 ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      return a.d - b.d;
    })
    .slice(0, count)
    .map(x => x.s);
}

// PDFから抽出した送電線別空き容量ルックアップ（全9県）
interface LineCapacity { voltageKv: number; availableMw: number | null; n1AvailableMw: number | null; area?: string }
type RawLine = { name: string | null; voltageKv: number; availableMw: number | null; n1AvailableMw: number | null };
type CapacityDataset = { area: string; lines: RawLine[] };

// 括弧内区間表記を除いた基本名（例: "群馬幹線（群馬～新岡部）" → "群馬幹線"）
function normalizeLineName(name: string): string {
  return name.replace(/[（(].*?[）)]/g, "").trim();
}

// 全データセットから一括でマップ構築
const LINE_CAPACITY_MAP: Map<string, LineCapacity> = new Map(
  (gridCapacityAll as CapacityDataset[]).flatMap(dataset =>
    dataset.lines
      .filter(l => l.name)
      .map(l => [
        l.name as string,
        { voltageKv: l.voltageKv, availableMw: l.availableMw, n1AvailableMw: l.n1AvailableMw, area: dataset.area },
      ] as [string, LineCapacity])
  )
);

function lookupLineCapacity(lineName: string): LineCapacity | undefined {
  // 完全一致
  if (LINE_CAPACITY_MAP.has(lineName)) return LINE_CAPACITY_MAP.get(lineName);
  // 正規化一致（括弧区間除去）
  const normalized = normalizeLineName(lineName);
  for (const [key, val] of LINE_CAPACITY_MAP) {
    if (normalizeLineName(key) === normalized) return val;
  }
  // 前方一致
  for (const [key, val] of LINE_CAPACITY_MAP) {
    if (key.startsWith(normalized) || normalized.startsWith(normalizeLineName(key))) return val;
  }
  return undefined;
}

// 系統空き容量の表示テキスト＋色
function capacityLabel(mw: number, status: string): { text: string; color: string } {
  if (mw < 0) return { text: "非公開（OCCTO未連携）", color: "#64748b" };
  if (mw === 0) return { text: `0 MW（${status}）`, color: "#ef4444" };
  if (mw < 10)  return { text: `${mw} MW（${status}）`, color: "#f97316" };
  if (mw < 50)  return { text: `${mw} MW（${status}）`, color: "#f59e0b" };
  return { text: `${mw} MW（${status}）`, color: "#10b981" };
}

// 送電線ツールチップの共通コンテンツ
function LineTooltipContent({ line, pdfCap, nearby }: {
  line: import("@/types").TransmissionLine;
  pdfCap: LineCapacity | undefined;
  nearby: import("@/types").Substation[];
}) {
  return (
    <div style={{ minWidth: 200, fontSize: 11, lineHeight: "1.7" }}>
      <p style={{ fontWeight: 700, color: "#38bdf8", fontSize: 13, marginBottom: 4 }}>
        {line.name || "送電線"}
      </p>
      <p style={{ color: "#94a3b8", marginBottom: 6 }}>
        {line.voltageKv} kV
      </p>
      {pdfCap ? (
        <div style={{ borderTop: "1px solid #334155", paddingTop: 4, marginBottom: 4 }}>
          <p style={{ color: "#64748b", fontSize: 10, marginBottom: 3 }}>
            系統空き容量（TEPG 2026/04/19{pdfCap.area ? ` / ${pdfCap.area}` : ""}）
          </p>
          {(() => {
            const mw = pdfCap.availableMw;
            const color = mw === null ? "#64748b" : mw === 0 ? "#ef4444" : mw < 50 ? "#f59e0b" : "#10b981";
            const label = mw === null ? "データなし" : `${mw} MW`;
            return (
              <p style={{ color, fontWeight: 700, fontSize: 12, margin: "2px 0" }}>
                空き容量: {label}
              </p>
            );
          })()}
          {pdfCap.n1AvailableMw !== null && (
            <p style={{ color: "#94a3b8", margin: "1px 0" }}>
              N-1後: {pdfCap.n1AvailableMw} MW
            </p>
          )}
        </div>
      ) : (
        nearby.length > 0 && (
          <>
            <p style={{ color: "#64748b", fontSize: 10, marginBottom: 3, borderTop: "1px solid #334155", paddingTop: 4 }}>
              近接変電所（系統空き容量）
            </p>
            {nearby.map(sub => {
              const { text, color } = capacityLabel(sub.availableCapacityMw, sub.capacityStatus);
              return (
                <div key={sub.id} style={{ marginBottom: 3 }}>
                  <span style={{ color: "#cbd5e1" }}>⚡ {sub.name}</span>
                  <span style={{ color: "#64748b" }}> {sub.voltageKv}kV</span>
                  <br />
                  <span style={{ color, fontWeight: 600 }}>空き容量: {text}</span>
                </div>
              );
            })}
          </>
        )
      )}
    </div>
  );
}

// 154kVライン：ズーム9以上で表示
function Lines154kVLayer({
  lines,
  substations,
}: {
  lines: import("@/types").TransmissionLine[];
  substations: import("@/types").Substation[];
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  if (zoom < 9) return null;
  return (
    <>
      {lines.map(line => {
        const pdfCap = line.name ? lookupLineCapacity(line.name) : undefined;
        const nearby = nearestSubstationsToLine(line.path, substations, 2);
        return (
          <Polyline
            key={line.id}
            positions={line.path.map(p => [p.lat, p.lng])}
            color="#6366f1"
            weight={1.5}
            opacity={0.6}
            dashArray="4 4"
          >
            <Tooltip sticky opacity={0.97} direction="top">
              <LineTooltipContent line={line} pdfCap={pdfCap} nearby={nearby} />
            </Tooltip>
          </Polyline>
        );
      })}
    </>
  );
}

// 66kVライン：ズーム10以上で表示（カーソルホバーで詳細表示）
// 佐波変電所・オークション物件付近は強調
const SAWA_LAT = 36.2921271;
const SAWA_LNG = 139.2198783;

function Lines66kVLayer({
  lines,
  substations,
  auctionCoords,
}: {
  lines: import("@/types").TransmissionLine[];
  substations: import("@/types").Substation[];
  auctionCoords: { lat: number; lng: number }[];
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  if (zoom < 10) return null;

  return (
    <>
      {lines.map(line => {
        const pdfCap = line.name ? lookupLineCapacity(line.name) : undefined;
        const nearby = nearestSubstationsToLine(line.path, substations, 2);
        // 佐波変電所から0.03度以内 = 直接接続線
        const isNearSawa = line.path.some(p =>
          Math.hypot(p.lat - SAWA_LAT, p.lng - SAWA_LNG) < 0.03
        );
        // オークション物件から0.05度以内
        const isNearAuction = !isNearSawa && auctionCoords.some(ac =>
          line.path.some(p => Math.hypot(p.lat - ac.lat, p.lng - ac.lng) < 0.05)
        );
        const color = isNearSawa ? "#f0abfc" : isNearAuction ? "#e879f9" : "#a78bfa";
        const weight = isNearSawa ? 3 : isNearAuction ? 2.5 : 1.5;
        const opacity = isNearSawa ? 0.95 : isNearAuction ? 0.85 : 0.55;
        return (
          <Polyline
            key={line.id}
            positions={line.path.map(p => [p.lat, p.lng])}
            color={color}
            weight={weight}
            opacity={opacity}
            dashArray="4 3"
          >
            <Tooltip sticky opacity={0.97} direction="top">
              <LineTooltipContent line={line} pdfCap={pdfCap} nearby={nearby} />
            </Tooltip>
          </Polyline>
        );
      })}
    </>
  );
}

// 個別FIT設備レイヤー：電圧クラス別ズーム閾値（特別高圧8+・高圧9+・低圧10+）
function FitIndividualLayer({
  sites,
  fitLineInfo,
}: {
  sites: IndividualFitSite[];
  fitLineInfo: Map<string, { dist: number; name: string }>;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  if (zoom < 8) return null;

  const visibleSites = sites.filter(s =>
    s.v === "特別高圧" ? zoom >= 8 :
    s.v === "高圧"     ? zoom >= 9 :
                         zoom >= 10
  );

  return (
    <>
      {visibleSites.map((s: IndividualFitSite) => {
        const radius = s.v === "特別高圧" ? 7 : s.v === "高圧" ? 5 : 3;
        const color = getIndividualFitColor(s.t);
        return (
        <CircleMarker
          key={s.id}
          center={[s.la, s.lg]}
          radius={radius}
          pathOptions={{
            color: "#ffffff",
            fillColor: color,
            fillOpacity: 0.88,
            weight: s.v === "特別高圧" ? 1.5 : 0.8,
            opacity: 0.9,
          }}
        >
          <Tooltip direction="top" offset={[0, -4]} opacity={0.97} sticky>
            <div style={{ fontSize: 11, minWidth: 160, lineHeight: "1.6" }}>
              <p style={{ fontWeight: 700, color: "#065f46", marginBottom: 3, fontSize: 12 }}>{s.t}</p>
              <p style={{ color: "#374151", margin: "1px 0" }}>出力: <strong style={{ color: "#111827" }}>{s.k.toLocaleString()} kW</strong></p>
              <p style={{ color: "#374151", margin: "1px 0" }}>区分: <strong style={{ color: "#111827" }}>{s.v}</strong></p>
              <p style={{ color: "#374151", margin: "1px 0" }}>運転開始: <strong style={{ color: "#111827" }}>{s.y}年</strong></p>
              <p style={{ color: "#374151", margin: "1px 0" }}>所在: <strong style={{ color: "#111827" }}>{s.m}</strong></p>
              {fitLineInfo.has(s.id) && (() => {
                const info = fitLineInfo.get(s.id)!;
                return (
                  <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 3, marginTop: 3 }}>
                    <p style={{ color: "#374151", margin: "1px 0" }}>
                      最寄送電線: <strong style={{ color: "#0369a1" }}>{info.dist.toFixed(1)} km</strong>
                    </p>
                    {info.name && (
                      <p style={{ color: "#6b7280", margin: "1px 0", fontSize: 10 }}>{info.name}</p>
                    )}
                  </div>
                );
              })()}
            </div>
          </Tooltip>
        </CircleMarker>
        );
      })}
    </>
  );
}

// マップ中心を変更するコンポーネント
function MapController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.2 });
  }, [map, center, zoom]);
  return null;
}

interface MapComponentProps {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

export default function MapComponent({ state, dispatch }: MapComponentProps) {
  const { candidates, highlightedSiteId, mapCenter, mapZoom, focusedSubstationId, focusedLineId, addressPin } = state;

  // 実データが取得できていればそちらを使用、なければモックにフォールバック
  const substations = state.realSubstations ?? MOCK_SUBSTATIONS;
  const transmissionLines = state.realTransmissionLines ?? MOCK_TRANSMISSION_LINES;
  const lines154plus = transmissionLines.filter(l => l.voltageKv >= 154);
  const lines66 = transmissionLines.filter(l => l.voltageKv < 154);
  const auctionCoords = state.auctionProperties.map(p => p.coordinates);

  // 検索フォーカス対象
  const focusedSub = focusedSubstationId ? substations.find(s => s.id === focusedSubstationId) : null;
  const focusedLine = focusedLineId ? transmissionLines.find(l => l.id === focusedLineId) : null;

  // ── 送電線中点（名前付き、近似距離計算用）────────────────────
  const lineMidpoints = useMemo(() =>
    transmissionLines.map(l => ({
      name: l.name ?? "",
      lat: l.path[Math.floor(l.path.length / 2)].lat,
      lng: l.path[Math.floor(l.path.length / 2)].lng,
    })),
    [transmissionLines]
  );

  // 個別FIT設備：送電線距離・名前を一括事前計算（データ変更時のみ再計算）
  const fitLineInfo = useMemo((): Map<string, { dist: number; name: string }> => {
    const m = new Map<string, { dist: number; name: string }>();
    if (lineMidpoints.length === 0) return m;
    for (const s of state.fitIndividualSites) {
      let minSq = Infinity, bestName = "";
      for (const mp of lineMidpoints) {
        const sq = (mp.lat - s.la) ** 2 + (mp.lng - s.lg) ** 2;
        if (sq < minSq) { minSq = sq; bestName = mp.name; }
      }
      m.set(s.id, { dist: Math.sqrt(minSq) * 111, name: bestName });
    }
    return m;
  }, [lineMidpoints, state.fitIndividualSites]);

  // オークション物件：全パス点で正確計算（件数少）
  const auctionLineInfo = useMemo((): Map<string, { dist: number; name: string }> => {
    const m = new Map<string, { dist: number; name: string }>();
    if (transmissionLines.length === 0) return m;
    for (const prop of state.auctionProperties) {
      let minSq = Infinity, bestName = "";
      for (const line of transmissionLines) {
        for (const pt of line.path) {
          const sq = (pt.lat - prop.coordinates.lat) ** 2 + (pt.lng - prop.coordinates.lng) ** 2;
          if (sq < minSq) { minSq = sq; bestName = line.name ?? ""; }
        }
      }
      m.set(prop.id, { dist: Math.sqrt(minSq) * 111, name: bestName });
    }
    return m;
  }, [transmissionLines, state.auctionProperties]);

  const handleSiteClick = useCallback(
    (site: CandidateSite) => {
      dispatch({ type: "SET_HIGHLIGHTED_SITE", payload: site.id });
      dispatch({
        type: "SET_MAP_CENTER",
        payload: { center: [site.coordinates.lat, site.coordinates.lng], zoom: 13 },
      });
    },
    [dispatch]
  );

  // 候補地がない場合は全候補地を薄く表示
  const displaySites =
    candidates.length > 0 ? candidates : [];

  return (
    <MapContainer
      center={mapCenter}
      zoom={mapZoom}
      style={{ width: "100%", height: "100%", background: "#0f172a" }}
      zoomControl={true}
    >
      {/* マップ中心制御 */}
      <MapController center={mapCenter} zoom={mapZoom} />

      {/* ベースタイル: OpenStreetMap */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        className="map-tiles"
      />

      {/* 275kV・500kV送電線：常時表示 */}
      {lines154plus.filter(l => l.voltageKv >= 275).map((line) => {
        const pdfCap = line.name ? lookupLineCapacity(line.name) : undefined;
        const nearby = nearestSubstationsToLine(line.path, substations, 2);
        return (
          <Polyline
            key={line.id}
            positions={line.path.map((p) => [p.lat, p.lng])}
            color={line.voltageKv >= 500 ? "#f59e0b" : "#0ea5e9"}
            weight={line.voltageKv >= 500 ? 3 : 2.5}
            opacity={0.65}
          >
            <Tooltip sticky opacity={0.97} direction="top">
              <LineTooltipContent line={line} pdfCap={pdfCap} nearby={nearby} />
            </Tooltip>
          </Polyline>
        );
      })}

      {/* 154kV送電線：ズーム9以上で表示 */}
      <Lines154kVLayer
        lines={lines154plus.filter(l => l.voltageKv === 154)}
        substations={substations}
      />

      {/* 66kV送電線：ズーム10以上、佐波変電所・オークション物件付近は強調 */}
      <Lines66kVLayer lines={lines66} substations={substations} auctionCoords={auctionCoords} />

      {/* 検索フォーカス：送電線ハイライト（最前面に太い輝線を重ねる） */}
      {focusedLine && (
        <>
          {/* 外側グロー */}
          <Polyline
            key={`focus-outer-${focusedLine.id}`}
            positions={focusedLine.path.map(p => [p.lat, p.lng])}
            color="#ffffff"
            weight={10}
            opacity={0.18}
          />
          {/* 内側輝線 */}
          <Polyline
            key={`focus-inner-${focusedLine.id}`}
            positions={focusedLine.path.map(p => [p.lat, p.lng])}
            color="#7dd3fc"
            weight={5}
            opacity={0.92}
          />
        </>
      )}

      {/* 検索フォーカス：変電所パルスリング */}
      {focusedSub && (
        <Marker
          key={`focus-sub-${focusedSub.id}`}
          position={[focusedSub.coordinates.lat, focusedSub.coordinates.lng]}
          icon={createSubstationFocusIcon()}
          zIndexOffset={2000}
        />
      )}

      {/* 変電所マーカー */}
      {substations.map((sub) => (
        <Marker
          key={sub.id}
          position={[sub.coordinates.lat, sub.coordinates.lng]}
          icon={createSubstationIcon(sub.voltageKv)}
        >
          <Popup>
            <div style={{ color: "#e2e8f0", minWidth: "160px" }}>
              <p style={{ fontWeight: 700, color: "#38bdf8", marginBottom: 4, fontSize: 13 }}>
                {sub.name}
              </p>
              <p style={{ fontSize: 11, color: "#94a3b8" }}>
                {sub.voltageKv} kV / {sub.capacityMva} MVA
              </p>
              <p style={{ fontSize: 11, color: "#94a3b8" }}>{sub.operator}</p>
            </div>
          </Popup>
        </Marker>
      ))}

      {/* 個別FIT設備レイヤー（ズーム10以上で表示） */}
      {state.fitIndividualVisible && (
        <FitIndividualLayer
          sites={state.fitIndividualSites}
          fitLineInfo={fitLineInfo}
        />
      )}

      {/* オークション物件マーカー */}
      {state.auctionVisible && state.auctionProperties.map((prop: AuctionProperty) => (
        <Marker
          key={prop.id}
          position={[prop.coordinates.lat, prop.coordinates.lng]}
          icon={createAuctionIcon()}
          zIndexOffset={500}
        >
          <Tooltip direction="top" offset={[0, -20]} opacity={0.97}>
            <div style={{ fontSize: 11, lineHeight: "1.65", minWidth: 190 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 16 }}>🏠</span>
                <span style={{ fontWeight: 700, color: "#fb923c", fontSize: 12 }}>公売物件</span>
                <span style={{ color: "#94a3b8", fontSize: 10 }}>{prop.saleNumber}</span>
              </div>
              <p style={{ color: "#f8fafc", fontWeight: 600, marginBottom: 4, fontSize: 11 }}>{prop.address}</p>
              <div style={{ borderTop: "1px solid #334155", paddingTop: 4, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px" }}>
                <span style={{ color: "#64748b" }}>面積</span>
                <span style={{ color: "#cbd5e1" }}>{prop.areaM2.toLocaleString()}㎡</span>
                <span style={{ color: "#64748b" }}>地目</span>
                <span style={{ color: "#cbd5e1" }}>{prop.landType}</span>
                {prop.nearestSubstation && (<>
                  <span style={{ color: "#64748b" }}>最寄変電所</span>
                  <span style={{ color: "#cbd5e1" }}>{prop.nearestSubstation.name} ({prop.nearestSubstation.distance}km)</span>
                </>)}
                {auctionLineInfo.has(prop.id) && (() => {
                  const info = auctionLineInfo.get(prop.id)!;
                  return (<>
                    <span style={{ color: "#64748b" }}>最寄送電線</span>
                    <span style={{ color: "#7dd3fc", fontWeight: 600 }}>{info.dist.toFixed(1)} km{info.name ? ` — ${info.name}` : ""}</span>
                  </>);
                })()}
              </div>
            </div>
          </Tooltip>

          <Popup>
            <div style={{ color: "#e2e8f0", minWidth: "240px", maxWidth: "280px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>🏠</span>
                <div>
                  <p style={{ fontWeight: 700, color: "#fb923c", fontSize: 13, margin: 0 }}>公売物件</p>
                  <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>{prop.saleNumber}</p>
                </div>
              </div>
              <p style={{ fontWeight: 600, color: "#f8fafc", fontSize: 12, marginBottom: 8 }}>{prop.address}</p>
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <tbody>
                  {[
                    ["面積", `${prop.areaM2.toLocaleString()}㎡（${prop.areaHa}ha）`],
                    ["地目", prop.landType],
                    ["見積価額", `¥${prop.estimatedPrice.toLocaleString()}`],
                    ["保証金", `¥${prop.depositAmount.toLocaleString()}`],
                    ["都市計画", prop.zoningType],
                    ["用途地域", prop.zoningUse],
                    ["建ぺい率", `${prop.buildingCoverage}%`],
                    ["形状", prop.shape],
                    ["地勢", prop.topography],
                    ["上水道", prop.waterSupply ? "あり" : "なし"],
                    ["下水道", prop.sewer ? "あり" : "なし"],
                    ...(prop.nearestSubstation ? [
                      ["最寄変電所", prop.nearestSubstation.name],
                      ["変電所距離", `${prop.nearestSubstation.distance}km (${prop.nearestSubstation.voltageKv}kV)`],
                    ] : []),
                    ...(auctionLineInfo.has(prop.id) ? (() => {
                      const info = auctionLineInfo.get(prop.id)!;
                      return [["最寄送電線", `${info.dist.toFixed(1)} km${info.name ? ` — ${info.name}` : ""}`]];
                    })() : []),
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td style={{ color: "#64748b", paddingRight: 8, paddingBottom: 3, whiteSpace: "nowrap" }}>{label}</td>
                      <td style={{ color: label === "最寄送電線" ? "#7dd3fc" : "#cbd5e1", paddingBottom: 3, fontWeight: label === "最寄送電線" ? 600 : 400 }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {prop.notes && (
                <p style={{ fontSize: 10, color: "#f59e0b", marginTop: 6, borderTop: "1px solid #334155", paddingTop: 6, lineHeight: "1.5" }}>
                  ⚠ {prop.notes}
                </p>
              )}
              <p style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>{prop.contact}</p>
              <a
                href={`https://earth.google.com/web/@${prop.coordinates.lat},${prop.coordinates.lng},0a,500d,35y,0h,60t,0r`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: "block", marginTop: 8, padding: "6px 10px", background: "#ea580c", borderRadius: 8, color: "white", fontSize: 11, fontWeight: 600, textDecoration: "none", textAlign: "center" }}
              >
                🌍 Google Earthで現地確認
              </a>
            </div>
          </Popup>
        </Marker>
      ))}

      {/* 候補地マーカー */}
      {displaySites.map((site) => {
        const isHighlighted = highlightedSiteId === site.id;
        const isSelected = state.selectedForComparison.includes(site.id);

        return (
          <Marker
            key={site.id}
            position={[site.coordinates.lat, site.coordinates.lng]}
            icon={createSiteIcon(site, isHighlighted)}
            zIndexOffset={isHighlighted ? 1000 : 0}
            eventHandlers={{
              click: () => handleSiteClick(site),
              mouseover: () => dispatch({ type: "SET_HIGHLIGHTED_SITE", payload: site.id }),
              mouseout: () => dispatch({ type: "SET_HIGHLIGHTED_SITE", payload: null }),
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -18]}
              opacity={0.97}
              permanent={false}
            >
              <div style={{ fontSize: 11, lineHeight: "1.65", minWidth: 180 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: "#f8fafc", fontSize: 12 }}>{site.name}</span>
                  <span style={{ fontWeight: 800, fontSize: 15, color: getMarkerColor(site.score), marginLeft: 8 }}>{site.score}</span>
                </div>
                <p style={{ color: "#64748b", fontSize: 10, marginBottom: 4 }}>{site.prefecture} {site.municipality}</p>
                <div style={{ borderTop: "1px solid #334155", paddingTop: 4, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px" }}>
                  <span style={{ color: "#64748b" }}>変電所</span>
                  <span style={{ color: "#cbd5e1" }}>{site.nearestSubstation.name}</span>
                  <span style={{ color: "#64748b" }}>変電所距離</span>
                  <span style={{ color: "#cbd5e1" }}>{site.nearestSubstation.distance.toFixed(1)} km / {site.nearestSubstation.voltageKv} kV</span>
                  <span style={{ color: "#64748b" }}>最寄送電線</span>
                  <span style={{ color: "#7dd3fc", fontWeight: 600 }}>{site.gridDistance.toFixed(1)} km</span>
                  <span style={{ color: "#64748b" }}>土地利用</span>
                  <span style={{ color: "#cbd5e1" }}>{site.landUse}</span>
                  <span style={{ color: "#64748b" }}>面積</span>
                  <span style={{ color: "#cbd5e1" }}>{site.area} ha</span>
                </div>
              </div>
            </Tooltip>

            <Popup>
              <div style={{ color: "#e2e8f0", minWidth: "220px", maxWidth: "260px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <p style={{ fontWeight: 700, color: "#f8fafc", fontSize: 13 }}>{site.name}</p>
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: getMarkerColor(site.score),
                      marginLeft: 8,
                    }}
                  >
                    {site.score}
                  </span>
                </div>

                <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
                  {site.prefecture} {site.municipality}
                </p>

                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <tbody>
                    {[
                      ["面積", `${site.area} ha`, null],
                      ["傾斜", `${site.slope}°`, null],
                      ["標高", `${site.elevation} m`, null],
                      ["土地利用", site.landUse, null],
                      ["変電所", `${site.nearestSubstation.name}`, null],
                      ["変電所距離", `${site.nearestSubstation.distance.toFixed(1)} km`, null],
                      ["電圧", `${site.nearestSubstation.voltageKv} kV`, null],
                      [
                        "系統空き",
                        site.nearestSubstation.availableCapacityMw < 0
                          ? "非公開（OCCTO未連携）"
                          : `${site.nearestSubstation.availableCapacityMw} MW (${site.nearestSubstation.capacityStatus})`,
                        site.nearestSubstation.availableCapacityMw >= 50 ? "#10b981"
                          : site.nearestSubstation.availableCapacityMw >= 10 ? "#f59e0b"
                          : site.nearestSubstation.availableCapacityMw > 0 ? "#ef4444"
                          : "#64748b",
                      ],
                      ["最寄送電線", `${site.gridDistance.toFixed(1)} km`, "#7dd3fc"],
                    ].map(([label, value, color]) => (
                      <tr key={label as string}>
                        <td
                          style={{
                            color: "#64748b",
                            paddingRight: 8,
                            paddingBottom: 3,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </td>
                        <td style={{ color: (color as string | null) ?? "#cbd5e1", paddingBottom: 3, fontWeight: color ? 600 : 400 }}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {site.regulations.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <p style={{ fontSize: 10, color: "#ef4444", marginBottom: 2 }}>規制:</p>
                    {site.regulations.map((r, i) => (
                      <p key={i} style={{ fontSize: 10, color: "#fca5a5" }}>
                        • {r}
                      </p>
                    ))}
                  </div>
                )}

                {site.notes && (
                  <p
                    style={{
                      fontSize: 10,
                      color: "#94a3b8",
                      marginTop: 6,
                      borderTop: "1px solid #334155",
                      paddingTop: 6,
                    }}
                  >
                    {site.notes}
                  </p>
                )}

                {/* ボタン群 */}
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* Google Earth ボタン */}
                  <a
                    href={googleEarthUrl(site.coordinates.lat, site.coordinates.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      background: "#059669",
                      border: "none",
                      borderRadius: 8,
                      color: "white",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      textDecoration: "none",
                    }}
                  >
                    🌍 Google Earthで現地確認
                  </a>

                  {/* 比較チェック */}
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    onClick={() => dispatch({ type: "TOGGLE_COMPARISON_SELECT", payload: site.id })}
                  >
                    <input type="checkbox" checked={isSelected} readOnly style={{ accentColor: "#8b5cf6" }} />
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>比較に追加</span>
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
      {/* 住所検索ピン */}
      {addressPin && (
        <Marker
          position={[addressPin.lat, addressPin.lng]}
          icon={createAddressPinIcon()}
          zIndexOffset={3000}
        >
          <Popup>
            <div style={{ color: "#e2e8f0", minWidth: "180px" }}>
              <p style={{ fontWeight: 700, color: "#10b981", fontSize: 13, marginBottom: 6 }}>📍 {addressPin.label}</p>
              <p style={{ fontSize: 11, color: "#94a3b8" }}>{addressPin.lat.toFixed(6)}, {addressPin.lng.toFixed(6)}</p>
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
