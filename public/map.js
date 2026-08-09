/* ============================================================
   map.js — Leaflet 地図のロジック
   ------------------------------------------------------------
   1. ハワイ諸島全体を表示
   2. 投稿（API から取得）をピンとして描画（緑＝在来 / 赤＝外来 / ROD は特別）
   3. 最新の目撃を右サイドのフィードに表示
   ============================================================ */

/* ---------- 1. 地図の初期化（ハワイ諸島周辺に限定） ---------- */
// ISLANDS … 島々の範囲（初期表示の基準）
// PAN     … パンできる範囲。島の縁を画面中央まで寄せられるよう余白を持たせる。
const ISLANDS_BOUNDS = L.latLngBounds([18.4, -160.6], [22.6, -154.5]);
const PAN_BOUNDS = L.latLngBounds([13.0, -166.0], [27.5, -149.0]);

const map = L.map("map", {
  maxBounds: PAN_BOUNDS,         // この範囲外へはドラッグできない（余白込み）
  maxBoundsViscosity: 1.0,       // 端で“跳ね返す”強さ（1=完全固定）
  minZoom: 5,                    // 全島を一度に収められる余裕を持たせる
  maxZoom: 18
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  // bounds は付けない → 周辺の海タイルも読み込まれ、灰色の余白が出ない
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// 全島が余白付きで収まるように表示（島が端で切れないよう padding）
function fitHawaii() {
  map.invalidateSize();                              // コンテナの実サイズを再取得
  map.fitBounds(ISLANDS_BOUNDS, { padding: [30, 30] });
}
fitHawaii();
// レイアウト確定後にもう一度（初期表示で島が出ない問題の保険）
window.addEventListener("load", fitHawaii);
setTimeout(fitHawaii, 300);

/* 未確認（plantId が "unknown" 等で植物が見つからない）投稿の代用データ */
const UNKNOWN_PLANT = {
  hawaiianName: t("map.unconfirmed"),
  scientificName: t("map.awaiting"),
  category: "unknown",
  status: "watch",
  statusLabel: t("map.unconfirmed"),
  emoji: "❓",
  rodRisk: false
};

/* ---------- 2. ピンのスタイルを決める ---------- */
// 在来＝緑 / 外来＝赤 / 未確認＝灰。ROD 対象種は白塗り＋赤縁で目立たせる。
function markerStyle(plant) {
  if (plant.rodRisk) {
    return { color: "#c1272d", fillColor: "#ffffff", fillOpacity: 1, weight: 4, radius: 9 };
  }
  if (plant.category === "invasive") {
    return { color: "#8b0000", fillColor: "#c1272d", fillOpacity: 0.9, weight: 2, radius: 8 };
  }
  if (plant.category === "unknown") {
    return { color: "#555", fillColor: "#9e9e9e", fillOpacity: 0.9, weight: 2, radius: 8 };
  }
  return { color: "#1b4332", fillColor: "#2d6a4f", fillOpacity: 0.9, weight: 2, radius: 8 };
}

// ポップアップの中身（クリックで出る吹き出し）
function popupHtml(plant, sighting) {
  const rodTag = plant.rodRisk
    ? '<span class="badge rod">' + t("map.rod_watch") + "</span> "
    : "";
  const catLabel =
    plant.category === "native" ? t("legend.native") :
    plant.category === "invasive" ? t("legend.invasive") : t("map.unconfirmed");
  // 写真があれば表示（ユーザー投稿）
  const photo = sighting.photoUrl
    ? '<img class="popup-photo" src="' + sighting.photoUrl + '" alt="投稿写真">'
    : "";
  // BioCLIP が出した学名があればそれを見出しに使う
  const title = sighting.speciesName || plant.hawaiianName;
  const subtitle = sighting.speciesName
    ? (getPlantById(sighting.plantId) ? plant.hawaiianName : t("map.bioclip_id"))
    : plant.scientificName;
  const aiTag = (sighting.aiScore != null)
    ? ' <span class="badge keystone">AI ' + Math.round(sighting.aiScore * 100) + "%</span>"
    : "";
  return (
    '<div class="popup">' +
      '<div class="popup-title">' + title + "</div>" +
      '<div class="popup-sci">' + subtitle + aiTag + "</div>" +
      '<div style="margin:4px 0;">' + rodTag +
        '<span class="badge ' + plant.status + '">' + plant.statusLabel + "</span>" +
      "</div>" +
      photo +
      '<div class="popup-note">「' + sighting.note + "」</div>" +
      '<div class="popup-meta">' + catLabel + " ・ " + sighting.date + " ・ " +
        '<a class="reporter-link" href="profile.html?user=' + encodeURIComponent(sighting.reporter) + '">' + sighting.reporter + "</a></div>" +
      // 自分の投稿にだけ削除ボタンを出す
      (isMine(sighting)
        ? '<button type="button" class="del-btn" data-del="' + sighting.id + '">🗑 ' + t("delete.btn") + "</button>"
        : "") +
    "</div>"
  );
}

/* ---------- 3. ピンを地図に描く ---------- */
// sighting.id → marker の対応表（フィードからクリックで飛べるように保持）
const markersById = {};

// 現在ログイン中ユーザーの id（初期化時に解決）。自分の投稿の判定に使う。
let MY_ID = null;
function isMine(s) { return !!(MY_ID && s.userId && s.userId === MY_ID); }

// 削除（確認ダイアログ＝最低1回）→ 成功でピンとフィードカードを取り除く
async function handleDelete(id) {
  if (!window.confirm(t("delete.confirm"))) return;   // ← 最低1回の確認
  try {
    await deleteSighting(id);
    const m = markersById[id];
    if (m) { m.closePopup(); map.removeLayer(m); delete markersById[id]; }
    const card = document.querySelector('.feed-card[data-id="' + id + '"]');
    if (card) card.remove();
  } catch (err) {
    window.alert(t("delete.failed") + "\n" + err.message);
  }
}

function drawMarkers() {
  getAllSightings().forEach(function (s) {
    const plant = getPlantById(s.plantId) || UNKNOWN_PLANT; // 未確認は代用データ

    const marker = L.circleMarker([s.lat, s.lng], markerStyle(plant))
      .addTo(map)
      .bindPopup(popupHtml(plant, s));

    // ポップアップ内の削除ボタンにハンドラを結ぶ（Leaflet はクリック伝播を止めるため
    // document への委譲でなく、開いた時に直接バインドする）
    marker.on("popupopen", function (e) {
      const el = e.popup.getElement();
      const btn = el && el.querySelector("[data-del]");
      if (btn && !btn._bound) {
        btn._bound = true;
        btn.addEventListener("click", function () { handleDelete(btn.getAttribute("data-del")); });
      }
    });

    markersById[s.id] = marker;
  });
}

/* ---------- 4. 最新の目撃フィード（右サイド） ---------- */
function renderFeed() {
  const feed = document.getElementById("feed");

  // 日付の新しい順に並べ替え（元配列は壊さない）
  const sorted = getAllSightings().slice().sort(function (a, b) {
    return a.date < b.date ? 1 : -1;
  });

  sorted.forEach(function (s) {
    const plant = getPlantById(s.plantId) || UNKNOWN_PLANT;

    const card = document.createElement("div");
    card.className = "feed-card" + (plant.category === "invasive" ? " invasive" : "");
    card.dataset.id = s.id;   // 削除時に該当カードを探すため

    const photo = s.photoUrl
      ? '<img class="fc-photo" src="' + s.photoUrl + '" alt="投稿写真">'
      : "";

    // BioCLIP の学名があれば見出しに使う
    const fcName = s.speciesName || plant.hawaiianName;
    const fcSub = s.speciesName
      ? (getPlantById(s.plantId) ? plant.hawaiianName : t("map.bioclip_id"))
      : plant.scientificName;

    card.innerHTML =
      '<div class="fc-head">' +
        '<span class="fc-dot" style="background:' + plant.color + '"></span>' +
        "<span>" +
          '<span class="fc-name">' + fcName + "</span><br>" +
          '<span class="fc-sci">' + fcSub + "</span>" +
        "</span>" +
      "</div>" +
      photo +
      '<div class="fc-note">' + s.note + "</div>" +
      '<div class="fc-meta"><span>' + s.date + '</span><span><a class="reporter-link" href="profile.html?user=' +
        encodeURIComponent(s.reporter) + '">' + s.reporter + "</a></span></div>";

    // 自分の投稿にだけ削除ボタンを付ける
    if (isMine(s)) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "del-btn feed-del";
      del.setAttribute("data-del", s.id);
      del.textContent = "🗑 " + t("delete.btn");
      del.addEventListener("click", function (ev) {
        ev.stopPropagation();          // カードの地図移動を止める
        handleDelete(s.id);
      });
      card.appendChild(del);
    }

    // カードをクリック → 地図をそのピンへ移動してポップアップを開く
    // （投稿者名リンク・削除ボタンをタップしたときは地図移動しない）
    card.addEventListener("click", function (e) {
      if (e.target.closest("a") || e.target.closest("[data-del]")) return;
      map.setView([s.lat, s.lng], 11, { animate: true });
      const m = markersById[s.id];
      if (m) m.openPopup();
    });

    feed.appendChild(card);
  });
}

/* ---------- 初期化：投稿とログインユーザーを取得してから描画 ---------- */
// getCurrentUser（auth.js）で自分の id を得て、自分の投稿に削除ボタンを出せるようにする
Promise.all([
  loadSightings(),
  getCurrentUser().catch(function () { return null; })
]).then(function (r) {
  MY_ID = r[1] ? r[1].id : null;
  drawMarkers();
  renderFeed();
});
