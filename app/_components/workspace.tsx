"use client";
/* eslint-disable @next/next/no-img-element -- logos locais e previews controlados pelo usuário */

import { useEffect, useMemo, useState } from "react";
import { initialEntries, initialMembers, initialTasks, projects } from "./data";
import { Icon, type IconName } from "./icons";
import type { JournalEntry, Member, Task, ViewId } from "./types";
import { Overview } from "./views/overview";
import { Schedule } from "./views/schedule";
import { Journal } from "./views/journal";
import { Reports } from "./views/reports";
import { Team } from "./views/team";
import { Settings } from "./views/settings";

const nav: Array<{ id: ViewId; label: string; short: string; icon: IconName }> = [
  { id: "overview", label: "Visão geral", short: "Início", icon: "home" },
  { id: "schedule", label: "Cronograma", short: "Gantt", icon: "gantt" },
  { id: "journal", label: "Diário de obra", short: "Diário", icon: "journal" },
  { id: "reports", label: "Status reports", short: "Reports", icon: "report" },
  { id: "team", label: "Equipe", short: "Equipe", icon: "team" },
];

const titles: Record<ViewId, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "SEGUNDA-FEIRA, 24 DE AGOSTO", title: "Visão geral da obra", description: "Acompanhe os principais indicadores e o ritmo da execução." },
  schedule: { eyebrow: "PLANEJAMENTO E CONTROLE", title: "Cronograma da obra", description: "Compare o planejado, a linha de base e o avanço realizado." },
  journal: { eyebrow: "ACOMPANHAMENTO DE CAMPO", title: "Diário de obra", description: "Evidências, descrições e evolução registrada pela equipe." },
  reports: { eyebrow: "COMUNICAÇÃO COM O CLIENTE", title: "Status reports", description: "Relatórios claros gerados a partir do avanço real da obra." },
  team: { eyebrow: "PESSOAS E ACESSOS", title: "Equipe do projeto", description: "Controle quem registra, aprova e acompanha cada informação." },
  settings: { eyebrow: "PREFERÊNCIAS", title: "Configurações", description: "Personalize a experiência e os padrões dos relatórios." },
};

export function Workspace() {
  const [view, setView] = useState<ViewId>("overview");
  const [projectId, setProjectId] = useState(projects[0].id);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [entries, setEntries] = useState<JournalEntry[]>(initialEntries);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [dark, setDark] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const project = projects.find((item) => item.id === projectId) || projects[0];
  const meta = titles[view];

  useEffect(() => {
    const saved = window.localStorage.getItem("emdia-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const frame = window.requestAnimationFrame(() => setDark(saved ? saved === "dark" : prefersDark));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    window.localStorage.setItem("emdia-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const metrics = useMemo(() => {
    const overall = Math.round(tasks.reduce((sum, task) => sum + task.progress * task.duration, 0) / tasks.reduce((sum, task) => sum + task.duration, 0));
    const active = tasks.filter((task) => task.progress > 0 && task.progress < 100).length;
    return { overall, active };
  }, [tasks]);

  function navigate(next: ViewId) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateTaskProgress(id: number, progress: number) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, progress: Math.max(0, Math.min(100, progress)) } : task));
  }

  function addEntry(entry: JournalEntry) {
    setEntries((current) => [entry, ...current]);
    const currentTask = tasks.find((task) => task.id === entry.taskId);
    if (currentTask) updateTaskProgress(entry.taskId, currentTask.progress + entry.progressAdded);
    setToast("Registro salvo e cronograma atualizado.");
  }

  const common = { project, tasks, entries, members, navigate, metrics };

  return (
    <div className="app-shell">
      <aside className="sidebar glass">
        <button className="brand" onClick={() => navigate("overview")} aria-label="Ir para visão geral">
          <img src="/emdia.svg" alt="" />
          <span><strong>em dia</strong><small>BY EVERLENZ</small></span>
        </button>

        <div className="sidebar-project-label">PROJETO ATUAL</div>
        <button className="sidebar-project" onClick={() => setProjectMenu((open) => !open)}>
          <span className="project-monogram">RS</span>
          <span className="project-copy"><strong>{project.name}</strong><small>{project.location}</small></span>
          <Icon name="chevron" />
        </button>
        {projectMenu && <div className="project-switcher glass">
          {projects.map((option) => <button key={option.id} className={option.id === project.id ? "active" : ""} onClick={() => { setProjectId(option.id); setProjectMenu(false); }}><strong>{option.name}</strong><small>{option.client}</small></button>)}
        </div>}

        <nav className="side-nav" aria-label="Navegação principal">
          {nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span>{item.id === "reports" && <em>2</em>}</button>)}
        </nav>

        <div className="side-footer">
          <button className={view === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Icon name="settings" /><span>Configurações</span></button>
          <div className="user-card"><span className="avatar avatar-dark">GA</span><span><strong>Gustavo Adriano</strong><small>Administrador</small></span><Icon name="more" /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><img src="/emdia.svg" alt="" /><strong>em dia <span>BY EVERLENZ</span></strong></div>
          <div className="header-copy"><small>{meta.eyebrow}</small><h1>{meta.title}</h1><p>{meta.description}</p></div>
          <div className="header-actions">
            <div className="sync-state"><span /> Sincronizado agora</div>
            <button className="icon-btn" onClick={() => setDark((value) => !value)} aria-label="Alternar tema"><Icon name={dark ? "sun" : "moon"} /></button>
            <button className="icon-btn notification" aria-label="Notificações"><Icon name="bell" /><span /></button>
            <button className="avatar avatar-dark desktop-avatar">GA</button>
          </div>
        </header>

        <div className="content-area">
          {view === "overview" && <Overview {...common} />}
          {view === "schedule" && <Schedule {...common} updateTaskProgress={updateTaskProgress} setToast={setToast} />}
          {view === "journal" && <Journal {...common} addEntry={addEntry} />}
          {view === "reports" && <Reports {...common} setToast={setToast} />}
          {view === "team" && <Team {...common} setMembers={setMembers} setToast={setToast} />}
          {view === "settings" && <Settings dark={dark} setDark={setDark} setToast={setToast} />}
        </div>
      </main>

      <nav className="bottom-nav glass" aria-label="Navegação mobile">
        {nav.slice(0, 4).map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.short}</span></button>)}
        <button className={view === "team" || view === "settings" ? "active" : ""} onClick={() => navigate("team")}><Icon name="more" /><span>Mais</span></button>
      </nav>

      {toast && <div className="toast"><span><Icon name="check" /></span>{toast}</div>}
    </div>
  );
}
