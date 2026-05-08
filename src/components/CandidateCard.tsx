"use client";

import { MapPin, Zap, Mountain, DollarSign, ExternalLink, ChevronRight } from "lucide-react";
import type { CandidateSite } from "@/types";
import clsx from "clsx";

function googleEarthUrl(lat: number, lng: number) {
  return `https://earth.google.com/web/@${lat},${lng},0a,800d,35y,0h,60t,0r`;
}

interface CandidateCardProps {
  site: CandidateSite;
  rank?: number;
  isSelected?: boolean;
  isHighlighted?: boolean;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  onFocus?: (site: CandidateSite) => void;
}

function ScoreBar({ value, max = 20, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="h-1 bg-slate-700/80 rounded-full overflow-hidden">
      <div className={clsx("h-full rounded-full score-bar-fill", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const { ring, text, bg } =
    score >= 80
      ? { ring: "ring-emerald-500/40", text: "text-emerald-300", bg: "bg-emerald-500/10" }
      : score >= 65
      ? { ring: "ring-amber-500/40", text: "text-amber-300", bg: "bg-amber-500/10" }
      : { ring: "ring-rose-500/40", text: "text-rose-300", bg: "bg-rose-500/10" };

  return (
    <div className={clsx("w-11 h-11 rounded-full ring-2 flex flex-col items-center justify-center flex-shrink-0", ring, bg)}>
      <span className={clsx("text-[15px] font-bold leading-none", text)}>{score}</span>
      <span className="text-[8px] text-slate-600 mt-0.5">pt</span>
    </div>
  );
}

export default function CandidateCard({
  site, rank, isSelected, isHighlighted, onSelect, onHover, onFocus,
}: CandidateCardProps) {
  const capMw = site.nearestSubstation.availableCapacityMw;
  const capUnknown = capMw < 0;

  return (
    <div
      className={clsx(
        "group rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden",
        isHighlighted
          ? "border-sky-500/60 bg-sky-500/5 shadow-md shadow-sky-500/10"
          : isSelected
          ? "border-violet-500/50 bg-violet-500/5"
          : "border-slate-700/50 bg-slate-800/60 hover:border-slate-600 hover:bg-slate-800/80"
      )}
      onMouseEnter={() => onHover?.(site.id)}
      onMouseLeave={() => onHover?.(null)}
      onClick={() => onFocus?.(site)}
    >
      {/* ヘッダー */}
      <div className="px-3 pt-3 pb-2 flex items-start gap-2.5">
        {rank && (
          <span className="flex-shrink-0 text-[10px] font-bold text-slate-600 bg-slate-700/60 rounded-full w-5 h-5 flex items-center justify-center mt-0.5">
            {rank}
          </span>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white leading-tight truncate">{site.name}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
            <MapPin size={9} className="flex-shrink-0" />
            {site.prefecture} {site.municipality}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <ScoreBadge score={site.score} />
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => { e.stopPropagation(); onSelect?.(site.id); }}
            onClick={(e) => e.stopPropagation()}
            className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-700 accent-violet-500 cursor-pointer"
            title="比較に追加"
          />
        </div>
      </div>

      {/* メトリクス行 */}
      <div className="px-3 pb-2 flex items-center gap-3 text-[10px]">
        <div className="flex items-center gap-1 text-slate-400">
          <Mountain size={9} className="text-slate-500" />
          <span>{site.area}ha</span>
          <span className="text-slate-600">·</span>
          <span>{site.slope}°</span>
        </div>
        <div className="flex items-center gap-1 text-slate-400">
          <Zap size={9} className="text-sky-500/80" />
          <span className="text-sky-400/80">{site.nearestSubstation.voltageKv}kV</span>
          <span className="text-slate-600">·</span>
          <span>{site.nearestSubstation.distance.toFixed(1)}km</span>
        </div>
        {site.estimatedConstructionCost && (
          <div className="flex items-center gap-1 text-slate-400 ml-auto">
            <DollarSign size={9} className="text-emerald-500/60" />
            <span className="text-emerald-400/70">{site.estimatedConstructionCost}M</span>
          </div>
        )}
      </div>

      {/* 系統空き容量バッジ */}
      <div className="px-3 pb-2">
        {capUnknown ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] bg-slate-700/40 text-slate-500 border border-slate-700/60">
            <Zap size={7} />
            系統空き容量: 非公開（OCCTO未連携）
          </span>
        ) : (
          <span className={clsx(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium border",
            capMw >= 50 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
              : capMw >= 10 ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
              : capMw > 0 ? "bg-rose-500/10 text-rose-400 border-rose-500/25"
              : "bg-slate-700/40 text-slate-500 border-slate-700/60"
          )}>
            <Zap size={7} />
            系統空き {capMw} MW ({site.nearestSubstation.capacityStatus})
          </span>
        )}
      </div>

      {/* スコア内訳バー */}
      <div className="px-3 pb-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {[
          { label: "系統", val: site.scoreBreakdown.gridProximity, color: "bg-sky-500" },
          { label: "地形", val: site.scoreBreakdown.terrain, color: "bg-violet-500" },
          { label: "土地", val: site.scoreBreakdown.landUse, color: "bg-amber-500" },
          { label: "規制", val: site.scoreBreakdown.regulation, color: "bg-emerald-500" },
        ].map(({ label, val, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="text-[8px] text-slate-600 w-7 flex-shrink-0">{label}</span>
            <div className="flex-1">
              <ScoreBar value={val} color={color} />
            </div>
            <span className="text-[8px] text-slate-600 w-3 text-right">{val}</span>
          </div>
        ))}
      </div>

      {/* 規制タグ */}
      {site.regulations.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {site.regulations.map((reg, i) => (
            <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-rose-500/10 border border-rose-500/20 rounded text-[8px] text-rose-400">
              {reg.length > 16 ? reg.substring(0, 16) + "…" : reg}
            </span>
          ))}
        </div>
      )}

      {/* フッター */}
      <div className="px-3 pb-2.5 pt-1 border-t border-slate-700/40 flex items-center justify-between gap-2">
        <span className="text-[9px] text-slate-600 truncate flex items-center gap-1">
          <Zap size={8} className="text-sky-600/60 flex-shrink-0" />
          {site.nearestSubstation.name}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={googleEarthUrl(site.coordinates.lat, site.coordinates.lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-0.5 text-[9px] text-slate-500 hover:text-violet-400 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={9} />
            現地確認
          </a>
          <button
            className="flex items-center gap-0.5 text-[9px] text-slate-500 hover:text-sky-400 transition-colors"
            onClick={(e) => { e.stopPropagation(); onFocus?.(site); }}
          >
            地図 <ChevronRight size={9} />
          </button>
        </div>
      </div>
    </div>
  );
}
