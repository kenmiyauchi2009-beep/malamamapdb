/* ============================================================
   stats.js — 統計ページ（サマリー / トレンド / ランキング）
   ------------------------------------------------------------
   ・投稿(getAllSightings)を1回走査して集計
   ・Chart.js で可視化（在来=緑 / 外来=Lehua赤 / 未分類=グレー）
   ・重要：目撃報告数は"個体数"ではない → 「観測トレンド」と表示、
     小サンプルは「データ不足」で断定を避ける（観測努力バイアス対策）
   ============================================================ */

// テーマ色（style.css の :root と同じ実値）
const C = {
  forest: "#234b3a",
  forestLight: "#3d6b52",
  lehua: "#b03a2e",
  gray: "#7a7261",
  rule: "#cbbfa6",
  textSoft: "#7a7259",
};

// Chart.js 全体の既定（フォント・色をテーマに合わせる）
if (window.Chart) {
  Chart.defaults.font.family =
    '"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif';
  Chart.defaults.color = C.textSoft;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
}

const charts = {};       // 生成した Chart インスタンス（タブ表示時に resize する）
const chartsByTab = { summary: [], trend: [], ranking: [] };

/* ---------- 集計（1回の走査） ---------- */
function aggregate() {
  const all = getAllSightings();

  const monthly = {};        // "YYYY-MM" -> { total, native, invasive }
  const species = {};        // key -> { name, category, count }
  const speciesMonthly = {}; // key -> { "YYYY-MM": count }
  const contributors = {};   // reporter -> true

  let total = 0, nativeCount = 0, invasiveCount = 0, communityCount = 0, rodCount = 0, recent30 = 0;

  // 直近30日の下限（YYYY-MM-DD の文字列比較でOK）
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  all.forEach(function (s) {
    total++;
    const plant = getPlantById(s.plantId);
    const category = plant ? plant.category : "community";
    const key = plant ? plant.id : (s.speciesName || "unknown");
    const name = plant ? plant.hawaiianName : (s.speciesName || "未確認");
    const month = (s.date || "").slice(0, 7);

    if (plant && plant.rodRisk) rodCount++;
    if (category === "native") nativeCount++;
    else if (category === "invasive") invasiveCount++;
    else communityCount++;
    if (s.reporter) contributors[s.reporter] = true;
    if (s.date && s.date >= cutoff) recent30++;

    if (month) {
      if (!monthly[month]) monthly[month] = { total: 0, native: 0, invasive: 0 };
      monthly[month].total++;
      if (category === "native") monthly[month].native++;
      else if (category === "invasive") monthly[month].invasive++;

      if (!speciesMonthly[key]) speciesMonthly[key] = {};
      speciesMonthly[key][month] = (speciesMonthly[key][month] || 0) + 1;
    }

    if (!species[key]) species[key] = { name: name, category: category, count: 0 };
    species[key].count++;
  });

  return {
    all: all,
    total: total,
    nativeCount: nativeCount,
    invasiveCount: invasiveCount,
    communityCount: communityCount,
    rodCount: rodCount,
    recent30: recent30,
    contributors: Object.keys(contributors).length,
    distinctSpecies: Object.keys(species).length,
    months: Object.keys(monthly).sort(),
    monthly: monthly,
    species: species,
    speciesMonthly: speciesMonthly,
  };
}

const catColor = function (cat) {
  return cat === "native" ? C.forestLight : cat === "invasive" ? C.lehua : C.gray;
};

/* ---------- タブ1：サマリー ---------- */
function renderSummary(a) {
  const tiles = [
    { num: a.total, label: "合計 投稿数" },
    { num: a.distinctSpecies, label: "発見した種数" },
    { num: a.contributors, label: "貢献者数" },
    { num: a.rodCount, label: "ROD報告（ʻŌhiʻa）" },
    { num: a.recent30, label: "直近30日の投稿" },
  ];
  document.getElementById("kpiGrid").innerHTML = tiles.map(function (t) {
    return '<div class="kpi-tile"><div class="kpi-num">' + t.num +
      '</div><div class="kpi-label">' + t.label + "</div></div>";
  }).join("");

  // 在来 vs 外来 vs 未分類 の構成比（ドーナツ）
  const ctx = document.getElementById("chartComposition");
  if (a.total === 0) {
    ctx.parentNode.insertAdjacentHTML("beforeend",
      '<p class="stats-empty">まだ投稿がありません。</p>');
    return;
  }
  charts.composition = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["在来 Native", "外来 Invasive", "未分類"],
      datasets: [{
        data: [a.nativeCount, a.invasiveCount, a.communityCount],
        backgroundColor: [C.forestLight, C.lehua, C.gray],
        borderColor: "#fbf7ee", borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
    },
  });
  chartsByTab.summary.push(charts.composition);
}

