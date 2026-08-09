/* ============================================================
   report.js — 投稿フォームのロジック
   ------------------------------------------------------------
   ① 写真を撮る/選ぶ（縮小してプレビュー＆保存）
   ② 地図をタップして地点を選ぶ（ドラッグ微調整・GPS対応）
   ③ 植物名を選ぶ（未確認も選べる）
   ④ メモ・報告者名
   送信 → 写真を Storage に上げ、投稿を API に保存 → ホーム地図へ
   ============================================================ */

/* ---------- ログイン必須：未ログインなら login.html へ ----------
   投稿ページはログインしていないと使えない（フェーズ2 方針）。      */
let currentUser = null;
requireLogin().then(function (user) {
  currentUser = user;   // null のときは requireLogin 内でリダイレクト済み
  if (!user) return;
  // ⑤報告者欄にログイン名を表示
  const nameBox = document.getElementById("reporterName");
  if (nameBox) nameBox.textContent = userDisplayName(user);
  // 「新種発見」判定のため既存投稿を読み込んでおく
  loadSightings();
});

/* ---------- ③ 植物セレクトを作る ----------
   構成：
     - （プレースホルダ：HTML 側にある）
     - 🧠 BioCLIP 候補   … 写真を解析すると動的に追加（aiGroup）
     - ❓ 未確認
   候補種は値を "sp:<学名>" で持つ。
   ※ 固定の7種リストは廃止。植物名は BioCLIP の候補から選ぶ方式。      */
const plantSelect = document.getElementById("plantSelect");

// 「未確認」= コミュニティ判定に回す
const unknownOpt = document.createElement("option");
unknownOpt.value = "unknown";
unknownOpt.textContent = t("report.unknown_opt");
plantSelect.appendChild(unknownOpt);

// BioCLIP 候補グループ（最初は空。解析後に埋める）
const aiGroup = document.createElement("optgroup");
aiGroup.label = t("ai.candidates");
aiGroup.hidden = true;
plantSelect.insertBefore(aiGroup, unknownOpt); // プレースホルダの直後・未確認の前

// 予測リストでセレクトの AI 候補グループを作り直す
function fillAiOptions(preds) {
  aiGroup.innerHTML = "";
  preds.forEach(function (p) {
    const opt = document.createElement("option");
    opt.value = "sp:" + p.name;                 // 候補種は "sp:" 接頭辞
    const common = p.common_name ? "・" + p.common_name : "";
    const m = matchPlant(p.name);
    const tag = m ? (m.category === "native" ? t("report.native_tag") : t("report.invasive_tag")) : "";
    opt.textContent =
      Math.round(p.score * 100) + "% " + p.name + common + " " + tag;
    aiGroup.appendChild(opt);
  });
  aiGroup.hidden = preds.length === 0;
}

/* ---------- ② 地点選択ミニマップ（ハワイ周辺に限定） ---------- */
// ISLANDS … 島々（初期表示・GPS判定用） / PAN … 余白込みのパン可能範囲
const ISLANDS_BOUNDS = L.latLngBounds([18.4, -160.6], [22.6, -154.5]);
const PAN_BOUNDS = L.latLngBounds([13.0, -166.0], [27.5, -149.0]);
const pickMap = L.map("pickMap", {
  maxBounds: PAN_BOUNDS,
  maxBoundsViscosity: 1.0,
  minZoom: 5,
  maxZoom: 18
});
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  // bounds は付けない → 周辺の海タイルも読み込まれ、灰色の余白が出ない
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(pickMap);

// 全島が余白付きで収まるように（コンテナ確定後にも再計算）
function fitHawaiiPick() {
  pickMap.invalidateSize();
  pickMap.fitBounds(ISLANDS_BOUNDS, { padding: [20, 20] });
}
fitHawaiiPick();
window.addEventListener("load", fitHawaiiPick);
setTimeout(fitHawaiiPick, 300);

let chosen = null;       // { lat, lng }
let pickMarker = null;
const coordLabel = document.getElementById("coordLabel");

// 緯度経度をセットしてピンを置く（共通処理）
function setLocation(lat, lng) {
  chosen = { lat: lat, lng: lng };
  if (!pickMarker) {
    pickMarker = L.marker([lat, lng], { draggable: true }).addTo(pickMap);
    // ドラッグで微調整 → 座標を更新
    pickMarker.on("dragend", function () {
      const pos = pickMarker.getLatLng();
      chosen = { lat: pos.lat, lng: pos.lng };
      updateCoordLabel();
      hideExifSuggest(); // ドラッグで微調整＝手動確定
    });
  } else {
    pickMarker.setLatLng([lat, lng]);
  }
  updateCoordLabel();
}

