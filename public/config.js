/* ============================================================
   config.js — フロントの接続設定（全ページで最初に読み込む）
   ------------------------------------------------------------
   ・MALAMA_API_BASE      … バックエンド Worker（malamamapdb）の URL
   ・MALAMA_SUPABASE_URL  … Supabase プロジェクト URL
   ・MALAMA_SUPABASE_ANON_KEY … publishable / anon キー（公開して安全）
   ※ anon キーはブラウザに出しても問題ない。書き込みは RLS で保護される。

   API_BASE は「開いているホスト」で自動切替する：
     ・localhost / 127.0.0.1 で開いた   → ローカル Worker（wrangler dev）
     ・それ以外（本番 web.malama-map.com 等）→ 本番 Worker
   これで同じファイルがローカルでも本番でも動く（差し替え不要）。
   ============================================================ */
(function () {
  var host = location.hostname;
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
  // 本番バックエンド Worker（malamamapdb）の公開 URL
  var PROD_API_BASE = "https://malamamapdb.kenmiyauchi2009.workers.dev";
  window.MALAMA_API_BASE = isLocal ? "http://localhost:8787" : PROD_API_BASE;

  // サイト（フロント）自身の公開 URL。Google ログイン後のリダイレクト先に使う。
  //   ・開発  → http://localhost:3000（開発用HTTPサーバー）
  //   ・本番  → PROD_SITE_URL
  // ⚠️ Supabase ダッシュボード（Authentication → URL Configuration →
  //    Redirect URLs）に、開発と本番の両方の URL を登録しておくこと。
  //    登録が無い側は無視され、Supabase の Site URL（＝本番）へ飛ばされる。
  var DEV_SITE_URL = "http://localhost:3000";
  var PROD_SITE_URL = "https://web.malama-map.com"; // 本番フロントのURL（必要なら変更）
  window.MALAMA_SITE_URL = isLocal ? DEV_SITE_URL : PROD_SITE_URL;
})();

window.MALAMA_SUPABASE_URL = "https://kykuculompxyzpwnykbl.supabase.co";
window.MALAMA_SUPABASE_ANON_KEY = "sb_publishable_1uKPKqd-GuBdxexcpztpXA_HaymAdaV";
