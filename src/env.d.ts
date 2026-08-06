// `wrangler types` が生成する worker-configuration.d.ts の `Env` に
// プロジェクト固有の変数/シークレットをマージする。
interface Env {
	SUPABASE_URL: string;
	SUPABASE_ANON_KEY: string;
	// CORS 許可オリジン（カンマ区切り）。未設定なら開発用に全許可。
	ALLOWED_ORIGIN?: string;
}