function updateCoordLabel() {
  coordLabel.textContent =
    t("report.picked", { lat: chosen.lat.toFixed(4), lng: chosen.lng.toFixed(4) });
  coordLabel.classList.add("set");
}

// 地図クリックで地点選択（手動で選んだのでサジェストは閉じる）
pickMap.on("click", function (e) {
  setLocation(e.latlng.lat, e.latlng.lng);
  hideExifSuggest();
});

// 現在地（GPS）ボタン
document.getElementById("useGps").addEventListener("click", function () {
  if (!navigator.geolocation) {
    alert(t("report.gps_unavailable"));
    return;
  }
  coordLabel.textContent = t("report.gps_loading");
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      // ハワイ範囲外（例：日本でテスト中）なら弾く
      if (!ISLANDS_BOUNDS.contains([lat, lng])) {
        coordLabel.textContent = t("report.gps_outside");
        return;
      }
      setLocation(lat, lng);
      pickMap.setView([lat, lng], 13);
      hideExifSuggest(); // 現在地を使った＝手動確定
    },
    function () {
      coordLabel.textContent = t("report.gps_fail");
    }
  );
});

/* ---------- 写真のEXIF位置情報から「ここですか？」サジェスト ---------- */
const exifSuggest = document.getElementById("exifSuggest");

// 圧縮前の元ファイルから GPS を読み、ハワイ内なら地点候補として提示する
async function readExifLocation(file) {
  hideExifSuggest();
  if (typeof exifr === "undefined") return; // ライブラリ未読込の保険

  let gps;
  try {
    gps = await exifr.gps(file); // { latitude, longitude } または undefined
  } catch (e) {
    return; // EXIF を読めない画像（スクショ・変換済みなど）
  }
  if (!gps || gps.latitude == null || gps.longitude == null) return; // 位置情報なし

  const lat = gps.latitude;
  const lng = gps.longitude;

  if (!ISLANDS_BOUNDS.contains([lat, lng])) {
    // ハワイ外の写真 → 手動選択を促す
    showExifNote(t("report.exif_outside"));
    return;
  }

  // 候補として地点をセット（ピンは動かせるまま）＋地図を寄せる＋「ここですか？」
  setLocation(lat, lng);
  pickMap.setView([lat, lng], 13);
  showExifSuggest();
}

function showExifSuggest() {
  exifSuggest.className = "exif-suggest";
  exifSuggest.hidden = false;
  exifSuggest.innerHTML =
    '<div class="es-text">' + t("report.exif_here") + "</div>" +
    '<button type="button" class="es-ok">' + t("report.exif_ok") + "</button>";
  exifSuggest.querySelector(".es-ok").addEventListener("click", hideExifSuggest);
}

function showExifNote(msg) {
  exifSuggest.className = "exif-suggest note";
  exifSuggest.hidden = false;
  exifSuggest.innerHTML = '<div class="es-text">' + msg + "</div>";
}

function hideExifSuggest() {
  exifSuggest.hidden = true;
  exifSuggest.innerHTML = "";
}

/* ---------- ① 写真：撮影/選択 → 縮小してプレビュー ---------- */
const photoInput = document.getElementById("photoInput");
const photoBox = document.getElementById("photoBox");
const placeholder = document.getElementById("photoPlaceholder");
const preview = document.getElementById("photoPreview");
const clearPhotoBtn = document.getElementById("clearPhoto");
const cropBtn = document.getElementById("cropBtn");

let photoDataUrl = null;       // 保存用の画像（data URL）＝既定は全体、クロップ後はクロップ
let fullPhotoDataUrl = null;   // クロップ元として保持する全体画像
let cropper = null;            // Cropper インスタンス

// プレースホルダ全体をタップでファイル選択を開く
photoBox.addEventListener("click", function () {
  photoInput.click();
});

