/**
 * AIエージェントチャットAPIルート
 * ANTHROPIC_API_KEY が設定されている場合: Claude claude-sonnet-4-6 + Tool Use
 * 設定されていない場合: ルールベースの自動解析モード（デモ用）
 *
 * 候補地はすべて OSM + GSI 実データ（モック不使用）
 */

import { NextRequest, NextResponse } from "next/server";
import type {
  ChatRequest,
  ChatApiResponse,
  ThinkingStep,
  CandidateSite,
  FilterCriteria,
  LandUseCategory,
} from "@/types";
import {
  searchCandidateSites,
  rerankByPriority,
  generateSiteDetailReport,
  compareSites,
  calcCentroid,
} from "@/lib/geoAnalysis";
import { getCandidateSites, getSiteByIdReal } from "@/lib/candidateData";
import { getFitCandidateSites } from "@/lib/fitCandidateData";

// ============================================================
// ルールベース解析（APIキー不要モード）
// ============================================================

function parseConditions(text: string, currentIds?: string[]): FilterCriteria {
  const criteria: FilterCriteria = {};

  const prefList = ["茨城", "栃木", "群馬", "埼玉", "千葉", "神奈川", "山梨", "長野"];
  const matchedPrefs = prefList.filter((p) => text.includes(p)).map((p) => p + "県");
  if (matchedPrefs.length > 0) criteria.prefectures = matchedPrefs;

  const slopeMatch =
    text.match(/傾斜\s*(\d+(?:\.\d+)?)\s*度以下/) ||
    text.match(/(\d+(?:\.\d+)?)\s*度以下/) ||
    text.match(/勾配\s*(\d+(?:\.\d+)?)/);
  if (slopeMatch) criteria.maxSlope = parseFloat(slopeMatch[1]);

  const areaMatch =
    text.match(/(\d+(?:\.\d+)?)\s*ha以上/) ||
    text.match(/面積\s*(\d+(?:\.\d+)?)/);
  if (areaMatch) criteria.minArea = parseFloat(areaMatch[1]);

  const distMatch =
    text.match(/変電所.{0,6}?(\d+(?:\.\d+)?)\s*km以内/) ||
    text.match(/(\d+(?:\.\d+)?)\s*km以内/);
  if (distMatch) criteria.maxDistanceFromSubstation = parseFloat(distMatch[1]);

  if (text.includes("500")) criteria.minVoltageKv = 500;
  else if (text.includes("275")) criteria.minVoltageKv = 275;
  else if (text.includes("154")) criteria.minVoltageKv = 154;

  const capacityMatch =
    text.match(/空き容量\s*(\d+)\s*MW以上/i) ||
    text.match(/(\d+)\s*MW以上の空き/) ||
    text.match(/空き\s*(\d+)\s*MW以上/i) ||
    text.match(/系統容量\s*(\d+)\s*MW以上/i);
  if (capacityMatch) {
    criteria.minAvailableCapacityMw = parseFloat(capacityMatch[1]);
  } else if (
    text.includes("空き容量十分") ||
    text.includes("余裕あり") ||
    text.includes("空き容量が多")
  ) {
    criteria.minAvailableCapacityMw = 50;
  } else if (text.includes("空きゼロ") || text.includes("空き容量ゼロ") || text.includes("逼迫")) {
    criteria.minAvailableCapacityMw = 1;
  }

  const cats: LandUseCategory[] = [];
  if (text.includes("工業")) cats.push("industrial");
  if (text.includes("農地") || text.includes("農業")) cats.push("agricultural");
  if (text.includes("雑種") || text.includes("原野")) cats.push("wasteland");
  if (text.includes("山林") || text.includes("森林")) cats.push("forest");
  // FIT関連キーワード: FIT認定エリアを含む全土地カテゴリを対象にする
  if (
    text.includes("FIT") || text.includes("fit") ||
    text.includes("再エネ") || text.includes("再生可能") ||
    text.includes("太陽光") || text.includes("風力") || text.includes("バイオマス")
  ) {
    // FIT候補地（農地・山林・工業）をすべて含める
    if (!cats.includes("agricultural")) cats.push("agricultural");
    if (!cats.includes("forest")) cats.push("forest");
    if (!cats.includes("industrial")) cats.push("industrial");
    if (!cats.includes("wasteland")) cats.push("wasteland");
  }
  if (cats.length > 0) criteria.landUseCategories = cats;

  const excludeRegs: string[] = [];
  if (text.includes("農振") || text.includes("農業振興")) excludeRegs.push("農業振興地域");
  if (text.includes("自然公園")) excludeRegs.push("自然公園");
  if (text.includes("急傾斜")) excludeRegs.push("急傾斜地");
  if (excludeRegs.length > 0) criteria.excludeRegulations = excludeRegs;

  const excludeAreas: string[] = [];
  const m1 = text.match(/([^\s、。]{1,6})[はを]除外/g);
  if (m1)
    m1.forEach((s) => {
      const r = s.replace(/[はを]除外$/, "").replace(/[県市町村]/g, "");
      if (r) excludeAreas.push(r);
    });
  if (excludeAreas.length > 0) criteria.excludeAreas = excludeAreas;

  const scoreMatch =
    text.match(/スコア\s*(\d+)\s*点以上/) || text.match(/(\d+)\s*点以上/);
  if (scoreMatch) criteria.minScore = parseInt(scoreMatch[1]);

  const isRefine =
    text.includes("今の条件") ||
    text.includes("さらに") ||
    text.includes("追加") ||
    text.includes("絞り込");
  if (isRefine && currentIds && currentIds.length > 0) {
    criteria.currentCandidateIds = currentIds;
  }

  return criteria;
}

