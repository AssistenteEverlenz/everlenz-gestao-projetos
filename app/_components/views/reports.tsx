"use client";
/* eslint-disable @next/next/no-img-element -- relatório exibe evidências do diário */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import {
  taskExecutionStatus,
  taskStatusPalette,
  type TaskExecutionStatus,
} from "../task-structure";
import type {
  JournalEntry,
  Member,
  Project,
  ProjectIssue,
  ReportTemplate,
  ReportSummary,
  Task,
  ViewId,
} from "../types";
import { Modal, StatusBadge } from "../ui";

type Props = {
  project: Project;
  tasks: Task[];
  entries: JournalEntry[];
  members: Member[];
  reports: ReportSummary[];
  reportTemplates?: ReportTemplate[];
  issues?: ProjectIssue[];
  navigate: (view: ViewId) => void;
  metrics: { overall: number; active: number };
  ensureReport: (date: string) => Promise<void>;
  approveReport: (date: string) => Promise<void>;
  transitionReport: (reportId: string, status: ReportSummary["status"], note?: string) => Promise<void>;
  saveReportTemplate: (template: ReportTemplate) => Promise<void>;
  generateReportSummary: (reportId: string, date: string) => Promise<string>;
  setToast: (value: string) => void;
};
const longDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
const dayMs = 86_400_000;
const dateValue = (value: string) => new Date(`${value}T12:00:00`).getTime();

