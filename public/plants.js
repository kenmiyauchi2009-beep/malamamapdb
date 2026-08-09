/* ============================================================
   plants.js — 植物図鑑（ハイブリッド型）
   ------------------------------------------------------------
   ① 骨格＝厳選種 PLANTS を常に表示
   ② 投稿があれば 🔓見つかった / 無ければ 🔒未発見（Pokédex方式）
      発見済みなら投稿写真を優先表示。無ければ Wikimedia 実写。
   ③ 骨格にない投稿種（BioCLIPの学名）はコミュニティ発見として自動追加
   ④ フィルタ：すべて / 見つかった / 未発見 / 在来 / 外来 ＋ 発見数カウンター
   ※「マイコレクション」はアカウント（DB導入後）で対応予定
   ============================================================ */

const grid = document.getElementById("plantGrid");
const dexProgress = document.getElementById("dexProgress");

/* ---------- 投稿から「発見状況」を集計 ---------- */
function buildDiscovery() {
  const sightings = getAllSightings();
  const discoveredIds = new Set();  // 発見済みの骨格種 id
  const plantPhotos = {};           // plantId -> 投稿写真（あれば）
  const community = {};             // 学名 -> { name, count, photo }

  sightings.forEach(function (s) {
    const plant = getPlantById(s.plantId);
    if (plant) {
      discoveredIds.add(plant.id);
      if (s.photoUrl && !plantPhotos[plant.id]) plantPhotos[plant.id] = s.photoUrl;
    } else if (s.speciesName) {
      // 骨格に無い種 → コミュニティ発見
      if (!community[s.speciesName]) {
        community[s.speciesName] = { name: s.speciesName, count: 0, photo: null };
      }
      community[s.speciesName].count++;
      if (s.photoUrl && !community[s.speciesName].photo) {
        community[s.speciesName].photo = s.photoUrl;
      }
    }
  });

  return { discoveredIds: discoveredIds, plantPhotos: plantPhotos, community: community };
}

/* ---------- 写真ブロック（フォールバック付き） ---------- */
function makePhoto(src, alt, fallbackColor, fallbackEmoji) {
  const photo = document.createElement("div");
  photo.className = "plant-photo";

  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    img.loading = "lazy";
    img.onerror = function () {
      const fb = document.createElement("div");
      fb.className = "photo-fallback";
      fb.style.background = fallbackColor;
      fb.textContent = fallbackEmoji;
      img.replaceWith(fb);
    };
    photo.appendChild(img);
  } else {
    const fb = document.createElement("div");
    fb.className = "photo-fallback";
    fb.style.background = fallbackColor;
    fb.textContent = fallbackEmoji;
    photo.appendChild(fb);
  }
  return photo;
}

/* ---------- 骨格種のカード ---------- */
function createCard(plant, discovered, postedPhoto) {
  const card = document.createElement("article");
  card.className = "plant-card" + (discovered ? "" : " locked");
  card.dataset.category = plant.category;

  const catLabel = plant.category === "native" ? t("legend.native") : t("legend.invasive");

  // 発見済みなら投稿写真を優先、無ければ Wikimedia
  const photoSrc = discovered && postedPhoto ? postedPhoto : plant.imageUrl;
  const photo = makePhoto(photoSrc, plant.hawaiianName, plant.color, plant.emoji);

  // カテゴリタグ
  const catTag = document.createElement("span");
  catTag.className = "cat-tag " + plant.category;
  catTag.textContent = catLabel;
  photo.appendChild(catTag);

  // 発見状態タグ（🔓/🔒）
  const state = document.createElement("span");
  state.className = "dex-state " + (discovered ? "found" : "locked");
  state.textContent = discovered ? t("plants.bar_discovered") : t("plants.find_hint");
  photo.appendChild(state);

  const body = document.createElement("div");
  body.className = "plant-body";

  // 規律：カード表面は「名前＋学名」だけ。説明・文化・バッジ等は
  // クリックで開く詳細モーダルへ（プログレッシブ・ディスクロージャー）
  body.innerHTML =
    '<div class="haw-name">' + plant.hawaiianName + "</div>" +
    '<div class="sci-name">' + plant.scientificName + "</div>" +
    (discovered ? "" : '<div class="find-hint">見つけて投稿すると図鑑が完成します</div>');

  card.appendChild(photo);
  card.appendChild(body);
  card.addEventListener("click", function () {
    openPlantDetail(plant, discovered, postedPhoto);
  });
  return card;
}

