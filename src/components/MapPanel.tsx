"use client";

import dynamic from "next/dynamic";
import { Layers, Compass, Zap } from "lucide-react";
import type { AppState, AppAction } from "@/types";
import clsx from "clsx";

const MapComponent = dynamic(() => import("./MapComponent"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-slate-950">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-sky-500/60 border-t-sky-400 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-[12px] text-slate-500">地図を読み込み中...</p>
      </div>
    </div>
  ),
});

interface MapPanelProps {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

export default function MapPanel({ state, dispatch }: MapPanelProps) {
  const candidateCount = state.candidates.length;

  return (
    <div className="relative w-full h-full">
      <MapComponent state={state} dispatch={dispatch} />

      {/* 凡例オーバーレイ */}
      <div className="absolute bottom-8 right-3 z-[1000] bg-slate-900/85 backdrop-blur-sm border border-slate-700/40 rounded-xl p-3 text-[10px] min-w-[136px] shadow-xl">
        <p className="text-slate-500 font-semibold mb-2 flex items-center gap-1.5">
          <Layers size={10} />
          凡例
        </p>
        <div className="space-y-1.5">
          {[
            { color: "bg-emerald-500", label: "高スコア（80+）", val: "90" },
            { color: "bg-amber-500",   label: "中スコア（65-79）", val: "70" },
            { color: "bg-rose-500",    label: "低スコア（-64）", val: "50" },
          ].map(({ color, label, val }) => (
            <div key={val} className="flex items-center gap-2">
              <div className={clsx("w-4 h-4 rounded-full border border-white/30 flex items-center justify-center text-[6px] text-white font-bold", color)}>
                {val}
              </div>
              <span className="text-slate-400">{label}</span>
            </div>
          ))}

          <div className="border-t border-slate-700/60 my-1.5" />

          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-sky-600 border border-white/20 rounded-sm flex items-center justify-center text-[8px] text-white">⚡</div>
            <span className="text-slate-400">変電所（275kV+）</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-indigo-600 border border-white/20 rounded-sm flex items-center justify-center text-[8px] text-white">⚡</div>
            <span className="text-slate-400">変電所（154kV）</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-[3px] bg-amber-400 rounded" />
            <span className="text-slate-400">送電線（500kV）</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-[2.5px] bg-sky-400 rounded" />
            <span className="text-slate-400">送電線（275kV）</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-[1.5px]" style={{ backgroundImage: "repeating-linear-gradient(90deg,#818cf8 0,#818cf8 4px,transparent 4px,transparent 8px)" }} />
            <span className="text-slate-400">154kV（ズーム9+）</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-[2px]" style={{ backgroundImage: "repeating-linear-gradient(90deg,#f0abfc 0,#f0abfc 4px,transparent 4px,transparent 7px)" }} />
            <span className="text-slate-400">66kV 佐波接続（ズーム10+）</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-[1.5px]" style={{ backgroundImage: "repeating-linear-gradient(90deg,#a78bfa 0,#a78bfa 4px,transparent 4px,transparent 7px)" }} />
            <span className="text-slate-400">66kV その他（ズーム10+）</span>
          </div>

          {state.fitIndividualVisible && (
            <>
              <div className="border-t border-slate-700/60 my-1.5" />
              <p className="text-slate-600 text-[9px] mb-1">FIT個別設備</p>
              {[
                { color: "bg-orange-500",  label: "太陽光" },
                { color: "bg-cyan-400",    label: "風力" },
                { color: "bg-green-500",   label: "バイオマス" },
                { color: "bg-blue-500",    label: "水力" },
                { color: "bg-purple-500",  label: "その他" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className={clsx("w-2.5 h-2.5 rounded-full", color)} />
                  <span className="text-slate-400">{label}</span>
                </div>
              ))}
              <p className="text-slate-600 text-[9px] mt-1">特高ズーム8+ / 高圧9+ / 低圧10+</p>
            </>
          )}
        </div>
      </div>

      {/* 左上コントロール群 */}
      <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-2">
        {candidateCount > 0 && (
          <div className="bg-slate-900/85 backdrop-blur-sm border border-sky-500/30 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-md">
            <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            <span className="text-[11px] text-sky-300 font-medium">{candidateCount} 件の候補地</span>
          </div>
        )}

        <button
          onClick={() => dispatch({ type: "SET_FIT_INDIVIDUAL_VISIBLE", payload: !state.fitIndividualVisible })}
          className={clsx(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all border backdrop-blur-sm shadow-md",
            state.fitIndividualVisible
              ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
              : "bg-slate-900/85 border-slate-700/50 text-slate-400 hover:text-slate-200 hover:border-slate-600/70"
          )}
        >
          <Zap size={10} />
          FIT個別
          {state.fitIndividualLoading && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
          {!state.fitIndividualLoading && state.fitIndividualSites.length > 0 && state.fitIndividualVisible && (
            <span className="text-[8px] opacity-60">{state.fitIndividualSites.length.toLocaleString()}件</span>
          )}
        </button>
      </div>

      {/* 初期ヒント */}
      {candidateCount === 0 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1000] pointer-events-none">
          <div className="bg-slate-900/75 backdrop-blur-sm border border-slate-700/40 rounded-2xl px-5 py-4 text-center shadow-xl">
            <Compass size={20} className="text-slate-600 mx-auto mb-2.5" />
            <p className="text-[12px] text-slate-400 leading-relaxed">
              左パネルで条件を絞り込むと
              <br />
              <span className="text-slate-500">候補地がピンで表示されます</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
