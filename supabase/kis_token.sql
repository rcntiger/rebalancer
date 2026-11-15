-- KIS 토큰 저장 테이블 (Edge Function kis-proxy 가 24시간 재사용)
-- 본인 이메일로 로그인했을 때만 읽고 쓸 수 있음 → 아래 이메일을 로그인 이메일로 바꿔 실행
create table if not exists public.kis_token (
  id int primary key default 1,
  token text not null,
  expires_at timestamptz not null
);
alter table public.kis_token enable row level security;

drop policy if exists "kis_token_owner" on public.kis_token;
create policy "kis_token_owner" on public.kis_token
  for all to authenticated
  using (lower(auth.jwt()->>'email') = lower('로그인_이메일'))
  with check (lower(auth.jwt()->>'email') = lower('로그인_이메일'));
