import type { Filters, Insight, Transaction, TransactionType } from "./types";

export const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

export const monthLabel = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC"
});

const normalizeText = (value: unknown) =>
  String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function isExpense(item: Transaction) {
  return item.tipo === "Despesa" || item.tipo === "Despesa Fixa";
}

export function normalizeType(value: unknown): TransactionType {
  const text = normalizeText(value);
  if (text.includes("receita") || text.includes("entrada") || text.includes("credito")) return "Receita";
  if (text.includes("fixa") || text.includes("recorrente")) return "Despesa Fixa";
  return "Despesa";
}

export function parseDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + Math.floor(value));
    return excelEpoch.toISOString().slice(0, 10);
  }
  const raw = String(value ?? "").trim();
  if (!raw) return new Date().toISOString().slice(0, 10);
  const br = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

export function parseMoney(value: unknown): number {
  if (typeof value === "number") {
    const decimal = String(value).split(".")[1] ?? "";
    return Math.abs(value > 0 && value < 10 && decimal.length === 3 ? value * 1000 : value);
  }

  let raw = String(value ?? "")
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!raw || isDateLike(raw)) return 0;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  if (hasComma && hasDot) {
    raw = raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (hasComma) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const decimals = raw.split(".").at(-1) ?? "";
    raw = decimals.length <= 2 ? raw : raw.replace(/\./g, "");
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

export function mapRowToTransaction(row: Record<string, unknown>, index: number): Transaction {
  const keys = Object.keys(row);
  const get = (...aliases: string[]) => {
    const wanted = aliases.map(normalizeText);
    const key = keys.find((item) => wanted.includes(normalizeText(item)));
    return key ? row[key] : "";
  };

  const subcategoria = String(get("Subcategoria", "Sub-category") || "");
  const observacoes = String(get("Observações", "Observacoes", "Notes", "Obs") || "");
  const tipo = normalizeType(get("Tipo", "Entrada/Saída", "Receita ou Despesa") || observacoes);
  const conta = String(get("Conta", "Account", "Banco", "Cartão", "Cartao") || subcategoria || "Carteira");
  const formaPagamento = String(
    get("Forma de pagamento", "Pagamento", "Payment", "Método") ||
      (normalizeText(conta).includes("nubank") || normalizeText(conta).includes("cartao") || normalizeText(conta).includes("cartão")
        ? "Crédito"
        : "Não informado")
  );

  return {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${index}`,
    data: parseDate(get("Data", "Date", "Dt")),
    descricao: String(get("Descrição", "Descricao", "Description", "Histórico") || "Sem descrição"),
    categoria: String(get("Categoria", "Category") || "Sem categoria"),
    subcategoria,
    tipo,
    valor: parseMoney(get("Valor", "Value", "Amount", "Total")),
    conta,
    formaPagamento,
    observacoes
  };
}

export function mapRowsToTransactions(rows: Record<string, unknown>[]): Transaction[] {
  const hasStructuredHeaders = rows.some((row) =>
    Object.keys(row).some((key) =>
      ["data", "descricao", "descrição", "valor", "tipo", "categoria"].includes(normalizeText(key))
    )
  );

  if (hasStructuredHeaders) {
    return rows.map(mapRowToTransaction).filter((item) => item.valor > 0);
  }

  return mapBudgetRowsToTransactions(rows);
}

export function mapSheetRowsToTransactions(rows: unknown[][]): Transaction[] {
  const cleanRows = rows
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));
  const firstRow = cleanRows[0] ?? [];
  const structuredHeaderIndexes = firstRow
    .map((cell, index) => ({ name: normalizeText(cell), index }))
    .filter((cell) => ["data", "descricao", "descrição", "valor", "tipo", "categoria"].includes(cell.name));

  if (structuredHeaderIndexes.length >= 2) {
    const dataRows = cleanRows.slice(1).map((row) => {
      const record: Record<string, unknown> = {};
      firstRow.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });
    return dataRows.map(mapRowToTransaction).filter((item) => item.valor > 0);
  }

  return mapBudgetMatrixToTransactions(cleanRows);
}

function mapBudgetMatrixToTransactions(rows: string[][]): Transaction[] {
  let currentSection = "Previsão";
  let currentDate = new Date().toISOString().slice(0, 10);

  return rows.flatMap((row, index) => {
    const label = row.find((cell) => normalizeText(cell) && !looksLikeMoney(cell)) ?? "";
    const normalized = normalizeText(label);
    const dateMatch = row.join(" ").match(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/);

    if (!label) return [];
    if (dateMatch) currentDate = parseDate(dateMatch[0]);
    if (normalized.includes("despesa")) {
      currentSection = "Despesas previstas";
      return [];
    }
    if (normalized.includes("receita")) {
      currentSection = "Receitas previstas";
      return [];
    }
    if (["previsao", "previsão", "total", "restara", "restará", "saldo"].some((word) => normalized.includes(normalizeText(word)))) return [];

    const amountCell = row.find((cell) => looksLikeMoney(cell) && parseMoney(cell) > 0);
    const amount = parseMoney(amountCell);
    if (!amount) return [];

    const tipo: TransactionType =
      normalized.includes("salario") || normalized.includes("salário") || normalized.includes("receita") || currentSection.includes("Receitas")
        ? "Receita"
        : "Despesa";

    return [
      {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${index}`,
        data: currentDate,
        descricao: label,
        categoria: tipo === "Receita" ? "Receitas previstas" : "Despesas previstas",
        subcategoria: label,
        tipo,
        valor: amount,
        conta: "Previsão",
        formaPagamento: "Não informado",
        observacoes: "Importado de planilha de previsão"
      }
    ];
  });
}

