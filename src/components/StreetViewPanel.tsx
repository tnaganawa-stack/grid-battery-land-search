"use client";

import { useState, useEffect } from "react";
import { X, ExternalLink, MapPin, ChevronLeft, ChevronRight, Globe } from "lucide-react";
import type { CandidateSite } from "@/types";
import clsx from "clsx";

interface StreetViewPanelProps {
  site: CandidateSite;
  allSites?: CandidateSite[];
  onClose: () => void;
  onNavigate?: (site: CandidateSite) => void;
}

function earthEmbedUrl(lat: number, lng: number) {
  return `https://earth.google.com/web/@${lat},${lng},0a,800d,35y,0h,60t,0r`;
}

function earthExternalUrl(lat: number, lng: number) {
  return `https://earth.google.com/web/@${lat},${lng},0a,800d,35y,0h,60t,0r`;
}

export default function StreetViewPanel({
  site,
  allSites = [],
  onClose,
  onNavigate,
}: StreetViewPanelProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);

  const { lat, lng } = site.coordinates;

  useEffect(() => {
    setIsLoading(true);
    setIframeKey((k) => k + 1);
  }, [site.id]);

  const currentIndex = allSites.findIndex((s) => s.id === site.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < allSites.length - 1;

  return (
    <div className="fixed inset-0 z-[2500] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl w-full max-w-4xl flex flex-col"
        style={{ maxHeight: "90vh" }}
      >
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 flex-shrink-0">
          <Globe size={16} className="text-emerald-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{site.name}</p>
            <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
              <MapPin size={9} />
              {site.prefecture} {site.municipality}
              <span className="font-mono ml-1">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
              {site.nearestSubstation.availableCapacityMw !== undefined && (
                <span className={clsx(
                  "ml-2 px-1.5 py-0.5 rounded text-[9px] font-semibold",
                  site.nearestSubstation.availableCapacityMw >= 50
                    ? "bg-emerald-500/20 text-emerald-400"
                    : site.nearestSubstation.availableCapacityMw >= 10
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-rose-500/20 text-rose-400"
                )}>
                  系統空き {site.nearestSubstation.availableCapacityMw} MW
                </span>
              )}
            </p>
          </div>

          {/* 候補地ナビ */}
          {allSites.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => hasPrev && onNavigate?.(allSites[currentIndex - 1])}
                disabled={!hasPrev}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-[10px] text-slate-500 w-12 text-center">
                {currentIndex + 1} / {allSites.length}
              </span>
              <button
                onClick={() => hasNext && onNavigate?.(allSites[currentIndex + 1])}
                disabled={!hasNext}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          <a
            href={earthExternalUrl(lat, lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <ExternalLink size={11} /> 別タブで開く
          </a>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Google Earth 埋め込み */}
        <div className="relative flex-1 bg-slate-950" style={{ minHeight: 480 }}>
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-slate-950">
              <div className="text-center">
                <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-slate-300">Google Earth を読み込み中...</p>
                <p className="text-[10px] text-slate-500 mt-1">初回は少し時間がかかります</p>
              </div>
            </div>
          )}
          <iframe
            key={iframeKey}
            src={earthEmbedUrl(lat, lng)}
            width="100%"
            height="100%"
            style={{ border: 0, minHeight: 480, display: "block" }}
            allowFullScreen
            allow="fullscreen"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => setIsLoading(false)}
            className={clsx("transition-opacity duration-500", isLoading ? "opacity-0" : "opacity-100")}
            title={`${site.name} - Google Earth`}
          />
        </div>

        {/* フッター */}
        <div className="px-4 py-2.5 border-t border-slate-800 flex-shrink-0 bg-slate-900/80">
          <div className="flex items-center gap-5 text-[10px] text-slate-500 flex-wrap">
            <span>面積 <span className="text-slate-300">{site.area} ha</span></span>
            <span>傾斜 <span className="text-slate-300">{site.slope}°</span></span>
            <span>標高 <span className="text-slate-300">{site.elevation} m</span></span>
            <span>
              変電所 <span className="text-slate-300">
                {site.nearestSubstation.name}（{site.nearestSubstation.voltageKv}kV）
                {site.nearestSubstation.distance.toFixed(1)}km
              </span>
            </span>
            {site.nearestSubstation.availableCapacityMw !== undefined && (
              <span>
                系統空き容量 <span className={clsx(
                  "font-semibold",
                  site.nearestSubstation.availableCapacityMw >= 50 ? "text-emerald-400"
                    : site.nearestSubstation.availableCapacityMw >= 10 ? "text-amber-400"
                    : "text-rose-400"
                )}>
                  {site.nearestSubstation.availableCapacityMw} MW
                  （{site.nearestSubstation.capacityStatus}）
                </span>
              </span>
            )}
            <span className="ml-auto">
              総合スコア <span className={clsx(
                "font-bold text-sm",
                site.score >= 80 ? "text-emerald-400"
                  : site.score >= 65 ? "text-amber-400"
                  : "text-rose-400"
              )}>{site.score}</span>/100
            </span>
          </div>
          <p className="text-[9px] text-slate-700 mt-1">
            ※ 座標ピンが示す位置を現地の目安としてください。正確な用地境界は現地調査が必要です。
          </p>
        </div>
      </div>
    </div>
  );
}