/* ---------- コミュニティ発見種のカード ---------- */
function createCommunityCard(sp) {
  const card = document.createElement("article");
  card.className = "plant-card community";
  card.dataset.category = "community";

  const photo = makePhoto(sp.photo, sp.name, "#6b7280", "");

  const catTag = document.createElement("span");
  catTag.className = "cat-tag community";
  catTag.textContent = t("plants.community_tag");
  photo.appendChild(catTag);

  const state = document.createElement("span");
  state.className = "dex-state found";
  state.textContent = t("plants.found_x", { n: sp.count });
  photo.appendChild(state);

  const body = document.createElement("div");
  body.className = "plant-body";
  body.innerHTML =
    '<div class="haw-name">' + sp.name + "</div>" +
    '<div class="sci-name">' + t("plants.unverified") + "</div>";

  card.appendChild(photo);
  card.appendChild(body);
  card.addEventListener("click", function () {
    openCommunityDetail(sp);
  });
  return card;
}

/* ---------- フィルタ判定 ---------- */
function passFilter(filter, category, discovered) {
  switch (filter) {
    case "native":       return category === "native";
    case "invasive":     return category === "invasive";
    case "discovered":   return discovered;
    case "undiscovered": return !discovered;
    default:             return true; // all
  }
}

/* ---------- 検索・フィルタの状態 ---------- */
let currentFilter = "all";
let searchQuery = "";
let lazyObserver = null;   // 遅延描画用の IntersectionObserver

// 検索一致（学名・ハワイ語名・英名のいずれかに部分一致）
function matchSearch(fields) {
  if (!searchQuery) return true;
  return fields.some(function (f) {
    return f && f.toLowerCase().indexOf(searchQuery) !== -1;
  });
}

/* ---------- 表示アイテムを集めて描画 ---------- */
function renderCards() {
  const dex = buildDiscovery();

  // 在来 → 外来 の順・発見済みのみ・フィルタ＋検索を適用してアイテム化
  const items = [];
  PLANTS.slice().sort(function (a, b) {
    const rank = function (c) { return c === "native" ? 0 : 1; };
    return rank(a.category) - rank(b.category);
  }).forEach(function (plant) {
    if (!dex.discoveredIds.has(plant.id)) return;                    // 発見済みのみ
    if (!passFilter(currentFilter, plant.category, true)) return;
    if (!matchSearch([plant.hawaiianName, plant.scientificName, plant.englishName])) return;
    items.push({ kind: "curated", plant: plant, photo: dex.plantPhotos[plant.id] });
  });
  // コミュニティ発見種（未分類なので「すべて」表示のときのみ）
  if (currentFilter === "all") {
    Object.keys(dex.community).forEach(function (name) {
      const sp = dex.community[name];
      if (!matchSearch([sp.name])) return;
      items.push({ kind: "community", sp: sp });
    });
  }

  lazyRender(items);
  updateProgress(dex);
}

/* ---------- 遅延描画（スクロールで少しずつ描く：3,000種でも軽い） ---------- */
function lazyRender(items) {
  if (lazyObserver) { lazyObserver.disconnect(); lazyObserver = null; }
  grid.innerHTML = "";

  if (!items.length) {
    grid.innerHTML = '<p class="dex-empty">' +
      (searchQuery ? t("plants.no_result") : t("plants.empty")) + "</p>";
    return;
  }

  const BATCH = 24;   // 1回に描く枚数
  let i = 0;
  const sentinel = document.createElement("div");
  sentinel.className = "dex-sentinel";

  function renderMore() {
    const end = Math.min(i + BATCH, items.length);
    const frag = document.createDocumentFragment();
    for (; i < end; i++) {
      const it = items[i];
      frag.appendChild(it.kind === "curated"
        ? createCard(it.plant, true, it.photo)
        : createCommunityCard(it.sp));
    }
    grid.insertBefore(frag, sentinel);
    if (i >= items.length && lazyObserver) {
      lazyObserver.disconnect(); lazyObserver = null;
      sentinel.remove();
    }
  }

  grid.appendChild(sentinel);
  // 画面下に近づいたら次のバッチを描く（rootMargin で先読み）
  lazyObserver = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) renderMore();
  }, { rootMargin: "500px" });
  lazyObserver.observe(sentinel);
  renderMore();   // 最初の1バッチ
}