function detectIntent(text: string): "search" | "compare" | "detail" | "rerank" {
  if (text.includes("比較") || text.includes("比べ")) return "compare";
  if (text.includes("詳細") || text.includes("詳しく")) return "detail";
  if (text.includes("ランキング") || text.includes("並び替") || text.includes("順番"))
    return "rerank";
  return "search";
}

function detectPriority(
  text: string
): "grid" | "terrain" | "land_use" | "regulation" | "cost" {
  if (text.includes("変電所") || text.includes("系統") || text.includes("連系"))
    return "grid";
  if (text.includes("傾斜") || text.includes("地形") || text.includes("平坦"))
    return "terrain";
  if (text.includes("土地") || text.includes("用地")) return "land_use";
  if (text.includes("規制") || text.includes("許可")) return "regulation";
  if (text.includes("コスト") || text.includes("費用") || text.includes("安"))
    return "cost";
  return "grid";
}

async function buildRuleBasedResponse(
  userText: string,
  currentIds: string[],
  allSites: CandidateSite[]
): Promise<{ message: string; candidates: CandidateSite[]; thinkingSteps: ThinkingStep[] }> {
  const steps: ThinkingStep[] = [];
  const now = new Date().toISOString();
  let candidates: CandidateSite[] = [];
  let message = "";
  const intent = detectIntent(userText);

  steps.push({
    type: "analysis",
    content: `意図判定: "${intent}" / 入力: "${userText}"`,
    timestamp: now,
  });

  if (intent === "compare" && currentIds.length >= 2) {
    const sites = currentIds
      .slice(0, 5)
      .map((id) => allSites.find((s) => s.id === id))
      .filter(Boolean) as CandidateSite[];
    const priority = detectPriority(userText);
    const ranked = rerankByPriority(sites, priority);
    steps.push({
      type: "tool-call",
      content: `compare_sites (${sites.length}件, ${priority}優先)`,
      toolName: "compare_sites",
      toolInput: { site_ids: currentIds.slice(0, 5), priority },
      timestamp: now,
    });
    const compText = compareSites(ranked);
    steps.push({ type: "tool-result", content: compText, toolOutput: compText, timestamp: now });
    message =
      `現在の候補地 ${sites.length} 件を「${priority}」優先軸で比較しました。\n\n${compText}`;
    candidates = ranked;
  } else if (intent === "detail" && currentIds.length > 0) {
    const site = allSites.find((s) => s.id === currentIds[0]);
    if (site) {
      steps.push({
        type: "tool-call",
        content: `get_site_details: ${site.name}`,
        toolName: "get_site_details",
        toolInput: { site_id: site.id },
        timestamp: now,
      });
      const detail = generateSiteDetailReport(site);
      steps.push({ type: "tool-result", content: detail, toolOutput: detail, timestamp: now });
      message = detail;
      candidates = [site];
    }
  } else if (intent === "rerank" && currentIds.length > 0) {
    const sites = currentIds
      .map((id) => allSites.find((s) => s.id === id))
      .filter(Boolean) as CandidateSite[];
    const priority = detectPriority(userText);
    const ranked = rerankByPriority(sites, priority);
    steps.push({
      type: "tool-call",
      content: `rerank_by_priority: ${priority}`,
      toolName: "rerank_by_priority",
      toolInput: { site_ids: currentIds, priority },
      timestamp: now,
    });
    message =
      `${ranked.length}件を「${priority}」優先で並び替えました。\n\n` +
      ranked.map((s, i) => `${i + 1}位 ${s.name}（${s.score}点）`).join("\n");
    candidates = ranked;
  } else {
    const criteria = parseConditions(userText, currentIds);
    steps.push({
      type: "tool-call",
      content: "search_candidate_sites を実行",
      toolName: "search_candidate_sites",
      toolInput: criteria as Record<string, unknown>,
      timestamp: now,
    });
    candidates = searchCandidateSites(criteria, allSites);
    steps.push({
      type: "tool-result",
      content: `${candidates.length}件取得`,
      toolOutput: { count: candidates.length },
      timestamp: now,
    });

    const condSummary: string[] = [];
    if (criteria.prefectures?.length) condSummary.push(`対象県: ${criteria.prefectures.join("・")}`);
    if (criteria.maxSlope !== undefined) condSummary.push(`傾斜${criteria.maxSlope}度以下`);
    if (criteria.minArea !== undefined) condSummary.push(`${criteria.minArea}ha以上`);
    if (criteria.maxDistanceFromSubstation !== undefined)
      condSummary.push(`変電所${criteria.maxDistanceFromSubstation}km以内`);
    if (criteria.minVoltageKv !== undefined) condSummary.push(`${criteria.minVoltageKv}kV以上`);
    if (criteria.landUseCategories?.length)
      condSummary.push(`土地: ${criteria.landUseCategories.join("・")}`);
    if (criteria.excludeAreas?.length) condSummary.push(`除外: ${criteria.excludeAreas.join("・")}`);
    if (criteria.minScore !== undefined) condSummary.push(`スコア${criteria.minScore}点以上`);
    if (criteria.minAvailableCapacityMw !== undefined)
      condSummary.push(`空き容量${criteria.minAvailableCapacityMw}MW以上`);

    if (candidates.length === 0) {
      message = `条件に合致する候補地が見つかりませんでした。条件を緩めてみてください。\n\n抽出条件: ${condSummary.join(" / ") || "（条件なし）"}`;
    } else {
      const isRefine = Boolean(criteria.currentCandidateIds);
      const top = candidates[0];
      message =
        `${isRefine ? "追加絞り込みの結果、" : ""}${candidates.length}件の候補地を抽出しました。\n\n` +
        `【抽出条件】${condSummary.join(" / ") || "全件"}\n\n` +
        `【最高スコア】${top.name}（${top.score}点）\n` +
        `　${top.nearestSubstation.name} まで${top.nearestSubstation.distance.toFixed(1)}km` +
        ` / ${top.nearestSubstation.voltageKv}kV` +
        ` / 傾斜${top.slope}° / ${top.area}ha\n\n` +
        `※系統空き容量は非公開（OCCTO未連携）のため表示されていません。\n` +
        `カードをクリックすると地図上の位置を確認できます。`;
    }
  }

  steps.push({ type: "conclusion", content: message, timestamp: now });
  return { message, candidates, thinkingSteps: steps };
}

