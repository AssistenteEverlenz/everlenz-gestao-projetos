"use client";
import { SearchableSelect } from "../searchable-select";
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
import {
  actualProgressAt,
  ancestorsOf,
  buildSCurve,
  curvePoints,
  entriesContribution,
  entryContribution,
  formatPercent,
  leafTasks,
  leavesUnder,
  plannedProgressAt,
} from "../progress";
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
  /** Administradores e gestores; o perfil Usuário apenas visualiza e exporta. */
  canManage: boolean;
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
  canManage,
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
  const selectedStatus =
    reports.find((report) => report.date === selectedDate)?.status ?? "review";
  const selectedReport = reports.find((report) => report.date === selectedDate);
  const openIssues = issues.filter((issue) => issue.status !== "resolved");
  const cutoffDate = selectedDate ?? new Date().toLocaleDateString("sv-SE");
  const reportCurve = buildSCurve(project, tasks, entries, cutoffDate);
  // Avanço do dia em pontos percentuais do projeto (não a soma dos % de cada atividade).
  const dayPoints = entriesContribution(reportEntries, tasks);
  const totalAtDate = reportCurve.actualAtCutoff;
  const plannedAtDate = reportCurve.plannedAtCutoff;
  const deviation = totalAtDate - plannedAtDate;
  const leaves = leafTasks(tasks);
  const doneLeaves = leaves.filter((task) => task.progress >= 100).length;
  const lateLeaves = leaves.filter((task) => taskExecutionStatus(task) === "late").length;
  const daysLeft = Math.round((dateValue(project.end) - dateValue(cutoffDate)) / dayMs);
  const fronts = (scope: Task[]) =>
    scope.map((task) => {
      const under = leavesUnder(tasks, task.id);
      const planned = plannedProgressAt(tasks, cutoffDate, under);
      const actual = actualProgressAt(tasks, entries, cutoffDate, under);
      return { task, planned, actual, deviation: actual - planned };
    });
  const stageRows = fronts(tasks.filter((task) => !task.parentId));
  // Frentes do dia: o item imediatamente abaixo da etapa que contém cada atividade lançada.
  const dayFrontIds = [
    ...new Set(
      reportEntries.map((entry) => {
        const path = ancestorsOf(tasks, entry.taskId);
        return (path[1] ?? path[0])?.id ?? entry.taskId;
      }),
    ),
  ];
  const dayFrontRows = fronts(
    tasks.filter((task) => dayFrontIds.includes(task.id) && task.parentId),
  ).slice(0, 8);
  // Mesmo conjunto de fotos = mesma evidência: as atividades aparecem juntas, sem repetir a foto.
  const activityGroups = reportEntries.reduce<JournalEntry[][]>((groups, entry) => {
    const key = entry.photos.map((photo) => photo.storagePath ?? photo.url).sort().join("|");
    const group = key
      ? groups.find((items) => items[0].photos.map((photo) => photo.storagePath ?? photo.url).sort().join("|") === key)
      : undefined;
    if (group) group.push(entry);
    else groups.push([entry]);
    return groups;
  }, []);
  // Fotos únicas do dia (a mesma foto pode valer para várias atividades).
  const photoCount = new Set(reportEntries.flatMap((entry) => entry.photos.map((photo) => photo.storagePath ?? photo.url))).size;
  // Um cartão por foto; cada página impressa leva no máximo 2 linhas × 2 colunas.
  const activityCards = activityGroups.flatMap((group) => {
    const list: (JournalEntry["photos"][number] | null)[] = group[0].photos.length ? group[0].photos : [null];
    return list.map((photo, index) => ({ group, photo, index, total: list.length }));
  });
  const activityPages: (typeof activityCards)[] = [];
  for (let index = 0; index < activityCards.length; index += 4) activityPages.push(activityCards.slice(index, index + 4));
  let sectionCount = 0;
  const nextSection = () => String(++sectionCount).padStart(2, "0");
  // Gantt do relatório: mostra os itens-pai e esconde as atividades de último nível,
  // exceto as que não têm pai.
  const ganttTasks = tasks.filter(
    (task) => !task.parentId || tasks.some((child) => child.parentId === task.id),
  );
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

  /**
   * Gera o PDF num documento à parte (iframe): só o relatório e o Gantt, sem o app em volta.
   * Assim o tema escuro não vaza para a impressão e o Gantt sai em paisagem.
   */
  async function exportPdf() {
    const paper = document.querySelector(".report-paper");
    if (!paper) return;
    const gantt = document.querySelector(".report-gantt-print");
    const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')]
      .map((node) => node.outerHTML)
      .join("");
    const title = `Status Report · ${project.name} · ${(selectedDate ?? "").split("-").reverse().join("-")}`
      .replace(/[<>&"]/g, "");
    const html = `<!doctype html><html lang="pt-BR" data-theme="light" style="color-scheme:light"><head><meta charset="utf-8"><meta name="viewport" content="width=800"><title>${title}</title><base href="${window.location.origin}/">${styles}</head><body class="report-print-document">${paper.outerHTML}${gantt?.outerHTML ?? ""}</body></html>`;
    const ready = async (target: Document) => {
      await Promise.all(
        [...target.images].map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                image.onload = () => resolve();
                image.onerror = () => resolve();
              }),
        ),
      );
      await target.fonts?.ready;
    };
    // No celular o navegador ignora a impressão de iframe e imprime a tela do app (cortando as fotos).
    // Lá o relatório abre numa aba própria, só com o documento, e a impressão sai dessa aba.
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
      const tab = window.open("", "_blank");
      if (tab) {
        tab.document.open();
        tab.document.write(html);
        tab.document.close();
        await ready(tab.document);
        tab.focus();
        tab.print();
        return;
      }
    }
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    if (!doc || !view) { frame.remove(); return; }
    doc.open();
    doc.write(html);
    doc.close();
    await ready(doc);
    const cleanup = () => window.setTimeout(() => frame.remove(), 500);
    view.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(() => frame.isConnected && frame.remove(), 120_000);
    view.focus();
    view.print();
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
        viewBox={`0 0 1000 ${Math.max(27, ganttTasks.length * 27)}`}
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
        {ganttTasks.map((task, targetIndex) => {
          const sourceIndex = ganttTasks.findIndex(
            (item) => item.id === task.dependencyId,
          );
          if (sourceIndex < 0) return null;
          const predecessor = ganttTasks[sourceIndex];
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
          <span>CRONOGRAMA RESUMIDO</span>
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
        {ganttTasks.map((task) => {
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
        <small>
          Visão por etapas e frentes: as atividades de último nível estão
          consolidadas no avanço do item acima.
        </small>
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
          {canManage && (
            <button className="secondary-btn" onClick={() => { setTemplateDraft(activeTemplate); setTemplateOpen(true); }}>
              <Icon name="settings" /> Modelo
            </button>
          )}
          <button
            className="primary-btn"
            disabled={openingDate !== null}
            onClick={() => void openReport(reportDates[0])}
          >
            {openingDate === reportDates[0] ? "Preparando..." : canManage ? "Revisar o mais recente" : "Abrir o mais recente"}{" "}
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
                <div className="report-page-one">
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
                <section className="report-overview">
                <ReportCaption no={nextSection()} title="Visão geral" subtitle={`Como a obra estava em ${selectedDate.split("-").reverse().join("/")}`} />
                <div className="report-hero">
                  <div className="report-hero-ring">
                    <svg viewBox="0 0 120 120" role="img" aria-label={`Realizado ${formatPercent(totalAtDate)}%, planejado ${formatPercent(plannedAtDate)}%`}>
                      <circle className="track" cx="60" cy="60" r="52" />
                      <circle className="actual" cx="60" cy="60" r="52" pathLength={100} strokeDasharray={`${Math.min(100, Math.max(0, totalAtDate))} 100`} transform="rotate(-90 60 60)" />
                      <circle className="track" cx="60" cy="60" r="40" />
                      <circle className="planned" cx="60" cy="60" r="40" pathLength={100} strokeDasharray={`${Math.min(100, Math.max(0, plannedAtDate))} 100`} transform="rotate(-90 60 60)" />
                    </svg>
                    <div>
                      <strong>{formatPercent(totalAtDate)}%</strong>
                      <span>concluído</span>
                    </div>
                  </div>
                  <div className="report-hero-text">
                    <span>AVANÇO NESTE DIA</span>
                    <strong>+{formatPercent(dayPoints)} p.p.</strong>
                    <p>
                      levando a obra a <b>{formatPercent(totalAtDate)}%</b> · planejado <b>{formatPercent(plannedAtDate)}%</b>
                    </p>
                    <em className={deviation < -0.05 ? "late" : "ok"}>
                      <Icon name={deviation < -0.05 ? "alert" : "trend"} />
                      {formatPercent(Math.abs(deviation))} p.p.{" "}
                      {deviation < -0.05 ? "atrás do planejado" : "à frente do planejado"}
                    </em>
                  </div>
                  <div className="report-hero-bars">
                    <span>REALIZADO × PLANEJADO × PRAZO</span>
                    {([
                      ["Realizado", totalAtDate, "actual"],
                      ["Planejado", plannedAtDate, "planned"],
                      ["Prazo consumido", reportCurve.cutoffX * 100, "time"],
                    ] as const).map(([label, value, tone]) => (
                      <div key={label}>
                        <small>{label}</small>
                        <i>
                          <em className={tone} style={{ width: `${Math.min(100, Math.max(1.5, value))}%` }} />
                        </i>
                        <b>{formatPercent(value, tone === "time" ? 0 : 1)}%</b>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="report-stats">
                  <div>
                    <span className="report-stat-icon"><Icon name="journal" /></span>
                    <small>ATIVIDADES NO DIA</small>
                    <strong>{new Set(reportEntries.map((entry) => entry.taskId)).size}</strong>
                    <p>{reportEntries.length} registro{reportEntries.length === 1 ? "" : "s"} no diário</p>
                  </div>
                  <div>
                    <span className="report-stat-icon"><Icon name="camera" /></span>
                    <small>EVIDÊNCIAS</small>
                    <strong>{photoCount}</strong>
                    <p>foto{photoCount === 1 ? "" : "s"} de campo no dia</p>
                  </div>
                  <div>
                    <span className="report-stat-icon good"><Icon name="check" /></span>
                    <small>CONCLUÍDAS</small>
                    <strong>
                      {doneLeaves}
                      <em> de {leaves.length}</em>
                    </strong>
                    <i className="report-stat-bar"><em style={{ width: `${(doneLeaves / Math.max(1, leaves.length)) * 100}%` }} /></i>
                  </div>
                  <div>
                    <span className={lateLeaves ? "report-stat-icon bad" : "report-stat-icon"}><Icon name="clock" /></span>
                    <small>EM ATRASO</small>
                    <strong className={lateLeaves ? "negative" : ""}>{lateLeaves}</strong>
                    <p>atividade{lateLeaves === 1 ? "" : "s"} com prazo vencido</p>
                  </div>
                  <div>
                    <span className={openIssues.length ? "report-stat-icon warn" : "report-stat-icon"}><Icon name="alert" /></span>
                    <small>PONTOS DE ATENÇÃO</small>
                    <strong className={openIssues.length ? "negative" : ""}>{openIssues.length}</strong>
                    <p>em aberto</p>
                  </div>
                  <div>
                    <span className={daysLeft < 0 ? "report-stat-icon bad" : "report-stat-icon"}><Icon name="calendar" /></span>
                    <small>TÉRMINO PREVISTO</small>
                    <strong>{project.end.split("-").reverse().join("/")}</strong>
                    <p>
                      {daysLeft >= 0
                        ? `${daysLeft} dia${daysLeft === 1 ? "" : "s"} restante${daysLeft === 1 ? "" : "s"}`
                        : `${Math.abs(daysLeft)} dias após o prazo`}
                    </p>
                  </div>
                </div>
                </section>
                {activeTemplate.showSummary && <section className="report-executive-summary">
                  <div className="report-section-heading"><ReportCaption no={nextSection()} title="Resumo executivo" />{canManage && <button className="secondary-btn compact no-print" disabled={generatingSummary || !selectedReport} onClick={() => void handleGenerateSummary()}><Icon name="spark"/>{generatingSummary ? " Gerando..." : " Gerar resumo inteligente"}</button>}</div>
                  <p>
                    {selectedReport?.executiveSummary ?? <>Foram realizados {reportEntries.length} registros em{" "}
                    {new Set(reportEntries.map((entry) => entry.taskId)).size}{" "}
                    atividades do cronograma, que somaram{" "}
                    {formatPercent(dayPoints)} ponto{dayPoints === 1 ? "" : "s"}{" "}
                    percentua{dayPoints === 1 ? "l" : "is"} ao projeto,
                    levando o avanço geral a {formatPercent(totalAtDate)}%
                    (planejado: {formatPercent(plannedAtDate)}%).</>}
                  </p>
                </section>}
                {activeTemplate.showSCurve && <section className="report-curve-section">
                  <ReportCaption no={nextSection()} title="Curva S" subtitle="Planejado × realizado acumulado" />
                  <div className="report-curve-chart">
                    <div className="report-curve-axis"><span>100%</span><span>50%</span><span>0%</span></div>
                    <svg viewBox="0 0 600 150" preserveAspectRatio="none" role="img" aria-label="Curva S do projeto"><g><line x1="0" y1="5" x2="600" y2="5"/><line x1="0" y1="75" x2="600" y2="75"/><line x1="0" y1="145" x2="600" y2="145"/></g><polygon className="actual-area" points={`${curvePoints(reportCurve.actual, 600, 150, 5)} ${reportCurve.cutoffX * 600},145 0,145`}/><line className="cutoff" x1={reportCurve.cutoffX * 600} y1="0" x2={reportCurve.cutoffX * 600} y2="150"/><polyline className="planned" points={curvePoints(reportCurve.planned, 600, 150, 5)}/><polyline className="actual" points={curvePoints(reportCurve.actual, 600, 150, 5)}/></svg>
                  </div>
                  <footer><span>{project.start.split("-").reverse().join("/")}</span><b className="planned">Planejado {formatPercent(plannedAtDate)}%</b><b className="actual">Realizado {formatPercent(totalAtDate)}%</b><span>{project.end.split("-").reverse().join("/")}</span></footer>
                </section>}
                <section className="report-fronts">
                  <ReportCaption no={nextSection()} title="Etapas da obra" subtitle="Barra: realizado · traço: onde deveria estar" />
                  <FrontBars rows={stageRows} />
                </section>
                {dayFrontRows.length > 0 && <section className="report-fronts">
                  <ReportCaption no={nextSection()} title="Frentes trabalhadas no dia" />
                  <FrontBars rows={dayFrontRows} />
                </section>}
                {activeTemplate.showAttention && openIssues.length > 0 && <section className="report-attention-section">
                  <ReportCaption no={nextSection()} title="Pontos de atenção" />
                  <div className="report-update-list">
                    {openIssues.slice(0, 3).map((issue) => <article key={issue.id}><span>!</span><div><strong>{issue.title}</strong><small>{issue.category} · {issue.priority}</small><p>{issue.description}</p></div></article>)}
                  </div>
                </section>}
                </div>
                {activeTemplate.showPhotos && activityPages.length > 0 && <section className="report-activities">
                  <ReportCaption no={nextSection()} title="Serviços executados e evidências" subtitle={`${new Set(reportEntries.map((entry) => entry.taskId)).size} atividades · ${photoCount} foto${photoCount === 1 ? "" : "s"}`} />
                  {activityPages.map((page, pageIndex) => (
                    <div className="report-activity-grid" key={pageIndex}>
                      {page.map(({ group, photo, index, total }) => {
                        const first = group[0];
                        const sameText = group.every((entry) => entry.title === first.title && entry.description === first.description);
                        return (
                          <article className="report-activity-card" key={`${first.id}-${index}`}>
                            <header>
                              {group.slice(0, 3).map((entry) => {
                                const task = tasks.find((item) => item.id === entry.taskId);
                                const path = ancestorsOf(tasks, entry.taskId);
                                return (
                                  <div className="report-card-line" key={entry.id}>
                                    <span>{task?.code}</span>
                                    <div>
                                      {path.length > 0 && <small>{path.map((parent) => `${parent.code} ${parent.name}`).join(" › ")}</small>}
                                      <strong>{task?.name ?? entry.title}</strong>
                                      {!sameText && <p>{entry.title}{entry.description ? ` — ${entry.description}` : ""}</p>}
                                    </div>
                                    <b>
                                      {entry.progressBefore}% → {entry.progressAfter}%
                                      <small>+{formatPercent(entryContribution(entry, tasks), 2)} p.p. da obra</small>
                                    </b>
                                  </div>
                                );
                              })}
                              {group.length > 3 && <small className="report-card-more">+{group.length - 3} atividades na mesma evidência</small>}
                              <footer>
                                {sameText && <p><b>{first.title}</b>{first.description ? ` — ${first.description}` : ""}</p>}
                                <small>{first.author} às {first.time}</small>
                              </footer>
                            </header>
                            {photo ? (
                              <figure>
                                <img src={photo.url} alt={`${first.title} · evidência ${index + 1}`} />
                                {total > 1 && <figcaption>{index + 1}/{total}</figcaption>}
                              </figure>
                            ) : (
                              <figure className="empty"><Icon name="camera" /><span>Sem foto neste registro</span></figure>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  ))}
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
                  onClick={() => void exportPdf()}
                >
                  <Icon name="download" /> Exportar PDF
                </button>
                {!canManage && <StatusBadge value={statusLabel(selectedDate)} />}
                {canManage && selectedStatus === "draft" && <button className="primary-btn" disabled={approving} onClick={() => setReviewOpen("review")}><Icon name="share" /> Enviar para revisão</button>}
                {canManage && selectedStatus === "review" && <><button className="secondary-btn" disabled={approving} onClick={() => setReviewOpen("draft")}>Devolver</button><button className="primary-btn" disabled={approving} onClick={() => setReviewOpen("approved")}><Icon name="check" /> Aprovar relatório</button></>}
                {canManage && selectedStatus === "approved" && <button className="primary-btn" disabled={approving} onClick={() => setReviewOpen("sent")}><Icon name="share" /> Marcar como enviado</button>}
                {canManage && selectedStatus === "sent" && <button className="secondary-btn" disabled>Relatório enviado</button>}
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
          <label><span>Tamanho das fotos</span><SearchableSelect value={templateDraft.photoSize} onChange={(event) => setTemplateDraft({ ...templateDraft, photoSize: event.target.value as "medium" | "large" })}><option value="large">Grande — foco na evidência</option><option value="medium">Médio — mais fotos por página</option></SearchableSelect></label>
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

type FrontRow = { task: Task; planned: number; actual: number; deviation: number };

function ReportCaption({ no, title, subtitle }: { no: string; title: string; subtitle?: string }) {
  return (
    <div className="report-caption">
      <span>{no}</span>
      <div>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

/** Barras de etapas/frentes: realizado na data, com um traço onde deveria estar pelo planejado. */
function FrontBars({ rows }: { rows: FrontRow[] }) {
  return (
    <div className="report-front-bars">
      {rows.map(({ task, planned, actual, deviation }) => {
        const tone = deviation < -0.05 ? "late" : actual >= 99.95 ? "done" : "ok";
        return (
          <div className={`report-front-bar ${tone}`} key={task.id}>
            <span>
              <b>{task.code}</b> {task.name}
            </span>
            <i>
              <em style={{ width: `${Math.min(100, actual)}%` }} />
              <u style={{ left: `${Math.min(100, planned)}%` }} />
            </i>
            <strong>{formatPercent(actual)}%</strong>
            <small>
              {deviation >= 0 ? "+" : "−"}
              {formatPercent(Math.abs(deviation))} p.p.
            </small>
          </div>
        );
      })}
    </div>
  );
}
