import { Hono } from "npm:hono@4.5.4";

type SendBody = {
  email: string;
  password: string;
  emailRedirectTo?: string;
  shouldCreateUser?: boolean;
};

type VerifyBody = {
  email: string;
  token: string;
  type?: string;
};

const app = new Hono();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function getRequiredEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Supabase Edge Function preflight
app.options("*", () => {
  return new Response("ok", {
    headers: corsHeaders,
  });
});

app.post("/password-validate-send-otp", async (c) => {
  const apiKeySecret = Deno.env.get("PASSWORD_OTP_API_KEY_SECRET");

  if (!apiKeySecret) {
    return json({ error: "Server not configured" }, 500);
  }

  const authHeader = c.req.header("x-api-key") ?? "";

  if (authHeader !== apiKeySecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: SendBody | VerifyBody;

  try {
    body = await c.req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // OTP verify flow
  if ("token" in body) {
    return verifyOtpAndReturnTokens(body);
  }

  // Password validation + OTP send flow
  return validateLoginAndSendOtp(body);
});

async function validateLoginAndSendOtp(body: SendBody) {
  const email = body.email?.trim();
  const password = body.password;
  const emailRedirectTo = body.emailRedirectTo;
  const shouldCreateUser = body.shouldCreateUser ?? false;

  if (!email || !password) {
    return json({ error: "Missing email or password" }, 400);
  }

  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const supabaseAnonKey = getRequiredEnv("SUPABASE_ANON_KEY");

  // Validate credentials
  const tokenResp = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    }
  );

  if (!tokenResp.ok) {
    return json({ error: "Invalid email or password" }, 401);
  }

  // Send OTP
  const otpResp = await fetch(`${supabaseUrl}/auth/v1/otp`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      options: {
        shouldCreateUser,
        emailRedirectTo,
      },
    }),
  });

  if (!otpResp.ok) {
    const err = await otpResp.json().catch(() => null);

    return json(
      {
        error: "Could not send OTP",
        details: err,
      },
      502
    );
  }

  return json({
    ok: true,
    message: "Password validated. OTP sent.",
  });
}

async function verifyOtpAndReturnTokens(body: VerifyBody) {
  const email = body.email?.trim();
  const token = body.token;
  const type = body.type ?? "email";

  if (!email || !token) {
    return json({ error: "Missing email or token" }, 400);
  }

  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const supabaseAnonKey = getRequiredEnv("SUPABASE_ANON_KEY");

  const verifyResp = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      token,
      type,
    }),
  });

  const payload = await verifyResp.json().catch(() => null);

  if (!verifyResp.ok) {
    return json(
      {
        error: "OTP verification failed",
        details: payload,
      },
      401
    );
  }

  return json({
    ok: true,
    ...payload,
  });
}

Deno.serve(app.fetch);
