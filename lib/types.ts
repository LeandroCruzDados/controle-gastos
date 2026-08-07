export type TransactionType = "Receita" | "Despesa" | "Despesa Fixa";

export type Transaction = {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  subcategoria: string;
  tipo: TransactionType;
  valor: number;
  conta: string;
  formaPagamento: string;
  observacoes: string;
  criadoPor?: string;
  isCreditCardDetail?: boolean;
  recurringEnded?: boolean;
  forecastStatus?: "forecast" | "paid";
  sourceFile?: string;
  importBatchId?: string;
  importedAt?: string;
};

export type Filters = {
  year: string;
  month: string;
  category: string;
  account: string;
  type: string;
  payment: string;
};

export type Insight = {
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "danger";
};