/* ---------- 進捗（在来/外来 別の小図鑑バー） ---------- */
function updateProgress(dex) {
  let nativeTotal = 0, invasiveTotal = 0, nativeFound = 0, invasiveFound = 0;
  PLANTS.forEach(function (p) {
    if (p.category === "native") {
      nativeTotal++;
      if (dex.discoveredIds.has(p.id)) nativeFound++;
    } else if (p.category === "invasive") {
      invasiveTotal++;
      if (dex.discoveredIds.has(p.id)) invasiveFound++;
    }
  });
  const communityFound = Object.keys(dex.community).length;

  // 分母＝BioCLIP が判別できる全種（hawaii_plants.csv の種数）
  const BIOCLIP_TOTAL_SPECIES = 3191;
  // 在来＋外来を合算して1本のバーにする
  const found = nativeFound + invasiveFound;
  const pct = ((found / BIOCLIP_TOTAL_SPECIES) * 100).toFixed(2); // 小数第2位まで

  dexProgress.innerHTML =
    '<div class="dex-bar-row">' +
      '<span class="dex-bar-label">' + t("plants.bar_discovered") + "</span>" +
      '<span class="dex-bar-track">' +
        '<span class="dex-bar"><span class="dex-bar-fill native" style="width:' + pct + '%"></span></span>' +
        '<span class="dex-bar-pct">' + found + " / " + BIOCLIP_TOTAL_SPECIES + " ・ " + pct + "%</span>" +
      "</span>" +
    "</div>" +
    (communityFound
      ? '<div class="dex-community">' + t("plants.community_count", { n: communityFound }) + "</div>"
      : "");
}

/* ---------- フィルタボタン ---------- */
const filterBar = document.getElementById("filters");
filterBar.addEventListener("click", function (e) {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  filterBar.querySelectorAll(".filter-btn").forEach(function (b) {
    b.classList.remove("active");
  });
  btn.classList.add("active");
  currentFilter = btn.dataset.filter;
  renderCards();
});

/* ---------- 検索ボックス ---------- */
const dexSearch = document.getElementById("dexSearch");
if (dexSearch) {
  dexSearch.addEventListener("input", function () {
    searchQuery = dexSearch.value.trim().toLowerCase();
    renderCards();
  });
}

/* ============================================================
   詳細モーダル（カードタップで開く）
   ------------------------------------------------------------
   大きい写真・種の情報・その種の全目撃地点のミニ地図・投稿リスト
   ============================================================ */
let detailMap = null;

// 骨格種の詳細
function openPlantDetail(plant, discovered, postedPhoto) {
  const sightings = getAllSightings().filter(function (s) { return s.plantId === plant.id; });
  const posted = sightings.find(function (s) { return s.photoUrl; });
  const photoSrc = (discovered && posted) ? posted.photoUrl : plant.imageUrl;

  const catLabel = plant.category === "native" ? t("legend.native") : t("legend.invasive");
  let tags = '<span class="cat-tag ' + plant.category + '" style="position:static">' + catLabel + "</span> ";
  tags += '<span class="badge ' + plant.status + '">' + plant.statusLabel + "</span>";
  if (plant.rodRisk)    tags += ' <span class="badge rod">' + t("map.rod_watch") + "</span>";
  if (plant.isKeystone) tags += ' <span class="badge keystone">' + t("plants.keystone") + "</span>";

  renderDetail({
    photoSrc: photoSrc,
    color: plant.color,
    emoji: plant.emoji,
    name: plant.emoji + " " + plant.hawaiianName,
    sci: plant.scientificName,
    eng: "English: " + plant.englishName,
    badges: tags,
    desc: plant.description,
    cultural: "<strong>" + t("plants.cultural") + "</strong> " + plant.culturalNote,
    sightings: sightings,
    markerColor: plant.category === "native" ? "#2d6a4f" : "#c1272d"
  });
}

