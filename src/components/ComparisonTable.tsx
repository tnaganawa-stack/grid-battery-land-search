"use client";

import { X, Download, TrendingUp, MapPin, Zap, Mountain, DollarSign, FileText, Star } from "lucide-react";
import type { CandidateSite } from "@/types";
import clsx from "clsx";

interface ComparisonTableProps {
  sites: CandidateSite[];
  onClose: () => void;
  onRemoveSite: (id: string) => void;
}

function Cell({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <td
      className={clsx(
        "px-3 py-2 text-xs border-r border-slate-700/50 last:border-r-0",
        highlight ? "bg-emerald-500/10 text-emerald-300" : "text-slate-300"
      )}
    >
      {children}
    </td>
  );
}

function HeaderCell({ site, onRemove }: { site: CandidateSite; onRemove: () => void }) {
  const color =
    site.score >= 80
      ? "border-emerald-500/50 bg-emerald-500/5"
      : site.score >= 65
      ? "border-amber-500/50 bg-amber-500/5"
      : "border-slate-600 bg-slate-800";

  return (
    <th
      className={clsx(
        "px-3 py-2 text-left border-r border-slate-700/50 last:border-r-0 border-b-2 min-w-[160px]",
        color
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div>
          <p className="text-xs font-semibold text-white leading-tight">{site.name}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {site.prefecture} {site.municipality}
          </p>
        </div>
        <button
          onClick={onRemove}
          className="text-slate-500 hover:text-rose-400 transition-colors mt-0.5 flex-shrink-0"
        >
          <X size={12} />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div
          className={clsx(
            "text-xl font-bold",
            site.score >= 80
              ? "text-emerald-400"
              : site.score >= 65
              ? "text-amber-400"
              : "text-rose-400"
          )}
        >
          {site.score}
        </div>
        <div className="text-[10px] text-slate-500">/ 100点</div>
      </div>
    </th>
  );
}

function ScoreMini({ value, max = 20 }: { value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color =
    pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={clsx("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] w-4 text-right">{value}</span>
    </div>
  );
}

function exportCSV(sites: CandidateSite[]) {
  const headers = [
    "名称", "都道府県", "市区町村", "総合スコア",
    "面積(ha)", "傾斜(度)", "標高(m)",
    "土地利用", "最寄変電所", "変電所距離(km)", "変電所電圧(kV)",
    "規制", "概算工事費(百万円)"
  ];

  const rows = sites.map((s) => [
    s.name, s.prefecture, s.municipality, s.score,
    s.area, s.slope, s.elevation,
    s.landUse,
    s.nearestSubstation.name,
    s.nearestSubstation.distance,
    s.nearestSubstation.voltageKv,
    s.regulations.join(" / "),
    s.estimatedConstructionCost ?? "未試算"
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell}"`).join(","))
    .join("\n");

  const bom = "\uFEFF"; // UTF-8 BOM for Excel
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "battery_site_candidates.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function ComparisonTable({ sites, onClose, onRemoveSite }: ComparisonTableProps) {
  if (sites.length === 0) return null;

  // 各指標のベスト値を計算
  const bestScore = Math.max(...sites.map((s) => s.score));
  const bestSubDist = Math.min(...sites.map((s) => s.nearestSubstation.distance));
  const bestSlope = Math.min(...sites.map((s) => s.slope));
  const bestArea = Math.max(...sites.map((s) => s.area));
  const bestCost = Math.min(...sites.map((s) => s.estimatedConstructionCost ?? 9999));

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center pb-0 pointer-events-none">
      <div
        className="w-full max-h-[55vh] bg-slate-900 border-t border-slate-700 shadow-2xl pointer-events-auto overflow-hidden flex flex-col"
        style={{ borderTopLeftRadius: "12px", borderTopRightRadius: "12px" }}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-sky-400" />
            <span className="text-sm font-semibold text-white">
              候補地 比較表（{sites.length}件）
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCSV(sites)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-md transition-colors"
            >
              <Download size={12} />
              CSV出力
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* テーブル */}
        <div className="overflow-auto flex-1">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-900">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] text-slate-500 uppercase tracking-wider border-r border-slate-700/50 w-28 bg-slate-900">
                  指標
                </th>
                {sites.map((s) => (
                  <HeaderCell
                    key={s.id}
                    site={s}
                    onRemove={() => onRemoveSite(s.id)}
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {/* 場所 */}
              <tr className="hover:bg-slate-800/30">
                <td className="px-3 py-2 text-[10px] text-slate-500 border-r border-slate-700/50 flex items-center gap-1">
                  <MapPin size={10} /> 所在地
                </td>
                {sites.map((s) => (
                  <Cell key={s.id}>
                    {s.prefecture}<br />{s.municipality}
                  </Cell>
                ))}
              </tr>

              {/* 面積 */}
              <tr className="hover:bg-slate-800/30">
                <td className="px-3 py-2 text-[10px] text-slate-500 border-r border-slate-700/50">
                  <Mountain size={10} className="inline mr-1" />面積
                </td>
                {sites.map((s) => (
                  <Cell key={s.id} highlight={s.area === bestArea}>
                    {s.area} ha
                    {s.area === bestArea && (
                      <Star size={10} className="inline ml-1 text-emerald-400" />
                    )}
                  </Cell>
                ))}
              </tr>

              {/* 傾斜 */}
              <tr className="hover:bg-slate-800/30">
                <td className="px-3 py-2 text-[10px] text-slate-500 border-r border-slate-700/50">
                  傾斜
                </td>
                {sites.map((s) => (
                  <Cell key={s.id} highlight={s.slope === bestSlope}>
                    {s.slope}°
                    {s.slope === bestSlope && (
                      <Star size={10} className="inline ml-1 text-emerald-400" />
                    )}
                  </Cell>
                ))}
              </tr>

              {/* 標高 */}
              <tr className="hover:bg-slate-800/30">
                <td className="px-3 py-2 text-[10px] text-slate-500 border-r border-slate-700/50">
                  標高
                </td>
                {sites.map((s) => (
                  <Cell key={s.id}>{s.elevation} m</Cell>
                ))}
              </tr>

              {/* 土地利用 */}
              <tr className="hover:bg-slate-800/30">
                <td className="px-3 py-2 text-[10px] text-slate-500 border-r border-slate-700/50">
                  土地利用
                </td>
                {sites.map((s) => (
                  <Cell key={s.id}>{s.landUse}</Cell>
                ))}
              </tr>

              {/* 変電所距離 */}
              <tr className="hover:bg-slate-800/30">
                <td className="px-3 py-2 text-[10px] text-slate-500 border-r border-slate-700/50">
                  <Zap size={10} className="inline mr-1 text-sky-500" />変電所距離
                </td>
                {sites.map((s) => (
                  <Cell key={s.id} highlight={s.nearestSubstation.distance === bestSubDist}>
                    {s.nearestSubstation.distance.toFixed(1)} km
                    {s.nearestSubstation.distance === bestSubDist && (
                      <Star size={10} className="inline ml-1 text-emerald-400" />
                    )}
                  </Cell>
                ))}
              </tr>

              {/* 変電所電圧 */}
              <tr className="hover:bg-slate-800/30">
                <td className="px-3 py-2 text-[10px] text-slate-500 border-r border-slate-700/50">
                  接続電圧
                </td>
                {sites.map((s) => (
                  <Cell key={s.id} highlight={s.nearestSubstation.voltageKv >= 275}>
                    {s.nearestSubstation.voltageKv} kV
                  </Cell>
                ))}
              </tr>

              {/* スコア内訳 */}
              <tr className="hover:bg-slate-800/30">
                <td className="px-3 py-2 text-[10px] text-slate-500 border-r border-slate-700/50">
                  スコア内訳
                </td>
                {sites.map((s) => (
                  <td key={s.id} className="px-3 py-2 border-r border-slate-700/50 last:border-r-0">
                    <div className="space-y-1 min-w-[100px]">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-slate-500 w-12">系統</span>
                        <ScoreMini value={s.scoreBreakdown.gridProximity} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-slate-500 w-12">地形</span>
                        <ScoreMini value={s.scoreBreakdown.terrain} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-slate-500 w-12">土地</span>
                        <ScoreMini value={s.scoreBreakdown.landUse} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-slate-500 w-12">規制</span>
                        <ScoreMini value={s.scoreBreakdown.regulation} />
                      </div>
                    </div>
                  </td>
                ))}
              </tr>

              {/* 規制 */}
              <tr className="hover:bg-slate-800/30">
                <td className="px-3 py-2 text-[10px] text-slate-500 border-r border-slate-700/50">
                  <FileText size={10} className="inline mr-1" />規制
                </td>
                {sites.map((s) => (
                  <Cell key={s.id} highlight={s.regulations.length === 0}>
                    {s.regulations.length === 0 ? (
                      <span className="text-emerald-400">なし</span>
                    ) : (
                      <span className="text-rose-400 text-[9px]">
                        {s.regulations.join(" / ")}
                      </span>
                    )}
                  </Cell>
                ))}
              </tr>

              {/* 概算工事費 */}
              <tr className="hover:bg-slate-800/30">
                <td className="px-3 py-2 text-[10px] text-slate-500 border-r border-slate-700/50">
                  <DollarSign size={10} className="inline mr-1" />概算工事費
                </td>
                {sites.map((s) => {
                  const cost = s.estimatedConstructionCost;
                  return (
                    <Cell key={s.id} highlight={cost === bestCost}>
                      {cost ? (
                        <>
                          {cost}百万円
                          {cost === bestCost && (
                            <Star size={10} className="inline ml-1 text-emerald-400" />
                          )}
                        </>
                      ) : (
                        <span className="text-slate-500">未試算</span>
                      )}
                    </Cell>
                  );
                })}
              </tr>

              {/* 備考 */}
              <tr className="hover:bg-slate-800/30">
                <td className="px-3 py-2 text-[10px] text-slate-500 border-r border-slate-700/50">
                  備考
                </td>
                {sites.map((s) => (
                  <td
                    key={s.id}
                    className="px-3 py-2 text-[10px] text-slate-400 border-r border-slate-700/50 last:border-r-0 max-w-xs"
                  >
                    {s.notes ?? "—"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* フッター */}
        <div className="px-4 py-2 border-t border-slate-700/50 flex-shrink-0">
          <p className="text-[10px] text-slate-500">
            ★ = その指標での最優秀値 / 概算工事費は蓄電設備本体・土木工事費の試算値。連系工事費・土地取得費は別途。
          </p>
        </div>
      </div>
    </div>
  );
}
