import { NextResponse } from "next/server";

type AlertPayload = {
  balance: number;
  level: "low" | "zero";
  userEmail?: string;
  test?: boolean;
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

export async function POST(request: Request) {
  const { balance, level, userEmail, test } = (await request.json()) as AlertPayload;

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

  const title = test ? "TESTE DO DASHBOARD" : level === "zero" ? "ALERTA CRITICO" : "ALERTA DE SALDO";
  const body = test
    ? `Teste do Controle de Gastos.\nSe voce recebeu esta mensagem, a integracao com WhatsApp esta funcionando.`
    : `${title}\n` +
      `Seu saldo chegou a ${currency.format(balance)}.\n` +
      `${level === "zero" ? "A conta chegou a zero ou ficou negativa." : "A conta chegou a R$ 50,00 ou menos."}\n` +
      `Lancamento feito por: ${userEmail || "dashboard"}.`;

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
        throw new Error(result?.message ?? result?.error_message ?? "Falha ao enviar WhatsApp.");
      }
      return result;
    })
  );

  return NextResponse.json({ ok: true, sent: results.length });
}

function normalizeWhatsAppNumber(value: string) {
  return value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
}
