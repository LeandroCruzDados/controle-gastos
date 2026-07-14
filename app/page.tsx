"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Bot, CreditCard, Moon, Plus, Search, Sun, Trash2, Wallet } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { answerQuestion, applyFilters, currency, generateInsights, groupBy, monthlyFlow, runningBalance, summarize } from "@/lib/finance";
import { deleteTransaction, ensureHousehold, fetchTransactions, replaceTransactions, saveTransaction, saveTransactions } from "@/lib/supabase-storage";
import { supabase } from "@/lib/supabase";
import type { Filters, Insight, Transaction, TransactionType } from "@/lib/types";
import type { User } from "@supabase/supabase-js";

const colors = ["#9d1cff", "#b8ff00", "#35d5ff", "#ff4fd8", "#7c5cff", "#00ffa8"];
const initialFilters: Filters = { year: "2026", month: "all", category: "all", account: "all", type: "all", payment: "all" };

export default function Home() {
  const [light, setLight] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("finance-transactions");
    if (!saved) return [];
    const parsed = JSON.parse(saved) as Transaction[];
    const restored = restoreKnownManualTransactionsIfEmpty(parsed);
    if (restored.length !== parsed.length) {
      localStorage.setItem("finance-transactions", JSON.stringify(restored));
      localStorage.setItem("finance-restored-manuals", "true");
    }
    return restored;
  });
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("Pergunte algo como: quanto gastei este mês?");
  const [fileStatus, setFileStatus] = useState(() => {
    if (typeof window === "undefined") return "Importe Excel ou CSV. Novos arquivos serão somados aos lançamentos atuais.";
    const restored = localStorage.getItem("finance-restored-manuals") === "true";
    if (restored) {
      localStorage.removeItem("finance-restored-manuals");
      return "Restaurei os lançamentos manuais que tinham sumido da lista.";
    }
    return "Importe Excel ou CSV. Novos arquivos serão somados aos lançamentos atuais.";
  });
  const [aiInsights, setAiInsights] = useState<Insight[]>([]);
  const [activeUser, setActiveUser] = useState(() => {
    if (typeof window === "undefined") return "Eu";
    return localStorage.getItem("finance-active-user") ?? "Eu";
  });
  const [form, setForm] = useState<Omit<Transaction, "id">>({
    data: new Date().toISOString().slice(0, 10),
    descricao: "",
    categoria: "",
    subcategoria: "",
    tipo: "Despesa",
    valor: 0,
    conta: "Carteira",
    formaPagamento: "Não informado",
    observacoes: "",
    criadoPor: "Eu"
  });
  const [cardForm, setCardForm] = useState({
    descricao: "",
    categoria: "",
    subcategoria: "Nubank",
    valor: 0,
    observacoes: ""
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cardEditingId, setCardEditingId] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authStatus, setAuthStatus] = useState("Entre para salvar seus dados na nuvem.");
  const [loadingCloud, setLoadingCloud] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) {
      setLoadingCloud(false);
      setAuthStatus("Supabase não configurado. O app está usando apenas este navegador.");
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setAuthUser(data.session?.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authUser) {
      setHouseholdId(null);
      setLoadingCloud(false);
      return;
    }

    let cancelled = false;
    const currentUser = authUser;
    async function loadCloudData() {
      try {
        setLoadingCloud(true);
        setAuthStatus("Carregando seus lançamentos na nuvem...");
        const household = await ensureHousehold(currentUser);
        const cloudItems = await fetchTransactions(household);
        if (cancelled) return;

        setHouseholdId(household);
        const localItems = readLocalTransactions();
        const migrationKey = `finance-supabase-migrated-${currentUser.id}`;
        const shouldMigrate = cloudItems.length === 0 && localItems.length > 0 && localStorage.getItem(migrationKey) !== "true";

        if (shouldMigrate) {
          await saveTransactions(localItems, household, currentUser);
          localStorage.setItem(migrationKey, "true");
          setTransactions(localItems);
          setFileStatus(`${localItems.length} lançamentos migrados para a nuvem.`);
        } else {
          setTransactions(cloudItems);
          localStorage.setItem("finance-transactions", JSON.stringify(cloudItems));
          setFileStatus(`${cloudItems.length} lançamentos carregados do Supabase.`);
        }

        setActiveUser(currentUser.email ?? "Eu");
        setForm((current) => ({ ...current, criadoPor: currentUser.email ?? "Eu" }));
        setAuthStatus(`Conectado como ${currentUser.email}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        setAuthStatus(`Não consegui carregar o Supabase: ${message}`);
      } finally {
        if (!cancelled) setLoadingCloud(false);
      }
    }

    loadCloudData();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  const filtered = useMemo(() => applyFilters(transactions, filters), [transactions, filters]);
  const summary = useMemo(() => summarize(filtered), [filtered]);
  const monthly = useMemo(() => monthlyFlow(filtered), [filtered]);
  const categoryData = useMemo(() => groupBy(filtered, "categoria", true), [filtered]);
  const paymentData = useMemo(() => groupBy(filtered, "formaPagamento", true), [filtered]);
  const balanceData = useMemo(() => runningBalance(filtered), [filtered]);
  const currentMonthExpenses = useMemo(() => {
    const now = new Date();
    return [...filtered]
      .filter((item) => {
        const date = new Date(`${item.data}T00:00:00`);
        return (
          (item.tipo === "Despesa" || item.tipo === "Despesa Fixa") &&
          date.getFullYear() === now.getFullYear() &&
          date.getMonth() === now.getMonth()
        );
      })
      .sort((a, b) => b.data.localeCompare(a.data))
      .slice(0, 12);
  }, [filtered]);
  const recurringExpenses = useMemo(() => filtered.filter((item) => item.tipo === "Despesa Fixa").sort((a, b) => b.data.localeCompare(a.data)), [filtered]);
  const creditCardExpenses = useMemo(
    () => filtered.filter(isCreditCardDetailTransaction).sort((a, b) => b.data.localeCompare(a.data)),
    [filtered]
  );
  const creditCardGroups = useMemo(() => {
    const names = ["Nubank", "Santander"];
    return names.map((name) => {
      const items = creditCardExpenses.filter((item) => getCardName(item) === name);
      return { name, items, total: items.reduce((sum, item) => sum + item.valor, 0) };
    });
  }, [creditCardExpenses]);
  const manualTransactions = useMemo(() => {
    const currentMonth = transactions.filter(isCurrentMonth);
    const manual = currentMonth.filter((item) => !isCreditCardDetailTransaction(item) && !isCreditCardSummaryTransaction(item));
    const creditSummaries = buildCreditCardSummaries(currentMonth.filter(isCreditCardDetailTransaction));
    return [...creditSummaries, ...manual].sort((a, b) => b.data.localeCompare(a.data));
  }, [transactions]);
  const nextMonthFixedForecasts = useMemo(
    () => latestRecurringItems(transactions.filter((item) => !isCreditCardDetailTransaction(item) && !isCreditCardSummaryTransaction(item) && isManualForecastSource(item))),
    [transactions]
  );
  const nextMonthCardForecasts = useMemo(
    () => latestRecurringItems(transactions.filter((item) => isCreditCardDetailTransaction(item) && isRecurringCardItem(item))),
    [transactions]
  );
  const nextMonthCardForecastSummaries = useMemo(() => buildCreditCardSummaries(nextMonthCardForecasts), [nextMonthCardForecasts]);
  const nextMonthCombinedForecasts = useMemo(
    () => [...nextMonthCardForecastSummaries, ...nextMonthFixedForecasts].sort((a, b) => b.data.localeCompare(a.data)),
    [nextMonthCardForecastSummaries, nextMonthFixedForecasts]
  );
  const nextMonthCardForecastTotal = useMemo(() => nextMonthCardForecasts.reduce((sum, item) => sum + item.valor, 0), [nextMonthCardForecasts]);
  const nextMonthFixedForecastTotal = useMemo(
    () => nextMonthFixedForecasts.reduce((sum, item) => sum + (item.tipo === "Receita" ? item.valor : -item.valor), 0) - nextMonthCardForecastTotal,
    [nextMonthFixedForecasts, nextMonthCardForecastTotal]
  );
  const insights = useMemo(() => generateInsights(filtered), [filtered]);

  const categories = unique(transactions.map((t) => t.categoria));
  const accounts = unique(transactions.map((t) => t.conta));
  const payments = unique(transactions.map((t) => t.formaPagamento));
  function persist(next: Transaction[], message = `${next.length} lançamentos salvos.`) {
    setTransactions(next);
    localStorage.setItem("finance-transactions", JSON.stringify(next));
    setFileStatus(message);
    syncCloud(next);
  }

  async function syncCloud(next: Transaction[]) {
    if (!authUser || !householdId) return;
    try {
      await replaceTransactions(next, householdId, authUser);
      setAuthStatus(`Sincronizado na nuvem como ${authUser.email}.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "erro desconhecido";
      setAuthStatus(`Salvei neste navegador, mas falhou na nuvem: ${detail}`);
    }
  }

  function setUser(user: string) {
    setActiveUser(user);
    localStorage.setItem("finance-active-user", user);
    setForm((current) => ({ ...current, criadoPor: user }));
  }

  function clearImportedData() {
    const importedCount = transactions.filter((item) => item.importBatchId).length;
    const next = transactions.filter((item) => !item.importBatchId);
    persist(next, `${importedCount} lançamentos importados removidos. Lançamentos manuais preservados.`);
  }

  function addTransaction(event: FormEvent) {
    event.preventDefault();
    if (!form.descricao || !form.categoria || !form.valor) {
      setFileStatus("Preencha descrição, categoria e valor para adicionar manualmente.");
      return;
    }

    const nextItem: Transaction = {
      ...form,
      id: editingId ?? crypto.randomUUID(),
      valor: Math.abs(Number(form.valor)),
      criadoPor: activeUser
    };
    const next = editingId
      ? transactions.map((item) => (item.id === editingId ? nextItem : item))
      : [nextItem, ...transactions];
    persist(next, `${nextItem.tipo} ${editingId ? "atualizada" : "adicionada"} por ${activeUser}: ${currency.format(nextItem.valor)}.`);
    setEditingId(null);
    setForm({
      ...form,
      descricao: "",
      categoria: "",
      subcategoria: "",
      valor: 0,
      observacoes: "",
      criadoPor: activeUser
    });
  }

  function startEditManual(item: Transaction) {
    setEditingId(item.id);
    setForm({
      data: item.data,
      descricao: item.descricao,
      categoria: item.categoria,
      subcategoria: item.subcategoria,
      tipo: item.tipo,
      valor: item.valor,
      conta: item.conta,
      formaPagamento: item.formaPagamento,
      observacoes: item.observacoes,
      criadoPor: item.criadoPor ?? activeUser
    });
    setFileStatus(`Editando lançamento manual: ${item.descricao}.`);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({
      ...form,
      data: new Date().toISOString().slice(0, 10),
      descricao: "",
      categoria: "",
      subcategoria: "",
      tipo: "Despesa",
      valor: 0,
      conta: "Carteira",
      formaPagamento: "Não informado",
      observacoes: "",
      criadoPor: activeUser
    });
    setFileStatus("Edição cancelada.");
  }

  function deleteManual(id: string) {
    const target = transactions.find((item) => item.id === id);
    if (!target) return;
    const next = transactions.filter((item) => item.id !== id);
    persist(next, `Lançamento manual excluído: ${target.descricao}.`);
    if (editingId === id) cancelEdit();
    if (cardEditingId === id) cancelCardEdit();
  }

  function relaunchExpense(item: Transaction) {
    if (item.importBatchId || item.tipo === "Receita") return;
    const nextDate = addOneMonth(item.data);
    const nextItem: Transaction = {
      ...item,
      id: crypto.randomUUID(),
      data: nextDate,
      criadoPor: activeUser
    };
    const date = new Date(`${nextDate}T00:00:00`);
    setFilters((current) => ({
      ...current,
      year: String(date.getFullYear()),
      month: String(date.getMonth() + 1).padStart(2, "0")
    }));
    persist([nextItem, ...transactions], `Despesa relançada para ${nextItem.data}: ${item.descricao}.`);
  }

  function finishRecurring(item: Transaction) {
    const next = transactions.map((transaction) =>
      recurringKey(transaction) === recurringKey(item) ? { ...transaction, recurringEnded: true } : transaction
    );
    persist(next, `Recorrência finalizada: ${item.descricao}. Ela não aparecerá nas próximas previsões.`);
  }

  function markForecastPaid(item: Transaction, isCard = false) {
    const nextDate = nextMonthDateFor(item.data);
    const nextItem: Transaction = {
      ...item,
      id: crypto.randomUUID(),
      data: nextDate,
      criadoPor: activeUser,
      recurringEnded: false,
      isCreditCardDetail: isCard || item.isCreditCardDetail
    };
    const date = new Date(`${nextDate}T00:00:00`);
    setFilters((current) => ({
      ...current,
      year: String(date.getFullYear()),
      month: String(date.getMonth() + 1).padStart(2, "0")
    }));
    persist([nextItem, ...transactions], `Pago e contabilizado em ${nextDate}: ${item.descricao}.`);
  }

  function addCreditCardExpense(event: FormEvent) {
    event.preventDefault();
    if (!cardForm.descricao || !cardForm.categoria || !cardForm.valor) {
      setFileStatus("Preencha descrição, categoria e valor para adicionar uma compra no cartão.");
      return;
    }

    const isRecurring = cardForm.observacoes.toLowerCase().includes("recorrente");
    const target = cardEditingId ? transactions.find((item) => item.id === cardEditingId) : undefined;
    const nextItem: Transaction = {
      id: cardEditingId ?? crypto.randomUUID(),
      data: target?.data ?? new Date().toISOString().slice(0, 10),
      descricao: cardForm.descricao,
      categoria: cardForm.categoria,
      subcategoria: cardForm.subcategoria,
      tipo: isRecurring ? "Despesa Fixa" : "Despesa",
      valor: Math.abs(Number(cardForm.valor)),
      conta: cardForm.subcategoria || "Nubank",
      formaPagamento: "Crédito",
      observacoes: cardForm.observacoes,
      criadoPor: activeUser,
      isCreditCardDetail: true
    };
    const next = cardEditingId
      ? transactions.map((item) => (item.id === cardEditingId ? nextItem : item))
      : [nextItem, ...transactions];
    persist(next, `Compra no cartão ${cardEditingId ? "atualizada" : "adicionada"} por ${activeUser}: ${currency.format(nextItem.valor)}.`);
    setCardEditingId(null);
    setCardForm({ descricao: "", categoria: "", subcategoria: "Nubank", valor: 0, observacoes: "" });
  }

  function startEditCard(item: Transaction) {
    setCardEditingId(item.id);
    setCardForm({
      descricao: item.descricao,
      categoria: item.categoria,
      subcategoria: getCardName(item),
      valor: item.valor,
      observacoes: item.observacoes
    });
    setFileStatus(`Editando compra do cartão: ${item.descricao}.`);
  }

  function cancelCardEdit() {
    setCardEditingId(null);
    setCardForm({ descricao: "", categoria: "", subcategoria: "Nubank", valor: 0, observacoes: "" });
    setFileStatus("Edição da compra do cartão cancelada.");
  }

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    if (!supabase) {
      setAuthStatus("Supabase não configurado neste projeto.");
      return;
    }
    if (!authEmail || !authPassword) {
      setAuthStatus("Informe e-mail e senha.");
      return;
    }

    setLoadingCloud(true);
    const authAction = authMode === "signup"
      ? supabase.auth.signUp({ email: authEmail, password: authPassword })
      : supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    const { error } = await authAction;
    setLoadingCloud(false);

    if (error) {
      setAuthStatus(error.message);
      return;
    }

    setAuthStatus(authMode === "signup" ? "Cadastro criado. Se o Supabase pedir, confirme o e-mail antes de entrar." : "Login realizado.");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthUser(null);
    setHouseholdId(null);
    setAuthStatus("Você saiu da conta.");
  }

  async function requestAiInsights() {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: filtered })
    });
    const data = await response.json();
    setAiInsights(Array.isArray(data.insights) ? data.insights : []);
  }

  if (supabase && !authUser) {
    return (
      <main className={light ? "theme light" : "theme"}>
        <style jsx global>{styles}</style>
        <section className="auth-shell">
          <div className="auth-card">
            <span className="eyebrow">CONTROLE FINANCEIRO FAMILIAR</span>
            <h1>Controle de Gastos</h1>
            <p>Entre para acessar seus lançamentos em qualquer navegador e manter os dados sincronizados.</p>
            <form className="auth-form" onSubmit={handleAuth}>
              <Input label="E-mail" type="email" value={authEmail} onChange={setAuthEmail} placeholder="voce@email.com" />
              <Input label="Senha" type="password" value={authPassword} onChange={setAuthPassword} placeholder="Mínimo 6 caracteres" />
              <button className="add-button" disabled={loadingCloud}>{loadingCloud ? "Aguarde..." : authMode === "login" ? "Entrar" : "Cadastrar"}</button>
            </form>
            <button className="ghost auth-switch" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
              {authMode === "login" ? "Criar uma conta" : "Já tenho conta"}
            </button>
            <p className="status">{authStatus}</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={light ? "theme light" : "theme"}>
      <style jsx global>{styles}</style>
      <section className="shell">
        <header className="topbar">
          <div>
            <span className="eyebrow">CONTROLE FINANCEIRO FAMILIAR</span>
            <h1>Controle de Gastos</h1>
            <p>Cadastre lançamentos direto no dashboard e acompanhe gastos do mês, cartão e despesas recorrentes.</p>
          </div>
          <div className="actions">
            <label className="user-select">
              Quem está lançando?
              <select value={activeUser} onChange={(event) => setUser(event.target.value)}>
                <option>Eu</option>
                <option>Esposa</option>
              </select>
            </label>
            <button className="ghost" onClick={clearImportedData}>Limpar importados</button>
            {authUser && <button className="ghost" onClick={signOut}>Sair</button>}
            <button className="ghost" onClick={() => setLight((value) => !value)}>{light ? <Moon size={17} /> : <Sun size={17} />} Tema</button>
          </div>
        </header>

        <p className="status">{fileStatus}</p>
        {authUser && <p className="cloud-status">{authStatus}</p>}

        <section className="metrics">
          <Metric title="Saldo atual" value={currency.format(summary.balance)} icon={<Wallet />} accent="green" />
          <Metric title="Receitas" value={currency.format(summary.income)} icon={<ArrowUpRight />} accent="blue" />
          <Metric title="Despesas" value={currency.format(summary.expenses)} icon={<ArrowDownRight />} accent="pink" />
          <Metric title="Economia" value={`${summary.savingsRate.toFixed(1)}%`} icon={<CreditCard />} accent="purple" />
        </section>

        <FiltersBar filters={filters} setFilters={setFilters} categories={categories} accounts={accounts} payments={payments} />

        <Panel title="Incluir manualmente">
          <form className="manual-form" onSubmit={addTransaction}>
            <Input label="Data" type="date" value={form.data} onChange={(data) => setForm({ ...form, data })} />
            <Input label="Descrição" value={form.descricao} onChange={(descricao) => setForm({ ...form, descricao })} placeholder="Ex.: Mercado, salário, farmácia" />
            <Input label="Categoria" value={form.categoria} onChange={(categoria) => setForm({ ...form, categoria })} placeholder="Ex.: Alimentação" />
            <Input label="Subcategoria" value={form.subcategoria} onChange={(subcategoria) => setForm({ ...form, subcategoria })} placeholder="Opcional" />
            <label>
              Tipo
              <select value={form.tipo} onChange={(event) => setForm({ ...form, tipo: event.target.value as TransactionType })}>
                <option>Despesa</option>
                <option>Despesa Fixa</option>
                <option>Receita</option>
              </select>
            </label>
            <Input label="Valor" type="number" value={String(form.valor || "")} onChange={(valor) => setForm({ ...form, valor: Number(valor) })} placeholder="0,00" />
            <Input label="Conta" value={form.conta} onChange={(conta) => setForm({ ...form, conta })} />
            <Input label="Pagamento" value={form.formaPagamento} onChange={(formaPagamento) => setForm({ ...form, formaPagamento })} />
            <Input label="Observações" value={form.observacoes} onChange={(observacoes) => setForm({ ...form, observacoes })} />
            <button className="add-button"><Plus size={17} /> {editingId ? "Salvar edição" : "Adicionar"}</button>
            {editingId && <button type="button" className="ghost cancel-button" onClick={cancelEdit}>Cancelar</button>}
          </form>
        </Panel>

        <section className="side-grid">
        <Panel title="Lançamentos do mês">
          {manualTransactions.length ? (
            <div className="manual-list compact-list">
              {manualTransactions.map((item) => (
                <div className="manual-row" key={item.id}>
                  <div>
                    <strong>{item.descricao}</strong>
                    <small>{item.data} • {item.tipo} • {item.categoria} • {item.criadoPor ?? "Sem usuário"}</small>
                    <small>Observações: {item.observacoes || "Sem observações"}</small>
                  </div>
                  <b>{currency.format(item.valor)}</b>
                  {!isCreditCardSummaryTransaction(item) ? (
                    <div className="row-actions">
                      {item.tipo !== "Receita" && <button className="relaunch-button" onClick={() => relaunchExpense(item)}>Relançar despesa</button>}
                      <button className="edit-button" onClick={() => startEditManual(item)}>Editar</button>
                      <button className="delete-button" onClick={() => deleteManual(item.id)}><Trash2 size={16} /> Excluir</button>
                    </div>
                  ) : (
                    <small className="summary-label">Resumo do cartão</small>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">Nenhum lançamento do mês cadastrado ainda.</p>
          )}
        </Panel>

        <Panel title={<PanelTitle label="Previsão do mês seguinte" total={nextMonthFixedForecastTotal} />}>
          <ForecastList
              items={nextMonthCombinedForecasts}
            emptyText="Nenhuma despesa fixa ou salário ativo para o próximo mês."
            onPaid={(item) => markForecastPaid(item)}
            onFinish={finishRecurring}
            onDelete={(item) => deleteManual(item.id)}
          />
        </Panel>
        </section>

        <section className="grid-main">
          <Panel title="Análise ao longo do tempo" wide>
            <ResponsiveContainer width="100%" height={310}>
              <BarChart data={monthly}>
                <CartesianGrid vertical={false} stroke="#2a2d45" />
                <XAxis dataKey="month" stroke="#9aa0b8" />
                <YAxis stroke="#9aa0b8" tickFormatter={(value) => `${Number(value) / 1000}k`} />
                <Tooltip formatter={(value) => currency.format(Number(value))} contentStyle={{ background: "#15182a", border: "1px solid #303653", color: "#fff" }} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} />
                <Bar dataKey="receitas" fill="#b8ff00" radius={[8, 8, 0, 0]} />
                <Bar dataKey="despesas" fill="#8b1dff" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Gastos por categoria">
            <ResponsiveContainer width="100%" height={310}>
              <PieChart>
                <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={96} paddingAngle={3}>
                  {categoryData.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => currency.format(Number(value))} contentStyle={{ background: "#15182a", border: "1px solid #303653", color: "#fff" }} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} />
              </PieChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Evolução do saldo" wide>
            <ResponsiveContainer width="100%" height={270}>
              <AreaChart data={balanceData}>
                <defs><linearGradient id="neon" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#b8ff00" stopOpacity={0.55} /><stop offset="100%" stopColor="#b8ff00" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="#2a2d45" />
                <XAxis dataKey="date" stroke="#9aa0b8" />
                <YAxis stroke="#9aa0b8" tickFormatter={(value) => `${Number(value) / 1000}k`} />
                <Tooltip formatter={(value) => currency.format(Number(value))} contentStyle={{ background: "#15182a", border: "1px solid #303653", color: "#fff" }} />
                <Area dataKey="saldo" stroke="#b8ff00" fill="url(#neon)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Gastos do mês atual">
            <div className="ranking">{currentMonthExpenses.map((item, index) => <div className="rank" key={item.id}><span>{index + 1}</span><div><strong>{item.descricao}</strong><small>{item.data} • {item.categoria} • {item.criadoPor ?? "Sem usuário"}</small><small>Observações: {item.observacoes || "Sem observações"}</small></div><b>{currency.format(item.valor)}</b></div>)}</div>
          </Panel>
        </section>

        <Panel title="Cartão de Crédito">
          <form className="card-form" onSubmit={addCreditCardExpense}>
            <Input label="Descrição" value={cardForm.descricao} onChange={(descricao) => setCardForm({ ...cardForm, descricao })} placeholder="Ex.: Spotify" />
            <Input label="Categoria" value={cardForm.categoria} onChange={(categoria) => setCardForm({ ...cardForm, categoria })} placeholder="Ex.: Streaming" />
            <label>
              Cartão
              <select value={cardForm.subcategoria} onChange={(event) => setCardForm({ ...cardForm, subcategoria: event.target.value })}>
                <option>Nubank</option>
                <option>Santander</option>
              </select>
            </label>
            <Input label="Valor" type="number" value={String(cardForm.valor || "")} onChange={(valor) => setCardForm({ ...cardForm, valor: Number(valor) })} placeholder="0,00" />
            <Input label="Observações" value={cardForm.observacoes} onChange={(observacoes) => setCardForm({ ...cardForm, observacoes })} placeholder="Ex.: Recorrente" />
            <button className="add-button"><Plus size={17} /> {cardEditingId ? "Salvar compra" : "Adicionar compra"}</button>
            {cardEditingId && <button type="button" className="ghost cancel-button" onClick={cancelCardEdit}>Cancelar</button>}
          </form>
          <div className="credit-layout">
          <div className="credit-groups">
            {creditCardGroups.map((group) => (
              <section className="credit-card-group" key={group.name}>
                <div className="credit-group-header">
                  <span>Total {group.name}</span>
                  <strong>{currency.format(group.total)}</strong>
                </div>
                {group.items.length ? (
                  <div className="credit-list">
                    {group.items.map((item) => (
                      <div className="credit-row" key={item.id}>
                        <div>
                          <strong>{item.descricao}</strong>
                          <small>{item.data} • {item.categoria} • {item.observacoes || item.tipo}</small>
                        </div>
                        <b>{currency.format(item.valor)}</b>
                        <div className="row-actions">
                          <button className="relaunch-button" onClick={() => relaunchExpense(item)}>Relançar</button>
                          <button className="edit-button" onClick={() => startEditCard(item)}>Editar</button>
                          <button className="delete-button" onClick={() => deleteManual(item.id)}><Trash2 size={16} /> Excluir</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state">Nenhuma compra cadastrada no {group.name}.</p>
                )}
              </section>
            ))}
          </div>
          <section className="forecast-box">
            <div className="forecast-title">
              <h3>Previsão do próximo mês - cartões</h3>
              <strong>{currency.format(nextMonthCardForecastTotal)}</strong>
            </div>
            <ForecastList
              items={nextMonthCardForecasts}
              emptyText="Nenhuma compra recorrente ativa nos cartões."
              onPaid={(item) => markForecastPaid(item, true)}
              onFinish={finishRecurring}
              onDelete={(item) => deleteManual(item.id)}
            />
          </section>
          </div>
        </Panel>

        <section className="lower">
          <Panel title="Forma de pagamento">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={paymentData} layout="vertical">
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={96} stroke="#9aa0b8" />
                <Tooltip formatter={(value) => currency.format(Number(value))} contentStyle={{ background: "#15182a", border: "1px solid #303653", color: "#fff" }} />
                <Bar dataKey="value" fill="#9d1cff" radius={[0, 9, 9, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Insights e assistente">
            <button className="ai" onClick={requestAiInsights}>Gerar insights com OpenAI</button>
            {[...insights, ...aiInsights].slice(0, 4).map((insight, index) => <div className={`insight ${insight.severity}`} key={`${insight.title}-${index}`}><strong>{insight.title}</strong><p>{insight.body}</p></div>)}
            <form className="ask" onSubmit={(event: FormEvent) => { event.preventDefault(); setAnswer(answerQuestion(question, filtered)); }}>
              <Search size={17} />
              <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Quanto gastei com alimentação este mês?" />
              <button>Perguntar</button>
            </form>
            <p className="answer">{answer}</p>
          </Panel>

          <Panel title="Despesas recorrentes">
            <div className="calendar">{recurringExpenses.slice(0, 12).map((item) => <div key={item.id}><span>{item.data.slice(5)}</span><strong>{item.descricao}</strong><small>{currency.format(item.valor)} • {item.categoria} • {item.criadoPor ?? "Sem usuário"}</small><small>Observações: {item.observacoes || "Sem observações"}</small></div>)}</div>
          </Panel>
        </section>
      </section>
    </main>
  );
}

function Metric({ title, value, icon, accent }: { title: string; value: string; icon: React.ReactNode; accent: string }) {
  return <motion.article whileHover={{ y: -3 }} className={`metric ${accent}`}><div className="metric-icon">{icon}</div><span>{title}</span><strong>{value}</strong><div className="meter"><i /></div></motion.article>;
}

function Panel({ title, children, wide = false }: { title: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return <section className={wide ? "panel wide" : "panel"}><h2>{title}</h2>{children}</section>;
}

function PanelTitle({ label, total }: { label: string; total: number }) {
  return <span className="panel-title-row"><span>{label}</span><strong>{currency.format(total)}</strong></span>;
}

function ForecastList({ items, emptyText, onPaid, onFinish, onDelete }: { items: Transaction[]; emptyText: string; onPaid: (item: Transaction) => void; onFinish: (item: Transaction) => void; onDelete: (item: Transaction) => void }) {
  if (!items.length) return <p className="empty-state">{emptyText}</p>;
  return <div className="forecast-list">
    {items.map((item) => (
      <div className="forecast-row" key={recurringKey(item)}>
        <div>
          <strong>{item.descricao}</strong>
          <small>{nextMonthDateFor(item.data)} • {item.tipo} • {item.categoria} • {item.conta}</small>
          <small>Previsão: {item.observacoes || "Recorrente"}</small>
        </div>
        <b>{currency.format(item.valor)}</b>
        {isCreditCardSummaryTransaction(item) ? (
          <small className="summary-label">Resumo do cartão</small>
        ) : (
          <div className="row-actions">
            <button className="paid-button" onClick={() => onPaid(item)}>Pago</button>
            <button className="delete-button" onClick={() => onFinish(item)}>Finalizar</button>
            <button className="delete-button" onClick={() => onDelete(item)}><Trash2 size={16} /> Excluir</button>
          </div>
        )}
      </div>
    ))}
  </div>;
}

function FiltersBar({ filters, setFilters, categories, accounts, payments }: { filters: Filters; setFilters: (filters: Filters) => void; categories: string[]; accounts: string[]; payments: string[] }) {
  return <div className="filters">
    <Select label="Ano" value={filters.year} onChange={(year) => setFilters({ ...filters, year })} options={[["all", "Todos"], ["2026", "2026"], ["2027", "2027"], ["2028", "2028"], ["2029", "2029"], ["2030", "2030"]]} />
    <Select label="Mês" value={filters.month} onChange={(month) => setFilters({ ...filters, month })} options={[["all", "Todos"], ["01", "Janeiro"], ["02", "Fevereiro"], ["03", "Março"], ["04", "Abril"], ["05", "Maio"], ["06", "Junho"], ["07", "Julho"], ["08", "Agosto"], ["09", "Setembro"], ["10", "Outubro"], ["11", "Novembro"], ["12", "Dezembro"]]} />
    <Select label="Categoria" value={filters.category} onChange={(category) => setFilters({ ...filters, category })} options={[["all", "Todas"], ...categories.map((item) => [item, item])]} />
    <Select label="Conta" value={filters.account} onChange={(account) => setFilters({ ...filters, account })} options={[["all", "Todas"], ...accounts.map((item) => [item, item])]} />
    <Select label="Tipo" value={filters.type} onChange={(type) => setFilters({ ...filters, type })} options={[["all", "Todos"], ["Receita", "Receita"], ["Despesa", "Despesa"], ["Despesa Fixa", "Despesa Fixa"]]} />
    <Select label="Pagamento" value={filters.payment} onChange={(payment) => setFilters({ ...filters, payment })} options={[["all", "Todos"], ...payments.map((item) => [item, item])]} />
  </div>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function Input({ label, value, onChange, type = "text", placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <label>{label}<input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function addOneMonth(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(date.getDate(), lastDay));
  return next.toISOString().slice(0, 10);
}

function nextMonthDateFor(dateString: string) {
  const now = new Date();
  const source = new Date(`${dateString}T00:00:00`);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(source.getDate(), lastDay));
  return next.toISOString().slice(0, 10);
}

function nextMonthKey() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function readLocalTransactions() {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem("finance-transactions");
    if (!saved) return [];
    return restoreKnownManualTransactionsIfEmpty(JSON.parse(saved) as Transaction[]);
  } catch {
    return [];
  }
}

function isManualForecastSource(item: Transaction) {
  if (item.recurringEnded) return false;
  const text = `${item.descricao} ${item.categoria} ${item.observacoes}`.toLowerCase();
  return item.tipo === "Despesa Fixa" || (item.tipo === "Receita" && text.includes("salário"));
}

function isCurrentMonth(item: Transaction) {
  const now = new Date();
  const date = new Date(`${item.data}T00:00:00`);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function isRecurringCardItem(item: Transaction) {
  if (item.recurringEnded) return false;
  const text = `${item.tipo} ${item.observacoes}`.toLowerCase();
  return item.tipo === "Despesa Fixa" || text.includes("recorrente");
}

function recurringKey(item: Transaction) {
  return [
    item.isCreditCardDetail ? "card" : "manual",
    getCardName(item),
    item.descricao,
    item.categoria,
    item.conta,
    item.valor
  ].join("|").toLowerCase();
}

function latestRecurringItems(items: Transaction[]) {
  const latest = new Map<string, Transaction>();
  items.forEach((item) => {
    const key = recurringKey(item);
    const current = latest.get(key);
    if (!current || item.data > current.data) latest.set(key, item);
  });
  return Array.from(latest.values())
    .filter((item) => !item.data.startsWith(nextMonthKey()))
    .sort((a, b) => a.data.localeCompare(b.data));
}

function isCreditCardTransaction(item: Transaction) {
  const text = `${item.formaPagamento} ${item.conta} ${item.subcategoria} ${item.categoria}`.toLowerCase();
  return text.includes("crédito") || text.includes("credito") || text.includes("cartão") || text.includes("cartao") || text.includes("nubank") || text.includes("santander");
}

function isCreditCardDetailTransaction(item: Transaction) {
  if (item.isCreditCardDetail) return true;
  if (!isCreditCardTransaction(item)) return false;
  return !isCreditCardSummaryTransaction(item);
}

function isCreditCardSummaryTransaction(item: Transaction) {
  if (item.id.startsWith("credit-summary-")) return true;
  const text = `${item.descricao} ${item.categoria} ${item.observacoes}`.toLowerCase();
  const isCardTotal = text.includes("cartão nubank") || text.includes("cartao nubank") || text.includes("cartão santander") || text.includes("cartao santander");
  return isCardTotal || text.includes("resumo do cartão") || text.includes("resumo do cartao");
}

function buildCreditCardSummaries(items: Transaction[]) {
  return ["Nubank", "Santander"].flatMap((name) => {
    const cardItems = items.filter((item) => getCardName(item) === name);
    const total = cardItems.reduce((sum, item) => sum + item.valor, 0);
    if (!total) return [];
    const lastDate = cardItems.map((item) => item.data).sort((a, b) => b.localeCompare(a))[0] ?? new Date().toISOString().slice(0, 10);
    return [{
      id: `credit-summary-${name.toLowerCase()}`,
      data: lastDate,
      descricao: `Cartão ${name}`,
      categoria: "Cartão de Crédito",
      subcategoria: name,
      tipo: "Despesa" as TransactionType,
      valor: total,
      conta: name,
      formaPagamento: "Crédito",
      observacoes: "Resumo do cartão. Detalhamento disponível no quadro Cartão de Crédito.",
      criadoPor: "Sistema"
    }];
  });
}

function getCardName(item: Transaction) {
  const text = `${item.subcategoria} ${item.conta} ${item.formaPagamento} ${item.categoria}`.toLowerCase();
  if (text.includes("santander")) return "Santander";
  return "Nubank";
}

function restoreKnownManualTransactionsIfEmpty(transactions: Transaction[]) {
  const hasRegularTransactions = transactions.some((item) => !isCreditCardDetailTransaction(item) && !isCreditCardSummaryTransaction(item));
  const hasCreditCardData = transactions.some((item) => isCreditCardDetailTransaction(item) || isCreditCardSummaryTransaction(item));
  if (hasRegularTransactions || !hasCreditCardData) return transactions;

  const restored: Transaction[] = [
    ["Salário", "Receita", "Receitas", "Conta corrente", "Pix", 3728],
    ["Internet", "Despesa", "Casa", "Conta corrente", "Débito", 139.9],
    ["Tarifas do banco", "Despesa", "Banco", "Conta corrente", "Débito", 16.85],
    ["Cemitério", "Despesa", "Família", "Conta corrente", "Débito", 94],
    ["Netflix", "Despesa Fixa", "Streaming", "Conta corrente", "Débito", 57.8],
    ["Condomínio/água", "Despesa", "Moradia", "Conta corrente", "Débito", 477.95],
    ["Dízimo", "Despesa", "Doações", "Conta corrente", "Débito", 50],
    ["CNPJ", "Despesa", "Trabalho", "Conta corrente", "Débito", 86.05],
    ["Passagem", "Despesa", "Transporte", "Conta corrente", "Débito", 88],
    ["IPTU", "Despesa", "Moradia", "Conta corrente", "Débito", 93.52],
    ["Ração", "Despesa", "Pet", "Conta corrente", "Débito", 58]
  ].map(([descricao, tipo, categoria, conta, formaPagamento, valor]) => ({
    id: `restored-${String(descricao).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    data: "2026-07-09",
    descricao: String(descricao),
    categoria: String(categoria),
    subcategoria: "",
    tipo: tipo as TransactionType,
    valor: Number(valor),
    conta: String(conta),
    formaPagamento: String(formaPagamento),
    observacoes: "Restaurado após separação do cartão de crédito",
    criadoPor: "Sistema"
  }));

  return [...restored, ...transactions];
}

const styles = `
  *{box-sizing:border-box} body{margin:0;background:#111321;color:#f8f9ff;font-family:Inter,Segoe UI,Arial,sans-serif}.theme{min-height:100vh;background:radial-gradient(circle at 35% 10%,rgba(85,37,255,.32),transparent 34rem),linear-gradient(135deg,#121320,#17192b 55%,#10111c)}.theme.light{background:#f5f6fb;color:#171827}.auth-shell{min-height:100vh;display:grid;place-items:center;padding:24px}.auth-card{width:min(520px,100%);background:linear-gradient(145deg,rgba(31,34,58,.96),rgba(23,26,46,.98));border:1px solid #303653;border-radius:22px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}.auth-form{display:grid;gap:12px;margin-top:20px}.auth-form label{font-size:11px;font-weight:800;color:#c8cce2;text-transform:uppercase}.auth-form input{width:100%;margin-top:6px;background:#1c1f34;color:#fff;border:1px solid #363b60;border-radius:10px;padding:12px}.auth-form .add-button{justify-content:center}.auth-switch{margin-top:12px;width:100%;justify-content:center}.cloud-status{margin-top:-12px;color:#8be9ff;font-size:13px}.add-button:disabled{opacity:.65;cursor:not-allowed}.shell{padding:26px;max-width:1480px;margin:0 auto}.topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.eyebrow{font-size:11px;font-weight:800;color:#b8ff00;letter-spacing:.12em}h1{margin:6px 0 8px;font-size:42px;line-height:1}p{color:#aeb4cf}.actions{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;justify-content:flex-end}.upload,.ghost,.ai,.ask button,.add-button{border:1px solid #3a3e62;background:#20233a;color:#fff;border-radius:12px;padding:12px 15px;display:inline-flex;align-items:center;gap:9px;font-weight:800;cursor:pointer}.upload,.add-button{background:#b8ff00;color:#101010;box-shadow:0 0 28px rgba(184,255,0,.22)}.upload input{display:none}.user-select{font-size:11px;font-weight:800;color:#c8cce2;text-transform:uppercase}.user-select select{display:block;margin-top:6px;min-width:150px;background:#1c1f34;color:#fff;border:1px solid #363b60;border-radius:10px;padding:10px}.status{margin:14px 0 20px;color:#b8ff00;font-size:13px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.metric,.panel{background:linear-gradient(145deg,rgba(31,34,58,.95),rgba(23,26,46,.96));border:1px solid #282c4a;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.22)}.metric{padding:18px;position:relative;overflow:hidden}.metric:before{content:"";position:absolute;inset:auto 0 0;height:64%;background:radial-gradient(circle at 70% 10%,rgba(157,28,255,.3),transparent 55%)}.metric-icon{width:36px;height:36px;border-left:5px solid #b8ff00;color:#fff;display:grid;place-items:center}.metric span{display:block;margin-top:10px;color:#c8cce2;font-size:12px;font-weight:800;text-transform:uppercase}.metric strong{display:block;margin-top:8px;font-size:24px}.meter{height:7px;background:#353956;border-radius:9px;margin-top:16px;overflow:hidden}.meter i{display:block;width:76%;height:100%;background:#b8ff00}.blue .meter i{background:#35d5ff}.pink .meter i{background:#ff4fd8}.purple .meter i{background:#9d1cff}.filters{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:18px 0}.filters label,.manual-form label{font-size:11px;font-weight:800;color:#c8cce2;text-transform:uppercase}.filters select,.manual-form input,.manual-form select,.ask input{width:100%;margin-top:6px;background:#1c1f34;color:#fff;border:1px solid #363b60;border-radius:10px;padding:10px}.manual-form{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.manual-form .add-button,.manual-form .cancel-button{align-self:end;justify-content:center}.imports-list,.manual-list,.credit-list{display:grid;gap:10px}.import-row,.manual-row,.credit-row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:12px;background:#20233a;border:1px solid #303653;border-radius:13px;padding:12px}.credit-row{grid-template-columns:1fr auto}.import-row{display:flex;justify-content:space-between}.import-row strong,.manual-row strong,.credit-row strong{display:block}.import-row small,.manual-row small,.credit-row small{display:block;margin-top:4px;color:#aeb4cf}.manual-row b,.credit-row b{color:#b8ff00}.credit-summary{display:grid;grid-template-columns:minmax(180px,260px);gap:12px;margin-bottom:12px}.credit-summary div{background:#20233a;border:1px solid #303653;border-radius:13px;padding:14px}.credit-summary span{display:block;color:#aeb4cf;font-size:12px;text-transform:uppercase;font-weight:800}.credit-summary strong{display:block;margin-top:6px;font-size:24px;color:#b8ff00}.row-actions{display:flex;gap:8px;flex-wrap:wrap}.edit-button{border:1px solid rgba(184,255,0,.45);background:rgba(184,255,0,.12);color:#d8ff7a;border-radius:10px;padding:10px 12px;font-weight:800;cursor:pointer}.delete-button{border:1px solid rgba(255,79,117,.45);background:rgba(255,79,117,.12);color:#ff8da5;border-radius:10px;padding:10px 12px;display:inline-flex;align-items:center;gap:8px;font-weight:800;cursor:pointer}.empty-state{margin:0}.grid-main{display:grid;grid-template-columns:1.25fr .75fr;gap:16px;margin-top:16px}.lower{display:grid;grid-template-columns:.8fr 1.1fr .9fr;gap:16px;margin-top:16px}.panel{padding:18px;min-height:unset;margin-top:16px}.metrics+.filters,.filters+.panel,.panel+.panel,.grid-main .panel{margin-top:0}.panel.wide{min-height:340px}.panel h2{margin:0 0 16px;font-size:14px;color:#dfe3ff;text-transform:uppercase;letter-spacing:.04em}.ranking{display:grid;gap:10px}.rank{display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:10px;padding:10px;border-radius:13px;background:#20233a}.rank span{width:24px;height:24px;border-radius:50%;background:#9d1cff;display:grid;place-items:center;font-weight:900}.rank strong{display:block}.rank small,.calendar small{color:#aeb4cf}.rank b{color:#b8ff00}.insight{border-left:4px solid #35d5ff;background:#20233a;border-radius:12px;padding:11px;margin:10px 0}.insight.warning{border-color:#f8c44f}.insight.danger{border-color:#ff4f75}.insight.success{border-color:#b8ff00}.insight p{margin:6px 0 0;font-size:13px}.ask{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;margin-top:12px}.ask button{background:#9d1cff}.answer{background:#171a2d;border:1px solid #303653;border-radius:12px;padding:12px}.calendar{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.calendar div{background:#20233a;border-radius:12px;padding:10px}.calendar span{color:#b8ff00;font-size:12px}.calendar strong{display:block;margin:5px 0}.light .metric,.light .panel{background:#fff;color:#171827}.light p,.light .rank small,.light .calendar small,.light .import-row small,.light .manual-row small,.light .credit-row small{color:#62677c}.light .filters select,.light .manual-form input,.light .manual-form select,.light .user-select select,.light .ask input,.light .rank,.light .calendar div,.light .insight,.light .answer,.light .import-row,.light .manual-row,.light .credit-row,.light .credit-summary div{background:#f0f2fa;color:#171827;border-color:#d8dcea}@media(max-width:1100px){.metrics,.filters,.manual-form,.grid-main,.lower{grid-template-columns:1fr 1fr}.topbar{align-items:flex-start;flex-direction:column}.actions{justify-content:flex-start}.manual-row{grid-template-columns:1fr}}@media(max-width:720px){.shell{padding:16px}.metrics,.filters,.manual-form,.grid-main,.lower,.calendar,.credit-summary{grid-template-columns:1fr}h1{font-size:34px}.ask{grid-template-columns:1fr}.ask svg{display:none}.import-row{align-items:flex-start;flex-direction:column}.credit-row{grid-template-columns:1fr}.delete-button,.edit-button{width:100%;justify-content:center}.row-actions{width:100%}}
  .card-form{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}
  .card-form label{font-size:11px;font-weight:800;color:#c8cce2;text-transform:uppercase}
  .filters{grid-template-columns:repeat(6,minmax(0,1fr))}
  .card-form input,.card-form select{width:100%;margin-top:6px;background:#1c1f34;color:#fff;border:1px solid #363b60;border-radius:10px;padding:10px}
  .card-form .add-button{align-self:end;justify-content:center}
  .side-grid,.credit-layout{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;align-items:start}
  .side-grid .panel,.credit-layout .forecast-box{margin-top:0}
  .compact-list,.forecast-list,.credit-list{max-height:360px;overflow:auto;padding-right:4px}
  .credit-layout .credit-groups{display:grid;grid-template-columns:1fr;gap:14px}
  .credit-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  .credit-card-group{background:rgba(32,35,58,.58);border:1px solid #303653;border-radius:14px;padding:12px}
  .credit-group-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
  .credit-group-header span{color:#aeb4cf;font-size:12px;font-weight:900;text-transform:uppercase}
  .credit-group-header strong{color:#b8ff00;font-size:24px}
  .credit-card-group .credit-row{grid-template-columns:minmax(0,1fr) auto auto}
  .panel-title-row,.forecast-title{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%}
  .panel-title-row strong,.forecast-title strong{color:#b8ff00;font-size:22px}
  .forecast-box{margin-top:16px;border-top:1px solid #303653;padding-top:16px}
  .credit-layout .forecast-box{border-top:0;padding-top:0}
  .forecast-box h3{margin:0;color:#dfe3ff;font-size:13px;text-transform:uppercase;letter-spacing:.04em}
  .forecast-title{margin-bottom:12px}
  .forecast-list{display:grid;gap:10px}
  .forecast-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;background:#20233a;border:1px solid #303653;border-radius:13px;padding:12px}
  .forecast-row strong{display:block}.forecast-row small{display:block;margin-top:4px;color:#aeb4cf}.forecast-row b{color:#b8ff00}
  .paid-button{border:1px solid rgba(184,255,0,.5);background:#b8ff00;color:#101010;border-radius:10px;padding:10px 12px;font-weight:900;cursor:pointer}
  .forecast-row .row-actions{flex-wrap:nowrap}.forecast-row .paid-button,.forecast-row .delete-button{min-width:94px;justify-content:center;white-space:nowrap}.forecast-row .delete-button{padding:10px}
  .relaunch-button{border:1px solid rgba(53,213,255,.45);background:rgba(53,213,255,.12);color:#8be9ff;border-radius:10px;padding:10px 12px;font-weight:800;cursor:pointer}
  .rank small,.calendar small{display:block;margin-top:4px}
  .light .card-form input,.light .card-form select,.light .credit-card-group,.light .forecast-row{background:#f0f2fa;color:#171827;border-color:#d8dcea}
  @media(max-width:1100px){.filters,.card-form,.credit-groups{grid-template-columns:1fr 1fr}.side-grid,.credit-layout{grid-template-columns:1fr}}
  @media(max-width:720px){.filters,.card-form,.credit-groups{grid-template-columns:1fr}.credit-card-group .credit-row,.forecast-row{grid-template-columns:1fr}.relaunch-button,.paid-button{width:100%;justify-content:center}.compact-list,.forecast-list,.credit-list{max-height:none}}
`;
