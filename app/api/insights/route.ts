import OpenAI from "openai";
import { NextResponse } from "next/server";
import type { Transaction } from "@/lib/types";

export async function POST(request: Request) {
  const { transactions } = (await request.json()) as { transactions: Transaction[] };

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      insights: [
        {
          title: "OpenAI não configurada",
          body: "Configure OPENAI_API_KEY no ambiente de deploy para gerar análises avançadas. O dashboard segue funcionando com insights locais enquanto isso.",
          severity: "info"
        }
      ]
    });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.25,
    messages: [
      {
        role: "system",
        content:
          "Você é um analista financeiro pessoal. Responda apenas em JSON com a chave insights, contendo objetos com title, body e severity: info, success, warning ou danger."
      },
      {
        role: "user",
        content: JSON.stringify({
          objetivo:
            "Encontrar maiores gastos, categorias em alta, gastos incomuns, recorrências, assinaturas, desperdícios, projeções, previsão de saldo, economia e alertas.",
          transactions: transactions.slice(-250)
        })
      }
    ],
    response_format: { type: "json_object" }
  });

  return NextResponse.json(JSON.parse(completion.choices[0]?.message?.content ?? "{\"insights\":[]}"));
}
