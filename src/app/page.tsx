"use client";

import { useReducer, useState, useEffect, useCallback, useRef } from "react";
import { Battery, ChevronLeft, ChevronRight, Info, X, Zap, ClipboardList } from "lucide-react";
import type { AppState, AppAction, CandidateSite, AuctionProperty } from "@/types";
import FilterPanel from "@/components/FilterPanel";
import MapPanel from "@/components/MapPanel";
import ComparisonTable from "@/components/ComparisonTable";
import PropertyListModal from "@/components/PropertyListModal";
import clsx from "clsx";

const FIT_PREF_LIST = [
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","山梨県","長野県","静岡県",
];

const initialState: AppState = {
  messages: [],
  allCandidates: [],
  allCandidatesLoading: false,
  allCandidatesError: null,
  candidates: [],
  selectedForComparison: [],
  showComparison: false,
  mapCenter: [36.2, 139.8],
  mapZoom: 8,
  highlightedSiteId: null,
  streetViewSite: null,
  focusedSubstationId: null,
  focusedLineId: null,
  realSubstations: null,
  realTransmissionLines: null,
  realDataSource: "loading",
  fitSites: [],
  fitLayerVisible: false,
  fitLayerLoading: false,
  fitLoadedPrefectures: [],
  fitIndividualSites: [],
  fitIndividualVisible: false,
  fitIndividualLoading: false,
  auctionProperties: [],
  auctionVisible: true,
  addressPin: null,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.payload] };
    case "UPDATE_LAST_MESSAGE": {
      const updated = [...state.messages];
      const lastIdx = updated.length - 1;
      if (lastIdx >= 0) updated[lastIdx] = { ...updated[lastIdx], ...action.payload };
      return { ...state, messages: updated };
    }
    case "SET_ALL_CANDIDATES":
      return { ...state, allCandidates: action.payload, allCandidatesLoading: false, allCandidatesError: null };
    case "SET_ALL_CANDIDATES_LOADING":
      return { ...state, allCandidatesLoading: action.payload };
    case "SET_ALL_CANDIDATES_ERROR":
      return { ...state, allCandidatesError: action.payload, allCandidatesLoading: false };
    case "SET_CANDIDATES":
      return { ...state, candidates: action.payload };
    case "TOGGLE_COMPARISON_SELECT": {
      const id = action.payload;
      const exists = state.selectedForComparison.includes(id);
      const updated = exists
        ? state.selectedForComparison.filter((x) => x !== id)
        : state.selectedForComparison.length < 5
        ? [...state.selectedForComparison, id]
        : state.selectedForComparison;
      return { ...state, selectedForComparison: updated };
    }
    case "SET_SHOW_COMPARISON":
      return { ...state, showComparison: action.payload };
    case "SET_MAP_CENTER":
      return { ...state, mapCenter: action.payload.center, mapZoom: action.payload.zoom ?? state.mapZoom };
    case "SET_HIGHLIGHTED_SITE":
      return { ...state, highlightedSiteId: action.payload };
    case "SET_STREET_VIEW_SITE":
      return { ...state, streetViewSite: action.payload };
    case "SET_REAL_SUBSTATIONS":
      return { ...state, realSubstations: action.payload.data, realDataSource: action.payload.source };
    case "SET_REAL_TRANSMISSION_LINES":
      return { ...state, realTransmissionLines: action.payload };
    case "SET_REAL_DATA_SOURCE":
      return { ...state, realDataSource: action.payload };
    case "APPEND_FIT_SITES":
      return {
        ...state,
        fitSites: [
          ...state.fitSites.filter((s) => s.prefecture !== action.payload.prefecture),
          ...action.payload.data,
        ],
        fitLoadedPrefectures: [
          ...state.fitLoadedPrefectures.filter((p) => p !== action.payload.prefecture),
          action.payload.prefecture,
        ],
      };
    case "TOGGLE_FIT_LAYER":
      return { ...state, fitLayerVisible: !state.fitLayerVisible };
    case "SET_FIT_LAYER_LOADING":
      return { ...state, fitLayerLoading: action.payload };
    case "SET_FIT_INDIVIDUAL_SITES":
      return { ...state, fitIndividualSites: action.payload };
    case "SET_FIT_INDIVIDUAL_VISIBLE":
      return { ...state, fitIndividualVisible: action.payload };
    case "SET_FIT_INDIVIDUAL_LOADING":
      return { ...state, fitIndividualLoading: action.payload };
    case "SET_FOCUSED_SUBSTATION":
      return { ...state, focusedSubstationId: action.payload };
    case "SET_FOCUSED_LINE":
      return { ...state, focusedLineId: action.payload };
    case "CLEAR_COMPARISON":
      return { ...state, selectedForComparison: [], showComparison: false };
    case "SET_AUCTION_PROPERTIES":
      return { ...state, auctionProperties: action.payload };
    case "TOGGLE_AUCTION_VISIBLE":
      return { ...state, auctionVisible: !state.auctionVisible };
    case "SET_ADDRESS_PIN":
      return { ...state, addressPin: action.payload };
    default:
      return state;
  }
}

