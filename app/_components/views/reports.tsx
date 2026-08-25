"use client";
/* eslint-disable @next/next/no-img-element -- relatório exibe evidências do diário */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import type { JournalEntry, Member, Project, ReportSummary, Task, ViewId } from "../types";
import { Modal, StatusBadge } from "../ui";

type Props = { project: Project; tasks: Task[]; entries: JournalEntry[]; members: Member[]; reports: ReportSummary[]; navigate: (view: ViewId) => void; metrics: { overall: number; active: number }; ensureReport: (date: string) => Promise<void>; approveReport: (date: string) => Promise<void>; setToast: (value: string) => void };
const longDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
const dayMs = 86_400_000;
const dateValue = (value: string) => new Date(`${value}T12:00:00`).getTime();

export function Reports({ project, tasks, entries, reports, metrics, navigate, ensureReport, approveReport, setToast }: Props) {
  const reportDates = useMemo(() => [...new Set(entries.map((entry) => entry.date))].sort().reverse(), [entries]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [openingDate, setOpeningDate] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const reportEntries = entries.filter((entry) => entry.date === selectedDate);
  const photos = reportEntries.flatMap((entry) => entry.photos.map((photo) => ({ photo: photo.url, entry })));
  const selectedStatus = reports.find((report) => report.date === selectedDate)?.status ?? "review";
  const ganttDays = Math.max(1, Math.round((dateValue(project.end) - dateValue(project.start)) / dayMs) + 1);
  const ganttLabels = Array.from({ length: 10 }, (_, index) => { const date = new Date(dateValue(project.start) + Math.round((ganttDays - 1) * index / 9) * dayMs); return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(" de ", " ").toUpperCase(); });
  const ganttBar = (task: Task) => ({ left: `${Math.max(0, Math.min(100, (dateValue(task.plannedStart) - dateValue(project.start)) / dayMs / ganttDays * 100))}%`, width: `${Math.max(1, Math.min(100, (Math.round((dateValue(task.plannedEnd) - dateValue(task.plannedStart)) / dayMs) + 1) / ganttDays * 100))}%` });

  const statusLabel = (date: string) => {
    const status = reports.find((report) => report.date === date)?.status;
    if (status === "approved") return "Aprovado";
    if (status === "sent") return "Enviado";
    return "Em revisão";
  };

  async function openReport(date: string) {
    setOpeningDate(date);
    try {
      await ensureReport(date);
      setSelectedDate(date);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "Não foi possível preparar o relatório.");
    } finally {
      setOpeningDate(null);
    }
  }

  async function handleApprove() {
    if (!selectedDate || selectedStatus === "approved") return;
    setApproving(true);
    try {
      await approveReport(selectedDate);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "Não foi possível aprovar o relatório.");
    } finally {
      setApproving(false);
    }
  }

  const ganttPage = (extraClass: string) => <section className={`report-gantt-page ${extraClass}`}><header><div><span>CRONOGRAMA COMPLETO</span><h3>Evolução geral da obra</h3><p>{project.name} · posição em {selectedDate ? longDate(selectedDate) : ""}</p></div><strong>{metrics.overall}%<small> avanço geral</small></strong></header><div className="print-gantt"><div className="print-gantt-heading"><span>EAP · ATIVIDADE</span><div>{ganttLabels.map((label) => <b key={label}>{label}</b>)}</div></div>{tasks.map((task) => <div className="print-gantt-row" key={task.id}><span style={{ paddingLeft: `${Math.min(4, task.code.split(".").length - 1) * 10}px` }}><i style={{ background: task.color }}/><b>{task.code}</b><em><strong>{task.name}</strong><small>{task.responsible || "Sem responsável"} · {task.progress}%</small></em></span><div className="print-timeline"><i className="print-planned-bar" style={{ ...ganttBar(task), background: task.color }}><b style={{ width: `${task.progress}%` }}/></i></div></div>)}</div><footer><span><i/> Planejado</span><span><i/> Realizado</span><b>{project.start.split("-").reverse().join("/")} - {project.end.split("-").reverse().join("/")}</b></footer></section>;

  if (!entries.length) return <section className="empty-schedule glass"><span className="empty-workspace-icon"><Icon name="report" /></span><span className="overline">STATUS REPORT AUTOMÁTICO</span><h2>O primeiro relatório nasce no campo</h2><p>Assim que a equipe lançar atividades no Diário de Obra, esta área organizará descrições, fotos, medições e o Gantt completo do projeto.</p><button className="primary-btn" onClick={() => navigate("journal")}><Icon name="plus"/> Fazer primeiro registro</button></section>;

  return <div className="view-stack reports-view">
    <section className="report-builder glass"><div className="builder-icon"><Icon name="spark"/></div><div><span className="overline">RELATÓRIO AUTOMÁTICO</span><h2>{reportDates.length} relatório{reportDates.length > 1 ? "s" : ""} gerado{reportDates.length > 1 ? "s" : ""} pelo diário.</h2><p>Cada documento reúne todos os registros do dia, as evidências fotográficas, as medições e a visão completa do cronograma.</p><div className="builder-chips"><span><Icon name="trend"/> {metrics.overall}% de avanço geral</span><span><Icon name="journal"/> {entries.length} registros</span><span><Icon name="camera"/> {entries.reduce((sum, entry) => sum + entry.photos.length, 0)} evidências</span></div></div><button className="primary-btn" disabled={openingDate !== null} onClick={() => void openReport(reportDates[0])}>{openingDate === reportDates[0] ? "Preparando..." : "Revisar o mais recente"} <Icon name="arrow"/></button></section>

    <section className="panel glass reports-panel"><header className="panel-header"><div><span className="overline">HISTÓRICO</span><h3>Relatórios diários da obra</h3></div><div className="search-box"><Icon name="search"/><input placeholder="Buscar relatório..."/></div></header><div className="report-table"><div className="report-row report-head"><span>RELATÓRIO</span><span>CONTEÚDO</span><span>STATUS</span><span/></div>{reportDates.map((date, index) => { const daily = entries.filter((entry) => entry.date === date); const photoCount = daily.reduce((sum, entry) => sum + entry.photos.length, 0); return <button className="report-row" disabled={openingDate !== null} key={date} onClick={() => void openReport(date)}><span><i className="pdf-icon"><Icon name="report"/></i><span><strong>Status diário · {longDate(date)}</strong><small>{openingDate === date ? "Preparando..." : `SR-${String(reportDates.length - index).padStart(4, "0")}`}</small></span></span><span><small>{daily.length} atualizações</small><small>{photoCount} fotos</small></span><span><StatusBadge value={statusLabel(date)}/></span><span><Icon name="more"/></span></button>; })}</div></section>

    {selectedDate && <><Modal title="Prévia do status report" subtitle={`${longDate(selectedDate)} · ${reportEntries.length} registros de campo`} onClose={() => setSelectedDate(null)} wide><div className="report-preview"><div className="report-paper">
      <header><div className="report-logo"><img src="/emdia.svg" alt=""/><strong>em dia <span>BY EVERLENZ</span></strong></div><small>STATUS REPORT · {selectedDate.split("-").reverse().join("/")}</small></header>
      <div className="report-cover"><span>ACOMPANHAMENTO DIÁRIO DE OBRA</span><h2>{project.name}</h2><p>{project.client} · {project.location}</p><strong>{longDate(selectedDate)}</strong></div>
      <div className="report-kpis"><div><span>AVANÇO GERAL</span><strong>{metrics.overall}%</strong></div><div><span>ATIVIDADES NO DIA</span><strong>{new Set(reportEntries.map((entry) => entry.taskId)).size}</strong></div><div><span>AVANÇO MEDIDO</span><strong>+{reportEntries.reduce((sum, entry) => sum + entry.progressAdded, 0)}%</strong></div><div><span>EVIDÊNCIAS</span><strong>{photos.length}</strong></div></div>
      <section><h3>Resumo do dia</h3><p>Foram realizados {reportEntries.length} registros em {new Set(reportEntries.map((entry) => entry.taskId)).size} atividades do cronograma. Cada medição abaixo está vinculada às respectivas evidências de campo e já foi incorporada ao avanço geral da obra.</p></section>
      <section><h3>Serviços executados e medições</h3><div className="report-update-list">{reportEntries.map((entry) => { const task = tasks.find((item) => item.id === entry.taskId); return <article key={entry.id}><span>{task?.code}</span><div><strong>{entry.title}</strong><small>{task?.name} · {entry.author} às {entry.time}</small><p>{entry.description}</p></div><b>{entry.progressBefore}% → {entry.progressAfter}% <em>(+{entry.progressAdded}%)</em></b></article>; })}</div></section>
      {photos.length > 0 && <section><h3>Registro fotográfico</h3><div className="preview-photos">{photos.map(({ photo, entry }, index) => <article key={`${entry.id}-${index}`}><img src={photo} alt={`${entry.title} · evidência ${index + 1}`}/><div><strong>{entry.title}</strong><p>{entry.description}</p><span>Evidência {index + 1} · +{entry.progressAdded}% medido</span></div></article>)}</div></section>}
      <footer>Gerado por Em Dia · by Everlenz · Informação técnica com evidência de campo</footer>
    </div>{ganttPage("report-gantt-screen")}<div className="preview-actions"><button className="secondary-btn" onClick={() => window.print()}><Icon name="download"/> Exportar PDF</button><button className="primary-btn" disabled={approving || selectedStatus === "approved"} onClick={() => void handleApprove()}><Icon name="share"/> {selectedStatus === "approved" ? "Relatório aprovado" : approving ? "Aprovando..." : "Aprovar relatório"}</button></div></div></Modal>{createPortal(ganttPage("report-gantt-print"), document.body)}</>}
  </div>;
}