function looksLikeMoney(value: string) {
  if (isDateLike(value)) return false;
  return /r\$/i.test(value) || /^\s*-?[\d.]+,\d{2}\s*$/.test(value) || /^\s*-?\d+(\.\d+)?\s*$/.test(value);
}

function isDateLike(value: string) {
  return /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value) || /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(value);
}

function mapBudgetRowsToTransactions(rows: Record<string, unknown>[]): Transaction[] {
  let currentSection = "Previsão";
  let currentDate = new Date().toISOString().slice(0, 10);

  return rows.flatMap((row, index) => {
    const values = Object.values(row).filter((value) => String(value ?? "").trim());
    const label = String(values[0] ?? "").trim();
    const amountCandidate = values.find((value, valueIndex) => valueIndex > 0 && parseMoney(value) > 0);
    const amount = parseMoney(amountCandidate);
    const normalized = normalizeText(label);
    const dateMatch = label.match(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/);

    if (!label) return [];
    if (dateMatch) currentDate = parseDate(dateMatch[0]);
    if (normalized.includes("despesa")) currentSection = "Despesas previstas";
    if (normalized.includes("receita")) currentSection = "Receitas previstas";
    if (["total", "restara", "restará", "saldo"].some((word) => normalized.includes(normalizeText(word)))) return [];
    if (!amount) return [];

    const tipo: TransactionType =
      normalized.includes("salario") || normalized.includes("receita") || currentSection.includes("Receitas")
        ? "Receita"
        : "Despesa";

    return [
      {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${index}`,
        data: currentDate,
        descricao: label,
        categoria: tipo === "Receita" ? "Receitas previstas" : "Despesas previstas",
        subcategoria: label,
        tipo,
        valor: amount,
        conta: "Previsão",
        formaPagamento: "Não informado",
        observacoes: "Importado de planilha de previsão em duas colunas"
      }
    ];
  });
}

export function applyFilters(transactions: Transaction[], filters: Filters) {
  return transactions.filter((item) => {
    const date = new Date(`${item.data}T00:00:00`);
    const yearOk = filters.year === "all" || String(date.getFullYear()) === filters.year;
    const monthOk = filters.month === "all" || String(date.getMonth() + 1).padStart(2, "0") === filters.month;

    return (
      yearOk &&
      monthOk &&
      (filters.category === "all" || item.categoria === filters.category) &&
      (filters.account === "all" || item.conta === filters.account) &&
      (filters.type === "all" || item.tipo === filters.type) &&
      (filters.payment === "all" || item.formaPagamento === filters.payment)
    );
  });
}

export function summarize(transactions: Transaction[]) {
  const income = transactions.filter((t) => t.tipo === "Receita").reduce((sum, t) => sum + t.valor, 0);
  const expenses = transactions.filter(isExpense).reduce((sum, t) => sum + t.valor, 0);
  return { income, expenses, balance: income - expenses, savingsRate: income > 0 ? ((income - expenses) / income) * 100 : 0 };
}

export function groupBy(transactions: Transaction[], key: keyof Transaction, onlyExpense = false) {
  const data = new Map<string, number>();
  transactions.filter((item) => !onlyExpense || isExpense(item)).forEach((item) => {
    data.set(String(item[key]), (data.get(String(item[key])) ?? 0) + item.valor);
  });
  return Array.from(data, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function monthlyFlow(transactions: Transaction[]) {
  const data = new Map<string, { month: string; receitas: number; despesas: number; saldo: number }>();
  transactions.forEach((item) => {
    const date = new Date(`${item.data}T00:00:00Z`);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const current = data.get(key) ?? { month: monthLabel.format(date), receitas: 0, despesas: 0, saldo: 0 };
    if (item.tipo === "Receita") current.receitas += item.valor;
    if (isExpense(item)) current.despesas += item.valor;
    current.saldo = current.receitas - current.despesas;
    data.set(key, current);
  });
  return Array.from(data.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}

export function runningBalance(transactions: Transaction[]) {
  let balance = 0;
  return [...transactions].sort((a, b) => a.data.localeCompare(b.data)).map((item) => {
    balance += item.tipo === "Receita" ? item.valor : -item.valor;
    return { date: item.data.slice(5), saldo: balance };
  });
}

export function generateInsights(transactions: Transaction[]): Insight[] {
  const expenses = transactions.filter(isExpense);
  const summary = summarize(transactions);
  const byCategory = groupBy(transactions, "categoria", true);
  const topCategory = byCategory[0];
  const averageExpense = expenses.length ? expenses.reduce((sum, item) => sum + item.valor, 0) / expenses.length : 0;
  const unusual = expenses.filter((item) => item.valor > averageExpense * 2.5).slice(0, 3);
  const recurring = findRecurring(expenses);
  const today = new Date();
  const monthDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const projectedExpenses = (summary.expenses / Math.max(1, today.getDate())) * monthDays;
  const insights: Insight[] = [];

  if (topCategory) insights.push({ title: "Maior concentração de gastos", body: `${topCategory.name} concentra ${currency.format(topCategory.value)} em despesas.`, severity: "warning" });
  if (unusual.length) insights.push({ title: "Gastos incomuns detectados", body: unusual.map((item) => `${item.descricao}: ${currency.format(item.valor)}`).join(" | "), severity: "danger" });
  if (recurring.length) insights.push({ title: "Possíveis assinaturas", body: recurring.slice(0, 4).join(", "), severity: "info" });
  insights.push({ title: "Estimativa até o fim do mês", body: `No ritmo atual, as despesas podem chegar a ${currency.format(projectedExpenses)}. Saldo projetado: ${currency.format(summary.income - projectedExpenses)}.`, severity: projectedExpenses > summary.income ? "danger" : "success" });
  if (summary.savingsRate < 10 && summary.income > 0) insights.push({ title: "Alerta de economia", body: `A economia está em ${summary.savingsRate.toFixed(1)}% das receitas.`, severity: "warning" });
  return insights;
}

function findRecurring(expenses: Transaction[]) {
  const names = new Map<string, number>();
  expenses.forEach((item) => {
    const cleaned = normalizeText(item.descricao).replace(/\d+/g, "").replace(/\s+/g, " ").trim();
    if (cleaned.length > 3) names.set(cleaned, (names.get(cleaned) ?? 0) + 1);
  });
  return Array.from(names.entries()).filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

export function answerQuestion(question: string, transactions: Transaction[]) {
  const q = normalizeText(question);
  const category = Array.from(new Set(transactions.map((t) => t.categoria))).find((cat) => q.includes(normalizeText(cat)));
  let scoped = transactions;
  const now = new Date();
  if (q.includes("este mes") || q.includes("mes atual")) {
    scoped = scoped.filter((item) => {
      const date = new Date(`${item.data}T00:00:00`);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });
  }
  if (category) scoped = scoped.filter((item) => item.categoria === category);
  if (q.includes("maior gasto")) {
    const biggest = [...scoped].filter(isExpense).sort((a, b) => b.valor - a.valor)[0];
    return biggest ? `Seu maior gasto foi ${biggest.descricao}, em ${biggest.categoria}, no valor de ${currency.format(biggest.valor)}.` : "Não encontrei despesas nesse recorte.";
  }
  if (q.includes("semana")) {
    const expenses = scoped.filter(isExpense).reduce((sum, t) => sum + t.valor, 0);
    const weeks = Math.max(1, new Set(scoped.map((t) => weekKey(t.data))).size);
    return `Seu gasto médio por semana nesse recorte é ${currency.format(expenses / weeks)}.`;
  }
  if (q.includes("final do ano")) {
    const summary = summarize(scoped);
    const month = now.getMonth() + 1;
    const projected = summary.balance + (summary.balance / Math.max(1, month)) * (12 - month);
    return `Mantendo o ritmo atual, a projeção aproximada para o final do ano é ${currency.format(projected)}.`;
  }
  const summary = summarize(scoped);
  if (category || q.includes("gastei") || q.includes("despesa")) return `Você gastou ${currency.format(summary.expenses)}${category ? ` com ${category}` : ""} nesse recorte.`;
  if (q.includes("economizei") || q.includes("saldo")) return `Seu saldo no recorte é ${currency.format(summary.balance)}, com taxa de economia de ${summary.savingsRate.toFixed(1)}%.`;
  return `Encontrei ${scoped.length} lançamentos. Receitas: ${currency.format(summary.income)}. Despesas: ${currency.format(summary.expenses)}. Saldo: ${currency.format(summary.balance)}.`;
}

function weekKey(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  const first = new Date(parsed.getFullYear(), 0, 1);
  const days = Math.floor((parsed.getTime() - first.getTime()) / 86400000);
  return `${parsed.getFullYear()}-${Math.ceil((days + first.getDay() + 1) / 7)}`;
}

export const sampleTransactions: Transaction[] = [
  { id: "1", data: "2026-07-01", descricao: "Salário", categoria: "Renda", subcategoria: "CLT", tipo: "Receita", valor: 8200, conta: "Banco principal", formaPagamento: "Pix", observacoes: "" },
  { id: "2", data: "2026-07-02", descricao: "Supermercado", categoria: "Alimentação", subcategoria: "Mercado", tipo: "Despesa", valor: 684.3, conta: "Cartão", formaPagamento: "Crédito", observacoes: "" },
  { id: "3", data: "2026-07-04", descricao: "Aluguel", categoria: "Moradia", subcategoria: "Aluguel", tipo: "Despesa", valor: 2300, conta: "Banco principal", formaPagamento: "Débito", observacoes: "Recorrente" },
  { id: "4", data: "2026-06-18", descricao: "Restaurante", categoria: "Alimentação", subcategoria: "Restaurante", tipo: "Despesa", valor: 156.9, conta: "Cartão", formaPagamento: "Crédito", observacoes: "" },
  { id: "5", data: "2026-06-07", descricao: "Streaming", categoria: "Assinaturas", subcategoria: "Entretenimento", tipo: "Despesa", valor: 49.9, conta: "Cartão", formaPagamento: "Crédito", observacoes: "Mensal" },
  { id: "6", data: "2026-07-07", descricao: "Streaming", categoria: "Assinaturas", subcategoria: "Entretenimento", tipo: "Despesa", valor: 49.9, conta: "Cartão", formaPagamento: "Crédito", observacoes: "Mensal" }
];


