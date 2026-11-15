-- 리밸런서 클라우드 백업 테이블 (날짜별 사본)
-- Supabase → SQL Editor 에 붙여넣고 Run (한 번만)
-- 로그인한 본인 데이터만, 그리고 허용한 이메일만 읽고 쓸 수 있음 (RLS)
-- 아래 '로그인_이메일' 을 본인 로그인 이메일로 바꿔 실행
create table if not exists public.rebalancer_backups (
  id          bigserial primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  kind        text not null default 'manual' check (kind in ('auto','manual','restore')),
  label       text,
  n_accounts  int,
  total_krw   numeric,
  accounts    jsonb not null,
  history     jsonb
);
create index if not exists rebalancer_backups_user_time on public.rebalancer_backups (user_id, created_at desc);

alter table public.rebalancer_backups enable row level security;

drop policy if exists "backups_owner" on public.rebalancer_backups;
create policy "backups_owner" on public.rebalancer_backups
  for all to authenticated
  using (user_id = auth.uid() and lower(auth.jwt()->>'email') = lower('로그인_이메일'))
  with check (user_id = auth.uid() and lower(auth.jwt()->>'email') = lower('로그인_이메일'));