// ============================================================
// ツール実行（共通）
// ============================================================
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  allSites: CandidateSite[]
): Promise<{ result: unknown; candidates: CandidateSite[] }> {
  switch (toolName) {
    case "search_candidate_sites": {
      const criteria: FilterCriteria = {
        prefectures: toolInput.prefectures as string[] | undefined,
        minArea: toolInput.min_area as number | undefined,
        maxSlope: toolInput.max_slope as number | undefined,
        maxDistanceFromSubstation: toolInput.max_distance_from_substation as number | undefined,
        minVoltageKv: toolInput.min_voltage_kv as number | undefined,
        landUseCategories: toolInput.land_use_categories as LandUseCategory[] | undefined,
        excludeRegulations: toolInput.exclude_regulations as string[] | undefined,
        excludeAreas: toolInput.exclude_areas as string[] | undefined,
        currentCandidateIds: toolInput.current_candidate_ids as string[] | undefined,
        minScore: toolInput.min_score as number | undefined,
        minAvailableCapacityMw: toolInput.min_available_capacity_mw as number | undefined,
      };
      const candidates = searchCandidateSites(criteria, allSites);
      return {
        result: {
          count: candidates.length,
          sites: candidates.map((s) => ({ id: s.id, name: s.name, score: s.score })),
        },
        candidates,
      };
    }
    case "get_site_details": {
      const site = allSites.find((s) => s.id === (toolInput.site_id as string));
      if (!site) return { result: { error: "not found" }, candidates: [] };
      return { result: { detail: generateSiteDetailReport(site) }, candidates: [site] };
    }
    case "compare_sites": {
      const ids = toolInput.site_ids as string[];
      const sites = ids
        .map((id) => allSites.find((s) => s.id === id))
        .filter(Boolean) as CandidateSite[];
      const priority = toolInput.priority as
        | "grid"
        | "terrain"
        | "land_use"
        | "regulation"
        | "cost"
        | undefined;
      const ranked = priority ? rerankByPriority(sites, priority) : sites;
      return { result: { comparison: compareSites(ranked) }, candidates: ranked };
    }
    case "rerank_by_priority": {
      const ids = toolInput.site_ids as string[];
      const priority = toolInput.priority as
        "grid" | "terrain" | "land_use" | "regulation" | "cost";
      const sites = ids
        .map((id) => allSites.find((s) => s.id === id))
        .filter(Boolean) as CandidateSite[];
      return { result: {}, candidates: rerankByPriority(sites, priority) };
    }
    default:
      return { result: { error: `unknown: ${toolName}` }, candidates: [] };
  }
}