export default function Home() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showPropertyList, setShowPropertyList] = useState(false);
  const [candidatesFallback, setCandidatesFallback] = useState(false);
  const [osmLoading, setOsmLoading] = useState(true);
  const fitCandidatesRef = useRef<CandidateSite[]>([]);

  // 全候補地を起動時にロード: FIT（高速）→ OSM（低速）の順で段階的に表示
  useEffect(() => {
    dispatch({ type: "SET_ALL_CANDIDATES_LOADING", payload: true });

    // 5秒以内にFITが返らなければ強制的にUIを表示する
    const loadingTimeout = setTimeout(() => {
      dispatch({ type: "SET_ALL_CANDIDATES_LOADING", payload: false });
    }, 5000);

    // FITデータを先に取得（~1秒）
    fetch("/api/candidates?source=fit")
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: CandidateSite[] = await res.json();
        fitCandidatesRef.current = data;
        dispatch({ type: "SET_ALL_CANDIDATES", payload: data });
      })
      .catch(e => {
        console.warn("FIT取得失敗:", e instanceof Error ? e.message : e);
        dispatch({ type: "SET_ALL_CANDIDATES_LOADING", payload: false });
      })
      .finally(() => clearTimeout(loadingTimeout));

    // OSMデータをバックグラウンドで追加取得（~40秒、キャッシュ後は即時）
    fetch("/api/candidates?source=osm")
      .then(async res => {
        if (!res.ok) return;
        const isFallback = res.headers.get("X-Data-Source") === "mock-fallback";
        if (isFallback) setCandidatesFallback(true);
        const osmData: CandidateSite[] = await res.json();
        if (osmData.length > 0) {
          dispatch({
            type: "SET_ALL_CANDIDATES",
            payload: [...osmData, ...fitCandidatesRef.current],
          });
        }
      })
      .catch(e => {
        console.warn("OSM取得失敗（FITデータは表示済み）:", e instanceof Error ? e.message : e);
      })
      .finally(() => setOsmLoading(false));
  }, []);

  // オークション物件ロード
  useEffect(() => {
    fetch("/api/auction-properties")
      .then(res => res.json())
      .then((data: AuctionProperty[]) => dispatch({ type: "SET_AUCTION_PROPERTIES", payload: data }))
      .catch(() => {});
  }, []);

  // 変電所・送電線レイヤー
  useEffect(() => {
    fetch("/api/real-data/substations")
      .then(async (res) => {
        const source = (res.headers.get("X-Data-Source") ?? "mock-fallback") as "osm" | "mock-fallback";
        const data = await res.json();
        dispatch({ type: "SET_REAL_SUBSTATIONS", payload: { data, source } });
      })
      .catch(() => dispatch({ type: "SET_REAL_DATA_SOURCE", payload: "error" }));
    fetch("/api/real-data/transmission-lines")
      .then((res) => res.json())
      .then((data) => dispatch({ type: "SET_REAL_TRANSMISSION_LINES", payload: data }))
      .catch(() => {});
  }, []);

  // FIT マップレイヤー（凡例表示用）
  const loadFitData = useCallback(async () => {
    if (state.fitLayerLoading) return;
    dispatch({ type: "SET_FIT_LAYER_LOADING", payload: true });
    const prefs = FIT_PREF_LIST.filter((p) => !state.fitLoadedPrefectures.includes(p));
    for (const pref of prefs) {
      try {
        const res = await fetch(`/api/real-data/fit-sites?prefecture=${encodeURIComponent(pref)}`);
        if (res.ok) {
          const data = await res.json();
          dispatch({ type: "APPEND_FIT_SITES", payload: { prefecture: pref, data } });
        }
      } catch { /* continue */ }
    }
    dispatch({ type: "SET_FIT_LAYER_LOADING", payload: false });
  }, [state.fitLayerLoading, state.fitLoadedPrefectures, dispatch]);

  useEffect(() => {
    if (state.fitLayerVisible && state.fitLoadedPrefectures.length === 0) loadFitData();
  }, [state.fitLayerVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  // 個別FIT：表示ON時に全県を自動ロード
  useEffect(() => {
    if (!state.fitIndividualVisible) return;
    if (state.fitIndividualSites.length > 0 || state.fitIndividualLoading) return;
    dispatch({ type: "SET_FIT_INDIVIDUAL_LOADING", payload: true });
    (async () => {
      try {
        const results = await Promise.all(
          FIT_PREF_LIST.map(pref =>
            fetch(`/api/real-data/fit-individual?prefecture=${encodeURIComponent(pref)}`)
              .then(r => r.ok ? r.json() : [])
              .catch(() => [])
          )
        );
        dispatch({ type: "SET_FIT_INDIVIDUAL_SITES", payload: results.flat() });
      } finally {
        dispatch({ type: "SET_FIT_INDIVIDUAL_LOADING", payload: false });
      }
    })();
  }, [state.fitIndividualVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  const comparisonSites: CandidateSite[] = state.candidates.filter((c) =>
    state.selectedForComparison.includes(c.id)
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950">
      {/* ヘッダー */}
      <header className="relative flex items-center gap-3 px-5 h-14 flex-shrink-0 z-10 border-b border-white/5">
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-900/95" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-sky-500/30 via-violet-500/20 to-transparent" />

        <div className="relative flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-violet-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Battery size={16} className="text-white" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-white leading-tight tracking-tight">
              系統用蓄電池 用地選定
            </p>
            <p className="text-[10px] text-slate-500 tracking-wide">Grid Battery Site Intelligence</p>
          </div>
        </div>

        {/* ステータスバー */}
        <div className="relative ml-4 flex items-center gap-3 text-[11px]">
          {state.allCandidatesLoading && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
              <span className="hidden sm:inline">FITデータ取得中...</span>
            </div>
          )}
          {!state.allCandidatesLoading && osmLoading && (
            <div className="flex items-center gap-1.5 text-sky-500/70">
              <div className="w-1.5 h-1.5 rounded-full bg-sky-500/70 animate-pulse" />
              <span className="hidden sm:inline">OSM工業地域 取得中（バックグラウンド）...</span>
            </div>
          )}
          {!state.allCandidatesLoading && state.allCandidates.length > 0 && (
            <div className={`flex items-center gap-1.5 ${candidatesFallback ? "text-amber-400/80" : "text-emerald-400/80"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${candidatesFallback ? "bg-amber-500" : "bg-emerald-500"}`} />
              <span className="hidden sm:inline">
                {candidatesFallback
                  ? `候補地 ${state.allCandidates.length}件（外部API障害中・モックデータ）`
                  : `候補地 ${state.allCandidates.length}件（OSM+FIT実データ）`}
              </span>
            </div>
          )}
          {state.allCandidatesError && (
            <div className="flex items-center gap-1.5 text-rose-400/80">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              <span className="hidden sm:inline">データ取得エラー</span>
            </div>
          )}
          {state.realDataSource === "osm" && (
            <div className="hidden md:flex items-center gap-1.5 text-slate-500">
              <div className="h-3 w-px bg-slate-700" />
              <span>変電所 {state.realSubstations?.length ?? 0}件</span>
            </div>
          )}
          {state.candidates.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-px bg-slate-700" />
              <div className="flex items-center gap-1.5 text-sky-400">
                <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                <span>表示中 <strong>{state.candidates.length}</strong> 件</span>
              </div>
            </div>
          )}
        </div>

        <div className="relative ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowPropertyList(true)}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-indigo-300 bg-indigo-500/10 border border-indigo-500/30 rounded-lg hover:bg-indigo-500/20 transition-all"
            title="登録物件リストを開く"
          >
            <ClipboardList size={11} />
            物件リスト
          </button>
          <a
            href="/capacity"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg hover:bg-amber-500/20 transition-all"
            title="系統空き容量マップを別タブで開く"
          >
            <Zap size={11} />
            空き容量マップ
          </a>
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-all"
          >
            <Info size={15} />
          </button>
        </div>
      </header>

      {/* メインコンテンツ */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* サイドバー（フィルターパネル） */}
        <div
          className={clsx(
            "flex-shrink-0 transition-all duration-300 overflow-hidden border-r border-slate-800",
            sidebarCollapsed ? "w-0" : "w-[400px]"
          )}
        >
          <div className="w-[400px] h-full">
            <FilterPanel state={state} dispatch={dispatch} />
          </div>
        </div>

        {/* サイドバートグル */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-5 h-10 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-r-md transition-all shadow-lg"
          style={{ left: sidebarCollapsed ? 0 : 400 }}
        >
          {sidebarCollapsed
            ? <ChevronRight size={12} className="text-slate-400" />
            : <ChevronLeft size={12} className="text-slate-400" />
          }
        </button>

        {/* 地図エリア */}
        <div className="flex-1 relative overflow-hidden">
          <MapPanel state={state} dispatch={dispatch} />
        </div>
      </div>

      {/* 物件リストモーダル */}
      {showPropertyList && (
        <PropertyListModal onClose={() => setShowPropertyList(false)} />
      )}

      {/* 比較テーブル */}
      {state.showComparison && comparisonSites.length > 0 && (
        <ComparisonTable
          sites={comparisonSites}
          onClose={() => dispatch({ type: "SET_SHOW_COMPARISON", payload: false })}
          onRemoveSite={(id) => dispatch({ type: "TOGGLE_COMPARISON_SELECT", payload: id })}
        />
      )}

      {/* 使い方モーダル */}
      {showInfo && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[3000] flex items-center justify-center p-4"
          onClick={() => setShowInfo(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700/60 rounded-2xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-sky-500/20 flex items-center justify-center">
                  <Info size={13} className="text-sky-400" />
                </div>
                使い方ガイド
              </h2>
              <button onClick={() => setShowInfo(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              {[
                {
                  color: "text-sky-400",
                  bg: "bg-sky-500/10",
                  label: "フィルター操作",
                  items: [
                    "左パネルで都道府県・変電所距離・土地利用などを絞り込む",
                    "スライダーを動かすと地図が即座に更新される",
                    "データソース切替: OSM工業地域 / FIT認定再エネ / 全候補",
                  ],
                },
                {
                  color: "text-amber-400",
                  bg: "bg-amber-500/10",
                  label: "絞り込み条件",
                  items: [
                    "変電所電圧・距離で系統接続コストを評価",
                    "土地価格帯で取得コスト目安を絞り込み",
                    "FIT認定エリア = 既存系統接続実績あり",
                  ],
                },
                {
                  color: "text-violet-400",
                  bg: "bg-violet-500/10",
                  label: "比較機能",
                  items: [
                    "候補カードのチェックで最大5件を選択",
                    "「比較表」ボタンで詳細比較テーブル表示",
                    "CSV出力でExcel書き出し可能",
                  ],
                },
              ].map((section) => (
                <div key={section.label} className={`rounded-xl p-3 ${section.bg}`}>
                  <h3 className={`font-semibold text-xs mb-2 ${section.color}`}>{section.label}</h3>
                  <ul className="space-y-1">
                    {section.items.map((item) => (
                      <li key={item} className="text-xs text-slate-400 flex items-start gap-2">
                        <span className="text-slate-600 mt-0.5">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/40">
                <p className="text-[11px] text-slate-500 font-medium mb-1.5">データソース</p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  OSM工業地域・廃工場跡地 + FIT認定ポータル（fit-portal.go.jp）の実データを使用。
                  系統空き容量はOCCTO未連携のため非公開。
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowInfo(false)}
              className="mt-5 w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-xl transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
