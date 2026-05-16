-- Supabase SQL Editor 中执行本脚本。
-- 轻量群内版：公开读取，公开写入同一份 league_state。
-- 管理员入口由网页密码隐藏；这不是强安全方案，但部署和维护最简单。

create table if not exists public.league_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.league_state enable row level security;

drop policy if exists "league_state_public_select" on public.league_state;
drop policy if exists "league_state_public_insert" on public.league_state;
drop policy if exists "league_state_public_update" on public.league_state;

create policy "league_state_public_select"
on public.league_state
for select
to anon
using (true);

create policy "league_state_public_insert"
on public.league_state
for insert
to anon
with check (true);

create policy "league_state_public_update"
on public.league_state
for update
to anon
using (true)
with check (true);

insert into public.league_state (id, data)
values (
  'main',
  '{
    "meta": {
      "kitMeta": "英超队套",
      "scoringMeta": {
        "name": "常规周",
        "drawExtra": 0,
        "kitBonusMultiplier": 1,
        "streakBonusMultiplier": 1,
        "groupBonus": { "enabled": false, "group": "甲", "points": 0 }
      }
    },
    "players": [],
    "matches": [],
    "settlements": [],
    "champions": [],
    "groupHistory": []
  }'::jsonb
)
on conflict (id) do nothing;
