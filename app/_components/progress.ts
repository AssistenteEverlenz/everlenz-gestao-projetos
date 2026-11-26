import type { JournalEntry, Project, Task } from "./types";

// Avanço físico ponderado do projeto: somente as atividades executáveis (sem filhos)
// entram na conta, cada uma com o seu peso. É a mesma regra do "avanço geral".

const dayMs = 86_400_000;
const dateValue = (value: string) => new Date(`${value}T12:00:00`).getTime();
const toIso = (value: number) => new Date(value).toISOString().slice(0, 10);

export function leafTasks(tasks: Task[]) {
  const parents = new Set(tasks.map((task) => task.parentId).filter(Boolean));
  return tasks.filter((task) => !parents.has(task.id));
}

function totalWeight(leaves: Task[]) {
  return leaves.reduce((sum, task) => sum + task.weight, 0) || 1;
}

/** Quanto um lançamento acrescentou ao projeto inteiro, em pontos percentuais. */
export function entryContribution(entry: JournalEntry, tasks: Task[]) {
  const leaves = leafTasks(tasks);
  const task = leaves.find((item) => item.id === entry.taskId);
  if (!task) return 0;
  return (entry.progressAdded * task.weight) / totalWeight(leaves);
}

/** Soma das contribuições de vários lançamentos, em pontos percentuais do projeto. */
export function entriesContribution(entries: JournalEntry[], tasks: Task[]) {
  const leaves = leafTasks(tasks);
  const weights = new Map(leaves.map((task) => [task.id, task.weight]));
  const total = totalWeight(leaves);
  return entries.reduce(
    (sum, entry) =>
      sum + (entry.progressAdded * (weights.get(entry.taskId) ?? 0)) / total,
    0,
  );
}

/**
 * Avanço real do projeto ao fim de um dia: parte do avanço atual de cada atividade
 * e desconta o que foi lançado depois daquela data.
 */
export function actualProgressAt(
  tasks: Task[],
  entries: JournalEntry[],
  isoDate: string,
  scope?: Task[],
) {
  const leaves = scope ?? leafTasks(tasks);
  const later = new Map<string, number>();
  for (const entry of entries)
    if (entry.date > isoDate)
      later.set(entry.taskId, (later.get(entry.taskId) ?? 0) + entry.progressAdded);
  return (
    leaves.reduce(
      (sum, task) =>
        sum +
        task.weight *
          Math.min(100, Math.max(0, task.progress - (later.get(task.id) ?? 0))),
      0,
    ) / totalWeight(leaves)
  );
}

/** Avanço planejado ao fim de um dia, distribuído linearmente no período de cada atividade. */
export function plannedProgressAt(tasks: Task[], isoDate: string, scope?: Task[]) {
  const leaves = scope ?? leafTasks(tasks);
  const sample = dateValue(isoDate);
  return (
    leaves.reduce((sum, task) => {
      const start = dateValue(task.plannedStart);
      const end = dateValue(task.plannedEnd) + dayMs;
      const fraction =
        sample + dayMs / 2 < start
          ? 0
          : sample + dayMs / 2 >= end
            ? 1
            : (sample + dayMs / 2 - start) / Math.max(dayMs, end - start);
      return sum + task.weight * fraction * 100;
    }, 0) / totalWeight(leaves)
  );
}

/** Atividades executáveis debaixo de um item (ou ele mesmo, se não tiver filhos). */
export function leavesUnder(tasks: Task[], taskId: string) {
  const children = new Map<string, Task[]>();
  for (const task of tasks)
    if (task.parentId)
      children.set(task.parentId, [...(children.get(task.parentId) ?? []), task]);
  const result: Task[] = [];
  const visit = (task: Task) => {
    const kids = children.get(task.id);
    if (!kids?.length) result.push(task);
    else kids.forEach(visit);
  };
  const root = tasks.find((task) => task.id === taskId);
  if (root) visit(root);
  return result;
}

/** Itens acima da atividade, do mais alto (pai) até o imediatamente superior. */
export function ancestorsOf(tasks: Task[], taskId: string) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const path: Task[] = [];
  let parentId = byId.get(taskId)?.parentId;
  while (parentId && !path.some((task) => task.id === parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    path.unshift(parent);
    parentId = parent.parentId;
  }
  return path;
}

export type CurvePoint = { x: number; value: number };

/**
 * Curva S planejado × realizado. As posições x vão de 0 a 1 ao longo do período do projeto.
 * O realizado termina na data de corte (hoje ou a data do relatório) e sempre inclui esse ponto.
 */
export function buildSCurve(
  project: Project,
  tasks: Task[],
  entries: JournalEntry[],
  cutoffIso: string,
  samples = 30,
) {
  const start = dateValue(project.start);
  const end = Math.max(start + dayMs, dateValue(project.end));
  const span = end - start;
  const cutoff = Math.min(end, Math.max(start, dateValue(cutoffIso)));
  const leaves = leafTasks(tasks);
  const times = Array.from({ length: samples }, (_, index) => start + (span * index) / (samples - 1));
  const planned: CurvePoint[] = times.map((time) => ({
    x: (time - start) / span,
    value: plannedProgressAt(tasks, toIso(time), leaves),
  }));
  const actualTimes = [...times.filter((time) => time < cutoff), cutoff];
  const actual: CurvePoint[] = actualTimes.map((time) => ({
    x: (time - start) / span,
    value: actualProgressAt(tasks, entries, toIso(time), leaves),
  }));
  return {
    planned,
    actual,
    plannedAtCutoff: plannedProgressAt(tasks, toIso(cutoff), leaves),
    actualAtCutoff: actual[actual.length - 1]?.value ?? 0,
    cutoffX: (cutoff - start) / span,
  };
}

/** Pontos de uma polyline SVG a partir da curva. */
export function curvePoints(points: CurvePoint[], width: number, height: number, pad = 0) {
  return points
    .map((point) => `${(point.x * width).toFixed(1)},${(height - pad - (point.value / 100) * (height - pad * 2)).toFixed(1)}`)
    .join(" ");
}

/** Percentual com uma casa decimal no padrão brasileiro (ex.: 3,2). */
export function formatPercent(value: number, digits = 1) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