// コミュニティ発見種の詳細
function openCommunityDetail(sp) {
  const sightings = getAllSightings().filter(function (s) {
    return !getPlantById(s.plantId) && s.speciesName === sp.name;
  });
  renderDetail({
    photoSrc: sp.photo,
    color: "#6b7280",
    emoji: "",
    name: sp.name,
    sci: sp.name,
    eng: "",
    badges: '<span class="badge">' + t("plants.community_tag") + '</span> <span class="badge">' + t("plants.unverified") + "</span>",
    desc: t("plants.community_desc"),
    cultural: "<strong>" + t("plants.memo") + "</strong> " + t("plants.community_memo"),
    sightings: sightings,
    markerColor: "#6b7280"
  });
}

function renderDetail(d) {
  closeDetail();

  // 写真（無ければ絵文字ブロック）
  const photoHtml = d.photoSrc
    ? '<img src="' + d.photoSrc + '" alt="' + d.sci + '" onerror="this.parentElement.innerHTML=\'<div class=&quot;detail-emoji&quot; style=&quot;background:' + d.color + '&quot;>' + d.emoji + '</div>\'">'
    : '<div class="detail-emoji" style="background:' + d.color + '">' + d.emoji + "</div>";

  // 目撃情報セクション
  let sightHtml;
  if (d.sightings.length) {
    const sorted = d.sightings.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    const last = sorted[0].date;
    let list = "";
    sorted.forEach(function (s) {
      const photo = s.photoUrl ? '<img class="ds-thumb" src="' + s.photoUrl + '" alt="">' : "";
      list +=
        '<li>' + photo +
          '<span class="ds-note">' + s.note + "</span>" +
          '<span class="ds-meta">' + s.date + ' ・ <a class="reporter-link" href="profile.html?user=' +
            encodeURIComponent(s.reporter) + '">' + s.reporter + "</a></span>" +
        "</li>";
    });
    sightHtml =
      "<h4>" + t("plants.detail_sightings") + " <span>" + t("plants.sightings_count", { n: d.sightings.length, last: last }) + "</span></h4>" +
      '<div class="detail-map" id="detailMap"></div>' +
      '<ul class="detail-sight-list">' + list + "</ul>";
  } else {
    sightHtml =
      "<h4>" + t("plants.detail_sightings") + "</h4>" +
      '<div class="detail-empty">' + t("plants.detail_empty") + "</div>";
  }

  const overlay = document.createElement("div");
  overlay.className = "detail-overlay";
  overlay.innerHTML =
    '<div class="detail-card">' +
      '<button type="button" class="detail-close" aria-label="閉じる">×</button>' +
      '<div class="detail-photo">' + photoHtml + "</div>" +
      '<div class="detail-body">' +
        '<div class="detail-name">' + d.name + "</div>" +
        '<div class="detail-sci">' + d.sci + "</div>" +
        (d.eng ? '<div class="detail-eng">' + d.eng + "</div>" : "") +
        '<div class="detail-badges">' + d.badges + "</div>" +
        '<div class="detail-desc">' + d.desc + "</div>" +
        '<div class="detail-cultural">' + d.cultural + "</div>" +
        '<div class="detail-sightings">' + sightHtml + "</div>" +
      "</div>" +
    "</div>";
  document.body.appendChild(overlay);

  // 閉じる（×ボタン / 背景クリック）
  overlay.querySelector(".detail-close").addEventListener("click", closeDetail);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeDetail();
  });

  // ミニ地図
  if (d.sightings.length) {
    detailMap = L.map("detailMap", { scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap"
    }).addTo(detailMap);
    const markers = d.sightings.map(function (s) {
      return L.circleMarker([s.lat, s.lng], {
        color: d.markerColor, fillColor: d.markerColor, fillOpacity: 0.85, weight: 2, radius: 8
      }).bindPopup(s.note + "<br><small>" + s.date + "</small>");
    });
    const group = L.featureGroup(markers).addTo(detailMap);
    detailMap.invalidateSize();
    detailMap.fitBounds(group.getBounds(), { maxZoom: 12, padding: [25, 25] });
  }
}

function closeDetail() {
  if (detailMap) { detailMap.remove(); detailMap = null; }
  const existing = document.querySelector(".detail-overlay");
  if (existing) existing.remove();
}

/* ---------- 初期表示：投稿を取得してから描画 ---------- */
loadSightings().then(function () {
  renderCards();
});