/* ---------- タブ2：トレンド ---------- */
function renderTrend(a) {
  const guard = document.getElementById("trendGuard");
  // データ不足ガード（月をまたぐデータが無い/少ない）
  if (a.total < 5 || a.months.length < 2) {
    guard.hidden = false;
    guard.textContent =
      "月をまたぐデータが貯まると傾向グラフが表示されます（現在はデータ不足）。";
    return;
  }

  const labels = a.months;
  const totalSeries = labels.map(function (m) { return a.monthly[m].total; });
  const nativeSeries = labels.map(function (m) { return a.monthly[m].native; });
  const invasiveSeries = labels.map(function (m) { return a.monthly[m].invasive; });

  // 月別 目撃報告数（合計・在来・外来の折れ線）
  charts.monthly = new Chart(document.getElementById("chartMonthly"), {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        { label: "合計", data: totalSeries, borderColor: C.forest, backgroundColor: C.forest, tension: 0.25 },
        { label: "在来", data: nativeSeries, borderColor: C.forestLight, backgroundColor: C.forestLight, tension: 0.25 },
        { label: "外来", data: invasiveSeries, borderColor: C.lehua, backgroundColor: C.lehua, tension: 0.25 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
  chartsByTab.trend.push(charts.monthly);

  // 在来 vs 外来 シェアの推移（100%積み上げ棒・未分類は除外）
  const nativePct = labels.map(function (m) {
    const d = a.monthly[m]; const base = d.native + d.invasive;
    return base ? Math.round((d.native / base) * 100) : 0;
  });
  const invasivePct = labels.map(function (m) {
    const d = a.monthly[m]; const base = d.native + d.invasive;
    return base ? Math.round((d.invasive / base) * 100) : 0;
  });
  charts.share = new Chart(document.getElementById("chartShare"), {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        { label: "在来 %", data: nativePct, backgroundColor: C.forestLight },
        { label: "外来 %", data: invasivePct, backgroundColor: C.lehua },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: { x: { stacked: true }, y: { stacked: true, max: 100, ticks: { callback: function (v) { return v + "%"; } } } },
    },
  });
  chartsByTab.trend.push(charts.share);
}

/* ---------- タブ3：ランキング・増減 ---------- */
function renderRanking(a) {
  // よく報告される種 トップ8（CSSバー）
  const ranked = Object.keys(a.species).map(function (k) { return a.species[k]; })
    .sort(function (x, y) { return y.count - x.count; }).slice(0, 8);
  const listEl = document.getElementById("rankList");
  if (!ranked.length) {
    listEl.innerHTML = '<p class="stats-empty">まだ投稿がありません。</p>';
  } else {
    const max = ranked[0].count || 1;
    listEl.innerHTML = ranked.map(function (sp) {
      const w = Math.round((sp.count / max) * 100);
      return '<div class="rank-row">' +
        '<span class="rank-name">' + sp.name + "</span>" +
        '<span class="rank-bar"><span class="rank-fill ' + sp.category + '" style="width:' + w + '%"></span></span>' +
        '<span class="rank-count">' + sp.count + "</span>" +
      "</div>";
    }).join("");
  }

  // 前期比の増減（直近の月 vs その前の月）
  const changeGuard = document.getElementById("changeGuard");
  const changeEl = document.getElementById("changeList");
  if (a.months.length < 2) {
    changeGuard.hidden = false;
    changeGuard.textContent = "2か月分以上のデータが貯まると増減が表示されます（データ不足）。";
    return;
  }
  const latest = a.months[a.months.length - 1];
  const prev = a.months[a.months.length - 2];

  const changes = Object.keys(a.speciesMonthly).map(function (key) {
    const cur = a.speciesMonthly[key][latest] || 0;
    const before = a.speciesMonthly[key][prev] || 0;
    const sp = a.species[key];
    return { name: sp.name, category: sp.category, cur: cur, before: before, delta: cur - before };
  }).filter(function (c) { return c.cur !== 0 || c.before !== 0; })
    .sort(function (x, y) { return y.delta - x.delta; });

  if (!changes.length) {
    changeEl.innerHTML = '<p class="stats-empty">直近2か月に投稿がありません。</p>';
    return;
  }

  changeEl.innerHTML = changes.map(function (c) {
    const arrow = c.delta > 0 ? "↑" : c.delta < 0 ? "↓" : "→";
    const dir = c.delta > 0 ? "up" : c.delta < 0 ? "down" : "flat";
    // 外来種が増加＝早期警戒アラート
    const alert = (c.category === "invasive" && c.delta > 0) ? " alert" : "";
    let deltaText;
    if (c.before === 0) deltaText = "新規 +" + c.cur;
    else if (c.delta === 0) deltaText = "±0";
    else {
      const pct = Math.round(((c.cur - c.before) / c.before) * 100);
      deltaText = (c.delta > 0 ? "+" : "") + c.delta + "（" + (pct > 0 ? "+" : "") + pct + "%）";
    }
    return '<div class="rank-row change ' + dir + alert + '">' +
      '<span class="rank-name">' + c.name + "</span>" +
      '<span class="change-arrow">' + arrow + "</span>" +
      '<span class="change-delta">' + deltaText +
        (alert ? ' <span class="change-alertlabel">外来急増</span>' : "") +
      "</span>" +
    "</div>";
  }).join("");
}

/* ---------- タブ切替 ---------- */
document.getElementById("statsTabs").addEventListener("click", function (e) {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  const tab = btn.dataset.tab;
  document.querySelectorAll(".tab-btn").forEach(function (b) {
    b.classList.toggle("active", b === btn);
  });
  document.querySelectorAll(".stats-panel").forEach(function (p) {
    p.classList.toggle("active", p.id === "panel-" + tab);
  });
  // 非表示中に作った Chart は 0px で描かれるので、表示時に再計算
  (chartsByTab[tab] || []).forEach(function (ch) { if (ch) ch.resize(); });
});

/* ---------- 初期化：投稿を取得してから描画 ---------- */
loadSightings().then(function () {
  const a = aggregate();
  renderSummary(a);
  renderTrend(a);
  renderRanking(a);
});
