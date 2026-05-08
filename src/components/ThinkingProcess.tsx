"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Brain, Wrench, Database, Lightbulb, CheckCircle } from "lucide-react";
import type { ThinkingStep } from "@/types";
import clsx from "clsx";

interface ThinkingProcessProps {
  steps: ThinkingStep[];
}

const stepConfig: Record<
  ThinkingStep["type"],
  { icon: React.ReactNode; label: string; color: string; bg: string }
> = {
  analysis: {
    icon: <Brain size={13} />,
    label: "条件分析",
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/30",
  },
  "tool-call": {
    icon: <Wrench size={13} />,
    label: "ツール実行",
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/30",
  },
  "tool-result": {
    icon: <Database size={13} />,
    label: "データ取得",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
  },
  reasoning: {
    icon: <Lightbulb size={13} />,
    label: "推論",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
  },
  conclusion: {
    icon: <CheckCircle size={13} />,
    label: "結論",
    color: "text-teal-400",
    bg: "bg-teal-500/10 border-teal-500/30",
  },
};

function ThinkingStepItem({ step, index }: { step: ThinkingStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const config = stepConfig[step.type];

  // conclusionタイプはスキップ（メインメッセージに表示される）
  if (step.type === "conclusion") return null;

  const hasDetail = Boolean(step.toolInput) || Boolean(step.toolOutput);

  return (
    <div className={clsx("rounded-md border px-3 py-2 text-xs", config.bg)}>
      <div
        className={clsx(
          "flex items-center gap-2 cursor-pointer select-none",
          config.color
        )}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        <span className="flex-shrink-0">{config.icon}</span>
        <span className="font-medium">{config.label}</span>
        {step.toolName && (
          <code className="px-1.5 py-0.5 bg-black/30 rounded text-[10px] font-mono">
            {step.toolName}
          </code>
        )}
        {hasDetail && (
          <span className="ml-auto">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </div>

      {/* ツール入力の概要 */}
      {Boolean(step.toolInput) && !expanded && step.toolInput && (
        <p className="mt-1 text-slate-400 text-[10px] leading-relaxed truncate">
          {Object.entries(step.toolInput)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(" | ")}
        </p>
      )}

      {/* 展開時の詳細 */}
      {expanded && hasDetail && (
        <div className="mt-2 space-y-2">
          {step.toolInput && (
            <div>
              <p className="text-[10px] text-slate-500 mb-1">入力パラメータ:</p>
              <pre className="text-[10px] text-slate-300 bg-black/30 rounded p-2 overflow-x-auto max-h-32 whitespace-pre-wrap">
                {JSON.stringify(step.toolInput, null, 2)}
              </pre>
            </div>
          )}
          {Boolean(step.toolOutput) && (
            <div>
              <p className="text-[10px] text-slate-500 mb-1">取得データ:</p>
              <pre className="text-[10px] text-slate-300 bg-black/30 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
                {typeof step.toolOutput === "string"
                  ? step.toolOutput
                  : JSON.stringify(step.toolOutput, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ThinkingProcess({ steps }: ThinkingProcessProps) {
  const [open, setOpen] = useState(false);
  const visibleSteps = steps.filter((s) => s.type !== "conclusion");

  if (visibleSteps.length === 0) return null;

  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 transition-colors"
      >
        <Brain size={13} className="text-violet-400" />
        <span>AIの推論プロセス ({visibleSteps.length}ステップ)</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 pl-2 border-l border-violet-500/30">
          {visibleSteps.map((step, i) => (
            <ThinkingStepItem key={i} step={step} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
