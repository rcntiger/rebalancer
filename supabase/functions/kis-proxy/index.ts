// 리밸런서 KIS 클라우드 프록시 (Supabase Edge Function)
//
// - 로그인한 본인(OWNER_EMAIL)만 사용 가능
// - KIS "시세 조회" 주소만 중계 (주문·잔고 등은 차단)
// - KIS 토큰은 kis_token 테이블에 저장해 24시간 재사용 (발급 제한: 1분 1회)
// - 필요한 Secrets: KIS_APP_KEY, KIS_APP_SECRET, OWNER_EMAIL
//
// 요청 (POST JSON)
//   { ping: true }                                   연결·토큰 확인
//   { path: "/uapi/...", query: "A=1&B=2", tr_id }   KIS 시세 조회 → KIS 응답 그대로
//   { yahoo: "OIL" | "US10Y" }                       → { rt_cd: "0", output: { price } }
//   { div: "458730.KS" | "JEPQ" }                     → 최근 1년 배당 합계 { ok, ttm, n, cur, last }
import { createClient } from "jsr:@supabase/supabase-js@2";

const KIS = "https://openapi.koreainvestment.com:9443";

// 허용: 국내·해외 "시세(quotations)" 조회만
const ALLOWED_PATH = /^\/uapi\/(domestic-stock|overseas-price)\/v1\/quotations\/[a-z0-9-]+$/;
const ALLOWED_TR = /^(FHK|HHD|FHP)[A-Z0-9]{5,}$/;
const YAHOO: Record<string, string> = { OIL: "CL=F", US10Y: "^TNX" };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

// 같은 서버 인스턴스 안에서는 메모리에도 보관
let memTok = "", memExp = 0;
let issuing: Promise<string> | null = null;

async function getToken(db: any): Promise<string> {
  const now = Date.now(), margin = 10 * 60 * 1000;
  if (memTok && memExp - margin > now) return memTok;

  const { data } = await db.from("kis_token").select("token,expires_at").eq("id", 1).maybeSingle();
  if (data && new Date(data.expires_at).getTime() - margin > now) {
    memTok = data.token; memExp = new Date(data.expires_at).getTime();
    return memTok;
  }
  // 동시에 여러 요청이 와도 발급은 한 번만
  issuing ??= (async () => {
    try {
      const r = await fetch(`${KIS}/oauth2/tokenP`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          appkey: Deno.env.get("KIS_APP_KEY"),
          appsecret: Deno.env.get("KIS_APP_SECRET"),
        }),
        signal: AbortSignal.timeout(10000),
      });
      const d: any = await r.json().catch(() => ({}));
      if (!d.access_token) {
        // 1분 제한에 걸린 경우: 다른 요청이 방금 발급해 저장했을 수 있음
        const again = await db.from("kis_token").select("token,expires_at").eq("id", 1).maybeSingle();
        if (again.data && new Date(again.data.expires_at).getTime() > now) return again.data.token;
        throw new Error("KIS 토큰 발급 실패: " + (d.error_description || d.msg1 || r.status));
      }
      const exp = Date.now() + (Number(d.expires_in) || 86400) * 1000;
      memTok = d.access_token; memExp = exp;
      await db.from("kis_token").upsert({ id: 1, token: memTok, expires_at: new Date(exp).toISOString() });
      return memTok;
    } finally {
      issuing = null;
    }
  })();
  return issuing;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ message: "POST only" }, 405);

  // ── 본인 확인 ──
  const auth = req.headers.get("Authorization") ?? "";
  // 키 방식에 따라 환경변수 이름이 달라 차례로 시도 (사용자 토큰으로 접속하므로 RLS가 적용됨)
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, anon, { global: { headers: { Authorization: auth } } });
  const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  const owner = (Deno.env.get("OWNER_EMAIL") ?? "").toLowerCase().trim();
  if (!u?.user) return json({ message: "로그인이 필요합니다" }, 401);
  if (!owner || (u.user.email ?? "").toLowerCase() !== owner) return json({ message: "허용되지 않은 사용자입니다" }, 403);

  const ak = Deno.env.get("KIS_APP_KEY"), as = Deno.env.get("KIS_APP_SECRET");
  if (!ak || !as) return json({ message: "서버에 KIS 키가 설정되지 않았습니다" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch (_) { return json({ message: "잘못된 요청" }, 400); }

  try {
    // ── Yahoo (원유·미국채) ──
    if (body.yahoo) {
      const sym = YAHOO[String(body.yahoo).toUpperCase()];
      if (!sym) return json({ rt_cd: "1", message: "unknown" }, 400);
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
      const d: any = await r.json();
      const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
      return json(price != null ? { rt_cd: "0", output: { price } } : { rt_cd: "1" });
    }

    // ── 배당: Yahoo 최근 1년(365일) 배당 기록 합계 ──
    if (body.div) {
      const sym = String(body.div).toUpperCase().trim();
      if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(sym)) return json({ ok: false, message: "잘못된 종목코드" }, 400);
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1mo&events=div`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
      const d: any = await r.json().catch(() => null);
      const res = d?.chart?.result?.[0];
      if (!res) return json({ ok: false, message: "배당 정보 없음" });
      const since = Date.now() / 1000 - 365 * 86400;
      const divs = Object.values(res.events?.dividends ?? {})
        .filter((x: any) => x.date >= since && +x.amount > 0)
        .sort((a: any, b: any) => a.date - b.date) as any[];
      const ttm = divs.reduce((t, x) => t + Number(x.amount), 0);
      const last = divs.at(-1);
      return json({ ok: true, ttm, n: divs.length, cur: res.meta?.currency ?? "", last: last ? { date: last.date, amount: Number(last.amount) } : null });
    }

    // ── 연결 확인 ──
    if (body.ping) {
      await getToken(db);
      return json({ ok: true, region: Deno.env.get("SB_REGION") ?? "" });
    }

    // ── KIS 시세 ──
    const path = String(body.path ?? ""), trId = String(body.tr_id ?? "");
    if (!ALLOWED_PATH.test(path) || !ALLOWED_TR.test(trId)) {
      return json({ message: "허용되지 않은 요청입니다 (시세 조회만 가능)" }, 403);
    }
    const query = String(body.query ?? "").replace(/^\?/, "");
    const call = async (tok: string) => fetch(`${KIS}${path}${query ? "?" + query : ""}`, {
      headers: { authorization: `Bearer ${tok}`, appkey: ak, appsecret: as, tr_id: trId,
        custtype: "P", "content-type": "application/json; charset=utf-8" },
      signal: AbortSignal.timeout(10000),
    });
    let r = await call(await getToken(db));
    let text = await r.text();
    // 토큰 만료 응답이면 한 번 재발급 후 재시도
    if (/EGW00123|만료된 token|expired/i.test(text)) {
      memTok = ""; memExp = 0;
      await db.from("kis_token").delete().eq("id", 1);
      r = await call(await getToken(db));
      text = await r.text();
    }
    // KIS 응답을 그대로 전달 (오류도 rt_cd/msg1 로 판단하도록 200으로)
    return new Response(text, { status: 200, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
  } catch (e) {
    return json({ message: String((e as Error).message ?? e) }, 502);
  }
});
