/* ============================================================
   sync-ui.mjs — フロント（../../../UI）→ public/ 同期スクリプト
   ------------------------------------------------------------
   別フォルダ UI/ で開発したフロントの Web 資産（HTML/CSS/JS/SVG）を
   この Worker が配信する public/ にコピーする。
   ・対象は拡張子 .html / .css / .js / .svg のトップレベルファイルのみ
   ・.md（ドキュメント）や .claude / memory / node_modules は対象外
   ・上書き＆追加のみ（public 側の削除はしない＝安全側）

   使い方:
     npm run sync-ui       … 同期だけ
     npm run deploy        … 同期してから wrangler deploy（predeploy で自動実行）
   ============================================================ */
import { readdirSync, copyFileSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// このスクリプトは malamamapdb/scripts/ にある想定
const SRC = join(__dirname, "..", "..", "..", "UI"); // U22project/UI
const DEST = join(__dirname, "..", "public");        // malamamapdb/public

// 配信対象の拡張子だけコピーする（ドキュメント .md 等は除外）
const ALLOWED_EXT = new Set([".html", ".css", ".js", ".svg"]);

mkdirSync(DEST, { recursive: true });

let count = 0;
for (const name of readdirSync(SRC)) {
  const srcPath = join(SRC, name);
  if (!statSync(srcPath).isFile()) continue;                 // ディレクトリは除外
  if (!ALLOWED_EXT.has(extname(name).toLowerCase())) continue; // 対象拡張子のみ
  copyFileSync(srcPath, join(DEST, name));
  console.log("  copied  " + name);
  count++;
}

console.log("\n✅ " + count + " files synced:  UI/  ->  public/");
