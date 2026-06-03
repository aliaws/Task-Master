import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeJwt } from "https://esm.sh/jose";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_ANON_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const REFRESH_BUFFER_HOURS = 2;

async function vault(names: string[] = []) {
  const { data, error } = await supabase.rpc("get_vault_secrets", {
    names,
  });

  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, string>;
}

function shouldRefresh(accessToken: string) {
  try {
    const payload = decodeJwt(accessToken);

    if (!payload.exp) return true;

    const bufferMs = REFRESH_BUFFER_HOURS * 60 * 60 * 1000;
    const expMs = payload.exp * 1000;

    return Date.now() + bufferMs >= expMs;
  } catch {
    return true;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const v = await vault();

    const { data: token, error } = await supabase.rpc("get_token_health");

    if (error) throw new Error(error.message);

    if (!token) {
      return json({ error: "No token found" }, 404);
    }

    if (!shouldRefresh(token.access_token)) {
      return json({
        status: "active",
        message: "Token is still valid",
        access_token: token.access_token,
      });
    }

    const res = await fetch(
      "https://services.leadconnectorhq.com/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: v.clientId,
          client_secret: v.clientSecret,
          grant_type: "refresh_token",
          refresh_token: token.refresh_token,
          user_type: "Location",
        }),
      }
    );

    const t = await res.json();

    if (!res.ok) {
      return json(t, res.status);
    }

    await supabase.from("engage_tokens").insert({
      auth_code: t.auth_code ?? null,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expiry: t.expires_in,
      scope: t.scope ?? null,
    });

    return json({
      status: "refreshed",
      access_token: t.access_token,
      refresh_token: t.refresh_token,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
