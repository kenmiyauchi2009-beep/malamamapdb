/**
 * Mālama Map — フェーズ2 バックエンド API（Cloudflare Worker）
 *
 * 役割：目撃投稿（sightings）の共有・永続化と写真アップロード。
 *   GET  /health    … 稼働確認
 *   GET  /sightings … 全投稿を取得（公開・camelCase で返す）
 *   POST /sightings … 投稿を作成（ログイン必須）
 *   POST /photos    … 写真を Storage に保存し URL を返す（ログイン必須）
 *
 * 認証：フロントが Supabase Auth で取得した JWT を `Authorization: Bearer`
 *   で送る。Worker は service_role キーを持たず、ユーザーの JWT を載せた
 *   クライアントで DB / Storage を操作する（RLS がユーザー単位で保護）。
 *
 * AI 判定（BioCLIP・さくらサーバー）はこの Worker とは別。
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Bindings = Env;

const PHOTO_BUCKET = "sighting-photos";

const app = new Hono<{ Bindings: Bindings }>();

/* ---------- CORS（フロントのオリジンのみ許可） ---------- */
app.use("*", async (c, next) => {
	const allowed = (c.env.ALLOWED_ORIGIN ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	return cors({
		// ALLOWED_ORIGIN 未設定なら開発用に全許可、設定済みなら一致オリジンのみ
		origin: (origin) => {
			if (allowed.length === 0) return origin ?? "*";
			return allowed.includes(origin) ? origin : allowed[0];
		},
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Authorization", "Content-Type"],
		maxAge: 86400,
	})(c, next);
});

/* ---------- Supabase クライアント ---------- */

// 公開読み取り用（anon）。RLS の select ポリシーで守られる。
function anonClient(env: Bindings): SupabaseClient {
	return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

// ユーザーの JWT を載せたクライアント。以降の書き込みは本人として実行される。
function userClient(env: Bindings, token: string): SupabaseClient {
	return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
		global: { headers: { Authorization: `Bearer ${token}` } },
	});
}

// Authorization ヘッダーから Bearer トークンを取り出して検証する。
// 成功で { client, user }、失敗で null を返す。
async function authenticate(c: {
	req: { header: (name: string) => string | undefined };
	env: Bindings;
}) {
	const header = c.req.header("Authorization") ?? "";
	const token = header.startsWith("Bearer ") ? header.slice(7) : "";
	if (!token) return null;

	const client = userClient(c.env, token);
	const { data, error } = await client.auth.getUser();
	if (error || !data.user) return null;
	return { client, user: data.user };
}

/* ---------- DB(snake_case) ⇄ フロント(camelCase) 変換 ---------- */

interface SightingRow {
	id: string;
	user_id: string | null;
	plant_id: string | null;
	species_name: string | null;
	ai_score: number | null;
	lat: number;
	lng: number;
	date: string;
	note: string | null;
	reporter: string | null;
	photo_url: string | null;
	status: string;
	created_at: string;
}

// フロントの getAllSightings() が期待する形へ
function toCamel(r: SightingRow) {
	return {
		id: r.id,
		plantId: r.plant_id,
		speciesName: r.species_name,
		aiScore: r.ai_score,
		lat: r.lat,
		lng: r.lng,
		date: r.date,
		note: r.note,
		reporter: r.reporter,
		photoUrl: r.photo_url,
		status: r.status,
		createdAt: r.created_at,
	};
}

/* ============================================================
   ルート
   ============================================================ */

app.get("/health", (c) => c.json({ ok: true }));

// 全投稿を取得（公開）
app.get("/sightings", async (c) => {
	const supabase = anonClient(c.env);
	const { data, error } = await supabase
		.from("sightings")
		.select("*")
		.order("date", { ascending: false });

	if (error) return c.json({ error: error.message }, 500);
	return c.json((data as SightingRow[]).map(toCamel));
});

// 投稿を作成（ログイン必須）
app.post("/sightings", async (c) => {
	const auth = await authenticate(c);
	if (!auth) return c.json({ error: "認証が必要です" }, 401);

	let body: Record<string, unknown>;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "JSON ボディが不正です" }, 400);
	}

	// 必須：位置
	const lat = Number(body.lat);
	const lng = Number(body.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return c.json({ error: "lat / lng が必要です" }, 400);
	}

	// 表示名（Google の full_name → name → メールのローカル部）
	const meta = (auth.user.user_metadata ?? {}) as Record<string, unknown>;
	const displayName =
		(meta.full_name as string) ||
		(meta.name as string) ||
		(auth.user.email ? auth.user.email.split("@")[0] : "匿名");

	// プロフィール行を保証（トリガーが無い環境の保険）
	await auth.client
		.from("users")
		.upsert({ id: auth.user.id, display_name: displayName }, { onConflict: "id" });

	// サーバーが id / user_id / reporter / created_at / status を付与
	const insertRow = {
		user_id: auth.user.id,
		plant_id: (body.plantId as string) ?? null,
		species_name: (body.speciesName as string) ?? null,
		ai_score: body.aiScore == null ? null : Number(body.aiScore),
		lat,
		lng,
		date: (body.date as string) || new Date().toISOString().slice(0, 10),
		note: (body.note as string) ?? null,
		reporter: displayName,
		photo_url: (body.photoUrl as string) ?? null,
	};

	const { data, error } = await auth.client
		.from("sightings")
		.insert(insertRow)
		.select("*")
		.single();

	if (error) return c.json({ error: error.message }, 500);
	return c.json(toCamel(data as SightingRow), 201);
});

// 写真をアップロードして URL を返す（ログイン必須）
app.post("/photos", async (c) => {
	const auth = await authenticate(c);
	if (!auth) return c.json({ error: "認証が必要です" }, 401);

	const form = await c.req.formData();
	const file = form.get("file");
	if (!(file instanceof File)) {
		return c.json({ error: "file が必要です" }, 400);
	}

	// ユーザーごとのフォルダに保存。衝突しないキーを生成。
	const ext = file.type === "image/png" ? "png" : "jpg";
	const key = `${auth.user.id}/${crypto.randomUUID()}.${ext}`;

	const { error } = await auth.client.storage
		.from(PHOTO_BUCKET)
		.upload(key, file, {
			contentType: file.type || "image/jpeg",
			upsert: false,
		});

	if (error) return c.json({ error: error.message }, 500);

	const { data } = auth.client.storage.from(PHOTO_BUCKET).getPublicUrl(key);
	return c.json({ url: data.publicUrl }, 201);
});

export default app;
