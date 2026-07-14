import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Transaction } from "@/lib/types";

const FAMILY_HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";

type DbTransaction = {
  id: string;
  household_id: string;
  user_id: string;
  date: string;
  description: string;
  category: string;
  subcategory: string | null;
  type: Transaction["tipo"];
  amount: number | string;
  account: string;
  payment_method: string;
  notes: string | null;
  source: "manual" | "card" | "import";
  card_name: string | null;
  is_recurring: boolean;
  recurrence_active: boolean;
  forecast_status: "forecast" | "paid";
  created_at?: string;
  updated_at?: string;
};

export async function ensureHousehold(user: User) {
  if (!supabase) throw new Error("Supabase nao configurado.");

  const { data: existing, error: memberError } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id);

  if (memberError) throw memberError;
  const existingHouseholdIds = (existing ?? []).map((item) => item.household_id as string);
  if (existingHouseholdIds.length) {
    const { data: latestTransaction } = await supabase
      .from("transactions")
      .select("household_id")
      .in("household_id", existingHouseholdIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return (latestTransaction?.household_id as string | undefined) ?? existingHouseholdIds[0];
  }

  const { error: householdError } = await supabase
    .from("households")
    .insert({ id: FAMILY_HOUSEHOLD_ID, name: "Minha casa", created_by: user.id });

  if (householdError && householdError.code !== "23505") throw householdError;

  const { error: insertMemberError } = await supabase
    .from("household_members")
    .insert({ household_id: FAMILY_HOUSEHOLD_ID, user_id: user.id, role: "member" });

  if (insertMemberError && insertMemberError.code !== "23505") throw insertMemberError;
  return FAMILY_HOUSEHOLD_ID;
}

export async function fetchTransactions(householdId: string) {
  if (!supabase) throw new Error("Supabase nao configurado.");

  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("household_id", householdId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(fromDbTransaction);
}

export async function saveTransactions(items: Transaction[], householdId: string, user: User) {
  if (!supabase || !items.length) return;

  const { error } = await supabase
    .from("transactions")
    .upsert(items.map((item) => toDbTransaction(item, householdId, user.id)), { onConflict: "id" });

  if (error) throw error;
}

export async function deleteTransaction(id: string) {
  if (!supabase) throw new Error("Supabase nao configurado.");

  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw error;
}

export async function replaceTransactions(items: Transaction[], householdId: string, user: User) {
  await saveTransactions(items, householdId, user);
}

function toDbTransaction(item: Transaction, householdId: string, userId: string): DbTransaction {
  const source = item.isCreditCardDetail ? "card" : item.importBatchId ? "import" : "manual";
  const cardName = item.isCreditCardDetail ? item.subcategoria || item.conta || null : null;

  return {
    id: item.id,
    household_id: householdId,
    user_id: userId,
    date: item.data,
    description: item.descricao,
    category: item.categoria || "Outros",
    subcategory: item.subcategoria || null,
    type: item.tipo,
    amount: item.valor,
    account: item.conta || "Carteira",
    payment_method: item.formaPagamento || "Nao informado",
    notes: item.observacoes || null,
    source,
    card_name: cardName,
    is_recurring: item.tipo === "Despesa Fixa" || item.observacoes.toLowerCase().includes("recorrente"),
    recurrence_active: !item.recurringEnded,
    forecast_status: "paid"
  };
}

function fromDbTransaction(item: DbTransaction): Transaction {
  return {
    id: item.id,
    data: item.date,
    descricao: item.description,
    categoria: item.category,
    subcategoria: item.subcategory ?? "",
    tipo: item.type,
    valor: Number(item.amount),
    conta: item.account,
    formaPagamento: item.payment_method,
    observacoes: item.notes ?? "",
    criadoPor: item.user_id,
    isCreditCardDetail: item.source === "card",
    recurringEnded: !item.recurrence_active
  };
}
