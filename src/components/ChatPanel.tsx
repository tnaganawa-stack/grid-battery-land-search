"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send, Bot, User, AlertCircle, Sparkles, MapPin, BarChart3, RefreshCw,
} from "lucide-react";
import type { ChatMessage, CandidateSite, AppState, AppAction } from "@/types";
import ThinkingProcess from "./ThinkingProcess";
import CandidateCard from "./CandidateCard";
import clsx from "clsx";

const SUGGESTIONS = [
  "茨城県で変電所5km以内、傾斜5度以下の工業地域を探して",
  "275kV変電所から10km以内の工業地域・廃工場跡地を全県で",
  "今の条件に、さらに面積3ha以上を追加して",
  "上位候補を詳しく比較してほしい",
];

interface ChatPanelProps {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1 py-1 px-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 bg-sky-500/70 rounded-full animate-bounce"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </div>
  );
}

function MessageBubble({
  message, state, dispatch,
}: {
  message: ChatMessage;
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end msg-animate">
        <div className="max-w-[88%]">
          <div className="flex items-end gap-2 justify-end">
            <div className="bg-sky-600 text-white text-[13px] px-4 py-2.5 rounded-2xl rounded-tr-sm leading-relaxed shadow-md shadow-sky-900/30">
              {message.content}
            </div>
            <div className="w-6 h-6 rounded-full bg-sky-700/80 flex items-center justify-center flex-shrink-0">
              <User size={12} className="text-white" />
            </div>
          </div>
          <p className="text-[9px] text-slate-700 text-right mt-1 pr-8">
            {new Date(message.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 msg-animate">
      <div className={clsx(
        "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
        message.isLoading
          ? "bg-slate-700 thinking-pulse"
          : "bg-gradient-to-br from-sky-600 to-violet-600 shadow-md"
      )}>
        <Bot size={14} className="text-white" />
      </div>

      <div className="flex-1 min-w-0">
        {message.thinkingSteps && message.thinkingSteps.length > 0 && (
          <ThinkingProcess steps={message.thinkingSteps} />
        )}

        {message.isLoading && <LoadingDots />}

        {message.content && !message.isLoading && (
          <div className="bg-slate-800/70 border border-slate-700/40 text-[13px] text-slate-200 px-4 py-3 rounded-2xl rounded-tl-sm leading-relaxed whitespace-pre-wrap shadow-sm">
            {message.content}
          </div>
        )}

        {message.candidates && message.candidates.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 px-1">
              <MapPin size={10} className="text-sky-500/70" />
              <span>{message.candidates.length}件の候補地を抽出</span>
            </div>
            {message.candidates.slice(0, 5).map((site, idx) => (
              <CandidateCard
                key={site.id}
                site={site}
                rank={idx + 1}
                isSelected={state.selectedForComparison.includes(site.id)}
                isHighlighted={state.highlightedSiteId === site.id}
                onSelect={(id) => dispatch({ type: "TOGGLE_COMPARISON_SELECT", payload: id })}
                onHover={(id) => dispatch({ type: "SET_HIGHLIGHTED_SITE", payload: id })}
                onFocus={(s) =>
                  dispatch({
                    type: "SET_MAP_CENTER",
                    payload: { center: [s.coordinates.lat, s.coordinates.lng], zoom: 13 },
                  })
                }
              />
            ))}
            {message.candidates.length > 5 && (
              <p className="text-[10px] text-slate-600 text-center py-1">
                他 {message.candidates.length - 5}件（地図でも確認できます）
              </p>
            )}
          </div>
        )}

        <p className="text-[9px] text-slate-700 mt-1 pl-1">
          {new Date(message.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

export default function ChatPanel({ state, dispatch }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    setError(null);
    setShowSuggestions(false);

    dispatch({ type: "ADD_MESSAGE", payload: {
      id: `msg-${Date.now()}`, role: "user", content: text.trim(), timestamp: new Date().toISOString(),
    }});
    setInput("");

    const loadingId = `loading-${Date.now()}`;
    dispatch({ type: "ADD_MESSAGE", payload: {
      id: loadingId, role: "assistant", content: "", timestamp: new Date().toISOString(), isLoading: true,
    }});
    setIsLoading(true);

    try {
      const history = state.messages.filter((m) => !m.isLoading).map((m) => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: text.trim() });

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, currentCandidateIds: state.candidates.map((c) => c.id) }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? `HTTP ${res.status}`); }

      const data = await res.json();
      dispatch({ type: "UPDATE_LAST_MESSAGE", payload: {
        id: loadingId, role: "assistant", content: data.message,
        timestamp: new Date().toISOString(), candidates: data.candidates, thinkingSteps: data.thinkingSteps,
      }});

      if (data.candidates?.length > 0) dispatch({ type: "SET_CANDIDATES", payload: data.candidates });
      if (data.mapAction?.center) dispatch({ type: "SET_MAP_CENTER", payload: {
        center: [data.mapAction.center.lat, data.mapAction.center.lng], zoom: data.mapAction.zoom,
      }});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "エラーが発生しました";
      setError(msg);
      dispatch({ type: "UPDATE_LAST_MESSAGE", payload: {
        id: loadingId, role: "assistant", content: `エラー: ${msg}`, timestamp: new Date().toISOString(), isLoading: false,
      }});
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, state.messages, state.candidates, dispatch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const selectedCount = state.selectedForComparison.length;

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* パネルヘッダー */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800 bg-slate-950 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-600 to-violet-600 flex items-center justify-center shadow-sm">
          <Sparkles size={13} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-slate-200 leading-tight">用地選定AI</p>
          <p className="text-[9px] text-slate-600">候補地探索エージェント</p>
        </div>

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

      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {state.messages.length === 0 && (
          <div className="py-8 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-sky-600/20 to-violet-600/20 border border-sky-500/20 flex items-center justify-center">
              <Sparkles size={24} className="text-sky-400/80" />
            </div>
            <p className="text-[13px] font-semibold text-slate-300 mb-1">系統用蓄電池 用地選定AI</p>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              設置条件をチャットで入力すると
              <br />
              OSM実データから最適な候補地を抽出します
            </p>
          </div>
        )}

        {showSuggestions && state.messages.length === 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-slate-600 px-1 mb-2">質問の例</p>
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                onClick={() => sendMessage(s)}
                className="w-full text-left text-[11px] text-slate-400 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/40 hover:border-slate-600/60 px-3 py-2 rounded-lg transition-all leading-relaxed"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {state.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} state={state} dispatch={dispatch} />
        ))}

        {error && (
          <div className="flex items-start gap-2 p-3 bg-rose-500/8 border border-rose-500/25 rounded-xl">
            <AlertCircle size={13} className="text-rose-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-300/90">{error}</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 入力エリア */}
      <div className="px-3 pb-3 pt-2 border-t border-slate-800 flex-shrink-0 bg-slate-950">
        {state.candidates.length > 0 && (
          <div className="flex items-center justify-between mb-2 px-0.5">
            <span className="text-[10px] text-slate-600">
              候補: <span className="text-sky-400/80">{state.candidates.length}件</span>
            </span>
            <button
              onClick={() => { dispatch({ type: "SET_CANDIDATES", payload: [] }); setShowSuggestions(true); }}
              className="text-[10px] text-slate-600 hover:text-slate-400 flex items-center gap-0.5 transition-colors"
            >
              <RefreshCw size={8} /> リセット
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="条件を入力（例: 茨城県で傾斜5度以下、変電所5km以内）"
            disabled={isLoading}
            rows={2}
            className="flex-1 bg-slate-800/80 border border-slate-700/60 text-[13px] text-slate-200 placeholder-slate-600 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-sky-500/60 focus:bg-slate-800 disabled:opacity-40 transition-all"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="w-9 h-9 flex items-center justify-center bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-xl transition-all flex-shrink-0 mb-0.5 shadow-sm"
          >
            <Send size={14} />
          </button>
        </div>
        <p className="text-[9px] text-slate-700 mt-1.5 px-0.5">Enter で送信 / Shift+Enter で改行</p>
      </div>
    </div>
  );
}