photoInput.addEventListener("change", function () {
  const file = photoInput.files[0];
  if (!file) return;

  // 圧縮する前の元ファイルから位置情報(EXIF)を読む（圧縮するとEXIFは消えるため）
  readExifLocation(file);

  const reader = new FileReader();
  reader.onload = function (ev) {
    // 画像を読み込んでから canvas で縮小（localStorage を圧迫しないため）
    const img = new Image();
    img.onload = function () {
      const MAX = 1000; // 長辺の最大ピクセル
      let w = img.width;
      let h = img.height;
      if (w > h && w > MAX) { h = h * (MAX / w); w = MAX; }
      else if (h > MAX)     { w = w * (MAX / h); h = MAX; }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);

      photoDataUrl = canvas.toDataURL("image/jpeg", 0.7); // 圧縮
      fullPhotoDataUrl = photoDataUrl;                    // クロップ元として保持
      preview.src = photoDataUrl;
      preview.hidden = false;
      placeholder.hidden = true;
      clearPhotoBtn.hidden = false;
      cropBtn.hidden = false;

      // 縮小済み画像を BioCLIP に送って種を提案してもらう
      canvas.toBlob(function (blob) {
        classifyWithBioCLIP(blob);
      }, "image/jpeg", 0.7);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// 写真を消す
clearPhotoBtn.addEventListener("click", function (e) {
  e.stopPropagation();
  photoDataUrl = null;
  photoInput.value = "";
  preview.hidden = true;
  preview.src = "";
  placeholder.hidden = false;
  clearPhotoBtn.hidden = true;
  cropBtn.hidden = true;
  fullPhotoDataUrl = null;
  aiResult.hidden = true;
  aiResult.innerHTML = "";
  updateRodScreen();   // ROD チェックも隠す
});

/* ---------- ✂️ クロップ（1株まるごとを囲む → 再判定） ---------- */
cropBtn.addEventListener("click", function () {
  if (fullPhotoDataUrl) openCropModal(fullPhotoDataUrl);
});

function openCropModal(src) {
  const overlay = document.createElement("div");
  overlay.className = "crop-overlay";
  overlay.innerHTML =
    '<div class="crop-modal">' +
      '<div class="crop-hint">' + t("report.crop_hint_html") + "</div>" +
      '<div class="crop-stage"><img id="cropImg" src="' + src + '" alt=""></div>' +
      '<div class="crop-actions">' +
        '<button type="button" class="ghost-btn" id="cropCancel">' + t("report.crop_cancel") + "</button>" +
        '<button type="button" class="submit-btn crop-confirm" id="cropConfirm">' + t("report.crop_confirm") + "</button>" +
      "</div>" +
    "</div>";
  document.body.appendChild(overlay);

  const img = overlay.querySelector("#cropImg");
  cropper = new Cropper(img, {
    viewMode: 1,
    autoCropArea: 0.7,
    background: false,
    movable: false,
    zoomable: false,
    rotatable: false
  });

  overlay.querySelector("#cropCancel").addEventListener("click", closeCropModal);
  overlay.querySelector("#cropConfirm").addEventListener("click", function () {
    const canvas = cropper.getCroppedCanvas({ maxWidth: 1000, maxHeight: 1000 });
    if (!canvas) { closeCropModal(); return; }
    const cropped = canvas.toDataURL("image/jpeg", 0.8);
    photoDataUrl = cropped;   // 保存写真＝クロップ
    preview.src = cropped;    // プレビュー更新
    closeCropModal();
    // クロップを BioCLIP に再判定させる
    canvas.toBlob(function (blob) { classifyWithBioCLIP(blob); }, "image/jpeg", 0.8);
  });
}

function closeCropModal() {
  if (cropper) { cropper.destroy(); cropper = null; }
  const ov = document.querySelector(".crop-overlay");
  if (ov) ov.remove();
}

/* ============================================================
   BioCLIP AI 種提案（フェーズ3）
   ------------------------------------------------------------
   BioCLIP API（http://163.43.183.200:8000）に写真を送り、
   返ってきた種候補を data.js の PLANTS と照合して
   「在来種 / 外来種 / 未確認」を提案する。
   ※ CLAUDE.md の3ステップ設計そのもの：
     Step1 BioCLIP で予測 → Step2 ハワイ種リストと照合
     → Step3 確信度が低ければ「未確認」でコミュニティ判定へ
   ============================================================ */
// BioCLIP（AI判定）サーバーのエンドポイント。バックエンド API とは別サーバー。
// （バックエンドの URL は data.js の API_BASE = window.MALAMA_API_BASE）
const BIOCLIP_BASE = "https://malama-map.com";
const aiResult = document.getElementById("aiResult");

// 予測の学名（"Metrosideros polymorpha"）を PLANTS と照合
function matchPlant(sciName) {
  if (!sciName) return null;
  const lower = sciName.toLowerCase();
  const genus = lower.split(" ")[0];
  // ① 学名フル一致
  let m = PLANTS.find(function (p) {
    return p.scientificName.toLowerCase() === lower;
  });
  if (m) return m;
  // ② 属名一致（"Pritchardia spp." のような属レベル登録に対応）
  return PLANTS.find(function (p) {
    return p.scientificName.toLowerCase().split(" ")[0] === genus;
  }) || null;
}

async function classifyWithBioCLIP(blob) {
  aiResult.hidden = false;
  aiResult.innerHTML = '<div class="ai-loading">BioCLIP が解析中…</div>';

  try {
    const fd = new FormData();
    fd.append("file", blob, "photo.jpg");
    fd.append("rank", "species");
    fd.append("top_k", "5");

    const res = await fetch(BIOCLIP_BASE + "/classify", { method: "POST", body: fd });
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    renderAiResult(data);
  } catch (err) {
    // サーバー未起動・CORS など → 手動選択にフォールバック
    aiResult.innerHTML =
      '<div class="ai-error">' + t("ai.unavailable") + t("ai.manual_pick") + "</div>";
  }
}

let lastPreds = [];   // 直近の候補（送信時のスコア参照用）

function renderAiResult(data) {
  const preds = data.predictions || [];
  lastPreds = preds;
  if (!preds.length) {
    aiResult.innerHTML = '<div class="ai-error">' + t("ai.no_candidates") + "</div>";
    return;
  }

  // ① セレクトの「BioCLIP 候補」グループを埋める → ドロップダウンからも選べる
  fillAiOptions(preds);
  // 一番有力な候補を初期選択
  plantSelect.value = "sp:" + preds[0].name;
  updateRodScreen();   // ʻŌhiʻa が最有力なら ROD チェックを出す

  // Step2：リスト内で最初に一致した候補を「判定」に採用
  let matchedPlant = null;
  let matchedPred = null;
  for (let i = 0; i < preds.length; i++) {
    const m = matchPlant(preds[i].name);
    if (m) { matchedPlant = m; matchedPred = preds[i]; break; }
  }

  const top = preds[0];

  // 判定見出し（在来/外来/未確認）
  let verdictHtml;
  if (matchedPlant) {
    const cat = matchedPlant.category === "native" ? "native" : "invasive";
    const catLabel = cat === "native" ? t("stats.legend_native") : t("stats.legend_invasive");
    verdictHtml =
      '<div class="ai-verdict ' + cat + '">' +
        t("ai.verdict_prefix") + "<strong>" + catLabel + "</strong> — " +
        matchedPlant.hawaiianName +
        '<span class="ai-score">' + t("ai.confidence", { pct: Math.round(matchedPred.score * 100) }) + "</span>" +
      "</div>";
  } else {
    verdictHtml =
      '<div class="ai-verdict unknown">' +
        t("ai.not_in_list", { name: top.name }) +
        '<span class="ai-score">' + t("ai.pick_or_unconfirmed") + "</span>" +
      "</div>";
  }

  // 確信度が低いときの注意
  const lowNote = top.score < 0.1
    ? '<div class="ai-lownote">⚠️ ' + t("ai.low_note") + "</div>"
    : "";

  // 候補リスト（クリックで植物名に選択できる）
  let listHtml = '<div class="ai-list-title">' + t("ai.tap_to_select") + "</div>";
  preds.forEach(function (p) {
    const pct = Math.round(p.score * 100);
    const m = matchPlant(p.name);
    const tag = m
      ? '<span class="ai-tag ' + m.category + '">' +
          (m.category === "native" ? t("stats.ds_native") : t("stats.ds_invasive")) + "</span>"
      : "";
    const common = p.common_name ? " （" + p.common_name + "）" : "";
    // data-sp に "sp:学名" を入れておく → クリックでセレクトに反映
    listHtml +=
      '<div class="ai-row selectable" data-sp="sp:' + p.name + '">' +
        '<div class="ai-row-name"><i>' + p.name + "</i>" + common + " " + tag + "</div>" +
        '<div class="ai-bar"><span style="width:' + Math.max(pct, 3) + '%"></span></div>' +
        '<div class="ai-pct">' + pct + "%</div>" +
      "</div>";
  });
  // 「未確認」もこの場で選べるように
  listHtml +=
    '<div class="ai-row selectable unknown-row" data-sp="unknown">' +
      '<div class="ai-row-name">' + t("ai.none") + "</div>" +
    "</div>";

  aiResult.innerHTML =
    '<div class="ai-head">' + t("ai.head") + "</div>" +
    verdictHtml + lowNote + listHtml +
    '<div class="ai-foot">' + t("ai.foot") + "</div>";

  // 候補クリック → 植物名セレクトに反映
  aiResult.querySelectorAll(".ai-row.selectable").forEach(function (row) {
    row.addEventListener("click", function () {
      plantSelect.value = row.dataset.sp;
      highlightSelectedRow();
      updateRodScreen();
    });
  });
  highlightSelectedRow();
}

// セレクトの現在値と一致する候補行をハイライト
function highlightSelectedRow() {
  aiResult.querySelectorAll(".ai-row.selectable").forEach(function (row) {
    row.classList.toggle("selected", row.dataset.sp === plantSelect.value);
  });
}
// ドロップダウンを直接操作したときもハイライトを同期
plantSelect.addEventListener("change", highlightSelectedRow);

/* ---------- ROD（Rapid ʻŌhiʻa Death）スクリーニング ----------
   AI は「種」は判定できても「病気(ROD)」は確定できない。
   そこで ʻŌhiʻa（rodRisk 種）を選んだときだけ症状チェックを出し、
   当てはまれば「ROD疑い」として州の通報経路へ誘導する（確定表示はしない）。 */
const rodScreen = document.getElementById("rodScreen");
const rodQ1 = document.getElementById("rodQ1");
const rodQ2 = document.getElementById("rodQ2");
const rodResult = document.getElementById("rodResult");

// 現在の選択が ʻŌhiʻa（rodRisk 種）か
function selectionIsOhia() {
  const v = plantSelect.value || "";
  if (v.indexOf("sp:") !== 0) return false;
  const m = matchPlant(v.slice(3));
  return !!(m && m.rodRisk);
}

// 選択に応じてスクリーニングの表示/非表示を切り替える（非表示時はリセット）
function updateRodScreen() {
  const show = selectionIsOhia();
  rodScreen.hidden = !show;
  if (!show) {
    rodQ1.checked = false;
    rodQ2.checked = false;
    rodResult.hidden = true;
  }
}

// 両方チェック＝ROD疑い → 通報パネルを表示
function updateRodResult() {
  rodResult.hidden = !(rodQ1.checked && rodQ2.checked);
}

// この投稿が ROD 疑いか（送信時に使う）
function isRodSuspect() {
  return !rodScreen.hidden && rodQ1.checked && rodQ2.checked;
}

rodQ1.addEventListener("change", updateRodResult);
rodQ2.addEventListener("change", updateRodResult);
plantSelect.addEventListener("change", updateRodScreen);

/* ---------- 送信 ---------- */
const form = document.getElementById("reportForm");
const formError = document.getElementById("formError");

// dataURL（"data:image/jpeg;base64,..."）を Blob に変換
function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(",");
  const mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(parts[1]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

const submitBtn = form.querySelector(".submit-btn");

form.addEventListener("submit", async function (e) {
  e.preventDefault();
  formError.hidden = true;

  // 必須チェック：ログイン・地点・植物名
  if (!currentUser) {
    showError(t("report.err_login"));
    return;
  }
  if (!chosen) {
    showError(t("report.err_no_loc"));
    return;
  }
  if (!plantSelect.value) {
    showError(t("report.err_no_plant"));
    return;
  }

  // 選択値を解決する
  //   "sp:<学名>" … BioCLIP 候補。図鑑種に一致すれば plantId を付け、
  //                 一致しなければ speciesName だけ保持（plantId は "unknown"）
  //   "unknown"   … 未確認
  const rawVal = plantSelect.value;
  let plantId = "unknown";
  let speciesName = null;
  let aiScore = null;
  if (rawVal.indexOf("sp:") === 0) {
    speciesName = rawVal.slice(3);
    const m = matchPlant(speciesName);
    plantId = m ? m.id : "unknown";
    const pr = lastPreds.find(function (p) { return p.name === speciesName; });
    if (pr) aiScore = pr.score;
  }

  // 発見判定は「保存する前」の状態で行う（この投稿で初めて見つかる種か？）
  const discoveredBefore = alreadyDiscoveredKeys();
  const dKey = discoveryKey(plantId, speciesName);
  const isNewDiscovery = dKey && !discoveredBefore.has(dKey);

  // 送信中はボタンを無効化
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = t("report.submitting");

  try {
    // ① 写真があれば Storage にアップロードして URL を得る
    let photoUrl = null;
    if (photoDataUrl) {
      submitBtn.textContent = t("report.uploading");
      photoUrl = await uploadPhoto(dataUrlToBlob(photoDataUrl));
    }

    // ② 投稿を作成（id / reporter / createdAt はサーバーが付与）
    submitBtn.textContent = t("report.submitting");
    const sighting = {
      plantId: plantId,
      speciesName: speciesName,   // BioCLIP が出した学名（あれば）
      aiScore: aiScore,           // その確信度（あれば）
      lat: chosen.lat,
      lng: chosen.lng,
      date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
      note: document.getElementById("noteInput").value.trim() || t("report.no_note"),
      photoUrl: photoUrl,         // Storage の URL（写真なしなら null）
      rodSuspect: isRodSuspect(), // ROD疑い（症状チェック両方に該当）
    };
    await saveSighting(sighting);
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    showError(err && err.message ? err.message : t("report.submit_fail"));
    return;
  }

  // 完了：初発見なら「じゃじゃーん」演出（ローカル写真で表示）、そうでなければ地図へ
  if (isNewDiscovery) {
    showDiscoveryPopup(plantId, speciesName, photoDataUrl, discoveredBefore);
  } else {
    alert(t("report.done"));
    window.location.href = "map.html";
  }
});

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
  formError.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ============================================================
   発見演出（じゃじゃーん）
   ------------------------------------------------------------
   未発見の種を初めて投稿したとき、お祝いポップアップを出す。
   ============================================================ */

// 投稿を図鑑の「発見キー」に変換（骨格種=plantId / コミュニティ種="sp:学名"）
function discoveryKey(plantId, speciesName) {
  if (getPlantById(plantId)) return plantId;
  if (speciesName) return "sp:" + speciesName;
  return null; // 未確認（図鑑の対象外）
}

// すでに発見済みのキー集合（※保存する前に呼ぶこと）
function alreadyDiscoveredKeys() {
  const set = new Set();
  getAllSightings().forEach(function (s) {
    const k = discoveryKey(s.plantId, s.speciesName);
    if (k) set.add(k);
  });
  return set;
}

function showDiscoveryPopup(plantId, speciesName, photoUrl, before) {
  const plant = getPlantById(plantId);

  // 進捗（保存前の発見数から算出）
  let curatedFound = 0;
  let communityFound = 0;
  before.forEach(function (k) {
    if (getPlantById(k)) curatedFound++;
    else if (k.indexOf("sp:") === 0) communityFound++;
  });
  const progressText = plant
    ? t("discovery.dex", { found: curatedFound + 1, total: PLANTS.length })
    : t("discovery.community", { n: communityFound + 1 });

  // 表示内容
  const name = plant ? plant.hawaiianName : speciesName;
  const sci = plant ? plant.scientificName : speciesName;
  const badge = plant
    ? '<span class="badge ' + plant.status + '">' +
        (plant.category === "native" ? t("stats.legend_native") : t("stats.legend_invasive")) + "</span>"
    : '<span class="badge">' + t("plants.community_tag") + "</span>";

  // 写真（投稿写真 → 図鑑写真 → 絵文字ブロック）
  const imgSrc = photoUrl || (plant ? plant.imageUrl : null);
  const photoHtml = imgSrc
    ? '<img src="' + imgSrc + '" alt="' + sci + '" onerror="this.style.display=\'none\'">'
    : '<div class="disc-emoji" style="background:' + (plant ? plant.color : "#6b7280") + '">' +
        (plant ? plant.emoji : "🌱") + "</div>";

  const overlay = document.createElement("div");
  overlay.className = "discovery-overlay";
  overlay.innerHTML =
    '<div class="discovery-card">' +
      '<div class="disc-sparkles">❦</div>' +
      '<div class="disc-title">' + t("discovery.title") + "</div>" +
      '<div class="disc-photo">' + photoHtml + "</div>" +
      '<div class="disc-name">' + name + "</div>" +
      '<div class="disc-sci">' + sci + "</div>" +
      '<div class="disc-badges">' + badge + "</div>" +
      '<div class="disc-progress">' + progressText + "</div>" +
      '<div class="disc-actions">' +
        '<button type="button" class="disc-btn primary" data-go="map.html">' + t("discovery.to_map") + "</button>" +
        '<button type="button" class="disc-btn" data-go="plants.html">' + t("discovery.to_dex") + "</button>" +
      "</div>" +
    "</div>";
  document.body.appendChild(overlay);

  overlay.querySelectorAll(".disc-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      window.location.href = b.dataset.go;
    });
  });
}
