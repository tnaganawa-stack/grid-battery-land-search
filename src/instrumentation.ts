export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // サーバー起動時にバックグラウンドでデータをプリロード（キャッシュ温め）
    // ユーザーが最初にアクセスする前にデータを準備することで体感速度を改善
    setTimeout(async () => {
      try {
        const [{ getCandidateSites }, { getFitCandidateSites }] = await Promise.all([
          import("./lib/candidateData"),
          import("./lib/fitCandidateData"),
        ]);
        await Promise.all([
          getCandidateSites().catch((e: unknown) =>
            console.warn("[preload] OSM候補地:", e instanceof Error ? e.message : e)
          ),
          getFitCandidateSites().catch((e: unknown) =>
            console.warn("[preload] FIT候補地:", e instanceof Error ? e.message : e)
          ),
        ]);
        console.log("[preload] 候補地データのウォームアップ完了");
      } catch (e) {
        console.warn("[preload] ウォームアップ失敗:", e);
      }
    }, 1000);
  }
}
