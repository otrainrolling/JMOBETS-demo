// Supabase Edge Function: jmo-register
// Server-side username/password registration. No secret is ever sent to the browser.
import { createClient } from "npm:@supabase/supabase-js@2.119.1";

const allowedOrigin = "https://otrainrolling.github.io";
const headers = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Content-Type": "application/json",
  "Vary": "Origin",
  "Cache-Control": "no-store",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}
Deno.serve(async (request: Request) => {
  if (request.headers.get("origin") !== allowedOrigin) {
    return json({error:"Invalid origin"},403);
  }
  if (request.method === "OPTIONS") return new Response(null, {status:204,headers});
  if (request.method !== "POST") return json({error:"Method not allowed"},405);
  if (Number(request.headers.get("content-length")||0) > 4096) return json({error:"Request too large"},413);

  let payload: {username?:unknown; password?:unknown};
  try { payload = await request.json(); } catch { return json({error:"Invalid request"},400); }
  const username = typeof payload.username === "string" ? payload.username.trim().toLowerCase() : "";
  const password = payload.password;
  if (!/^[a-z0-9_]{3,20}$/.test(username) || typeof password!=="string" || password.length<12 || password.length>128) {
    return json({error:"Use a username of 3–20 letters, numbers or underscores and a password of 12–128 characters."},400);
  }

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !secret) return json({error:"Registration service is not configured"},503);
  const admin = createClient(projectUrl,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  // Best-effort registration abuse protection. In production, add CAPTCHA/WAF and
  // stronger distributed throttling before opening self-service signups at scale.
  const rawIP = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(rawIP+"|jmobets-signup-v1"));
  const fingerprint = Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,"0")).join("");
  const since = new Date(Date.now()-60*60*1000).toISOString();
  const {count,error:countError} = await admin.from("signup_attempts").select("id",{count:"exact",head:true})
    .eq("fingerprint",fingerprint).gte("created_at",since);
  if (countError) return json({error:"Registration temporarily unavailable"},503);
  if ((count||0)>=5) return json({error:"Too many sign-up attempts. Try again later."},429);
  const {error:logError} = await admin.from("signup_attempts").insert({fingerprint});
  if (logError) return json({error:"Registration temporarily unavailable"},503);

  const {error} = await admin.auth.admin.createUser({
    email:username+"@accounts.jmobets.invalid",
    password,
    email_confirm:true,
    user_metadata:{username},
  });
  if (error) {
    // Do not expose raw Auth internals.
    if (/already|exists|duplicate|registered|unique/i.test(error.message||""))
      return json({error:"Username is already taken."},409);
    return json({error:"Could not create account. Choose a different username and retry."},400);
  }
  return json({ok:true},201);
});
