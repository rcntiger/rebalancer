-- 리밸런서 허용 사용자 (여러 명) — 각자 자기 데이터만 읽고 쓰기
-- Supabase → SQL Editor 에 붙여넣고, 아래 이메일 목록만 바꿔 Run
-- 사람을 추가·삭제할 때는 이 함수의 목록만 고쳐 다시 실행하면 됨

create or replace function public.rb_allowed() returns boolean
language sql stable as $$
  select lower(coalesce(auth.jwt()->>'email', '')) = any (array[
    'rcntiger@daum.net',     -- 본인
    '아내_이메일'             -- 아내 (실제 주소로 바꾸기)
  ]);
$$;

-- 기존 규칙(이메일 한 명용)을 지우고 새 규칙으로 바꿈
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('rebalancer_data', 'rebalancer_backups', 'kis_token')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 계좌 데이터: 허용된 사람이 자기 것만
create policy "rb_data_own" on public.rebalancer_data
  for all to authenticated
  using (user_id = auth.uid() and public.rb_allowed())
  with check (user_id = auth.uid() and public.rb_allowed());

-- 백업: 허용된 사람이 자기 것만
create policy "rb_backups_own" on public.rebalancer_backups
  for all to authenticated
  using (user_id = auth.uid() and public.rb_allowed())
  with check (user_id = auth.uid() and public.rb_allowed());

-- KIS 토큰: 허용된 사람끼리 함께 사용 (시세 조회용 1개)
create policy "rb_kis_token" on public.kis_token
  for all to authenticated
  using (public.rb_allowed())
  with check (public.rb_allowed());