export function Reports({
  project,
  tasks,
  entries,
  reports,
  metrics,
  navigate,
  ensureReport,
  transitionReport,
  saveReportTemplate,
  generateReportSummary,
  reportTemplates = [],
  issues = [],
  setToast,
}: Props) {
  const reportDates = useMemo(
    () => [...new Set(entries.map((entry) => entry.date))].sort().reverse(),
    [entries],
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [openingDate, setOpeningDate] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState<"draft" | "review" | "approved" | "sent" | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const defaultTemplate: ReportTemplate = {
    id: "",
    name: "Padrão Everlenz",
    isDefault: true,
    showSummary: true,
    showPhotos: true,
    showGantt: true,
    showSCurve: true,
    showAttention: true,
    photoSize: "large",
    compact: false,
  };
  const activeTemplate = reportTemplates.find((item) => item.isDefault) ?? reportTemplates[0] ?? defaultTemplate;
  const [templateDraft, setTemplateDraft] = useState<ReportTemplate>(activeTemplate);
  const reportEntries = entries.filter((entry) => entry.date === selectedDate);
  const photos = reportEntries.flatMap((entry) =>
    entry.photos.map((photo) => ({ photo: photo.url, entry })),
  );
  const selectedStatus =
    reports.find((report) => report.date === selectedDate)?.status ?? "review";
  const selectedReport = reports.find((report) => report.date === selectedDate);
  const openIssues = issues.filter((issue) => issue.status !== "resolved");
  const reportCurve = buildReportCurve(project, tasks, entries, selectedDate);
  const ganttStart = tasks.reduce(
    (value, task) => (task.plannedStart < value ? task.plannedStart : value),
    project.start,
  );
  const ganttEnd = tasks.reduce(
    (value, task) => (task.plannedEnd > value ? task.plannedEnd : value),
    project.end,
  );
  const ganttDays = Math.max(
    1,
    Math.round((dateValue(ganttEnd) - dateValue(ganttStart)) / dayMs) + 1,
  );
  const ganttLabels = Array.from({ length: 10 }, (_, index) => {
    const date = new Date(
      dateValue(ganttStart) +
        Math.round(((ganttDays - 1) * index) / 9) * dayMs,
    );
    return date
      .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
      .replace(" de ", " ")
      .toUpperCase();
  });
  const ganttBar = (task: Task) => ({
    left: `${Math.max(0, Math.min(100, ((dateValue(task.plannedStart) - dateValue(ganttStart)) / dayMs / ganttDays) * 100))}%`,
    width: `${Math.max(1, Math.min(100, ((Math.round((dateValue(task.plannedEnd) - dateValue(task.plannedStart)) / dayMs) + 1) / ganttDays) * 100))}%`,
  });

  const statusLabel = (date: string) => {
    const status = reports.find((report) => report.date === date)?.status;
    if (status === "draft") return "Rascunho";
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
      setToast(
        cause instanceof Error
          ? cause.message
          : "Não foi possível preparar o relatório.",
      );
    } finally {
      setOpeningDate(null);
    }
  }

  async function handleTransition() {
    if (!selectedReport || !reviewOpen) return;
    setApproving(true);
    try {
      await transitionReport(selectedReport.id, reviewOpen, reviewNote.trim() || undefined);
      setReviewOpen(null);
      setReviewNote("");
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "Não foi possível atualizar o fluxo do relatório.");
    } finally {
      setApproving(false);
    }
  }

  async function handleTemplateSave(event: React.FormEvent) {
    event.preventDefault();
    setApproving(true);
    try {
      await saveReportTemplate({ ...templateDraft, isDefault: true });
      setTemplateOpen(false);
      setToast("Modelo padrão do relatório atualizado.");
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "Não foi possível salvar o modelo.");
    } finally {
      setApproving(false);
    }
  }

  async function handleGenerateSummary() {
    if (!selectedDate || !selectedReport) return;
    setGeneratingSummary(true);
    try {
      await generateReportSummary(selectedReport.id, selectedDate);
      setToast("Resumo executivo atualizado.");
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "Não foi possível gerar o resumo.");
    } finally {
      setGeneratingSummary(false);
    }
  }

  const reportDependencyLayer = (suffix: string) => {
    const markerId = `report-arrow-${suffix}`;
    const xFor = (value: string, endBoundary = false) =>
      Math.max(
        0,
        Math.min(
          995,
          (((dateValue(value) - dateValue(ganttStart)) / dayMs +
            (endBoundary ? 1 : 0)) /
            ganttDays) *
            1000,
        ),
      );
    return (
      <svg
        className="print-dependency-layer"
        viewBox={`0 0 1000 ${Math.max(27, tasks.length * 27)}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <marker
            id={markerId}
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" />
          </marker>
        </defs>
        {tasks.map((task, targetIndex) => {
          const sourceIndex = tasks.findIndex(
            (item) => item.id === task.dependencyId,
          );
          if (sourceIndex < 0) return null;
          const predecessor = tasks[sourceIndex];
          const relation = task.dependencyType ?? "FS";
          const sourceUsesFinish = relation === "FS" || relation === "FF";
          const targetUsesFinish = relation === "FF" || relation === "SF";
          const sourceX = xFor(
            sourceUsesFinish
              ? predecessor.plannedEnd
              : predecessor.plannedStart,
            sourceUsesFinish,
          );
          const targetX = xFor(
            targetUsesFinish ? task.plannedEnd : task.plannedStart,
            targetUsesFinish,
          );
          const sourceY = sourceIndex * 27 + 13.5;
          const targetY = targetIndex * 27 + 13.5;
          const rowDirection = targetY >= sourceY ? 1 : -1;
          const laneOffset = (targetIndex % 4) * 5;
          const sourceExitX = Math.max(
            5,
            Math.min(
              995,
              sourceUsesFinish
                ? Math.max(sourceX, targetX) + 18 + laneOffset
                : Math.min(sourceX, targetX) - 18 - laneOffset,
            ),
          );
          const targetEntryX = Math.max(
            5,
            Math.min(995, targetX + (targetUsesFinish ? 12 : -12)),
          );
          const approachY = targetY - rowDirection * 7;
          return (
            <polyline
              key={`${predecessor.id}-${task.id}`}
              points={`${sourceX},${sourceY} ${sourceExitX},${sourceY} ${sourceExitX},${approachY} ${targetEntryX},${approachY} ${targetEntryX},${targetY} ${targetX},${targetY}`}
              markerEnd={`url(#${markerId})`}
            />
          );
        })}
      </svg>
    );
  };

  const ganttPage = (extraClass: string) => (
    <section className={`report-gantt-page ${extraClass}`}>
      <header>
        <div>
          <span>CRONOGRAMA COMPLETO</span>
          <h3>Evolução geral da obra</h3>
          <p>
            {project.name} · posição em{" "}
            {selectedDate ? longDate(selectedDate) : ""}
          </p>
        </div>
        <strong>
          {metrics.overall}%<small> avanço geral</small>
        </strong>
      </header>
      <div className="print-gantt">
        <div className="print-gantt-heading">
          <span>EAP · ATIVIDADE</span>
          <div>
            {ganttLabels.map((label) => (
              <b key={label}>{label}</b>
            ))}
          </div>
        </div>
        {reportDependencyLayer(extraClass)}
        {tasks.map((task) => {
          const palette = taskStatusPalette[taskExecutionStatus(task)];
          return (
            <div className="print-gantt-row" key={task.id}>
              <span
                style={{
                  paddingLeft: `${Math.min(4, task.code.split(".").length - 1) * 10}px`,
                }}
              >
                <i style={{ background: palette.period }} />
                <b>{task.code}</b>
                <em>
                  <strong>{task.name}</strong>
                  <small>
                    {task.responsible || "Sem responsável"} · {task.progress}%
                  </small>
                </em>
              </span>
              <div className="print-timeline">
                <i
                  className="print-planned-bar"
                  style={{
                    ...ganttBar(task),
                    background: palette.period,
                    color: palette.period,
                  }}
                >
                  <b
                    style={{
                      width: `${task.progress}%`,
                      background: palette.progress,
                    }}
                  />
                </i>
              </div>
            </div>
          );
        })}
      </div>
      <footer>
        {(["waiting", "active", "done", "late"] as TaskExecutionStatus[]).map(
          (status) => (
            <span key={status}>
              <i style={{ background: taskStatusPalette[status].period }} />{" "}
              {taskStatusPalette[status].label}
            </span>
          ),
        )}
        <b>
          {ganttStart.split("-").reverse().join("/")} -{" "}
          {ganttEnd.split("-").reverse().join("/")}
        </b>
      </footer>
    </section>
  );

  if (!entries.length)
    return (
      <section className="empty-schedule glass">
        <span className="empty-workspace-icon">
          <Icon name="report" />
        </span>
        <span className="overline">STATUS REPORT AUTOMÁTICO</span>
        <h2>O primeiro relatório nasce no campo</h2>
        <p>
          Assim que a equipe lançar atividades no Diário de Obra, esta área
          organizará descrições, fotos, medições e o Gantt completo do projeto.
        </p>
        <button className="primary-btn" onClick={() => navigate("journal")}>
          <Icon name="plus" /> Fazer primeiro registro
        </button>
      </section>
    );

  return (
    <div className="view-stack reports-view">
      <section className="report-builder glass">
        <div className="builder-icon">
          <Icon name="spark" />
        </div>
        <div>
          <span className="overline">RELATÓRIO AUTOMÁTICO</span>
          <h2>
            {reportDates.length} relatório{reportDates.length > 1 ? "s" : ""}{" "}
            gerado{reportDates.length > 1 ? "s" : ""} pelo diário.
          </h2>
          <p>
            Cada documento reúne todos os registros do dia, as evidências
            fotográficas, as medições e a visão completa do cronograma.
          </p>
          <div className="builder-chips">
            <span>
              <Icon name="trend" /> {metrics.overall}% de avanço geral
            </span>
            <span>
              <Icon name="journal" /> {entries.length} registros
            </span>
            <span>
              <Icon name="camera" />{" "}
              {entries.reduce((sum, entry) => sum + entry.photos.length, 0)}{" "}
              evidências
            </span>
          </div>
        </div>
        <div className="report-builder-actions">
          <button className="secondary-btn" onClick={() => { setTemplateDraft(activeTemplate); setTemplateOpen(true); }}>
            <Icon name="settings" /> Modelo
          </button>
          <button
            className="primary-btn"
            disabled={openingDate !== null}
            onClick={() => void openReport(reportDates[0])}
          >
            {openingDate === reportDates[0] ? "Preparando..." : "Revisar o mais recente"}{" "}
            <Icon name="arrow" />
          </button>
        </div>
      </section>

      <section className="panel glass reports-panel">
        <header className="panel-header">
          <div>
            <span className="overline">HISTÓRICO</span>
            <h3>Relatórios diários da obra</h3>
          </div>
          <div className="search-box">
            <Icon name="search" />
            <input placeholder="Buscar relatório..." />
          </div>
        </header>
        <div className="report-table">
          <div className="report-row report-head">
            <span>RELATÓRIO</span>
            <span>CONTEÚDO</span>
            <span>STATUS</span>
            <span />
          </div>
          {reportDates.map((date, index) => {
            const daily = entries.filter((entry) => entry.date === date);
            const photoCount = daily.reduce(
              (sum, entry) => sum + entry.photos.length,
              0,
            );
            return (
              <button
                className="report-row"
                disabled={openingDate !== null}
                key={date}
                onClick={() => void openReport(date)}
              >
                <span>
                  <i className="pdf-icon">
                    <Icon name="report" />
                  </i>
                  <span>
                    <strong>Status diário · {longDate(date)}</strong>
                    <small>
                      {openingDate === date
                        ? "Preparando..."
                        : `SR-${String(reportDates.length - index).padStart(4, "0")}`}
                    </small>
                  </span>
                </span>
                <span>
                  <small>{daily.length} atualizações</small>
                  <small>{photoCount} fotos</small>
                </span>
                <span>
                  <StatusBadge value={statusLabel(date)} />
                </span>
                <span>
                  <Icon name="more" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {selectedDate && (
        <>
          <Modal
            title="Prévia do status report"
            subtitle={`${longDate(selectedDate)} · ${reportEntries.length} registros de campo`}
            onClose={() => setSelectedDate(null)}
            wide
          >
            <div className="report-preview">
              <div className="report-paper">
                <header>
                  <div className="report-logo">
                    <img src="/emdia.svg" alt="" />
                    <strong>
                      em dia <span>BY EVERLENZ</span>
                    </strong>
                  </div>
                  <small>
                    STATUS REPORT ·{" "}
                    {selectedDate.split("-").reverse().join("/")}
                  </small>
                </header>
                <div className="report-cover">
                  <span>ACOMPANHAMENTO DIÁRIO DE OBRA</span>
                  <h2>{project.name}</h2>
                  <p>
                    {project.client} · {project.location}
                  </p>
                  <strong>{longDate(selectedDate)}</strong>
                </div>
                <div className="report-kpis">
                  <div>
                    <span>AVANÇO GERAL</span>
                    <strong>{metrics.overall}%</strong>
                  </div>
                  <div>
                    <span>ATIVIDADES NO DIA</span>
                    <strong>
                      {new Set(reportEntries.map((entry) => entry.taskId)).size}
                    </strong>
                  </div>
                  <div>
                    <span>AVANÇO MEDIDO</span>
                    <strong>
                      +
                      {reportEntries.reduce(
                        (sum, entry) => sum + entry.progressAdded,
                        0,
                      )}
                      %
                    </strong>
                  </div>
                  <div>
                    <span>EVIDÊNCIAS</span>
                    <strong>{photos.length}</strong>
                  </div>
                </div>
                {activeTemplate.showSummary && <section className="report-executive-summary">
                  <div className="report-section-heading"><h3>Resumo executivo</h3><button className="secondary-btn compact no-print" disabled={generatingSummary || !selectedReport} onClick={() => void handleGenerateSummary()}><Icon name="spark"/>{generatingSummary ? " Gerando..." : " Gerar resumo inteligente"}</button></div>
                  <p>
                    {selectedReport?.executiveSummary ?? <>Foram realizados {reportEntries.length} registros em{" "}
                    {new Set(reportEntries.map((entry) => entry.taskId)).size}{" "}
                    atividades do cronograma. Cada medição abaixo está vinculada
                    às respectivas evidências de campo e já foi incorporada ao
                    avanço geral da obra.</>}
                  </p>
                </section>}
                {activeTemplate.showAttention && openIssues.length > 0 && <section className="report-attention-section">
                  <h3>Pontos de atenção</h3>
                  <div className="report-update-list">
                    {openIssues.slice(0, 6).map((issue) => <article key={issue.id}><span>!</span><div><strong>{issue.title}</strong><small>{issue.category} · {issue.priority}</small><p>{issue.description}</p></div></article>)}
                  </div>
                </section>}
                {activeTemplate.showSCurve && <section className="report-curve-section">
                  <h3>Curva S · planejado × realizado</h3>
                  <svg viewBox="0 0 600 150" preserveAspectRatio="none" role="img" aria-label="Curva S do projeto"><g><line x1="0" y1="5" x2="600" y2="5"/><line x1="0" y1="75" x2="600" y2="75"/><line x1="0" y1="145" x2="600" y2="145"/></g><polyline className="planned" points={reportCurve.map((point,index)=>`${index/(reportCurve.length-1)*600},${145-point.planned*1.4}`).join(" ")}/><polyline className="actual" points={reportCurve.map((point,index)=>point.actual === null ? null : `${index/(reportCurve.length-1)*600},${145-point.actual*1.4}`).filter(Boolean).join(" ")}/></svg>
                  <footer><span>{project.start.split("-").reverse().join("/")}</span><b>Planejado</b><b>Realizado</b><span>{project.end.split("-").reverse().join("/")}</span></footer>
                </section>}
                {activeTemplate.showPhotos && <section>
                  <h3>Serviços executados e evidências</h3>
                  <div className="report-activity-blocks">
                    {reportEntries.map((entry) => {
                      const task = tasks.find(
                        (item) => item.id === entry.taskId,
                      );
                      return (
                        <article
                          className="report-activity-block"
                          key={entry.id}
                        >
                          <header>
                            <span>{task?.code}</span>
                            <div>
                              <strong>{entry.title}</strong>
                              <small>
                                {task?.name} · {entry.author} às {entry.time}
                              </small>
                              <p>{entry.description}</p>
                            </div>
                            <b>
                              {entry.progressBefore}% → {entry.progressAfter}%{" "}
                              <em>(+{entry.progressAdded}%)</em>
                            </b>
                          </header>
                          {entry.photos.length > 0 && (
                            <div className={`preview-photos activity-photos photos-${activeTemplate.photoSize}`}>
                              {entry.photos.map((photo, index) => (
                                <article
                                  key={photo.id ?? `${entry.id}-${index}`}
                                >
                                  <img
                                    src={photo.url}
                                    alt={`${entry.title} · evidência ${index + 1}`}
                                  />
                                  <div>
                                    <strong>Foto {index + 1}</strong>
                                    <p>{entry.title}</p>
                                    <span>
                                      Evidência vinculada · +
                                      {entry.progressAdded}% medido
                                    </span>
                                  </div>
                                </article>
                              ))}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>}
                <footer>
                  Gerado por Em Dia · by Everlenz · Informação técnica com
                  evidência de campo
                </footer>
              </div>
              {activeTemplate.showGantt && ganttPage("report-gantt-screen")}
              <div className="preview-actions">
                <button
                  className="secondary-btn"
                  onClick={() => window.print()}
                >
                  <Icon name="download" /> Exportar PDF
                </button>
                {selectedStatus === "draft" && <button className="primary-btn" disabled={approving} onClick={() => setReviewOpen("review")}><Icon name="share" /> Enviar para revisão</button>}
                {selectedStatus === "review" && <><button className="secondary-btn" disabled={approving} onClick={() => setReviewOpen("draft")}>Devolver</button><button className="primary-btn" disabled={approving} onClick={() => setReviewOpen("approved")}><Icon name="check" /> Aprovar relatório</button></>}
                {selectedStatus === "approved" && <button className="primary-btn" disabled={approving} onClick={() => setReviewOpen("sent")}><Icon name="share" /> Marcar como enviado</button>}
                {selectedStatus === "sent" && <button className="secondary-btn" disabled>Relatório enviado</button>}
              </div>
            </div>
          </Modal>
          {activeTemplate.showGantt && createPortal(ganttPage("report-gantt-print"), document.body)}
        </>
      )}
      {templateOpen && <Modal title="Modelo do status report" subtitle="A identidade visual permanece fixa; escolha o conteúdo e a densidade do documento." onClose={() => !approving && setTemplateOpen(false)}>
        <form className="invite-form report-template-form" onSubmit={handleTemplateSave}>
          <label><span>Nome do modelo</span><input value={templateDraft.name} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} required /></label>
          <div className="template-options">
            {([['showSummary','Resumo executivo'],['showPhotos','Fotos e medições'],['showGantt','Gantt completo'],['showSCurve','Curva S'],['showAttention','Pontos de atenção']] as const).map(([key,label]) => <label key={key}><input type="checkbox" checked={templateDraft[key]} onChange={(event) => setTemplateDraft({ ...templateDraft, [key]: event.target.checked })}/><span>{label}</span></label>)}
          </div>
          <label><span>Tamanho das fotos</span><select value={templateDraft.photoSize} onChange={(event) => setTemplateDraft({ ...templateDraft, photoSize: event.target.value as "medium" | "large" })}><option value="large">Grande — foco na evidência</option><option value="medium">Médio — mais fotos por página</option></select></label>
          <label className="switch-line"><input type="checkbox" checked={templateDraft.compact} onChange={(event) => setTemplateDraft({ ...templateDraft, compact: event.target.checked })}/><span><strong>Documento compacto</strong><small>Reduz espaços para relatórios extensos.</small></span></label>
          <div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setTemplateOpen(false)}>Cancelar</button><button className="primary-btn" disabled={approving}>{approving && <span className="button-spinner"/>}{approving ? "Salvando..." : "Salvar modelo"}</button></div>
        </form>
      </Modal>}
      {reviewOpen && <Modal title={reviewOpen === "approved" ? "Aprovar relatório" : reviewOpen === "sent" ? "Confirmar envio" : reviewOpen === "draft" ? "Devolver para ajustes" : "Enviar para revisão"} subtitle="A mudança ficará registrada no histórico de auditoria." onClose={() => !approving && setReviewOpen(null)}>
        <div className="invite-form"><label><span>Observação (opcional)</span><textarea rows={4} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Registre uma orientação, ressalva ou confirmação..."/></label><div className="modal-actions"><button className="secondary-btn" disabled={approving} onClick={() => setReviewOpen(null)}>Cancelar</button><button className="primary-btn" disabled={approving || !selectedReport} onClick={() => void handleTransition()}>{approving && <span className="button-spinner"/>}{approving ? "Processando..." : "Confirmar"}</button></div></div>
      </Modal>}
    </div>
  );
}

function buildReportCurve(project: Project, tasks: Task[], entries: JournalEntry[], selectedDate: string | null) {
  const day = 86_400_000;
  const start = dateValue(project.start);
  const end = dateValue(project.end);
  const cut = selectedDate ? dateValue(selectedDate) : Date.now();
  const leaves = tasks.filter((task) => !tasks.some((child) => child.parentId === task.id));
  const totalWeight = leaves.reduce((sum, task) => sum + task.weight, 0) || 1;
  return Array.from({ length: 14 }, (_, index) => {
    const sample = start + ((end - start) * index) / 13;
    const planned = leaves.reduce((sum, task) => {
      const taskStart = dateValue(task.plannedStart);
      const taskEnd = dateValue(task.plannedEnd);
      const fraction = sample < taskStart ? 0 : sample >= taskEnd ? 1 : (sample - taskStart) / Math.max(day, taskEnd - taskStart);
      return sum + task.weight * fraction * 100;
    }, 0) / totalWeight;
    const actual = sample > cut ? null : leaves.reduce((sum, task) => {
      const measured = entries.filter((entry) => entry.taskId === task.id && dateValue(entry.date) <= sample).reduce((value, entry) => value + entry.progressAdded, 0);
      return sum + task.weight * Math.min(100, measured);
    }, 0) / totalWeight;
    return { planned: Math.round(planned), actual: actual === null ? null : Math.round(actual) };
  });
}