// ============================================================
// Claudeエージェントモード
// ============================================================
async function runClaudeAgent(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  currentIds: string[],
  allSites: CandidateSite[]
): Promise<{ message: string; candidates: CandidateSite[]; thinkingSteps: ThinkingStep[] }> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  type AMessage = Parameters<typeof client.messages.create>[0]["messages"][number];
  type ATool =
    Parameters<typeof client.messages.create>[0]["tools"] extends (infer T)[] | undefined
      ? T
      : never;

  const tools: ATool[] = [
    {
      name: "search_candidate_sites",
      description: "系統用蓄電池の設置候補地を条件で検索します。OSM実データ（工業地域等）とFIT認定実データ（再エネ集積エリア）が対象です。",
      input_schema: {
        type: "object" as const,
        properties: {
          prefectures: { type: "array", items: { type: "string" } },
          min_area: { type: "number" },
          max_slope: { type: "number" },
          max_distance_from_substation: { type: "number" },
          min_voltage_kv: { type: "number" },
          land_use_categories: { type: "array", items: { type: "string" } },
          exclude_regulations: { type: "array", items: { type: "string" } },
          exclude_areas: { type: "array", items: { type: "string" } },
          current_candidate_ids: { type: "array", items: { type: "string" } },
          min_score: { type: "number" },
          min_available_capacity_mw: {
            type: "number",
            description: "最低系統空き容量 (MW)。※OSMデータでは非公開のため、-1以上を指定すると全件対象になります",
          },
        },
        required: [],
      },
    },
    {
      name: "get_site_details",
      description: "特定の候補地の詳細情報を取得します。",
      input_schema: {
        type: "object" as const,
        properties: { site_id: { type: "string" } },
        required: ["site_id"],
      },
    },
    {
      name: "compare_sites",
      description: "複数の候補地を比較分析します。",
      input_schema: {
        type: "object" as const,
        properties: {
          site_ids: { type: "array", items: { type: "string" } },
          priority: {
            type: "string",
            enum: ["grid", "terrain", "land_use", "regulation", "cost"],
          },
        },
        required: ["site_ids"],
      },
    },
    {
      name: "rerank_by_priority",
      description: "候補地リストを特定の優先軸で並び替えます。",
      input_schema: {
        type: "object" as const,
        properties: {
          site_ids: { type: "array", items: { type: "string" } },
          priority: {
            type: "string",
            enum: ["grid", "terrain", "land_use", "regulation", "cost"],
          },
        },
        required: ["site_ids", "priority"],
      },
    },
  ];

  const SYSTEM = `あなたは系統用蓄電池の用地選定を支援する地理空間分析AIエージェントです。
候補地データは2種類あります:
1. OSM実データ: 工業地域・廃工場跡地（IDが "osm-" から始まる）
2. FIT認定実データ: fit-portal.go.jp の認定設備集積市区町村（IDが "fit-" から始まる）
   - 太陽光・風力・バイオマス認定施設が集積しているエリアで電力系統接続実績あり
   - 系統空き容量はOCCTO未連携のため非公開

変電所電圧・距離・土地利用・地形などで最適な設置候補地を探索・絞り込み・比較してください。
日本語で回答し、候補地には優先順位と理由を付けてください。`;

  const thinkingSteps: ThinkingStep[] = [];
  let finalCandidates: CandidateSite[] = [];
  let finalText = "";

  const contextNote =
    currentIds.length > 0 ? `\n[現在の候補地IDs: ${currentIds.join(", ")}]` : "";
  const currentMessages: AMessage[] = messages.map((m, i) => ({
    role: m.role,
    content:
      i === messages.length - 1 && m.role === "user"
        ? m.content + contextNote
        : m.content,
  }));

  for (let turn = 0; turn < 5; turn++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM,
      tools,
      messages: currentMessages,
    });

    currentMessages.push({ role: "assistant", content: response.content } as AMessage);

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    for (const block of response.content) {
      if (block.type === "text") {
        finalText = block.text;
        thinkingSteps.push({
          type: "conclusion",
          content: block.text,
          timestamp: new Date().toISOString(),
        });
      } else if (block.type === "tool_use") {
        thinkingSteps.push({
          type: "tool-call",
          content: `ツール呼び出し: ${block.name}`,
          toolName: block.name,
          toolInput: block.input as Record<string, unknown>,
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) break;

    const toolResultContents = await Promise.all(
      toolUseBlocks
        .filter((b) => b.type === "tool_use")
        .map(async (block) => {
          if (block.type !== "tool_use") return null;
          const { result, candidates } = await executeTool(
            block.name,
            block.input as Record<string, unknown>,
            allSites
          );
          if (candidates.length > 0) finalCandidates = candidates;
          const resultText = JSON.stringify(result, null, 2);
          thinkingSteps.push({
            type: "tool-result",
            content: resultText,
            toolOutput: result,
            timestamp: new Date().toISOString(),
          });
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: resultText,
          };
        })
    );
    const toolResults: AMessage = {
      role: "user",
      content: toolResultContents.filter(Boolean) as {
        type: "tool_result";
        tool_use_id: string;
        content: string;
      }[],
    };
    currentMessages.push(toolResults);
  }

  return {
    message: finalText || `${finalCandidates.length}件の候補地を検索しました。`,
    candidates: finalCandidates,
    thinkingSteps,
  };
}

