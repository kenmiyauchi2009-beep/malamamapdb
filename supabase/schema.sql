-- ============================================================
-- Mālama Map — フェーズ2 バックエンド スキーマ
-- ------------------------------------------------------------
-- Supabase の SQL Editor でそのまま実行できる。
-- テーブル / RLS / Storage / シード / トリガーを含む。
--
-- 実行順の注意：Storage バケットは Dashboard または以下の
-- storage.buckets への insert で作成する。RLS ポリシーは
-- 冪等（存在すれば drop → create）にしてある。
-- ============================================================

-- ---------- 拡張 ----------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ============================================================
-- 1. users（アプリ側プロフィール。auth.users と 1:1）
-- ============================================================
create table if not exists public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  reputation   int         not null default 0,  -- 実績スコア（質ベース・実装は後日）
  created_at   timestamptz not null default now()
);

-- ============================================================
-- 2. sightings（目撃投稿）
--   ※ camelCase への変換は Worker 側で行う。
--   ※ reporter 列はフロント契約維持のため保持（display_name を格納）。
-- ============================================================
create table if not exists public.sightings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users (id) on delete set null,  -- 匿名/シードは null
  plant_id     text,                 -- 図鑑の種 id。未知/未確認は null または "unknown"
  species_name text,                 -- BioCLIP が返した学名（あれば）
  ai_score     real,                 -- 0〜1
  lat          double precision not null,
  lng          double precision not null,
  date         date not null,
  note         text,
  reporter     text,                 -- 表示名（ログインユーザーの display_name）
  photo_url    text,                 -- Storage 上の写真 URL（base64 は保存しない）
  status       text not null default 'unconfirmed'
                 check (status in ('unconfirmed', 'confirmed', 'rejected')),
  rod_suspect  boolean not null default false,  -- ROD疑い（症状チェックに該当・未確定）
  created_at   timestamptz not null default now()
);

-- 既存テーブルにも列を追加（再実行時の保険。無ければ追加）
alter table public.sightings add column if not exists rod_suspect boolean not null default false;

create index if not exists sightings_date_idx     on public.sightings (date desc);
create index if not exists sightings_plant_id_idx on public.sightings (plant_id);

-- ============================================================
-- 3. RLS ポリシー
-- ============================================================
alter table public.users     enable row level security;
alter table public.sightings enable row level security;

-- --- users ---
drop policy if exists users_select_all  on public.users;
drop policy if exists users_upsert_self on public.users;
drop policy if exists users_update_self on public.users;

create policy users_select_all  on public.users
  for select using (true);
create policy users_upsert_self on public.users
  for insert with check (id = auth.uid());
create policy users_update_self on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- --- sightings ---
drop policy if exists sightings_select_all    on public.sightings;
drop policy if exists sightings_insert_owner  on public.sightings;
drop policy if exists sightings_delete_owner  on public.sightings;

-- 目撃情報は公開読み取り（地図・図鑑・フィードで使う）
create policy sightings_select_all on public.sightings
  for select using (true);

-- 投稿はログインユーザーのみ・自分の user_id でのみ作成可
create policy sightings_insert_owner on public.sightings
  for insert with check (auth.uid() is not null and user_id = auth.uid());

-- 削除は本人の投稿のみ（user_id = 本人）。シード（user_id = null）は誰も削除できない。
create policy sightings_delete_owner on public.sightings
  for delete using (auth.uid() is not null and user_id = auth.uid());

-- ============================================================
-- 4. 新規サインアップで users 行を自動生成
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 5. Storage バケット（写真）
--   public read。書き込みは authenticated のみ。
-- ============================================================
insert into storage.buckets (id, name, public)
values ('sighting-photos', 'sighting-photos', true)
on conflict (id) do nothing;

drop policy if exists photos_public_read     on storage.objects;
drop policy if exists photos_auth_insert     on storage.objects;

create policy photos_public_read on storage.objects
  for select using (bucket_id = 'sighting-photos');

create policy photos_auth_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'sighting-photos');

-- ============================================================
-- 6. シードデータ（現行 data.js の SIGHTINGS 10 件）
--   user_id は null、reporter は既存文字列のまま。
--   固定 id で冪等に。
-- ============================================================
insert into public.sightings (id, plant_id, lat, lng, date, note, reporter, status)
values
  ('00000000-0000-0000-0000-000000000001', 'ohia-lehua',       21.4145, -157.7980, '2026-05-12', 'Waikalua Loko Iʻa の遊歩道沿い。葉に黒ずみあり、ROD要観察。', 'APIS Student', 'unconfirmed'),
  ('00000000-0000-0000-0000-000000000002', 'ohia-lehua',       19.4290, -155.2570, '2026-05-18', 'ハワイ火山国立公園。健康な大木。周囲の若木も順調。',           'Volunteer K.', 'unconfirmed'),
  ('00000000-0000-0000-0000-000000000003', 'koa',              20.7150, -156.2540, '2026-04-29', 'Haleakalā 中腹の保全林。柵で放牧から守られているエリア。',      'Ranger M.',    'unconfirmed'),
  ('00000000-0000-0000-0000-000000000004', 'olapa',            22.1310, -159.6620, '2026-05-02', 'Kokeʻe の湿った尾根道。葉が風で揺れていた。',                   'Hiker A.',     'unconfirmed'),
  ('00000000-0000-0000-0000-000000000005', 'amau',             19.4015, -155.2840, '2026-05-20', '新しい溶岩流の上に赤い新芽。再生の最前線。',                    'APIS Student', 'unconfirmed'),
  ('00000000-0000-0000-0000-000000000006', 'loulu',            21.3640, -157.8000, '2026-04-15', 'Lyon Arboretum 付近で保護株を確認。野生では希少。',             'Botanist S.',  'unconfirmed'),
  ('00000000-0000-0000-0000-000000000007', 'strawberry-guava', 21.3320, -157.8010, '2026-05-08', 'Mānoa の谷で密生。在来の若木が見当たらない。要駆除。',          'Volunteer T.', 'unconfirmed'),
  ('00000000-0000-0000-0000-000000000008', 'miconia',          20.8990, -156.4060, '2026-05-11', '東マウイの林道沿いで1本発見。即報告・除去依頼済み。',           'Ranger M.',    'unconfirmed'),
  ('00000000-0000-0000-0000-000000000009', 'ohia-lehua',       21.4980, -158.0150, '2026-06-01', 'オアフ北部の尾根。今のところ ROD の兆候なし。',                 'Hiker A.',     'unconfirmed'),
  ('00000000-0000-0000-0000-000000000010', 'strawberry-guava', 22.0750, -159.3210, '2026-06-05', 'カウアイ東部の登山口付近に新たな群落。拡大中。',                'APIS Student', 'unconfirmed')
on conflict (id) do nothing;
