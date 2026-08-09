/* ============================================================
   i18n.js — 日本語 / 英語の切替（全ページで config.js の直後に読む）
   ------------------------------------------------------------
   ・window.LANG … 現在の言語 "ja" | "en"
   ・t(key, vars) … 翻訳文字列を返す（{name} 等を差し込み可）
   ・setLang(lang) … 記憶してページ再読込（全動的表示も新言語で描き直す）
   ・DOM の [data-i18n]（textContent）/ [data-i18n-html]（innerHTML）/
     [data-i18n-ph]（placeholder）を自動翻訳
   ・ヘッダーに JA/EN トグルを自動挿入
   初期言語：localStorage → ブラウザ言語（ja*→日本語, それ以外→英語）
   ※ 既に日英併記の項目（ナビ「地図 Map」等）はそのまま（両者が読める）。
     図鑑の種の説明文・文化メモは対象外（日本語のまま）。
   ============================================================ */
(function () {
  var STORE_KEY = "malama_lang";

  // 対応言語（将来ここに1行足す＋各辞書にその言語コードの訳を足すだけで増やせる）
  // 先頭が既定言語。code は辞書のキー・navigator.language の前方一致に使う。
  var LANGUAGES = [
    { code: "ja", label: "日本語" },
    { code: "en", label: "English" },
  ];

  // 地球儀アイコン（インライン SVG・緯線/経線グリッド入り）
  var GLOBE_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7">' +
    '<circle cx="12" cy="12" r="10"/>' +
    '<line x1="12" y1="2" x2="12" y2="22"/>' +
    '<line x1="2" y1="12" x2="22" y2="12"/>' +
    '<path d="M12 2C6.5 6 6.5 18 12 22"/>' +
    '<path d="M12 2C17.5 6 17.5 18 12 22"/>' +
    '<path d="M3.6 8C8 6.6 16 6.6 20.4 8"/>' +
    '<path d="M3.6 16C8 17.4 16 17.4 20.4 16"/></svg>';

  function langCodes() { return LANGUAGES.map(function (l) { return l.code; }); }

  function detect() {
    var codes = langCodes();
    var saved = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (saved && codes.indexOf(saved) !== -1) return saved;
    var nav = (navigator.language || "").toLowerCase();
    for (var i = 0; i < codes.length; i++) {
      if (nav.indexOf(codes[i]) === 0) return codes[i];
    }
    return codes[0]; // 既定（先頭）
  }

  window.LANG = detect();
  document.documentElement.lang = window.LANG;

  /* ---------- 辞書 ---------- */
  var DICT = {
    // 共通
    "header.tagline": { ja: "ハワイ在来植物を守る市民マップ", en: "A citizen map protecting Hawaiʻi's native plants" },

    // ホーム（ランディング）
    "home.hero_sub": { ja: "Mālama（マラマ）＝ハワイ語で「守る・世話をする」", en: "Mālama — Hawaiian for \"to protect, to care for\"" },
    "home.hero_lede": { ja: "ハワイの在来植物を市民の力で記録し、外来種の侵食と ROD を早期に見つけるためのマップです。", en: "A citizen-powered map to record Hawaiʻi's native plants and catch invasive spread and ROD early." },
    "home.cta_map": { ja: "地図を見る", en: "View the map" },
    "home.cta_report": { ja: "投稿する", en: "Report a sighting" },
    "home.mission_title": { ja: "このアプリについて", en: "About this app" },
    "home.mission_body": { ja: "みんなが撮った植物の写真を AI（BioCLIP）が種を判定し、在来種と外来種を見分けます。投稿が集まるほど、外来種の広がりや ROD（ʻŌhiʻa の急性枯死病）の兆候を早く見つけられます。", en: "An AI model (BioCLIP) identifies the species from everyone's plant photos and tells native from invasive. As reports build up, the spread of invasives and signs of ROD (Rapid ʻŌhiʻa Death) show up earlier." },
    "home.steps_title": { ja: "使い方 3ステップ", en: "How it works — 3 steps" },
    "home.step1_title": { ja: "写真を撮る", en: "Take a photo" },
    "home.step1_body": { ja: "植物の写真を撮る／選ぶと、AI が種の候補を出します。分からなければ「未確認」でOK。", en: "Take or choose a photo and the AI suggests candidate species. Not sure? \"Unconfirmed\" is fine." },
    "home.step2_title": { ja: "場所を選ぶ", en: "Choose the spot" },
    "home.step2_body": { ja: "写真に位置情報があれば自動でサジェスト。地図タップや「現在地を使う」でも設定できます。", en: "If the photo has GPS, it's suggested automatically. You can also tap the map or use your current location." },
    "home.step3_title": { ja: "投稿する", en: "Submit" },
    "home.step3_body": { ja: "投稿すると地図と図鑑にすぐ反映。新種を見つけると発見の演出が出ます。", en: "Your report appears on the map and dex instantly — a discovery moment plays for new finds." },
    "home.features_title": { ja: "できること", en: "Features" },
    "home.feat_map_body": { ja: "目撃された植物をピンで表示。タップで写真・種名・AIの確信度が見られます。", en: "Sightings shown as pins. Tap for the photo, species, and AI confidence." },
    "home.feat_dex_body": { ja: "見つけた植物が集まる図鑑。検索や在来/外来の絞り込みができます。", en: "A field guide of found plants, with search and native/invasive filters." },
    "home.feat_ai_body": { ja: "写真から種を AI が判定。追加学習なしでハワイ固有種を識別します。", en: "AI identifies species from photos — recognizing Hawaiʻi's endemics with no extra training." },
    "home.feat_stats_body": { ja: "在来/外来の傾向やヒートマップを可視化。観測トレンドとして正直に表示します。", en: "Visualizes native/invasive trends and a heatmap — shown honestly as observation trends." },
    "nav.mypage": { ja: "マイページ", en: "My Page" },
    "nav.login": { ja: "ログイン", en: "Login" },
    "lang.ja": { ja: "日本語", en: "日本語" },
    "lang.en": { ja: "English", en: "English" },

    // フッター
    "footer.community": { ja: "市民科学でハワイの森を守る · みんなの投稿を共有", en: "Protecting Hawaiʻi's forests through citizen science · shared by all" },
    "footer.report": { ja: "フェーズ2 · 投稿はアカウントに紐づき、地図にすぐ共有されます", en: "Phase 2 · Sightings are tied to your account and shared to the map instantly" },
    "footer.stats": { ja: "市民科学でハワイの森を守る · 数値は観測トレンド（目撃報告数）", en: "Citizen science for Hawaiʻi's forests · figures are observation trends (report counts)" },
    "footer.profile": { ja: "フェーズ2 · あなたの発見の記録", en: "Phase 2 · A record of your discoveries" },
    "footer.login": { ja: "フェーズ2 · アカウントで投稿を共有・保存します", en: "Phase 2 · Accounts let you share and save your sightings" },

    // 地図ページ
    "index.legend_rod": { ja: "ROD 要観察（ʻŌhiʻa）", en: "ROD watch (ʻŌhiʻa)" },
    "map.bioclip_id": { ja: "BioCLIP 判定", en: "BioCLIP result" },
    "map.rod_watch": { ja: "ROD 要観察", en: "ROD watch" },
    "map.awaiting": { ja: "コミュニティ判定待ち", en: "Awaiting community review" },
    "map.unconfirmed": { ja: "未確認", en: "Unconfirmed" },

    // 図鑑ページ
    "plants.lead": { ja: "ハワイの在来種と、森を脅かす外来種。見つけて投稿すると図鑑が埋まっていきます。", en: "Hawaiʻi's native plants and the invasives threatening the forest. Find and report them to fill the guide." },
    "plants.empty": { ja: "まだ発見された植物がありません。<a href=\"report.html\">投稿</a>すると図鑑に追加されます。", en: "No plants discovered yet. <a href=\"report.html\">Report</a> one to add it to the guide." },
    "plants.search_ph": { ja: "種名で検索（学名・ハワイ語名）…", en: "Search by name (scientific / Hawaiian)…" },
    "plants.no_result": { ja: "該当する植物が見つかりません。", en: "No matching plants found." },
    "plants.community_tag": { ja: "コミュニティ発見", en: "Community find" },
    "plants.unverified": { ja: "未分類 Unverified", en: "Unverified" },
    "plants.found_x": { ja: "発見 ×{n}", en: "Found ×{n}" },
    "plants.find_hint": { ja: "見つけて投稿すると図鑑が完成します", en: "Find and report it to complete the guide" },
    "plants.bar_discovered": { ja: "発見 Discovered", en: "Discovered" },
    "plants.community_count": { ja: "コミュニティ発見 <strong>{n}</strong> 種", en: "<strong>{n}</strong> community finds" },
    "plants.detail_sightings": { ja: "目撃 Sightings", en: "Sightings" },
    "plants.detail_empty": { ja: "まだ目撃報告がありません。見つけて投稿しよう！", en: "No sightings yet. Go find and report one!" },
    "plants.cultural": { ja: "文化・豆知識:", en: "Culture & notes:" },
    "plants.community_desc": { ja: "コミュニティの投稿で見つかった種です。BioCLIP が判定しました。", en: "A species found through community reports, identified by BioCLIP." },
    "plants.community_memo": { ja: "在来/外来の分類は今後コミュニティで確認されます。", en: "Native/invasive classification will be confirmed by the community." },
    "plants.memo": { ja: "メモ:", en: "Note:" },
    "plants.keystone": { ja: "キーストーン種", en: "Keystone species" },
    "plants.sightings_count": { ja: "（{n}件・最終 {last}）", en: "({n} reports · latest {last})" },

    // 投稿ページ
    "report.lead": { ja: "見つけた植物の場所と写真を記録しよう。投稿は地図にすぐ反映されます。", en: "Record the location and photo of a plant you found. Your report appears on the map right away." },
    "report.photo_tap": { ja: "タップして写真を撮る / 選ぶ", en: "Tap to take or choose a photo" },
    "report.photo_sub": { ja: "写真を撮る / 選ぶ", en: "Take or choose a photo" },
    "report.crop_btn": { ja: "範囲を選ぶ（複数の植物があるとき）", en: "Select area (when multiple plants)" },
    "report.clear_photo": { ja: "写真を消す", en: "Remove photo" },
    "report.loc_hint": { ja: "写真に位置情報があれば自動で候補を表示します。地図をタップ／ピンをドラッグで微調整できます。", en: "If the photo has GPS, we suggest it automatically. Tap the map or drag the pin to fine-tune." },
    "report.use_gps": { ja: "現在地を使う", en: "Use current location" },
    "report.no_coord": { ja: "未選択", en: "Not selected" },
    "report.picked": { ja: "選択済: {lat}, {lng}", en: "Selected: {lat}, {lng}" },
    "report.gps_loading": { ja: "現在地を取得中…", en: "Getting current location…" },
    "report.gps_outside": { ja: "現在地がハワイ範囲外です。地図をタップして選んでください。", en: "Current location is outside Hawaiʻi. Tap the map to choose." },
    "report.gps_fail": { ja: "現在地の取得に失敗（地図をタップしてください）", en: "Couldn't get location (please tap the map)" },
    "report.gps_unavailable": { ja: "この端末では現在地を取得できません。地図をタップして選んでください。", en: "This device can't get your location. Tap the map to choose." },
    "report.plant_ph": { ja: "— 写真を撮ると候補が出ます —", en: "— Take a photo to see candidates —" },
    "report.plant_hint_html": { ja: "植物名は <strong>BioCLIP の候補</strong>から選びます。上の候補リストをタップしても選べます。分からなければ「未確認」でOK。", en: "Pick the species from <strong>BioCLIP's candidates</strong>. You can also tap the list above. Not sure? \"Unconfirmed\" is fine." },
    "report.note_ph": { ja: "例：葉に黒ずみあり、ROD要観察", en: "e.g. leaves have dark spots, watch for ROD" },
    "report.checking_login": { ja: "ログイン確認中…", en: "Checking login…" },
    "report.reporter_hint": { ja: "ログイン中のアカウント名で投稿されます。", en: "You'll post under your signed-in account name." },
    "report.submit": { ja: "この内容で投稿する", en: "Submit this report" },
    "report.submitting": { ja: "投稿中…", en: "Submitting…" },
    "report.uploading": { ja: "写真をアップロード中…", en: "Uploading photo…" },
    "report.submit_fail": { ja: "投稿に失敗しました。時間をおいて再度お試しください。", en: "Report failed. Please try again later." },
    "report.done": { ja: "投稿しました！地図に反映されます", en: "Reported! It will appear on the map." },
    "report.unknown_opt": { ja: "未確認（あとでみんなで判定）", en: "Unconfirmed (community will decide later)" },
    "report.exif_here": { ja: "写真の場所を検出しました。<strong>ここですか？</strong><br><small>違う場合は地図をタップ、またはピンをドラッグして調整できます。</small>", en: "Detected the photo's location. <strong>Is this the spot?</strong><br><small>If not, tap the map or drag the pin to adjust.</small>" },
    "report.exif_ok": { ja: "ここでOK", en: "Yes, here" },
    "report.exif_outside": { ja: "写真の位置がハワイ範囲外でした。地図で選んでください。", en: "The photo's location is outside Hawaiʻi. Please choose on the map." },
    "report.crop_hint_html": { ja: "判定したい<strong>1株まるごと</strong>を囲んでください。", en: "Frame the <strong>whole single plant</strong> you want identified." },
    "report.crop_cancel": { ja: "キャンセル", en: "Cancel" },
    "report.crop_confirm": { ja: "この範囲で判定", en: "Identify this area" },

    // AI（BioCLIP）
    "ai.analyzing": { ja: "BioCLIP が解析中…", en: "BioCLIP is analyzing…" },
    "ai.head": { ja: "BioCLIP 種提案", en: "BioCLIP suggestions" },
    "ai.not_in_list": { ja: "AI判定：図鑑リストにない種の可能性（{name}）", en: "AI: possibly a species not in the guide ({name})" },
    "ai.none": { ja: "どれでもない／未確認にする", en: "None of these / mark unconfirmed" },
    "ai.error": { ja: "AI判定に失敗しました。サーバーに接続できません。", en: "AI identification failed. Can't reach the server." },
    "ai.low_note": { ja: "確信度が低いため「未確認」を推奨します（近縁種と紛らわしい可能性）。", en: "Low confidence — we suggest \"Unconfirmed\" (may be confused with a close relative)." },
    "ai.candidates": { ja: "BioCLIP 候補", en: "BioCLIP candidates" },
    "ai.confidence": { ja: "確信度 {pct}%", en: "Confidence {pct}%" },
    "ai.verdict_prefix": { ja: "AI判定：", en: "AI: " },
    "ai.manual_pick": { ja: "手動で植物名を選んでください。", en: "Please pick the species manually." },
    "ai.unavailable": { ja: "AI種提案は今は使えません（BioCLIPサーバー未起動の可能性）。", en: "AI suggestions are unavailable (the BioCLIP server may be offline)." },
    "ai.no_candidates": { ja: "候補が得られませんでした。", en: "No candidates were returned." },
    "ai.pick_or_unconfirmed": { ja: "下から候補を選ぶか、未確認で投稿できます", en: "Pick a candidate below, or post as unconfirmed" },
    "ai.tap_to_select": { ja: "候補をタップして選択 ▼", en: "Tap a candidate to select ▼" },
    "ai.foot": { ja: "BioCLIP 2.5（さくらのサーバーで推論）", en: "BioCLIP 2.5 (inference on Sakura server)" },
    "report.native_tag": { ja: "［在来］", en: "[Native]" },
    "report.invasive_tag": { ja: "［外来］", en: "[Invasive]" },
    "report.err_login": { ja: "投稿にはログインが必要です。", en: "You must be logged in to post." },
    "report.err_no_loc": { ja: "地点が選ばれていません。地図をタップするか「現在地を使う」を押してください。", en: "No location selected. Tap the map or press \"Use current location\"." },
    "report.err_no_plant": { ja: "植物名を選んでください（分からなければ「未確認」でOK）。", en: "Please choose a species (\"Unconfirmed\" is fine if unsure)." },
    "report.no_note": { ja: "（メモなし）", en: "(no note)" },

    // 発見演出
    "discovery.title": { ja: "じゃじゃーん！新種発見", en: "Ta-da! New discovery" },
    "discovery.dex": { ja: "図鑑 <strong>{found} / {total}</strong> 種を発見！", en: "Guide: <strong>{found} / {total}</strong> species found!" },
    "discovery.community": { ja: "コミュニティ発見 <strong>{n}</strong> 種目！", en: "Community find #<strong>{n}</strong>!" },
    "discovery.to_map": { ja: "地図で見る", en: "View on map" },
    "discovery.to_dex": { ja: "図鑑を見る", en: "View guide" },

    // 統計ページ
    "stats.lead": { ja: "みんなの投稿から、在来種と外来種の傾向を読み解きます。", en: "Read native vs. invasive trends from everyone's reports." },
    "stats.note_html": { ja: "※ ここに出るのは <strong>観測トレンド（目撃報告数）</strong> であり、植物の実際の個体数ではありません。報告数は観測者・投稿の増減にも左右されるため、構成比や地点数など「努力に左右されにくい指標」を重視しています。", en: "※ These are <strong>observation trends (report counts)</strong>, not actual plant populations. Counts depend on how many people observe and post, so we emphasize effort-robust metrics like composition ratios and location counts." },
    "stats.tab_summary": { ja: "サマリー", en: "Summary" },
    "stats.tab_trend": { ja: "トレンド", en: "Trend" },
    "stats.tab_ranking": { ja: "ランキング", en: "Ranking" },
    "stats.tab_heat": { ja: "ヒートマップ", en: "Heatmap" },
    "stats.comp_title": { ja: "在来 vs 外来（報告数の構成比）", en: "Native vs. invasive (share of reports)" },
    "stats.monthly_title": { ja: "月別 目撃報告数（観測トレンド）", en: "Monthly report counts (observation trend)" },
    "stats.share_title": { ja: "在来 vs 外来 シェアの推移", en: "Native vs. invasive share over time" },
    "stats.top_title": { ja: "よく報告される種 トップ", en: "Most-reported species" },
    "stats.change_title": { ja: "前期比の増減（直近 vs その前）", en: "Change vs. previous period (latest vs. prior)" },
    "stats.heat_note": { ja: "濃いほど目撃報告が集中している場所です（＝観測トレンド。植物の個体数ではありません）。希少種は将来的に座標をぼかして表示します。", en: "Darker areas have more concentrated reports (an observation trend, not plant counts). Rare species' coordinates will be blurred in the future." },
    "stats.kpi_total": { ja: "合計 投稿数", en: "Total reports" },
    "stats.kpi_species": { ja: "発見した種数", en: "Species found" },
    "stats.kpi_contributors": { ja: "貢献者数", en: "Contributors" },
    "stats.kpi_rod": { ja: "ROD報告（ʻŌhiʻa）", en: "ROD reports (ʻŌhiʻa)" },
    "stats.kpi_recent": { ja: "直近30日の投稿", en: "Reports in last 30 days" },
    "stats.legend_native": { ja: "在来 Native", en: "Native" },
    "stats.legend_invasive": { ja: "外来 Invasive", en: "Invasive" },
    "stats.legend_community": { ja: "未分類", en: "Unclassified" },
    "stats.ds_total": { ja: "合計", en: "Total" },
    "stats.ds_native": { ja: "在来", en: "Native" },
    "stats.ds_invasive": { ja: "外来", en: "Invasive" },
    "stats.ds_native_pct": { ja: "在来 %", en: "Native %" },
    "stats.ds_invasive_pct": { ja: "外来 %", en: "Invasive %" },
    "stats.empty_none": { ja: "まだ投稿がありません。", en: "No reports yet." },
    "stats.trend_insufficient": { ja: "月をまたぐデータが貯まると傾向グラフが表示されます（現在はデータ不足）。", en: "Trend charts appear once data spans multiple months (not enough data yet)." },
    "stats.change_insufficient": { ja: "2か月分以上のデータが貯まると増減が表示されます（データ不足）。", en: "Change appears once there's 2+ months of data (not enough yet)." },
    "stats.change_none": { ja: "直近2か月に投稿がありません。", en: "No reports in the last two months." },
    "stats.new_plus": { ja: "新規 +{n}", en: "New +{n}" },
    "stats.flat": { ja: "±0", en: "±0" },
    "stats.alert_label": { ja: "外来急増", en: "Invasive surge" },
    "stats.heat_all": { ja: "すべて", en: "All" },
    "stats.heat_native": { ja: "在来", en: "Native" },
    "stats.heat_invasive": { ja: "外来", en: "Invasive" },
    "stats.heat_rod": { ja: "ROD", en: "ROD" },
    "stats.heat_empty": { ja: "この条件の投稿がまだありません。", en: "No reports match this filter yet." },

    // マイページ
    "profile.joined": { ja: "参加日", en: "Joined" },
    "profile.logout": { ja: "ログアウト", en: "Log out" },
    "profile.stats": { ja: "発見 {species} 種 ・ 投稿 {reports} 件", en: "{species} species found · {reports} reports" },
    "profile.empty": { ja: "まだ植物を投稿していません。<a href=\"report.html\">投稿</a>すると、ここに記録が残ります。", en: "You haven't reported any plants yet. <a href=\"report.html\">Report</a> one to start your record." },
    "profile.empty_other": { ja: "このユーザーはまだ植物を投稿していません。", en: "This user hasn't reported any plants yet." },
    "profile.finds_mine": { ja: "見つけた植物 My Finds", en: "My Finds" },
    "profile.finds_other": { ja: "{name} の発見", en: "{name}'s Finds" },
    "profile.unconfirmed": { ja: "未確認", en: "Unconfirmed" },

    // ログイン
    "login.lead": { ja: "投稿するには Google アカウントでのログインが必要です。", en: "You need to sign in with a Google account to post." },
    "login.google": { ja: "Google でログイン", en: "Sign in with Google" },
    "login.hint": { ja: "ログインすると投稿がアカウントに紐づき、地図・図鑑に共有されます。", en: "Signing in ties your reports to your account and shares them to the map and guide." },
  };

  /* ---------- t() ---------- */
  window.t = function (key, vars) {
    var entry = DICT[key];
    var s = entry ? (entry[window.LANG] != null ? entry[window.LANG] : entry.ja) : key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
      });
    }
    return s;
  };

  /* ---------- 言語切替（記憶して再読込） ---------- */
  window.setLang = function (lang) {
    if (langCodes().indexOf(lang) === -1) return;
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    location.reload();
  };

  /* ---------- 静的 DOM の翻訳 ---------- */
  function applyStatic() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = window.t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = window.t(el.getAttribute("data-i18n-html"));
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      el.setAttribute("placeholder", window.t(el.getAttribute("data-i18n-ph")));
    });
  }

  /* ---------- ヘッダーに地球儀＋言語メニューを挿入 ---------- */
  function injectSwitch() {
    var header = document.querySelector(".site-header");
    if (!header || document.querySelector(".lang-switch")) return;

    var wrap = document.createElement("div");
    wrap.className = "lang-switch";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lang-globe";
    btn.setAttribute("aria-label", "言語を選ぶ / Choose language");
    btn.setAttribute("aria-haspopup", "true");
    btn.innerHTML = GLOBE_SVG + '<span class="lang-caret" aria-hidden="true">▾</span>';

    var menu = document.createElement("div");
    menu.className = "lang-menu";
    menu.hidden = true;

    LANGUAGES.forEach(function (lng) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "lang-item" + (window.LANG === lng.code ? " active" : "");
      item.textContent = lng.label;
      item.addEventListener("click", function () { window.setLang(lng.code); });
      menu.appendChild(item);
    });

    // 地球儀クリックで開閉／外側クリックで閉じる
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute("aria-expanded", String(!menu.hidden));
    });
    document.addEventListener("click", function () { menu.hidden = true; });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    header.appendChild(wrap);
  }

  function run() { applyStatic(); injectSwitch(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
