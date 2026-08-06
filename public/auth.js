/* ============================================================
   auth.js — Supabase Auth 連携（全ページで config.js の後に読み込む）
   ------------------------------------------------------------
   ・supabase-js（UMD・グローバル `supabase`）でクライアントを生成
   ・Google ログイン / ログアウト（メール＋パスワードは廃止）
   ・requireLogin(): 未ログインなら login.html へ退避
   ・ヘッダーのナビにログイン状態を描画
   投稿の際は getAccessToken() の JWT を Authorization: Bearer で送る。
   ============================================================ */

// supabase-js の UMD グローバルからクライアントを作る。
// PKCE フロー：OAuth コールバックが ?code=... 方式になり、URL に
// トークンが露出しない（implicit フローの #access_token を避ける）。
const sb = supabase.createClient(
  window.MALAMA_SUPABASE_URL,
  window.MALAMA_SUPABASE_ANON_KEY,
  {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);
window.sb = sb;

/* ---------- セッション/ユーザー ---------- */
async function getCurrentUser() {
  const { data } = await sb.auth.getUser();
  return data.user || null;
}

async function getAccessToken() {
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.access_token : null;
}

// ログインユーザーの表示名（Google の名前 → メールのローカル部）
function userDisplayName(user) {
  if (!user) return "";
  const m = user.user_metadata || {};
  return m.full_name || m.name || (user.email ? user.email.split("@")[0] : "ユーザー");
}

/* ---------- ログイン必須ページの門番 ---------- */
// 未ログインなら login.html に飛ばす（戻り先を redirect に載せる）。
// ログイン済みなら user を返す。
async function requireLogin() {
  const user = await getCurrentUser();
  if (!user) {
    const here = encodeURIComponent(location.pathname.split("/").pop() || "index.html");
    location.href = "login.html?redirect=" + here;
    return null;
  }
  return user;
}

/* ---------- 認証アクション（Google ログインのみ） ---------- */
async function signInWithGoogle(redirectTo) {
  // リダイレクト先は config.js の MALAMA_SITE_URL（開発/本番で自動切替）を基準にする。
  // location.origin だと開発ポート違いなどで Supabase の許可URLと不一致になりやすい。
  var base = window.MALAMA_SITE_URL || location.origin;
  return sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: redirectTo || base + "/index.html" },
  });
}

async function signOut() {
  await sb.auth.signOut();
  location.reload();
}

/* ---------- ヘッダーにログイン状態を描画 ---------- */
async function renderAuthNav() {
  const nav = document.querySelector(".main-nav");
  if (!nav) return;

  // 先に await（この関数は DOMContentLoaded と onAuthStateChange から
  // ほぼ同時に呼ばれるため、削除→追加は await を挟まず一気に行う。
  // await の前で消すと、両方の呼び出しが削除をすり抜けて二重に追加され、
  // ログアウトボタンが複数出てしまう）。
  const user = await getCurrentUser();

  // ここから同期処理（await なし）＝重複が起きない
  // 既存の「マイページ（disabled）」プレースホルダを取り除く
  nav.querySelectorAll("a.disabled").forEach(function (a) {
    if (a.textContent.indexOf("マイページ") === 0) a.remove();
  });
  // 既存の認証ナビ項目を「すべて」除去（過去に重複していた分も掃除）
  nav.querySelectorAll("#authNavItem").forEach(function (a) { a.remove(); });

  const item = document.createElement("a");
  item.id = "authNavItem";
  item.href = "#";

  if (user) {
    // ログイン中はプロフィール（マイページ）へのリンク。ログアウトはマイページ内に置く。
    item.href = "profile.html";
    item.innerHTML = t("nav.mypage") + "<small>" + userDisplayName(user) + "</small>";
  } else {
    item.innerHTML = t("nav.login") + "<small>Login</small>";
    item.href = "login.html";
  }
  nav.appendChild(item);
}

// 認証状態が変わったらナビを描き直す。
// OAuth コールバック（#access_token=... がURLに残る）でサインインしたら、
// supabase がセッションを取り込んだ後に URL からトークンを消す。
sb.auth.onAuthStateChange(function (event) {
  renderAuthNav();
  const hasCallback =
    location.hash.indexOf("access_token") !== -1 ||
    location.hash.indexOf("error") !== -1 ||
    location.search.indexOf("code=") !== -1;
  if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && hasCallback) {
    history.replaceState(null, "", location.pathname);
  }
});

document.addEventListener("DOMContentLoaded", renderAuthNav);
