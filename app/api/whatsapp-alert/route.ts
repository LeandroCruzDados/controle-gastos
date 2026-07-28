import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type AlertPayload = {
  balance: number;
  level: "low" | "zero";
  userEmail?: string;
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) {
    return NextResponse.json({ error: "Login obrigatorio para enviar alertas." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Supabase nao configurado." }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return NextResponse.json({ error: "Sessao invalida." }, { status: 401 });
  }

  const { balance, level, userEmail } = (await request.json()) as AlertPayload;

  if (!Number.isFinite(balance) || !["low", "zero"].includes(level)) {
    return NextResponse.json({ error: "Alerta invalido." }, { status: 400 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const recipients = (process.env.TWILIO_WHATSAPP_TO ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!accountSid || !authToken || !from || recipients.length === 0) {
    return NextResponse.json({ error: "Twilio nao configurado." }, { status: 500 });
  }

  const title = level === "zero" ? "ALERTA CRITICO" : "ALERTA DE SALDO";
  const body =
    `${title}\n` +
    `Seu saldo chegou a ${currency.format(balance)}.\n` +
    `${level === "zero" ? "A conta chegou a zero ou ficou negativa." : "A conta chegou a R$ 50,00 ou menos."}\n` +
    `Lancamento feito por: ${userEmail || data.user.email || "usuario logado"}.`;

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const authorization = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const results = await Promise.all(
    recipients.map(async (to) => {
      const params = new URLSearchParams();
      params.set("From", normalizeWhatsAppNumber(from));
      params.set("To", normalizeWhatsAppNumber(to));
      params.set("Body", body);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authorization}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.message ?? "Falha ao enviar WhatsApp.");
      }
      return result;
    })
  );

  return NextResponse.json({ ok: true, sent: results.length });
}

function normalizeWhatsAppNumber(value: string) {
  return value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
}