// ============================================================
// メインハンドラ
// ============================================================
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: ChatRequest = await request.json();
    const { messages, currentCandidateIds = [] } = body;

    // 実データを先に取得（OSM + FIT、キャッシュがあれば即時返却）
    let allSites: CandidateSite[];
    try {
      const [osmSites, fitSites] = await Promise.all([
        getCandidateSites(),
        getFitCandidateSites().catch((e) => {
          console.warn("[chat] FIT候補地取得失敗（OSMのみ使用）:", e);
          return [] as CandidateSite[];
        }),
      ]);
      allSites = [...osmSites, ...fitSites];
      console.log(`[chat] allSites: OSM ${osmSites.length}件 + FIT ${fitSites.length}件 = ${allSites.length}件`);
    } catch (e) {
      console.error("[chat] 候補地取得失敗:", e);
      return NextResponse.json(
        {
          message:
            "候補地データの取得に失敗しました（OSM/Overpass APIに接続できませんでした）。しばらく後に再試行してください。",
          candidates: [],
          thinkingSteps: [],
        } satisfies ChatApiResponse,
        { status: 200 }
      );
    }

    const hasApiKey = Boolean(
      process.env.ANTHROPIC_API_KEY?.replace(/your_.*_here/, "").trim()
    );

    let result: { message: string; candidates: CandidateSite[]; thinkingSteps: ThinkingStep[] };

    if (hasApiKey) {
      result = await runClaudeAgent(messages, currentCandidateIds, allSites);
    } else {
      const lastUserMsg = messages.filter((m) => m.role === "user").pop()?.content ?? "";
      result = await buildRuleBasedResponse(lastUserMsg, currentCandidateIds, allSites);
    }

    const { message, candidates, thinkingSteps } = result;

    let mapAction: ChatApiResponse["mapAction"] | undefined;
    if (candidates.length > 0) {
      const centroid = calcCentroid(candidates);
      if (centroid) {
        mapAction = {
          center: centroid,
          zoom:
            candidates.length <= 3
              ? 11
              : candidates.length <= 10
              ? 9
              : 8,
          highlightIds: candidates.map((s) => s.id),
        };
      }
    }

    return NextResponse.json(
      { message, candidates, thinkingSteps, mapAction } satisfies ChatApiResponse
    );
  } catch (error) {
    console.error("Chat API error:", error);
    const msg = error instanceof Error ? error.message : "不明なエラー";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
