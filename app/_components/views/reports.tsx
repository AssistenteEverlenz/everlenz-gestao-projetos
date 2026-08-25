"use client";
/* eslint-disable @next/next/no-img-element -- relatório exibe evidências do diário */

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import type { JournalEntry, Member, Project, Task, ViewId } from "../types";
import { Modal, StatusBadge } from "../ui";

type Props = { project: Project; tasks: Task[]; entries: JournalEntry[]; members: Member[]; navigate: (view: ViewId) => void; metrics: { overall: number; active: number }; setToast: (value: string) => void };
const longDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

export function Reports({ project, tasks, entries, metrics, navigate, setToast }: Props) {
  const reportDates = useMemo(() => [...new Set(entries.map((entry) => entry.date))].sort().reverse(), [entries]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const reportEntries = entries.filter((entry) => entry.date === selectedDate);
  const photos = reportEntries.flatMap((entry) => entry.photos.map((photo) => ({ photo, entry })));

  if (!entries.length) return <section className="empty-schedule glass"><span className="empty-workspace-icon"><Icon name="report" /></span><span className="overline">STATUS REPORT AUTOMÁTICO</span><h2>O primeiro relatório nasce no campo</h2><p>Assim que a equipe lançar atividades no Diário de Obra, esta área organizará descrições, fotos, medições e o Gantt completo do projeto.</p><button className="primary-btn" onClick={() => navigate("journal")}><Icon name="plus"/> Fazer primeiro registro</button></section>;

  return <div className="view-stack reports-view">
    <section className="report-builder glass"><div className="builder-icon"><Icon name="spark"/></div><div><span className="overline">RELATÓRIO AUTOMÁTICO</span><h2>{reportDates.length} relatório{reportDates.length > 1 ? "s" : ""} gerado{reportDates.length > 1 ? "s" : ""} pelo diário.</h2><p>Cada documento reúne todos os registros do dia, as evidências fotográficas, as medições e a visão completa do cronograma.</p><div className="builder-chips"><span><Icon name="trend"/> {metrics.overall}% de avanço geral</span><span><Icon name="journal"/> {entries.length} registros</span><span><Icon name="camera"/> {entries.reduce((sum, entry) => sum + entry.photos.length, 0)} evidências</span></div></div><button className="primary-btn" onClick={() => setSelectedDate(reportDates[0])}>Revisar o mais recente <Icon name="arrow"/></button></section>

    <section className="panel glass reports-panel"><header className="panel-header"><div><span className="overline">HISTÓRICO</span><h3>Relatórios diários da obra</h3></div><div className="search-box"><Icon name="search"/><input placeholder="Buscar relatório..."/></div></header><div className="report-table"><div className="report-row report-head"><span>RELATÓRIO</span><span>CONTEÚDO</span><span>STATUS</span><span/></div>{reportDates.map((date, index) => { const daily = entries.filter((entry) => entry.date === date); const photoCount = daily.reduce((sum, entry) => sum + entry.photos.length, 0); return <button className="report-row" key={date} onClick={() => setSelectedDate(date)}><span><i className="pdf-icon"><Icon name="report"/></i><span><strong>Status diário · {longDate(date)}</strong><small>SR-{String(reportDates.length - index).padStart(4, "0")}</small></span></span><span><small>{daily.length} atualizações</small><small>{photoCount} fotos</small></span><span><StatusBadge value="Em revisão"/></span><span><Icon name="more"/></span></button>; })}</div></section>

    {selectedDate && <Modal title="Prévia do status report" subtitle={`${longDate(selectedDate)} · ${reportEntries.length} registros de campo`} onClose={() => setSelectedDate(null)} wide><div className="report-preview"><div className="report-paper">
      <header><div className="report-logo"><img src="/emdia.svg" alt=""/><strong>em dia <span>BY EVERLENZ</span></strong></div><small>STATUS REPORT · {selectedDate.split("-").reverse().join("/")}</small></header>
      <div className="report-cover"><span>ACOMPANHAMENTO DIÁRIO DE OBRA</span><h2>{project.name}</h2><p>{project.client} · {project.location}</p><strong>{longDate(selectedDate)}</strong></div>
      <div className="report-kpis"><div><span>AVANÇO GERAL</span><strong>{metrics.overall}%</strong></div><div><span>ATIVIDADES NO DIA</span><strong>{new Set(reportEntries.map((entry) => entry.taskId)).size}</strong></div><div><span>AVANÇO MEDIDO</span><strong>+{reportEntries.reduce((sum, entry) => sum + entry.progressAdded, 0)}%</strong></div><div><span>EVIDÊNCIAS</span><strong>{photos.length}</strong></div></div>
      <section><h3>Resumo do dia</h3><p>Foram realizados {reportEntries.length} registros em {new Set(reportEntries.map((entry) => entry.taskId)).size} atividades do cronograma. Cada medição abaixo está vinculada às respectivas evidências de campo e já foi incorporada ao avanço geral da obra.</p></section>
      <section><h3>Serviços executados e medições</h3><div className="report-update-list">{reportEntries.map((entry) => { const task = tasks.find((item) => item.id === entry.taskId); return <article key={entry.id}><span>{task?.code}</span><div><strong>{entry.title}</strong><small>{task?.name} · {entry.author} às {entry.time}</small><p>{entry.description}</p></div><b>{entry.progressBefore}% → {entry.progressAfter}% <em>(+{entry.progressAdded}%)</em></b></article>; })}</div></section>
      {photos.length > 0 && <section><h3>Registro fotográfico</h3><div className="preview-photos">{photos.map(({ photo, entry }, index) => <article key={`${entry.id}-${index}`}><img src={photo} alt={`${entry.title} · evidência ${index + 1}`}/><div><strong>{entry.title}</strong><p>{entry.description}</p><span>Evidência {index + 1} · +{entry.progressAdded}% medido</span></div></article>)}</div></section>}
      <section className="report-gantt-section"><h3>Cronograma geral e evolução da obra</h3><div className="report-gantt"><div className="report-gantt-head"><span>EAP · ATIVIDADE</span><span>PERÍODO</span><span>RESPONSÁVEL</span><span>AVANÇO</span></div>{tasks.map((task) => <div className="report-gantt-row" key={task.id}><span><i style={{ background: task.color }}/><b>{task.code}</b> {task.name}</span><span>{task.plannedStart.split("-").reverse().slice(0, 2).join("/")} – {task.plannedEnd.split("-").reverse().slice(0, 2).join("/")}</span><span>{task.responsible || "—"}</span><span><i><b style={{ width: `${task.progress}%`, background: task.color }}/></i><strong>{task.progress}%</strong></span></div>)}</div></section>
      <footer>Gerado por Em Dia · by Everlenz · Informação técnica com evidência de campo</footer>
    </div><div className="preview-actions"><button className="secondary-btn" onClick={() => window.print()}><Icon name="download"/> Exportar PDF</button><button className="primary-btn" onClick={() => { setSelectedDate(null); setToast("Relatório aprovado e pronto para compartilhamento."); }}><Icon name="share"/> Aprovar relatório</button></div></div></Modal>}
  </div>;
}
