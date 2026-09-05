"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { createOrganization } from "@/lib/supabase/repository";
import { BrandSymbols } from "./brand";
import { Icon } from "./icons";

export function LoadingScreen({
  message = "Sincronizando seu ambiente...",
}: {
  message?: string;
}) {
  return (
    <main className="access-shell">
      <section className="access-card glass loading-card">
        <BrandSymbols className="loading-brand" />
        <span className="loading-spinner" />
        <h1>{message}</h1>
        <p>Conectando planejamento, campo e relatórios.</p>
      </section>
    </main>
  );
}

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const supabase = getSupabaseBrowserClient();
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      setMessage(
        error
          ? translateAuthError(error.message)
          : data.session
            ? "Conta criada. Preparando seu ambiente..."
            : "Conta criada. Você já pode entrar com seu e-mail e senha.",
      );
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) setMessage(translateAuthError(error.message));
    }
    setLoading(false);
  }

  return (
    <main className="access-shell">
      <section className="access-card glass">
        <header>
          <BrandSymbols />
          <div>
            <strong>em dia</strong>
            <span>BY EVERLENZ</span>
          </div>
        </header>
        <span className="overline">
          {mode === "login" ? "ACESSO À PLATAFORMA" : "PRIMEIRO ACESSO"}
        </span>
        <h1>
          {mode === "login" ? "Sua obra começa em dia." : "Crie seu acesso."}
        </h1>
        <p>
          {mode === "login"
            ? "Entre para acompanhar cronogramas, registros de campo e relatórios."
            : "O primeiro usuário criará o ambiente da Everlenz; os demais entrarão por convite."}
        </p>
        <form onSubmit={submit}>
          {mode === "signup" && (
            <label>
              <span>Nome completo</span>
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
              />
            </label>
          )}
          <label>
            <span>E-mail</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </label>
          <label>
            <span>Senha</span>
            <input
              type="password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </label>
          {message && (
            <div className="access-message">
              <Icon name="alert" />
              {message}
            </div>
          )}
          <button className="primary-btn" disabled={loading}>
            {loading && <span className="button-spinner" />}
            {loading
              ? "Aguarde..."
              : mode === "login"
                ? "Entrar no Em Dia"
                : "Criar acesso"}
          </button>
        </form>
        <button
          className="access-switch"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setMessage("");
          }}
        >
          {mode === "login"
            ? "Primeiro acesso? Criar conta"
            : "Já possui acesso? Entrar"}
        </button>
      </section>
    </main>
  );
}

function translateAuthError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials"))
    return "Não encontramos uma conta com este e-mail ou a senha está incorreta.";
  if (normalized.includes("email not confirmed"))
    return "Este acesso ainda está aguardando liberação. Fale com o administrador.";
  if (normalized.includes("user already registered"))
    return "Já existe uma conta com este e-mail. Use a opção de entrar.";
  if (normalized.includes("password"))
    return "A senha precisa ter pelo menos 8 caracteres.";
  if (normalized.includes("rate limit"))
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  return "Não foi possível concluir o acesso. Confira os dados e tente novamente.";
}

export function OrganizationSetup({ onReady }: { onReady: () => void }) {
  const [name, setName] = useState("Everlenz");
  const [slug, setSlug] = useState("everlenz");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await createOrganization(name, slug);
      onReady();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível criar o ambiente.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="access-shell">
      <section className="access-card glass">
        <header>
          <BrandSymbols />
          <div>
            <strong>em dia</strong>
            <span>BY EVERLENZ</span>
          </div>
        </header>
        <span className="overline">CONFIGURAÇÃO INICIAL</span>
        <h1>Crie o ambiente da equipe</h1>
        <p>
          Projetos, pessoas e arquivos ficarão organizados sob esta empresa.
        </p>
        <form onSubmit={submit}>
          <label>
            <span>Nome da empresa</span>
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>Identificador</span>
            <input
              required
              pattern="[a-z0-9-]+"
              value={slug}
              onChange={(event) =>
                setSlug(
                  event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                )
              }
            />
          </label>
          {error && (
            <div className="access-message">
              <Icon name="alert" />
              {error}
            </div>
          )}
          <button className="primary-btn" disabled={loading}>
            {loading && <span className="button-spinner" />}
            {loading ? "Criando ambiente..." : "Continuar"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function ConnectionError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="access-shell">
      <section className="access-card glass loading-card">
        <span className="empty-workspace-icon">
          <Icon name="alert" />
        </span>
        <h1>Não foi possível sincronizar</h1>
        <p>{message}</p>
        <button className="primary-btn" onClick={onRetry}>
          Tentar novamente
        </button>
      </section>
    </main>
  );
}
