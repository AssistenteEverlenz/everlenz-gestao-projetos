"use client";
/* eslint-disable @next/next/no-img-element -- prévias de logos do storage */

import { useState } from "react";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import type { Project } from "../types";
import { Icon } from "../icons";
import { projectWorkDays } from "../work-calendar";

type Props = {
  dark: boolean;
  setDark: (value: boolean) => void;
  setToast: (value: string) => void;
  project?: Project;
  canManage: boolean;
  saveBrandLogo: (
    scope: "organization" | "client" | "project",
    file: File | null,
    background: string,
  ) => Promise<void>;
  updateProjectWorkDays: (workDays: number[]) => Promise<void>;
};

export function Settings({
  dark,
  setDark,
  setToast,
  project,
  canManage,
  saveBrandLogo,
  updateProjectWorkDays,
}: Props) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [workDays, setWorkDays] = useState(() =>
    projectWorkDays(project?.workDays),
  );

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
    try {
      if (project) await updateProjectWorkDays(workDays);
      setToast("Preferências salvas.");
    } finally {
      setSavingPreferences(false);
    }
  }

  return (
    <div className="view-stack settings-view">
      <div className="settings-layout">
        <aside className="panel glass settings-nav" aria-label="Seções das configurações">
          <div className="settings-nav-heading">
            <span className="overline">PREFERÊNCIAS</span>
            <strong>Central de configurações</strong>
            <p>Ajuste a experiência, o projeto e a sua conta.</p>
          </div>
          <nav>
            <a href="#settings-appearance">
              <Icon name="sun" />
              <span><strong>Aparência</strong><small>Tema da interface</small></span>
            </a>
            <a href="#settings-branding">
              <Icon name="building" />
              <span><strong>Identidade visual</strong><small>Marcas e logotipos</small></span>
            </a>
            <a href="#settings-project">
              <Icon name="calendar" />
              <span><strong>Projeto</strong><small>Relatórios e alertas</small></span>
            </a>
            <a href="#settings-account">
              <Icon name="lock" />
              <span><strong>Conta e ajuda</strong><small>Segurança e orientação</small></span>
            </a>
          </nav>
        </aside>
        <section className="panel glass settings-grid">
        <div className="settings-card" id="settings-appearance">
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
          id="settings-branding"
          title="Marca da empresa"
          description="Aparece no acesso, carregamento e identidade principal da plataforma."
          currentUrl={project?.organizationLogoUrl}
          currentBackground={project?.organizationLogoBackground}
          fallbackUrl="/everlenz-mark.png"
          disabled={!canManage}
          onSave={saveBrandLogo}
        />
        <div className="settings-card" id="settings-project">
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
        <div className="settings-card">
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
        <div className="settings-card">
          <span className="settings-icon">
            <Icon name="calendar" />
          </span>
          <div>
            <span className="overline">PLANEJAMENTO</span>
            <h3>Calendário da obra</h3>
            <p>Configuração usada no cálculo de durações e dependências.</p>
          </div>
          <div className="settings-work-calendar">
            <div className="weekday-options">
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(
                (label, day) => (
                  <label
                    key={label}
                    className={workDays.includes(day) ? "active" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={workDays.includes(day)}
                      onChange={() =>
                        setWorkDays((current) =>
                          current.includes(day)
                            ? current.filter((item) => item !== day)
                            : [...current, day].sort(),
                        )
                      }
                    />
                    <strong>{label}</strong>
                    <small>{workDays.includes(day) ? "Trabalho" : "Folga"}</small>
                  </label>
                ),
              )}
            </div>
            <small>
              Mesma regra utilizada para durações, dependências e reagendamento no Gantt.
            </small>
          </div>
        </div>
        {project && (
          <>
            <LogoSettingsCard
              key={`client-${project.id}`}
              scope="client"
              title="Logo do cliente"
              description={`Identidade de ${project.client}, vinculada somente a este projeto.`}
              currentUrl={project.clientLogoUrl}
              currentBackground={project.clientLogoBackground}
              fallbackText={brandInitials(project.client)}
              disabled={!canManage}
              onSave={saveBrandLogo}
            />
            <LogoSettingsCard
              key={`project-${project.id}`}
              scope="project"
              title="Logo da obra"
              description={`Identidade de ${project.name}; sem imagem, serão usadas as iniciais da obra.`}
              currentUrl={project.logoUrl}
              currentBackground={project.logoBackground}
              fallbackText={brandInitials(project.name)}
              disabled={!canManage}
              onSave={saveBrandLogo}
            />
          </>
        )}
        {isSupabaseConfigured() && (
          <form className="settings-card" id="settings-account" onSubmit={changePassword}>
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
        <div className="settings-card" data-tour="instrucoes">
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
      </div>
      <div className="settings-actions">
        <button
          className="primary-btn"
          disabled={savingPreferences || !workDays.length}
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
  id,
  title,
  description,
  currentUrl,
  currentBackground = "#FFFFFF",
  fallbackUrl,
  fallbackText,
  disabled,
  onSave,
}: {
  scope: "organization" | "client" | "project";
  id?: string;
  title: string;
  description: string;
  currentUrl?: string;
  currentBackground?: string;
  fallbackUrl?: string;
  fallbackText?: string;
  disabled: boolean;
  onSave: (
    scope: "organization" | "client" | "project",
    file: File | null,
    background: string,
  ) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [background, setBackground] = useState(currentBackground);
  const backgroundChanged =
    background.toUpperCase() !== currentBackground.toUpperCase();

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
    if (!file && !backgroundChanged) return;
    setSaving(true);
    setError("");
    try {
      await onSave(scope, file, background);
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
    <section className="settings-card branding-card" id={id}>
      <span className="settings-icon">
        <Icon name="building" />
      </span>
      <div>
        <span className="overline">IDENTIDADE VISUAL</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="branding-editor">
        <span className="branding-preview" style={{ backgroundColor: background }}>
          {preview || currentUrl || fallbackUrl ? (
            <img
              src={preview || currentUrl || fallbackUrl}
              alt={`Prévia — ${title}`}
            />
          ) : (
            <b>{fallbackText}</b>
          )}
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
        <label className="branding-color">
          <input
            type="color"
            value={background}
            disabled={disabled || saving}
            onChange={(event) => setBackground(event.target.value)}
            aria-label={`Cor de fundo — ${title}`}
          />
          <span>Fundo</span>
        </label>
        <button
          className="primary-btn"
          disabled={disabled || saving || (!file && !backgroundChanged)}
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

function brandInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
