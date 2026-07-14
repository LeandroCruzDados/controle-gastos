# Dashboard Financeiro com IA

Aplicação Next.js, React, TypeScript e Tailwind para importar planilhas Excel/CSV e gerar um dashboard financeiro interativo.

## Recursos

- Importação de `.xlsx`, `.xls` e `.csv`.
- Campos esperados: Data, Descrição, Categoria, Subcategoria, Tipo, Valor, Conta, Forma de pagamento e Observações.
- Também aceita planilhas simples de previsão em duas colunas, como item + valor, com seções de receitas/despesas.
- Dashboard com saldo, receitas, despesas, economia, comparação mensal e evolução do patrimônio.
- Gráficos com Recharts: categorias, meses, receitas x despesas, saldo, top gastos e forma de pagamento.
- Filtros por período, categoria, conta, tipo e forma de pagamento.
- Insights locais e rota `/api/insights` pronta para OpenAI.
- Assistente financeiro em linguagem natural.
- Tema claro/escuro, animações com Framer Motion e layout responsivo.
- Supabase preparado em `lib/supabase.ts` para persistência real no backend.

## Rodar localmente

```bash
pnpm install
pnpm dev
```

Abra `http://localhost:3000`.

## Variáveis de ambiente

Copie `.env.example` para `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
OPENAI_API_KEY=
```

Sem `OPENAI_API_KEY`, o app continua funcionando com insights locais.

## Backend e deploy

- Frontend/backend: Next.js App Router.
- API de IA: `app/api/insights/route.ts`.
- Persistência recomendada: Supabase com uma tabela `transactions`.
- Deploy recomendado: Vercel. Configure as variáveis acima no painel do projeto.

```sql
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  data date not null,
  descricao text not null,
  categoria text not null,
  subcategoria text,
  tipo text not null check (tipo in ('Receita', 'Despesa')),
  valor numeric(12,2) not null,
  conta text,
  forma_pagamento text,
  observacoes text,
  created_at timestamptz default now()
);
```
