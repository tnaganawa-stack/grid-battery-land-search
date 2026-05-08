"use client";

import { useState, useMemo, useCallback, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Download, Copy, Check, Zap, Filter, ChevronUp, ChevronDown, ExternalLink, Map, TableProperties, Printer } from "lucide-react";
import clsx from "clsx";
import gridCapacityAll from "@/data/grid_capacity_all.json";

import type { CapacityMapViewProps } from "./CapacityMapView";

const CapacityMapView = dynamic<CapacityMapViewProps>(() => import("./CapacityMapView"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-slate-950">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-amber-500/60 border-t-amber-400 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-[12px] text-slate-500">地図を読み込み中...</p>
      </div>
    </div>
  ),
});

// ─── 型定義 ──────────────────────────────────────────────────
type CapLine = {
  no: number;
  name: string;
  voltageKv: number;
  availableMw: number | null;
  n1AvailableMw: number | null;
};
type CapDataset = { source: string; date: string; area: string; lines: CapLine[] };

const DATASETS = gridCapacityAll as CapDataset[];

// ─── ユーティリティ ──────────────────────────────────────────
function capColor(mw: number | null): string {
  if (mw === null) return "text-slate-500";
  if (mw === 0)    return "text-rose-400 font-semibold";
  if (mw < 50)     return "text-amber-400 font-semibold";
  return "text-emerald-400 font-semibold";
}
function capBg(mw: number | null): string {
  if (mw === null) return "";
  if (mw === 0)    return "bg-rose-500/8";
  if (mw < 50)     return "bg-amber-500/8";
  return "bg-emerald-500/8";
}
function capLabel(mw: number | null): string {
  if (mw === null) return "—";
  return `${mw.toLocaleString()} MW`;
}
function voltColor(kv: number): string {
  if (kv >= 500) return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  if (kv >= 275) return "bg-sky-500/20 text-sky-300 border-sky-500/40";
  if (kv >= 154) return "bg-indigo-500/20 text-indigo-300 border-indigo-500/40";
  return "bg-violet-500/20 text-violet-300 border-violet-500/40";
}

type SortKey = "no" | "name" | "voltageKv" | "availableMw" | "n1AvailableMw";
type SortDir = "asc" | "desc";

