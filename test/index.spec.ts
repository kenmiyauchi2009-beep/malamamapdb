import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// ネットワーク（Supabase）に触れないルートだけを検証する。
// GET /sightings や POST の成功系は実 Supabase 依存のため E2E 側で確認する。
describe("Malama Map backend", () => {
	it("GET /health returns {ok:true}", async () => {
		const res = await SELF.fetch("http://example.com/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("POST /sightings without auth returns 401", async () => {
		const res = await SELF.fetch("http://example.com/sightings", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lat: 21.3, lng: -157.8 }),
		});
		expect(res.status).toBe(401);
	});

	it("POST /photos without auth returns 401", async () => {
		const res = await SELF.fetch("http://example.com/photos", {
			method: "POST",
			body: new FormData(),
		});
		expect(res.status).toBe(401);
	});
});
