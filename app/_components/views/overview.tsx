"use client";

import { useState } from "react";
import { Icon } from "../icons";
import type { JournalEntry, Member, Project, Task, ViewId } from "../types";
import { ProgressRing, StatusBadge } from "../ui";

type Props = { project: Project; tasks: Task[]; entries: JournalEntry[]; members: Member[]; navigate: (view: ViewId) => void; metrics: { overall: number; active: number } };

export function Overview({ project, tasks, entries, navigate, metrics }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const critical = tasks.filter((task) => task.critical && task.progress < 100);
  const activeTasks = tasks.filter((task) => task.progress > 0 && task.progress < 100).slice(0, 3);
  const startDate = new Date(project.start + "T12:00:00");
  const endDate = new Date(project.end + "T12:00:00");
  const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.round((Date.now() - startDate.getTime()) / 86_400_000) + 1));
  const formatDate = (value: string) => new Date(value + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(" de ", " ");
  const photoCount = entries.reduce((sum, entry) => sum + entry.photos.length, 0);

  function metricCard(id: string, label: string, value: string, hint: string, icon: "trend" | "calendar" | "clock" | "alert", tone: string, details: string) {
    const open = expanded === id;
    return <button className={`metric-card glass ${tone} ${open ? "expanded" : ""}`} onClick={() => setExpanded(open ? null : id)}>
      <span className="metric-icon"><Icon name={icon} /></span><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-hint">{hint}</span><span className="metric-details">{details}</span><Icon name="chevron" className="metric-chevron" />
    </button>;
  }

  return <div className="view-stack overview-view">
    <section className="project-hero glass">
      <div className="hero-main">
        <div className="hero-title-row"><div><span className="overline">OBRA EM ANDAMENTO</span><h2>{project.name}</h2><p><Icon name="building" /> {project.client} <i /> {project.location}</p></div><StatusBadge value={project.status} /></div>
        <div className="hero-progress"><ProgressRing value={metrics.overall} size={78}/><div><strong>Avanço físico geral</strong><p>{tasks.length ? tasks.length + " atividades estruturadas" : "Cronograma aguardando atividades"}</p><span className="variance">{metrics.active} em execução</span></div></div>
      </div>
      <div className="hero-dates"><div><span>INÍCIO</span><strong>{formatDate(project.start)}</strong></div><div><span>PREVISÃO DE TÉRMINO</span><strong>{formatDate(project.end)}</strong></div><div><span>DIAS DECORRIDOS</span><strong>{elapsedDays} <small>de {totalDays}</small></strong></div><button className="secondary-btn" onClick={() => navigate("schedule")}>Abrir cronograma <Icon name="arrow" /></button></div>
    </section>

    <section className="metrics-grid">
      {metricCard("physical", "AVANÇO FÍSICO", `${metrics.overall}%`, "↗ +3% nesta semana", "trend", "green", "O avanço real está 3 pontos abaixo da linha de base atual.")}
      {metricCard("term", "PRAZO CONSUMIDO", Math.round(elapsedDays / totalDays * 100) + "%", elapsedDays + " de " + totalDays + " dias", "calendar", "blue", "Restam " + Math.max(0, totalDays - elapsedDays) + " dias corridos até a entrega contratual.")}
      {metricCard("active", "ATIVIDADES EM CURSO", String(metrics.active), "2 dentro do prazo", "clock", "orange", "Formas da laje e alvenaria estão em execução neste momento.")}
      {metricCard("critical", "PONTOS DE ATENÇÃO", String(critical.length), "1 novo hoje", "alert", "red", "A armação da laje está impactando a data prevista da concretagem.")}
    </section>

    <div className="overview-columns">
      <section className="panel glass active-panel">
        <header className="panel-header"><div><span className="overline">EXECUÇÃO</span><h3>Atividades em andamento</h3></div><button className="text-btn" onClick={() => navigate("schedule")}>Ver cronograma <Icon name="arrow" /></button></header>
        <div className="activity-list">
          {!activeTasks.length && <button className="activity-item" onClick={() => navigate("schedule")}><span className="activity-color"/><div className="activity-copy"><strong>{tasks.length ? "Nenhuma atividade em execução" : "Cronograma ainda está vazio"}</strong><p>{tasks.length ? "Inicie ou meça uma atividade pelo diário." : "Adicione a primeira atividade para começar."}</p></div><Icon name="chevron" /></button>}
          {activeTasks.map((task) => <button key={task.id} className="activity-item" onClick={() => navigate("schedule")}><span className="activity-color"/><div className="activity-copy"><strong>{task.name}</strong><p>{task.phase} · {task.responsible}</p><div className="thin-progress"><i style={{ width: `${task.progress}%` }}/></div></div><b>{task.progress}%</b><Icon name="chevron" /></button>)}
        </div>
      </section>

      <section className="panel glass timeline-panel">
        <header className="panel-header"><div><span className="overline">HOJE NA OBRA</span><h3>Últimas atualizações</h3></div><span className="live-pill"><i/> AO VIVO</span></header>
        <div className="mini-timeline">
          {entries.slice(0, 3).map((entry, index) => <button key={entry.id} onClick={() => navigate("journal")}><span className={`timeline-dot dot-${index}`}>{index === 0 ? <Icon name="camera" /> : index === 1 ? <Icon name="trend" /> : <Icon name="check" />}</span><span><strong>{entry.title}</strong><small>{entry.description.slice(0, 76)}…</small><em>{entry.time} · {entry.author}</em></span></button>)}
        </div>
      </section>
    </div>

    <section className="report-callout">
      <div className="callout-art"><Icon name="report"/><span className="art-line one"/><span className="art-line two"/><span className="art-line three"/></div>
      <div><span className="overline">STATUS REPORT AUTOMÁTICO</span><h3>{entries.length ? "Os relatórios do diário estão prontos para revisar." : "O relatório será criado pelo Diário de Obra."}</h3><p>{entries.length} registros, {photoCount} fotos anexadas e avanço geral recalculado.</p></div>
      <button className="primary-btn" onClick={() => navigate("reports")}>Revisar e gerar relatório <Icon name="arrow" /></button>
    </section>
  </div>;
}
