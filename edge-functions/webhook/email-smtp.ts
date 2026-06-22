import nodemailer from "npm:nodemailer@6.9.16";

const DEFAULT_FROM_NAME = "Task Master";

/** Build "Task Master <email>" — display name is always Task Master unless MAIL_FROM_NAME is set. */
function resolveFromAddress() {
  const displayName =
    Deno.env.get("MAIL_FROM_NAME")?.trim() || DEFAULT_FROM_NAME;
  const fromRaw = Deno.env.get("MAIL_FROM")?.trim();
  const smtpUser = Deno.env.get("SMTP_USER")?.trim();

  let email = smtpUser ?? "";
  if (fromRaw) {
    const bracketMatch = fromRaw.match(/<([^>]+)>/);
    if (bracketMatch) {
      email = bracketMatch[1].trim();
    } else if (fromRaw.includes("@")) {
      email = fromRaw;
    }
  }

  if (!email) return null;
  return `${displayName} <${email}>`;
}

function smtpConfig() {
  const host = Deno.env.get("SMTP_HOST")?.trim();
  const port = Number(Deno.env.get("SMTP_PORT") ?? "465");
  const user = Deno.env.get("SMTP_USER")?.trim();
  const pass = Deno.env.get("SMTP_PASS");
  const from = resolveFromAddress();

  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");
  if (!from) missing.push("MAIL_FROM or SMTP_USER (for sender email)");

  if (missing.length) {
    throw new Error(
      `Missing SMTP env: ${missing.join(", ")}. Set in Supabase Edge Functions → Secrets or .env`
    );
  }

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("SMTP_PORT must be a positive number");
  }

  const secureEnv = Deno.env.get("SMTP_SECURE");
  const secure =
    secureEnv === "true"
      ? true
      : secureEnv === "false"
        ? false
        : port === 465;

  return { host, port, user, pass, from, secure };
}

/** Send HTML email via SMTP. Returns SMTP messageId when available. */
export async function sendSmtpEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  const { host, port, user, pass, from, secure } = smtpConfig();

  const timeoutMs = Number(Deno.env.get("SMTP_TIMEOUT_MS") ?? "25000");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("SMTP_TIMEOUT_MS must be a positive number");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`SMTP send timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    const info = await Promise.race([
      transporter.sendMail({ from, to, subject, html }),
      timeoutPromise,
    ]);
    return info?.messageId ?? null;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    transporter.close();
  }
}
