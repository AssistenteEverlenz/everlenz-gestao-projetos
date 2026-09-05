"use client";
/* eslint-disable @next/next/no-img-element -- prévias de logos do storage */

import { useState } from "react";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import type { Project } from "../types";
import { Icon } from "../icons";

type Props = {
  dark: boolean;
  setDark: (value: boolean) => void;
  setToast: (value: string) => void;
  project?: Project;
  canManage: boolean;
  saveBrandLogo: (
    scope: "organization" | "project",
    file: File | null,
  ) => Promise<void>;
};

export function Settings({
  dark,
  setDark,
  setToast,
  project,
  canManage,
  saveBrandLogo,
}: Props) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8)
      return setToast("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirmation) return setToast("As senhas não coincidem.");
    setSavingPassword(true);
    try {
      const { error } = await getSupabaseBrowserClient().auth.updateUser({
        password,
      });
      if (error) return setToast(error.message);
      setPassword("");
      setConfirmation("");
      setToast("Senha alterada com segurança.");
    } finally {
      setSavingPassword(false);
    }
  }

  async function savePreferences() {
    setSavingPreferences(true);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    setSavingPreferences(false);
    setToast("Preferências salvas.");
  }

  return (
    <div className="view-stack settings-view">
      <section className="settings-grid">
        <div className="panel glass settings-card">
          <span className="settings-icon">
            <Icon name="sun" />
          </span>
          <div>
            <span className="overline">APARÊNCIA</span>
            <h3>Tema da interface</h3>
            <p>Escolha o modo mais confortável para escritório ou canteiro.</p>
          </div>
          <div className="theme-options">
            <button
              className={!dark ? "active" : ""}
              onClick={() => setDark(false)}
            >
              <span className="theme-preview light-preview" />
              <Icon name="sun" /> Claro
            </button>
            <button
              className={dark ? "active" : ""}
              onClick={() => setDark(true)}
            >
              <span className="theme-preview dark-preview" />
              <Icon name="moon" /> Escuro
            </button>
          </div>
        </div>
        <LogoSettingsCard
          scope="organization"
          title="Marca da empresa"
          description="Aparece no acesso, carregamento e identidade principal da plataforma."
          currentUrl={project?.organizationLogoUrl}
          fallbackUrl="/everlenz-mark.png"
          disabled={!canManage}
          onSave={saveBrandLogo}
        />
        {project && (
          <LogoSettingsCard
            scope="project"
            title="Logo do projeto ou cliente"
            description={`Identifica ${project.name} ao lado da marca Everlenz em telas e documentos.`}
            currentUrl={project.logoUrl}
            fallbackUrl="/natreb-mark.png"
            disabled={!canManage}
            onSave={saveBrandLogo}
          />
        )}
        <div className="panel glass settings-card">
          <span className="settings-icon">
            <Icon name="report" />
          </span>
          <div>
            <span className="overline">RELATÓRIOS</span>
            <h3>Padrão do status report</h3>
            <p>Defina os dados que aparecem em todos os documentos.</p>
          </div>
          <label>
            <span>Nome da empresa</span>
            <input
              defaultValue={project?.organizationName ?? "Everlenz Engenharia"}
            />
          </label>
          <label>
            <span>Mensagem de rodapé</span>
            <input defaultValue="Informação técnica com evidência de campo" />
          </label>
        </div>
        <div className="panel glass settings-card">
          <span className="settings-icon">
            <Icon name="bell" />
          </span>
          <div>
            <span className="overline">NOTIFICAÇÕES</span>
            <h3>Alertas do projeto</h3>
            <p>Receba avisos importantes sem excesso de ruído.</p>
          </div>
          <label className="setting-toggle">
            <span>
              <strong>Atividade crítica atrasada</strong>
              <small>Aviso imediato para gestores</small>
            </span>
            <input type="checkbox" defaultChecked />
            <i />
          </label>
          <label className="setting-toggle">
            <span>
              <strong>Relatório pronto para revisar</strong>
              <small>Um resumo ao fim de cada dia</small>
            </span>
            <input type="checkbox" defaultChecked />
            <i />
          </label>
        </div>
        <div className="panel glass settings-card">
          <span className="settings-icon">
            <Icon name="calendar" />
          </span>
          <div>
            <span className="overline">PLANEJAMENTO</span>
            <h3>Calendário da obra</h3>
            <p>Configuração usada no cálculo de durações e dependências.</p>
          </div>
          <label>
            <span>Jornada padrão</span>
            <select defaultValue="seg-sab">
              <option value="seg-sab">Segunda a sábado</option>
              <option value="seg-sex">Segunda a sexta</option>
            </select>
          </label>
          <label>
            <span>Horas por dia</span>
            <input type="number" defaultValue="8" />
          </label>
        </div>
        {isSupabaseConfigured() && (
          <form className="panel glass settings-card" onSubmit={changePassword}>
            <span className="settings-icon">
              <Icon name="lock" />
            </span>
            <div>
              <span className="overline">SEGURANÇA</span>
              <h3>Alterar minha senha</h3>
              <p>Crie uma nova senha para o seu próprio acesso.</p>
            </div>
            <label>
              <span>Nova senha</span>
              <input
                type="password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              <span>Confirmar senha</span>
              <input
                type="password"
                minLength={8}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <button className="secondary-btn" disabled={savingPassword}>
              {savingPassword && <span className="button-spinner" />}
              {savingPassword ? "Alterando..." : "Alterar senha"}
            </button>
          </form>
        )}
        <div className="panel glass settings-card" data-tour="instrucoes">
          <span className="settings-icon">
            <Icon name="info" />
          </span>
          <div>
            <span className="overline">AJUDA</span>
            <h3>Apresentação da plataforma</h3>
            <p>Reveja o guia com as funções principais do Em Dia.</p>
          </div>
          <button
            className="secondary-btn"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("emdia:start-tour"))
            }
          >
            Rever apresentação
          </button>
        </div>
      </section>
      <div className="settings-actions">
        <button
          className="primary-btn"
          disabled={savingPreferences}
          onClick={() => void savePreferences()}
        >
          {savingPreferences ? (
            <>
              <span className="button-spinner" />
              Salvando...
            </>
          ) : (
            <>
              <Icon name="check" /> Salvar preferências
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function LogoSettingsCard({
  scope,
  title,
  description,
  currentUrl,
  fallbackUrl,
  disabled,
  onSave,
}: {
  scope: "organization" | "project";
  title: string;
  description: string;
  currentUrl?: string;
  fallbackUrl: string;
  disabled: boolean;
  onSave: (
    scope: "organization" | "project",
    file: File | null,
  ) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function selectFile(selected?: File) {
    setError("");
    if (!selected) return;
    if (selected.type !== "image/png")
      return setError("Selecione uma imagem PNG.");
    if (selected.size > 2 * 1024 * 1024)
      return setError("A imagem deve ter no máximo 2 MB.");
    setFile(selected);
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(selected);
  }

  async function save() {
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      await onSave(scope, file);
      setFile(null);
      setPreview(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar a logo.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel glass settings-card branding-card">
      <span className="settings-icon">
        <Icon name="building" />
      </span>
      <div>
        <span className="overline">IDENTIDADE VISUAL</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="branding-editor">
        <span className="branding-preview">
          <img
            src={preview || currentUrl || fallbackUrl}
            alt={`Prévia — ${title}`}
          />
        </span>
        <label className={`secondary-btn ${disabled ? "disabled" : ""}`}>
          <Icon name="camera" /> Escolher PNG
          <input
            hidden
            type="file"
            accept="image/png"
            disabled={disabled || saving}
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
        </label>
        <button
          className="primary-btn"
          disabled={disabled || saving || !file}
          onClick={() => void save()}
        >
          {saving ? (
            <>
              <span className="button-spinner" />
              Enviando...
            </>
          ) : (
            <>
              <Icon name="check" />
              Aplicar marca
            </>
          )}
        </button>
      </div>
      <small className="branding-help">
        PNG com fundo transparente · máximo de 2 MB.
      </small>
      {error && (
        <div className="access-message">
          <Icon name="alert" />
          {error}
        </div>
      )}
    </section>
  );
}