// ─── Excel エクスポート ───────────────────────────────────────
function exportExcel(datasets: CapDataset[], filtered: boolean) {
  import("xlsx").then((XLSX) => {
    const wb = XLSX.utils.book_new();
    for (const ds of datasets) {
      const headers = ["No.", "送電線名", "電圧(kV)", "空き容量(MW)", "N-1後空き容量(MW)"];
      const rows = ds.lines.map(l => [
        l.no, l.name, l.voltageKv,
        l.availableMw ?? "データなし",
        l.n1AvailableMw ?? "データなし",
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws["!cols"] = [{ wch: 6 }, { wch: 36 }, { wch: 10 }, { wch: 14 }, { wch: 16 }];
      // 安全なシート名（31文字以内、特殊文字除去）
      const sheetName = ds.area.replace(/[（）()\/\\?*\[\]]/g, "").slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `系統空き容量_${filtered ? "フィルター済_" : "全データ_"}${date}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ─── テーブルコンポーネント ──────────────────────────────────
function CapacityTable({
  lines,
  sortKey,
  sortDir,
  onSort,
}: {
  lines: CapLine[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const headers: { key: SortKey; label: string; align?: string }[] = [
    { key: "no",          label: "No.",          align: "text-right" },
    { key: "name",        label: "送電線名" },
    { key: "voltageKv",   label: "電圧(kV)",     align: "text-right" },
    { key: "availableMw", label: "空き容量(MW)",  align: "text-right" },
    { key: "n1AvailableMw", label: "N-1後(MW)",  align: "text-right" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="border-b border-slate-700/60">
            {headers.map(h => (
              <th
                key={h.key}
                onClick={() => onSort(h.key)}
                className={clsx(
                  "px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors select-none whitespace-nowrap",
                  h.align
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {h.label}
                  {sortKey === h.key && (
                    sortDir === "asc"
                      ? <ChevronUp size={10} className="text-sky-400" />
                      : <ChevronDown size={10} className="text-sky-400" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr
              key={`${line.no}-${line.name}`}
              className={clsx(
                "border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors",
                capBg(line.availableMw)
              )}
            >
              <td className="px-3 py-1.5 text-right text-slate-600">{line.no}</td>
              <td className="px-3 py-1.5 text-slate-200 font-medium max-w-[280px]">
                <span className="truncate block" title={line.name}>{line.name}</span>
              </td>
              <td className="px-3 py-1.5 text-right">
                <span className={clsx("text-[10px] font-semibold px-1.5 py-0.5 rounded border", voltColor(line.voltageKv))}>
                  {line.voltageKv}kV
                </span>
              </td>
              <td className={clsx("px-3 py-1.5 text-right tabular-nums", capColor(line.availableMw))}>
                {capLabel(line.availableMw)}
              </td>
              <td className={clsx("px-3 py-1.5 text-right tabular-nums", capColor(line.n1AvailableMw))}>
                {capLabel(line.n1AvailableMw)}
              </td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-slate-600 text-[11px]">
                条件に一致する送電線がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── サマリーバッジ ───────────────────────────────────────────
function DatasetSummary({ lines }: { lines: CapLine[] }) {
  const total = lines.length;
  const withCap = lines.filter(l => (l.availableMw ?? 0) > 0).length;
  const totalMw = lines.reduce((s, l) => s + (l.availableMw ?? 0), 0);
  const maxMw = Math.max(...lines.map(l => l.availableMw ?? 0));
  return (
    <div className="flex flex-wrap gap-3 text-[11px]">
      <span className="text-slate-500">合計 <strong className="text-slate-300">{total}</strong> 回線</span>
      <span className="text-slate-500">空き容量あり <strong className="text-emerald-400">{withCap}</strong> 回線</span>
      <span className="text-slate-500">合計 <strong className="text-emerald-400">{totalMw.toLocaleString()} MW</strong></span>
      <span className="text-slate-500">最大 <strong className="text-emerald-400">{maxMw.toLocaleString()} MW</strong></span>
    </div>
  );
}

// ─── メインコンテンツ（searchParams使用） ────────────────────
function CapacityContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialArea  = searchParams.get("area") ?? "all";
  const initialKv    = searchParams.get("kv")   ?? "all";
  const initialAvail = searchParams.get("avail") === "1";
  const initialView  = searchParams.get("v") === "map" ? "map" : "table";

  const [selectedArea, setSelectedArea] = useState(initialArea);
  const [kvFilter, setKvFilter]         = useState(initialKv);
  const [availOnly, setAvailOnly]       = useState(initialAvail);
  const [sortKey, setSortKey]           = useState<SortKey>("no");
  const [sortDir, setSortDir]           = useState<SortDir>("asc");
  const [copied, setCopied]             = useState(false);
  const [viewMode, setViewMode]         = useState<"table" | "map">(initialView);
  const [fitTrigger, setFitTrigger]     = useState(0);
  const [printing, setPrinting]         = useState(false);

  // URL 同期
  useEffect(() => {
    const p = new URLSearchParams();
    if (selectedArea !== "all") p.set("area", selectedArea);
    if (kvFilter !== "all") p.set("kv", kvFilter);
    if (availOnly) p.set("avail", "1");
    if (viewMode !== "table") p.set("v", viewMode);
    const qs = p.toString();
    router.replace(qs ? `?${qs}` : "/capacity", { scroll: false });
  }, [selectedArea, kvFilter, availOnly, viewMode, router]);

  const handleSort = useCallback((key: SortKey) => {
    setSortDir(d => sortKey === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKey(key);
  }, [sortKey]);

  // フィルター済みデータセット
  const filteredDatasets = useMemo(() => {
    return DATASETS
      .filter(ds => selectedArea === "all" || ds.area === selectedArea)
      .map(ds => {
        let lines = [...ds.lines];
        if (kvFilter !== "all") lines = lines.filter(l => String(l.voltageKv) === kvFilter);
        if (availOnly) lines = lines.filter(l => (l.availableMw ?? 0) > 0);
        // ソート
        lines.sort((a, b) => {
          const av = a[sortKey] ?? -Infinity;
          const bv = b[sortKey] ?? -Infinity;
          const cmp = typeof av === "string"
            ? av.localeCompare(bv as string, "ja")
            : (av as number) - (bv as number);
          return sortDir === "asc" ? cmp : -cmp;
        });
        return { ...ds, lines };
      })
      .filter(ds => ds.lines.length > 0 || selectedArea === ds.area);
  }, [selectedArea, kvFilter, availOnly, sortKey, sortDir]);

  // 全体サマリー
  const allLines = useMemo(() => filteredDatasets.flatMap(d => d.lines), [filteredDatasets]);
  const globalWithCap = allLines.filter(l => (l.availableMw ?? 0) > 0).length;
  const globalTotalMw = allLines.reduce((s, l) => s + (l.availableMw ?? 0), 0);

  const kvOptions = useMemo(() => {
    const kvs = new Set(DATASETS.flatMap(d => d.lines.map(l => l.voltageKv)));
    return Array.from(kvs).sort((a, b) => b - a);
  }, []);

  function copyUrl() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isFiltered = selectedArea !== "all" || kvFilter !== "all" || availOnly;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* 印刷CSS */}
      <style dangerouslySetInnerHTML={{ __html: `
        @page { margin: 0; }
        @media print {
          .no-print { display: none !important; }
          html, body { margin: 0; padding: 0; width: 100%; overflow: hidden; }
          .leaflet-control-zoom { display: none; }
          /* タイル画像・SVGポリライン・マーカーの色を忠実に印刷 */
          .leaflet-layer,
          .leaflet-overlay-pane svg,
          .leaflet-marker-pane,
          .leaflet-pane,
          .leaflet-tile-container img {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* 印刷時にページ幅を超えてはみ出さないようにする */
          .cap-map-wrapper {
            width: 100vw !important;
            height: 100vh !important;
            overflow: hidden !important;
          }
        }
      ` }} />

      {/* ヘッダー */}
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 no-print">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow">
              <Zap size={13} className="text-white" />
            </div>
            <div>
              <p className="text-[13px] font-bold text-white leading-tight">系統空き容量マップ</p>
              <p className="text-[9px] text-slate-500">東京電力パワーグリッド / 2026-04-19 時点</p>
            </div>
          </div>

          {/* 表示切替 */}
          <div className="flex gap-0.5 p-1 bg-slate-800 rounded-lg border border-slate-700/60 flex-shrink-0">
            <button
              onClick={() => setViewMode("table")}
              className={clsx(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-all",
                viewMode === "table" ? "bg-slate-600 text-white shadow" : "text-slate-500 hover:text-slate-300"
              )}
            >
              <TableProperties size={10} /> テーブル
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={clsx(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-all",
                viewMode === "map" ? "bg-amber-500/25 text-amber-300 shadow" : "text-slate-500 hover:text-slate-300"
              )}
            >
              <Map size={10} /> 地図
            </button>
          </div>

          {/* 県タブ（トグル隣） */}
          <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0" style={{ scrollbarWidth: "none" }}>
            <button
              onClick={() => setSelectedArea("all")}
              className={clsx(
                "px-2 py-1 rounded-md text-[10px] font-medium border transition-all whitespace-nowrap flex-shrink-0",
                selectedArea === "all"
                  ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                  : "bg-slate-800/50 border-slate-700/50 text-slate-500 hover:text-slate-300"
              )}
            >
              全県
            </button>
            {DATASETS.map(ds => (
              <button
                key={ds.area}
                onClick={() => setSelectedArea(selectedArea === ds.area ? "all" : ds.area)}
                className={clsx(
                  "px-2 py-1 rounded-md text-[10px] font-medium border transition-all whitespace-nowrap flex-shrink-0",
                  selectedArea === ds.area
                    ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                    : "bg-slate-800/50 border-slate-700/50 text-slate-500 hover:text-slate-300"
                )}
              >
                {ds.area.replace(/関東北部（|）/g, "").replace(/[県都]$/, "")}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {/* グローバルサマリー（テーブルモードのみ） */}
            {viewMode === "table" && (
              <div className="hidden sm:flex items-center gap-3 text-[11px] px-3 py-1 bg-slate-900 rounded-lg border border-slate-800">
                <span className="text-slate-500">表示中 <strong className="text-slate-200">{allLines.length}</strong> 回線</span>
                <span className="text-slate-700">|</span>
                <span className="text-slate-500">空きあり <strong className="text-emerald-400">{globalWithCap}</strong></span>
                <span className="text-slate-700">|</span>
                <span className="text-slate-500">合計 <strong className="text-emerald-400">{globalTotalMw.toLocaleString()} MW</strong></span>
              </div>
            )}

            {viewMode === "map" && (
              <button
                onClick={async () => {
                  setPrinting(true);
                  // Step1: 画面サイズで fitBounds → OSMタイルをキャッシュに乗せる
                  setFitTrigger(t => t + 1);
                  // Step2: タイルロード完了を待つ（CDN往復 + レンダリング余裕）
                  await new Promise(r => setTimeout(r, 2500));
                  // Step3: 印刷（matchMedia ハンドラが用紙サイズで再フィット）
                  window.print();
                  setPrinting(false);
                }}
                disabled={printing}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 text-white text-[11px] font-medium rounded-lg transition-all",
                  printing ? "bg-violet-700/40 cursor-wait" : "bg-violet-700/80 hover:bg-violet-600"
                )}
              >
                <Printer size={12} />
                {printing ? "準備中..." : "PDF印刷"}
              </button>
            )}

            {viewMode === "table" && (
              <button
                onClick={() => exportExcel(filteredDatasets, isFiltered)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700/80 hover:bg-emerald-600 text-white text-[11px] font-medium rounded-lg transition-all"
              >
                <Download size={12} />
                Excel出力
              </button>
            )}

            <button
              onClick={copyUrl}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all border",
                copied
                  ? "bg-sky-500/15 border-sky-500/50 text-sky-300"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
              )}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "コピー済み" : "URLをコピー"}
            </button>

            <a
              href="/"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-[11px] rounded-lg transition-all"
            >
              <ExternalLink size={11} />
              メインマップ
            </a>
          </div>
        </div>
      </header>

      {/* フィルターバー（テーブルモードのみ・電圧+空き容量） */}
      {viewMode === "table" && (
      <div className="sticky top-[57px] z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800/70 no-print">
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-2 flex-wrap">
          <Filter size={11} className="text-slate-600 flex-shrink-0" />

          {/* 電圧フィルター */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setKvFilter("all")}
              className={clsx(
                "px-2 py-0.5 rounded text-[10px] border transition-all",
                kvFilter === "all"
                  ? "bg-slate-600/40 border-slate-500 text-slate-200"
                  : "border-slate-700 text-slate-600 hover:text-slate-400"
              )}
            >
              全kV
            </button>
            {kvOptions.map(kv => (
              <button
                key={kv}
                onClick={() => setKvFilter(kvFilter === String(kv) ? "all" : String(kv))}
                className={clsx(
                  "px-2 py-0.5 rounded text-[10px] border transition-all",
                  kvFilter === String(kv)
                    ? clsx("font-semibold", voltColor(kv))
                    : "border-slate-700 text-slate-600 hover:text-slate-400"
                )}
              >
                {kv}kV
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-slate-700 mx-1" />

          {/* 空き容量あり Only */}
          <button
            onClick={() => setAvailOnly(v => !v)}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border transition-all",
              availOnly
                ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                : "bg-slate-800/50 border-slate-700/50 text-slate-500 hover:text-slate-300"
            )}
          >
            <span className={clsx("w-1.5 h-1.5 rounded-full", availOnly ? "bg-emerald-400" : "bg-slate-600")} />
            空き容量あり
          </button>
        </div>
      </div>
      )}

      {/* 地図ビュー */}
      {viewMode === "map" && (
        <div className="cap-map-wrapper" style={{ height: "calc(100vh - 58px)" }}>
          <CapacityMapView selectedArea={selectedArea} fitTrigger={fitTrigger} />
        </div>
      )}

      {/* テーブルビュー */}
      {viewMode === "table" && (
        <>
          <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
            {filteredDatasets.map(ds => (
              <section key={ds.area} className="bg-slate-900/60 border border-slate-800/70 rounded-2xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-800/70 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-5 rounded-full bg-gradient-to-b from-amber-400 to-orange-500" />
                    <div>
                      <h2 className="text-[14px] font-bold text-slate-100">{ds.area}</h2>
                      <p className="text-[10px] text-slate-600">{ds.source} · {ds.date}</p>
                    </div>
                  </div>
                  <DatasetSummary lines={ds.lines} />
                </div>
                <CapacityTable
                  lines={ds.lines}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
              </section>
            ))}
            {filteredDatasets.length === 0 && (
              <div className="text-center py-20 text-slate-600">
                <Zap size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-[13px]">条件に一致するデータがありません</p>
              </div>
            )}
          </main>
          <footer className="max-w-7xl mx-auto px-4 py-6 border-t border-slate-800/50 text-[10px] text-slate-700 text-center">
            出典: 東京電力パワーグリッド株式会社 系統空き容量マッピング（2026年4月19日時点）
          </footer>
        </>
      )}
    </div>
  );
}

// ─── ページエントリー（Suspenseで包む） ─────────────────────
export default function CapacityPage() {
  return (
    <Suspense>
      <CapacityContent />
    </Suspense>
  );
}
