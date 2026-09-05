"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { EntryHistoryModal } from "../entry-history";
import { Icon } from "../icons";
import {
  ancestorIds,
  normalizeTaskHierarchy,
  taskExecutionStatus,
  taskStatusPalette,
  type TaskExecutionStatus,
} from "../task-structure";
import type {
  DependencyType,
  JournalEntry,
  Member,
  Project,
  ProjectTeam,
  Task,
  TaskResponsibleKind,
  ViewId,
} from "../types";
import { Modal } from "../ui";
import {
  nextWorkingDay,
  projectWorkDays,
  shiftWorkingDays,
  workingDuration,
  workingEnd,
} from "../work-calendar";

type Props = {
  project: Project;
  tasks: Task[];
  entries: JournalEntry[];
  members: Member[];
  projectTeams?: ProjectTeam[];
  navigate: (view: ViewId) => void;
  metrics: { overall: number; active: number };
  addTask: (task: Task) => Promise<void>;
  editTask: (task: Task) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  editEntry: (entry: JournalEntry) => Promise<void>;
  deleteEntry: (entry: JournalEntry) => Promise<void>;
  reorderTasks: (tasks: Task[]) => Promise<void>;
  updateTaskProgress: (id: string, progress: number) => Promise<void>;
  updateProjectWorkDays: (workDays: number[]) => Promise<void>;
  setToast: (value: string) => void;
};

const dayMs = 86_400_000;
const toDate = (value: string) => new Date(`${value}T12:00:00`);
const daysBetween = (start: string, end: string) =>
  Math.max(
    0,
    Math.round((toDate(end).getTime() - toDate(start).getTime()) / dayMs),
  );
const duration = (task: Task) =>
  Math.max(1, daysBetween(task.plannedStart, task.plannedEnd) + 1);
const formatDate = (value: string) =>
  toDate(value)
    .toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .replace(" de ", " ");
const dependencyLabels: Record<DependencyType, string> = {
  FS: "Término → Início (FS)",
  SS: "Início → Início (SS)",
  FF: "Término → Término (FF)",
  SF: "Início → Término (SF)",
};

type RoutePoint = { x: number; y: number };

function roundedOrthogonalPath(points: RoutePoint[], radius = 4) {
  const route = points.filter(
    (point, index) =>
      index === 0 ||
      point.x !== points[index - 1].x ||
      point.y !== points[index - 1].y,
  );
  if (route.length < 2) return "";

  let path = `M ${route[0].x} ${route[0].y}`;
  for (let index = 1; index < route.length - 1; index += 1) {
    const previous = route[index - 1];
    const corner = route[index];
    const next = route[index + 1];
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
    const curve = Math.min(radius, incoming / 2, outgoing / 2);
    const before = {
      x: corner.x + ((previous.x - corner.x) / incoming) * curve,
      y: corner.y + ((previous.y - corner.y) / incoming) * curve,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / outgoing) * curve,
      y: corner.y + ((next.y - corner.y) / outgoing) * curve,
    };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = route[route.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

export function Schedule({
  project,
  tasks,
  entries,
  members,
  projectTeams = [],
  metrics,
  addTask,
  editTask,
  deleteTask,
  editEntry,
  deleteEntry,
  reorderTasks,
  updateTaskProgress,
  updateProjectWorkDays,
  setToast,
}: Props) {
  const [selected, setSelected] = useState<Task | null>(() => {
    if (typeof window === "undefined") return null;
    const taskId = window.sessionStorage.getItem("emdia-focus-task");
    if (!taskId) return null;
    window.sessionStorage.removeItem("emdia-focus-task");
    return tasks.find((item) => item.id === taskId) ?? null;
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingTask, setDeletingTask] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [taskPanelWidth, setTaskPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 790;
    const stored = Number(window.localStorage.getItem("emdia-gantt-table-width"));
    const maximum = Math.max(650, Math.min(1100, window.innerWidth - 300));
    const preferred =
      stored >= 650 && stored <= 1100
        ? stored
        : window.innerWidth <= 1250
          ? 700
          : 790;
    return Math.min(preferred, maximum);
  });
  const [editing, setEditing] = useState(false);
  const [historyTask, setHistoryTask] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const zoomLevels = ["Visão geral", "Semanas", "Dias"] as const;
  const [zoom, setZoom] = useState<(typeof zoomLevels)[number]>("Visão geral");
  const [mobileView, setMobileView] = useState<"execution" | "timeline">(
    "execution",
  );
  const [mobileFullGantt, setMobileFullGantt] = useState(false);
  const [showMobileTaskTable, setShowMobileTaskTable] = useState(true);
  const [showBaseline, setShowBaseline] = useState(true);
  const [filterCritical, setFilterCritical] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | TaskExecutionStatus>(
    "all",
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<{
    targetId: string;
    asChild: boolean;
  } | null>(null);
  const suppressTaskClick = useRef(false);
  const ganttDesktopRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const timelinePan = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    pageY: number;
    moved: boolean;
  } | null>(null);
  const columnResize = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const taskRowGesture = useRef<{
    taskId: string;
    pointerId: number;
    startX: number;
    startY: number;
    activated: boolean;
    timer: number;
  } | null>(null);
  const orderedTasks = useMemo(() => normalizeTaskHierarchy(tasks), [tasks]);
  const statusCounts = useMemo(
    () =>
      orderedTasks.reduce(
        (counts, task) => ({
          ...counts,
          [taskExecutionStatus(task)]: counts[taskExecutionStatus(task)] + 1,
        }),
        { waiting: 0, active: 0, done: 0, late: 0 } as Record<
          TaskExecutionStatus,
          number
        >,
      ),
    [orderedTasks],
  );
  const visible = useMemo(() => {
    const matches = orderedTasks
      .filter((task) => !filterCritical || task.critical)
      .filter(
        (task) =>
          !hideCompleted ||
          statusFilter === "done" ||
          taskExecutionStatus(task) !== "done",
      )
      .filter(
        (task) =>
          statusFilter === "all" || taskExecutionStatus(task) === statusFilter,
      );
    const matchIds = new Set(matches.map((task) => task.id));
    const ancestors = ancestorIds(orderedTasks, matchIds);
    const requiredIds = new Set([...matchIds, ...ancestors]);
    const filtering = filterCritical || hideCompleted || statusFilter !== "all";
    return orderedTasks.filter((task) => {
      if (filtering && !requiredIds.has(task.id)) return false;
      let parentId = task.parentId;
      while (parentId) {
        if (
          collapsedIds.has(parentId) &&
          !(filtering && ancestors.has(parentId))
        )
          return false;
        parentId = orderedTasks.find((item) => item.id === parentId)?.parentId;
      }
      return true;
    });
  }, [collapsedIds, filterCritical, hideCompleted, orderedTasks, statusFilter]);
  const timelineStart = tasks.reduce((value, task) => {
    const earliest =
      task.baselineStart && task.baselineStart < task.plannedStart
        ? task.baselineStart
        : task.plannedStart;
    return earliest < value ? earliest : value;
  }, project.start);
  const timelineEnd = tasks.reduce((value, task) => {
    const latest =
      task.baselineEnd && task.baselineEnd > task.plannedEnd
        ? task.baselineEnd
        : task.plannedEnd;
    return latest > value ? latest : value;
  }, project.end);
  const projectDays = Math.max(1, daysBetween(timelineStart, timelineEnd) + 1);
  const planned = useMemo(() => {
    const measurable = tasks.filter(
      (task) => !tasks.some((child) => child.parentId === task.id),
    );
    const today = new Date();
    const weighted = measurable.reduce((sum, task) => {
      const start = toDate(task.plannedStart);
      const end = toDate(task.plannedEnd);
      const expected =
        today < start
          ? 0
          : today >= end
            ? 100
            : Math.round(
                ((today.getTime() - start.getTime()) /
                  Math.max(dayMs, end.getTime() - start.getTime())) *
                  100,
              );
      return sum + expected * task.weight;
    }, 0);
    const weight = measurable.reduce((sum, task) => sum + task.weight, 0);
    return weight ? Math.round(weighted / weight) : 0;
  }, [tasks]);
  const timelineLabels = (() => {
    const shortDate = (date: Date) =>
      date
        .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
        .toUpperCase()
        .replace(" DE ", " ");
    const dateAt = (offset: number) => {
      const date = toDate(timelineStart);
      date.setDate(date.getDate() + offset);
      return date;
    };

    if (zoom === "Dias") {
      return Array.from({ length: projectDays }, (_, index) =>
        shortDate(dateAt(index)),
      );
    }
    if (zoom === "Semanas") {
      return Array.from({ length: Math.ceil(projectDays / 7) }, (_, index) => {
        const startOffset = index * 7;
        const endOffset = Math.min(projectDays - 1, startOffset + 6);
        return `${shortDate(dateAt(startOffset))} – ${shortDate(dateAt(endOffset))}`;
      });
    }

    const sections = Math.min(8, projectDays);
    return Array.from({ length: sections }, (_, index) =>
      shortDate(dateAt(Math.floor((index * projectDays) / sections))),
    );
  })();
  const timelineWidth =
    zoom === "Dias"
      ? projectDays * 44
      : zoom === "Semanas"
        ? Math.ceil(projectDays / 7) * 132
        : undefined;
  const zoomIndex = zoomLevels.indexOf(zoom);

  useEffect(() => {
    if (!mobileFullGantt) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileFullGantt]);

  function barStyle(task: Task, baseline = false) {
    const startValue = baseline ? task.baselineStart : task.plannedStart;
    const endValue = baseline ? task.baselineEnd : task.plannedEnd;
    if (!startValue || !endValue) return { display: "none" };
    return {
      left: `${Math.min(99, (daysBetween(timelineStart, startValue) / projectDays) * 100)}%`,
      width: `${Math.max(0.8, ((daysBetween(startValue, endValue) + 1) / projectDays) * 100)}%`,
    };
  }
  function taskDepth(task: Task) {
    let depth = 0;
    let parentId = task.parentId;
    while (parentId && depth < 12) {
      depth += 1;
      parentId = orderedTasks.find((item) => item.id === parentId)?.parentId;
    }
    return depth;
  }
  function descendantIds(taskId: string) {
    const found = new Set<string>();
    const visit = (parentId: string) =>
      orderedTasks
        .filter((task) => task.parentId === parentId)
        .forEach((task) => {
          found.add(task.id);
          visit(task.id);
        });
    visit(taskId);
    return found;
  }
  function toggleCollapsed(taskId: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }
  function updateDropIntent(
    event: ReactDragEvent<HTMLElement>,
    targetId: string,
  ) {
    event.preventDefault();
    if (
      !draggingId ||
      draggingId === targetId ||
      descendantIds(draggingId).has(targetId)
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropIntent({
      targetId,
      asChild: event.clientX > bounds.left + Math.min(150, bounds.width * 0.34),
    });
  }
  async function applyReorder(
    target: Task,
    childIntent?: boolean,
    draggedIdOverride?: string,
  ) {
    const activeDraggedId = draggedIdOverride ?? draggingId;
    const dragged = orderedTasks.find((task) => task.id === activeDraggedId);
    if (
      !dragged ||
      dragged.id === target.id ||
      descendantIds(dragged.id).has(target.id)
    )
      return resetDrag();
    const movingIds = new Set([dragged.id, ...descendantIds(dragged.id)]);
    const moving = orderedTasks.filter((task) => movingIds.has(task.id));
    const remaining = orderedTasks.filter((task) => !movingIds.has(task.id));
    const asChild =
      childIntent ?? (dropIntent?.targetId === target.id && dropIntent.asChild);
    const targetTree = descendantIds(target.id);
    const targetIndex = remaining.findIndex((task) => task.id === target.id);
    const targetEnd = asChild
      ? targetIndex
      : remaining.reduce(
          (last, task, index) => (targetTree.has(task.id) ? index : last),
          targetIndex,
        );
    const normalizedMoving = moving.map((task) =>
      task.id === dragged.id
        ? { ...task, parentId: asChild ? target.id : undefined }
        : task,
    );
    remaining.splice(targetEnd + 1, 0, ...normalizedMoving);
    resetDrag();
    try {
      await reorderTasks(normalizeTaskHierarchy(remaining));
    } catch (cause) {
      setToast(
        cause instanceof Error
          ? cause.message
          : "Não foi possível reorganizar o Gantt.",
      );
    }
  }
  async function applyDrop(event: ReactDragEvent<HTMLElement>, target: Task) {
    event.preventDefault();
    await applyReorder(target);
  }
  function pointerTarget(event: ReactPointerEvent<HTMLElement>) {
    return (
      (
        document.elementFromPoint(
          event.clientX,
          event.clientY,
        ) as HTMLElement | null
      )?.closest<HTMLElement>("[data-task-id]") ?? null
    );
  }
  function updatePointerDrop(
    event: ReactPointerEvent<HTMLElement>,
    activeDraggedId: string,
  ) {
    const row = pointerTarget(event);
    const targetId = row?.dataset.taskId;
    if (
      !row ||
      !targetId ||
      targetId === activeDraggedId ||
      descendantIds(activeDraggedId).has(targetId)
    )
      return;
    const bounds = row.getBoundingClientRect();
    setDropIntent({
      targetId,
      asChild: event.clientX > bounds.left + Math.min(150, bounds.width * 0.34),
    });
  }
  function beginPointerDrag(
    event: ReactPointerEvent<HTMLElement>,
    taskId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    suppressTaskClick.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(taskId);
  }
  function movePointerDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!draggingId) return;
    updatePointerDrop(event, draggingId);
  }
  function endPointerDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!draggingId) return;
    const row = pointerTarget(event);
    const target = orderedTasks.find((task) => task.id === row?.dataset.taskId);
    if (target && row) {
      const bounds = row.getBoundingClientRect();
      void applyReorder(
        target,
        event.clientX > bounds.left + Math.min(150, bounds.width * 0.34),
      );
    } else resetDrag();
    window.setTimeout(() => {
      suppressTaskClick.current = false;
    }, 0);
  }
  function resetDrag() {
    setDraggingId(null);
    setDropIntent(null);
  }
  function beginTaskRowGesture(
    event: ReactPointerEvent<HTMLButtonElement>,
    taskId: string,
  ) {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest(".drag-grip,.tree-toggle")
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const gesture = {
      taskId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      activated: false,
      timer: window.setTimeout(() => {
        const active = taskRowGesture.current;
        if (!active || active.pointerId !== event.pointerId) return;
        active.activated = true;
        suppressTaskClick.current = true;
        setDraggingId(active.taskId);
      }, 360),
    };
    taskRowGesture.current = gesture;
  }
  function moveTaskRowGesture(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = taskRowGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (
      !gesture.activated &&
      Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
      ) >= 6
    ) {
      window.clearTimeout(gesture.timer);
      gesture.activated = true;
      suppressTaskClick.current = true;
      setDraggingId(gesture.taskId);
    }
    if (!gesture.activated) return;
    event.preventDefault();
    updatePointerDrop(event, gesture.taskId);
  }
  function endTaskRowGesture(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = taskRowGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    window.clearTimeout(gesture.timer);
    taskRowGesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!gesture.activated) return;
    const row = pointerTarget(event);
    const target = orderedTasks.find((task) => task.id === row?.dataset.taskId);
    if (target && row) {
      const bounds = row.getBoundingClientRect();
      void applyReorder(
        target,
        event.clientX > bounds.left + Math.min(150, bounds.width * 0.34),
        gesture.taskId,
      );
    } else resetDrag();
    window.setTimeout(() => {
      suppressTaskClick.current = false;
    }, 0);
  }
  function openTaskFromTable(event: React.MouseEvent<HTMLElement>, task: Task) {
    if (
      suppressTaskClick.current ||
      (event.target as HTMLElement).closest(".drag-grip,.tree-toggle")
    )
      return;
    setSelected(task);
  }
  function beginTimelinePan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const timeline = timelineScrollRef.current;
    const desktop = ganttDesktopRef.current;
    if (!timeline || !desktop) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    timelinePan.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: timeline.scrollLeft,
      scrollTop: desktop.scrollTop,
      pageY: window.scrollY,
      moved: false,
    };
  }
  function moveTimelinePan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = timelinePan.current;
    const timeline = timelineScrollRef.current;
    const desktop = ganttDesktopRef.current;
    if (!pan || pan.pointerId !== event.pointerId || !timeline || !desktop)
      return;
    const deltaX = event.clientX - pan.startX;
    const deltaY = event.clientY - pan.startY;
    if (!pan.moved && Math.hypot(deltaX, deltaY) < 4) return;
    pan.moved = true;
    event.preventDefault();
    timeline.scrollLeft = pan.scrollLeft - deltaX;
    if (desktop.scrollHeight > desktop.clientHeight + 1)
      desktop.scrollTop = pan.scrollTop - deltaY;
    else window.scrollTo({ top: pan.pageY - deltaY });
  }
  function endTimelinePan(event: ReactPointerEvent<HTMLDivElement>) {
    if (timelinePan.current?.pointerId !== event.pointerId) return;
    timelinePan.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function resizeTaskPanel(nextWidth: number) {
    const desktopWidth = ganttDesktopRef.current?.clientWidth ?? 1320;
    const maximum = Math.max(650, Math.min(1100, desktopWidth - 240));
    const width = Math.round(Math.max(650, Math.min(maximum, nextWidth)));
    setTaskPanelWidth(width);
    window.localStorage.setItem("emdia-gantt-table-width", String(width));
  }
  function beginColumnResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    columnResize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: taskPanelWidth,
    };
  }
  function moveColumnResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = columnResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    resizeTaskPanel(resize.startWidth + event.clientX - resize.startX);
  }
  function endColumnResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (columnResize.current?.pointerId !== event.pointerId) return;
    columnResize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  if (!tasks.length)
    return (
      <div className="view-stack schedule-view">
        <section className="empty-schedule glass">
          <span className="empty-workspace-icon">
            <Icon name="gantt" />
          </span>
          <span className="overline">CRONOGRAMA EM BRANCO</span>
          <h2>Monte a estrutura da obra</h2>
          <p>
            Comece pelas etapas principais e depois adicione subitens,
            responsáveis, datas, dependências e pesos. O Diário de Obra será
            liberado assim que houver uma atividade executável.
          </p>
          <div className="gantt-feature-grid">
            <span>
              <Icon name="calendar" />
              <b>Datas e linha de base</b>
            </span>
            <span>
              <Icon name="team" />
              <b>Responsáveis</b>
            </span>
            <span>
              <Icon name="trend" />
              <b>Pesos e progresso</b>
            </span>
            <span>
              <Icon name="gantt" />
              <b>Pais e dependências</b>
            </span>
          </div>
          <button className="primary-btn" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Criar primeira atividade
          </button>
        </section>
        {creating && (
          <TaskForm
            project={project}
            tasks={tasks}
            members={members}
            projectTeams={projectTeams}
            onClose={() => setCreating(false)}
            onSave={async (task) => {
              await addTask(task);
              setCreating(false);
            }}
          />
        )}
      </div>
    );

  return (
    <div className="view-stack schedule-view">
      <section className="schedule-toolbar glass">
        <div className="toolbar-group">
          <button
            className="primary-btn compact"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" /> Nova atividade
          </button>
          <button
            className="secondary-btn compact"
            onClick={() => setCalendarOpen(true)}
          >
            <Icon name="calendar" /> Dias de trabalho
          </button>
        </div>
        <div className="toolbar-group center">
          <button
            className={filterCritical ? "toggle-chip active" : "toggle-chip"}
            onClick={() => setFilterCritical((value) => !value)}
          >
            <span className="critical-dot" /> Caminho crítico
          </button>
          <label className="switch-label">
            <input
              type="checkbox"
              checked={showBaseline}
              onChange={(event) => setShowBaseline(event.target.checked)}
            />
            <span /> Linha de base
          </label>
        </div>
        <div className="gantt-zoom-control" aria-label="Zoom do cronograma">
          <button
            type="button"
            disabled={zoomIndex === 0}
            onClick={() => setZoom(zoomLevels[Math.max(0, zoomIndex - 1)])}
            aria-label="Diminuir zoom"
          >
            −
          </button>
          <span>
            <small>ZOOM</small>
            <strong>{zoom}</strong>
          </span>
          <button
            type="button"
            disabled={zoomIndex === zoomLevels.length - 1}
            onClick={() =>
              setZoom(
                zoomLevels[Math.min(zoomLevels.length - 1, zoomIndex + 1)],
              )
            }
            aria-label="Aumentar zoom"
          >
            +
          </button>
        </div>
        <div className="gantt-quick-filters">
          <button
            className={statusFilter === "all" ? "active" : ""}
            onClick={() => setStatusFilter("all")}
          >
            Todas <b>{orderedTasks.length}</b>
          </button>
          <button
            className={statusFilter === "active" ? "active" : ""}
            onClick={() => setStatusFilter("active")}
          >
            Em andamento <b>{statusCounts.active}</b>
          </button>
          <button
            className={statusFilter === "waiting" ? "active" : ""}
            onClick={() => setStatusFilter("waiting")}
          >
            Não iniciadas <b>{statusCounts.waiting}</b>
          </button>
          <button
            className={statusFilter === "late" ? "active" : ""}
            onClick={() => setStatusFilter("late")}
          >
            Em atraso <b>{statusCounts.late}</b>
          </button>
          <button
            className={statusFilter === "done" ? "active" : ""}
            onClick={() => setStatusFilter("done")}
          >
            Concluídas <b>{statusCounts.done}</b>
          </button>
          <label className="switch-label hide-completed">
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={(event) => setHideCompleted(event.target.checked)}
            />
            <span /> Ocultar concluídas
          </label>
        </div>
      </section>

      <section
        className={`gantt-shell glass ${mobileFullGantt ? "mobile-gantt-fullscreen" : ""} ${showMobileTaskTable ? "" : "mobile-task-table-hidden"}`}
      >
        {mobileFullGantt && (
          <header className="mobile-gantt-stage-header">
            <div>
              <small>CRONOGRAMA COMPLETO</small>
              <strong>{project.name}</strong>
            </div>
            <div
              className="mobile-gantt-zoom"
              aria-label={`Zoom atual: ${zoom}`}
            >
              <button
                disabled={zoomIndex === 0}
                onClick={() => setZoom(zoomLevels[Math.max(0, zoomIndex - 1)])}
                aria-label="Diminuir zoom"
              >
                −
              </button>
              <span>{zoom}</span>
              <button
                disabled={zoomIndex === zoomLevels.length - 1}
                onClick={() =>
                  setZoom(
                    zoomLevels[Math.min(zoomLevels.length - 1, zoomIndex + 1)],
                  )
                }
                aria-label="Aumentar zoom"
              >
                +
              </button>
            </div>
            <button
              className="secondary-btn compact mobile-task-panel-toggle"
              onClick={() => setShowMobileTaskTable((value) => !value)}
              aria-label={
                showMobileTaskTable
                  ? "Ocultar tabela de atividades"
                  : "Mostrar tabela de atividades"
              }
            >
              <Icon name="menu" />
              {showMobileTaskTable
                ? "Ocultar atividades"
                : "Mostrar atividades"}
            </button>
            <button
              className="icon-btn"
              onClick={() => setMobileFullGantt(false)}
              aria-label="Fechar Gantt completo"
            >
              <Icon name="close" />
            </button>
          </header>
        )}
        <div className="gantt-summary">
          <div>
            <span>AVANÇO REAL</span>
            <strong>{metrics.overall}%</strong>
          </div>
          <div>
            <span>PLANEJADO</span>
            <strong>{planned}%</strong>
          </div>
          <div>
            <span>DESVIO</span>
            <strong className={metrics.overall < planned ? "danger" : ""}>
              {metrics.overall - planned > 0 ? "+" : ""}
              {metrics.overall - planned} p.p.
            </strong>
          </div>
          <div>
            <span>TÉRMINO PREVISTO</span>
            <strong>{formatDate(timelineEnd)}</strong>
          </div>
          <div>
            <span>CAMINHO CRÍTICO</span>
            <strong className="danger">
              {tasks.filter((task) => task.critical).length} atividades
            </strong>
          </div>
        </div>
        <div
          className="gantt-desktop"
          ref={ganttDesktopRef}
          style={{ "--gantt-table-width": `${taskPanelWidth}px` } as CSSProperties}
        >
          <div className="gantt-task-panel">
            <div className="task-table-head">
              <span>EAP</span>
              <span>ATIVIDADE</span>
              <span>DURAÇÃO</span>
              <span>PROGRESSO</span>
              <span>INÍCIO</span>
              <span>TÉRMINO</span>
              <span>STATUS</span>
            </div>
            {visible.map((task) => {
              const childCount = orderedTasks.filter(
                (item) => item.parentId === task.id,
              ).length;
              const status = taskExecutionStatus(task);
              const palette = taskStatusPalette[status];
              return (
                <div
                  data-task-id={task.id}
                  className={`gantt-task-line status-${status} ${childCount ? "is-parent" : ""} ${collapsedIds.has(task.id) ? "is-collapsed" : ""} ${task.critical ? "critical" : ""} ${draggingId === task.id ? "is-dragging" : ""} ${dropIntent?.targetId === task.id ? (dropIntent.asChild ? "drop-as-child" : "drop-as-root") : ""}`}
                  key={task.id}
                >
                  <button
                    className="task-row"
                    onPointerDown={(event) =>
                      beginTaskRowGesture(event, task.id)
                    }
                    onPointerMove={moveTaskRowGesture}
                    onPointerUp={endTaskRowGesture}
                    onPointerCancel={endTaskRowGesture}
                    onClick={(event) => openTaskFromTable(event, task)}
                  >
                    <span className="task-eap-cell">
                      <span
                        className="drag-grip"
                        role="button"
                        aria-label={`Reorganizar ${task.name}`}
                        onPointerDown={(event) =>
                          beginPointerDrag(event, task.id)
                        }
                        onPointerMove={movePointerDrag}
                        onPointerUp={endPointerDrag}
                      >
                        ••
                      </span>
                      <b>{task.code}</b>
                      {childCount > 0 && (
                        <span
                          className={`tree-toggle ${collapsedIds.has(task.id) ? "collapsed" : "expanded"}`}
                          role="button"
                          aria-label={
                            collapsedIds.has(task.id)
                              ? "Expandir subitens"
                              : "Ocultar subitens"
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleCollapsed(task.id);
                          }}
                        >
                          <Icon name="chevron" />
                        </span>
                      )}
                    </span>
                    <span
                      className="task-name-cell"
                      style={
                        {
                          "--task-indent": `${taskDepth(task) * 18}px`,
                        } as CSSProperties
                      }
                    >
                      <strong>{task.name}</strong>
                      <small>
                        {task.responsible || "Sem responsável"}
                        {entries.filter((entry) => entry.taskId === task.id)
                          .length > 0 && (
                          <em className="task-journal-count">
                            <Icon name="journal" />{" "}
                            {
                              entries.filter(
                                (entry) => entry.taskId === task.id,
                              ).length
                            }
                          </em>
                        )}
                      </small>
                    </span>
                    <span>
                      {task.milestone
                        ? "Marco"
                        : `${workingDuration(task.plannedStart, task.plannedEnd, project.workDays)}d`}
                    </span>
                    <span className="task-progress-cell">
                      <i>
                        <b
                          style={{
                            width: `${task.progress}%`,
                            background: palette.progress,
                          }}
                        />
                        <strong>{task.progress}%</strong>
                      </i>
                    </span>
                    <span className="task-date-cell">
                      {formatDate(task.plannedStart)}
                    </span>
                    <span className="task-date-cell">
                      {formatDate(task.plannedEnd)}
                    </span>
                    <span
                      className="task-status-cell"
                      title={palette.label}
                      aria-label={palette.label}
                    >
                      <i
                        style={{
                          background: palette.period,
                          color: palette.period,
                        }}
                      />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="gantt-column-resizer"
            role="separator"
            aria-label="Ajustar largura da tabela de atividades"
            aria-orientation="vertical"
            aria-valuemin={650}
            aria-valuemax={1100}
            aria-valuenow={taskPanelWidth}
            title="Arraste para aumentar ou diminuir a tabela"
            onPointerDown={beginColumnResize}
            onPointerMove={moveColumnResize}
            onPointerUp={endColumnResize}
            onPointerCancel={endColumnResize}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const next = taskPanelWidth + (event.key === "ArrowRight" ? 24 : -24);
              resizeTaskPanel(next);
            }}
          >
            <span />
          </button>
          <div
            className="gantt-timeline-scroll"
            ref={timelineScrollRef}
            onPointerDown={beginTimelinePan}
            onPointerMove={moveTimelinePan}
            onPointerUp={endTimelinePan}
            onPointerCancel={endTimelinePan}
          >
            <div
              className={`gantt-timeline-canvas zoom-${zoom === "Visão geral" ? "overview" : zoom.toLowerCase()}`}
              style={
                {
                  width: timelineWidth ? `${timelineWidth}px` : "100%",
                  minWidth: "100%",
                  "--timeline-columns": timelineLabels.length,
                } as CSSProperties
              }
            >
              <div className="timeline-head">
                {timelineLabels.map((label, index) => (
                  <span key={`${label}-${index}`}>{label}</span>
                ))}
              </div>
              <div className="gantt-timeline-body">
                <svg
                  className="gantt-dependency-layer"
                  viewBox={`0 0 1000 ${Math.max(56, visible.length * 56)}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="dependency-arrow"
                      markerWidth="7"
                      markerHeight="7"
                      refX="6"
                      refY="3.5"
                      orient="auto"
                    >
                      <path d="M0,0 L7,3.5 L0,7 Z" />
                    </marker>
                  </defs>
                  {visible.map((task, targetIndex) => {
                    const sourceIndex = visible.findIndex(
                      (item) => item.id === task.dependencyId,
                    );
                    if (sourceIndex < 0) return null;
                    const predecessor = visible[sourceIndex];
                    const relation = task.dependencyType ?? "FS";
                    const sourceUsesFinish =
                      relation === "FS" || relation === "FF";
                    const targetUsesFinish =
                      relation === "FF" || relation === "SF";
                    const sourceDate = sourceUsesFinish
                      ? predecessor.plannedEnd
                      : predecessor.plannedStart;
                    const targetDate = targetUsesFinish
                      ? task.plannedEnd
                      : task.plannedStart;
                    const dateX = (value: string, finish: boolean) =>
                      Math.max(
                        3,
                        Math.min(
                          997,
                          ((daysBetween(timelineStart, value) +
                            (finish ? 1 : 0)) /
                            projectDays) *
                            1000,
                        ),
                      );
                    const sourceX = dateX(sourceDate, sourceUsesFinish);
                    const targetX = dateX(targetDate, targetUsesFinish);
                    const sourceY = sourceIndex * 56 + 28;
                    const targetY = targetIndex * 56 + 28;
                    const rowDirection = targetY >= sourceY ? 1 : -1;
                    const dependencyIndex =
                      visible
                        .slice(0, targetIndex + 1)
                        .filter((candidate) =>
                          visible.some(
                            (source) => source.id === candidate.dependencyId,
                          ),
                        ).length - 1;
                    const laneOffset = Math.max(0, dependencyIndex % 8) * 4;
                    const sourceExitX = Math.max(
                      4,
                      Math.min(
                        996,
                        sourceX +
                          (sourceUsesFinish
                            ? 10 + laneOffset
                            : -10 - laneOffset),
                      ),
                    );
                    const targetApproachX = Math.max(
                      3,
                      Math.min(997, targetX + (targetUsesFinish ? 7 : -7)),
                    );
                    const approachY =
                      targetY -
                      rowDirection *
                        (12 + Math.max(0, dependencyIndex % 4) * 3);
                    const dependencyPath = roundedOrthogonalPath(
                      [
                        { x: sourceX, y: sourceY },
                        { x: sourceExitX, y: sourceY },
                        { x: sourceExitX, y: approachY },
                        { x: targetApproachX, y: approachY },
                        { x: targetApproachX, y: targetY },
                        { x: targetX, y: targetY },
                      ],
                      3,
                    );
                    return (
                      <path
                        className="dependency-path"
                        key={`${predecessor.id}-${task.id}`}
                        d={dependencyPath}
                        markerEnd="url(#dependency-arrow)"
                      />
                    );
                  })}
                </svg>
                {visible.map((task) => {
                  const childCount = orderedTasks.filter(
                    (item) => item.parentId === task.id,
                  ).length;
                  const status = taskExecutionStatus(task);
                  const palette = taskStatusPalette[status];
                  return (
                    <button
                      className={`timeline-row status-${status} ${childCount ? "is-parent" : ""} ${task.critical ? "critical" : ""}`}
                      aria-label={`Período de ${task.name}. Arraste para navegar pelo cronograma.`}
                      key={task.id}
                    >
                      <div className="day-lines">
                        {timelineLabels.map((_, column) => (
                          <i key={column} />
                        ))}
                      </div>
                      {showBaseline && (
                        <span
                          className="baseline-bar"
                          style={barStyle(task, true)}
                        />
                      )}
                      {task.milestone ? (
                        <span
                          className="milestone"
                          style={{
                            ...barStyle(task),
                            width: undefined,
                            background: palette.period,
                          }}
                        />
                      ) : childCount > 0 ? (
                        <span
                          className="gantt-parent-bar"
                          style={{
                            ...barStyle(task),
                            color: palette.period,
                            background: palette.period,
                          }}
                        >
                          <b>{task.progress}%</b>
                        </span>
                      ) : (
                        <span
                          className="gantt-bar"
                          style={{
                            ...barStyle(task),
                            background: palette.period,
                          }}
                        >
                          <i
                            style={{
                              width: `${task.progress}%`,
                              background: palette.progress,
                            }}
                          />
                          {duration(task) > 2 && <b>{task.progress}%</b>}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div
          className="mobile-gantt-view-switch"
          aria-label="Visualização mobile do cronograma"
        >
          <button
            className={mobileView === "execution" ? "active" : ""}
            onClick={() => setMobileView("execution")}
          >
            <Icon name="menu" /> Execução
          </button>
          <button
            className={mobileView === "timeline" ? "active" : ""}
            onClick={() => {
              setMobileView("timeline");
              setMobileFullGantt(true);
            }}
          >
            <Icon name="gantt" /> Gantt completo
          </button>
        </div>
        <div className={`gantt-mobile-list mobile-mode-${mobileView}`}>
          {visible.map((task) => {
            const depth = taskDepth(task);
            const journalCount = entries.filter(
              (entry) => entry.taskId === task.id,
            ).length;
            const childCount = orderedTasks.filter(
              (item) => item.parentId === task.id,
            ).length;
            const status = taskExecutionStatus(task);
            const palette = taskStatusPalette[status];
            const timelineLeft = Math.max(
              0,
              Math.min(
                100,
                (daysBetween(timelineStart, task.plannedStart) / projectDays) *
                  100,
              ),
            );
            const timelineWidth = Math.max(
              4,
              Math.min(
                100 - timelineLeft,
                (duration(task) / projectDays) * 100,
              ),
            );
            return (
              <button
                data-task-id={task.id}
                draggable
                onDragStart={(event) => {
                  suppressTaskClick.current = true;
                  setDraggingId(task.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => updateDropIntent(event, task.id)}
                onDrop={(event) => void applyDrop(event, task)}
                onDragEnd={() => {
                  resetDrag();
                  window.setTimeout(() => {
                    suppressTaskClick.current = false;
                  }, 0);
                }}
                key={task.id}
                className={`gantt-mobile-card status-${status} ${depth ? "is-child" : ""} ${childCount ? "is-parent" : ""} ${collapsedIds.has(task.id) ? "is-collapsed" : ""} ${draggingId === task.id ? "is-dragging" : ""} ${dropIntent?.targetId === task.id ? (dropIntent.asChild ? "drop-as-child" : "drop-as-root") : ""}`}
                style={{ "--task-depth": depth } as CSSProperties}
                onClick={(event) => openTaskFromTable(event, task)}
              >
                <span
                  className="drag-grip"
                  role="button"
                  aria-label={`Reorganizar ${task.name}`}
                  onPointerDown={(event) => beginPointerDrag(event, task.id)}
                  onPointerMove={movePointerDrag}
                  onPointerUp={endPointerDrag}
                >
                  ••
                </span>
                <span
                  className="mobile-task-color"
                  style={{ background: palette.period }}
                />
                {mobileView === "execution" ? (
                  <>
                    <div className="mobile-task-copy">
                      <small>
                        <b>{task.code}</b>
                        <span>{task.phase}</span>
                        {childCount > 0 && <em>{childCount} subitens</em>}
                      </small>
                      <strong>
                        {childCount > 0 && (
                          <span
                            className="tree-toggle"
                            role="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleCollapsed(task.id);
                            }}
                          >
                            {collapsedIds.has(task.id) ? "›" : "⌄"}
                          </span>
                        )}
                        {task.name}
                      </strong>
                      <span className="mobile-task-dates">
                        <Icon name="calendar" />
                        {formatDate(task.plannedStart)} —{" "}
                        {formatDate(task.plannedEnd)}
                        {journalCount > 0 && (
                          <em className="mobile-journal-count">
                            <Icon name="journal" />
                            {journalCount}
                          </em>
                        )}
                      </span>
                      <div className="thin-progress">
                        <i
                          style={{
                            width: `${task.progress}%`,
                            background: palette.period,
                          }}
                        />
                      </div>
                    </div>
                    <span
                      className="mobile-progress-value"
                      style={{ color: palette.period }}
                    >
                      <b>{task.progress}%</b>
                      <small>
                        {status === "active"
                          ? "executado"
                          : taskStatusPalette[status].label}
                      </small>
                    </span>
                  </>
                ) : (
                  <>
                    <div className="mobile-timeline-label">
                      <small>{task.code}</small>
                      <strong>{task.name}</strong>
                      {childCount > 0 && (
                        <span
                          className="tree-toggle"
                          role="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleCollapsed(task.id);
                          }}
                        >
                          {collapsedIds.has(task.id) ? "›" : "⌄"}
                        </span>
                      )}
                    </div>
                    <div className="mobile-timeline-track">
                      <span className="mobile-timeline-dates">
                        <i>{formatDate(task.plannedStart)}</i>
                        <i>{formatDate(task.plannedEnd)}</i>
                      </span>
                      <span className="mobile-timeline-rail">
                        <i
                          className="mobile-timeline-bar"
                          style={{
                            left: `${timelineLeft}%`,
                            width: `${timelineWidth}%`,
                            background: palette.period,
                          }}
                        >
                          <b
                            style={{
                              width: `${task.progress}%`,
                              background: palette.progress,
                            }}
                          />
                        </i>
                      </span>
                      <b>{task.progress}%</b>
                    </div>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <footer className="gantt-legend">
          {(["waiting", "active", "done", "late"] as TaskExecutionStatus[]).map(
            (status) => (
              <span key={status}>
                <i style={{ background: taskStatusPalette[status].period }} />{" "}
                {taskStatusPalette[status].label}
              </span>
            ),
          )}
          <span>
            <i className="legend-base" /> Linha de base
          </span>
        </footer>
      </section>

      {creating && (
        <TaskForm
          project={project}
          tasks={tasks}
          members={members}
          projectTeams={projectTeams}
          onClose={() => setCreating(false)}
          onSave={async (task) => {
            await addTask(task);
            setCreating(false);
          }}
        />
      )}
      {calendarOpen && (
        <WorkCalendarModal
          project={project}
          onClose={() => setCalendarOpen(false)}
          onSave={async (days) => {
            await updateProjectWorkDays(days);
            setCalendarOpen(false);
          }}
        />
      )}
      {selected && (
        <Modal
          title={editing ? `Editar ${selected.name}` : selected.name}
          subtitle={`${selected.phase} · Atividade ${selected.code}`}
          onClose={() => {
            setSelected(null);
            setEditing(false);
          }}
          wide
        >
          {editing ? (
            <TaskForm
              project={project}
              tasks={tasks}
              members={members}
              projectTeams={projectTeams}
              initial={selected}
              onClose={() => setEditing(false)}
              onSave={async (task) => {
                await editTask(task);
                setSelected(task);
                setEditing(false);
              }}
            />
          ) : (
            <div className="task-modal-body">
              <div className="task-detail-grid">
                <span>
                  <small>INÍCIO</small>
                  <strong>{formatDate(selected.plannedStart)}</strong>
                </span>
                <span>
                  <small>TÉRMINO</small>
                  <strong>{formatDate(selected.plannedEnd)}</strong>
                </span>
                <span>
                  <small>RESPONSÁVEL</small>
                  <strong>{selected.responsible || "Não definido"}</strong>
                </span>
                <span>
                  <small>PREDECESSORA</small>
                  <strong>
                    {selected.dependencyId
                      ? (() => {
                          const predecessor = tasks.find(
                            (task) => task.id === selected.dependencyId,
                          );
                          const lag = selected.lagDays ?? 0;
                          return predecessor
                            ? `${predecessor.code} · ${predecessor.name} — ${dependencyLabels[selected.dependencyType ?? "FS"]}${lag ? ` · ${lag > 0 ? "+" : ""}${lag}d` : ""}`
                            : "Atividade predecessora não encontrada";
                        })()
                      : "Nenhuma"}
                  </strong>
                </span>
              </div>
              {tasks.some((task) => task.parentId === selected.id) ? (
                <div className="parent-progress-note">
                  <Icon name="trend" />
                  <div>
                    <strong>Avanço consolidado: {selected.progress}%</strong>
                    <span>
                      Este percentual é calculado automaticamente a partir dos
                      subitens e não pode ser alterado manualmente.
                    </span>
                  </div>
                </div>
              ) : (
                <label className="range-field">
                  <span>
                    Avanço físico <strong>{selected.progress}%</strong>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={selected.progress}
                    onChange={(event) =>
                      setSelected({
                        ...selected,
                        progress: Number(event.target.value),
                      })
                    }
                  />
                  <div>
                    <small>0%</small>
                    <small>50%</small>
                    <small>100%</small>
                  </div>
                </label>
              )}
              <div className="task-history-callout">
                <Icon name="journal" />
                <div>
                  <strong>Diário de Obra desta atividade</strong>
                  <span>
                    {entries.filter((entry) => entry.taskId === selected.id)
                      .length
                      ? `${entries.filter((entry) => entry.taskId === selected.id).length} registro(s) com descrições, medições e fotos.`
                      : "Ainda não há registros de campo vinculados."}
                  </span>
                </div>
                <button
                  className="secondary-btn"
                  disabled={
                    !entries.some((entry) => entry.taskId === selected.id)
                  }
                  onClick={() => {
                    setHistoryTask(selected);
                    setSelected(null);
                  }}
                >
                  Ver diários
                </button>
              </div>
              <div className="modal-note">
                <Icon name="journal" />
                <p>
                  <strong>Medição preferencial pelo Diário de Obra</strong>
                  <br />
                  Use o ajuste manual apenas para correções. No uso diário,
                  registre o percentual junto com as evidências.
                </p>
              </div>
              <div className="modal-actions task-modal-actions">
                <button
                  className="danger-btn"
                  disabled={
                    entries.some((entry) => entry.taskId === selected.id) ||
                    tasks.some((task) => task.parentId === selected.id)
                  }
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icon name="trash" /> Excluir
                </button>
                <span />
                <button
                  className="secondary-btn"
                  onClick={() => setEditing(true)}
                >
                  <Icon name="edit" /> Editar
                </button>
                {!tasks.some((task) => task.parentId === selected.id) && (
                  <button
                    className="primary-btn"
                    disabled={savingProgress}
                    onClick={async () => {
                      setSavingProgress(true);
                      try {
                        await updateTaskProgress(
                          selected.id,
                          selected.progress,
                        );
                        setSelected(null);
                      } catch (cause) {
                        setToast(
                          cause instanceof Error
                            ? cause.message
                            : "Não foi possível salvar o avanço.",
                        );
                      } finally {
                        setSavingProgress(false);
                      }
                    }}
                  >
                    {savingProgress ? (
                      <>
                        <span className="button-spinner" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <Icon name="check" /> Salvar avanço
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
      {selected && confirmDelete && (
        <Modal
          title="Excluir atividade"
          subtitle="Esta ação não pode ser desfeita."
          onClose={() => {
            if (!deletingTask) setConfirmDelete(false);
          }}
        >
          <div className="confirm-delete-modal">
            <span className="confirm-delete-icon">
              <Icon name="alert" />
            </span>
            <h3>Excluir “{selected.name}”?</h3>
            <p>
              A atividade será removida e a numeração EAP será reorganizada. Só
              é possível excluir itens sem subitens e sem Diário de Obra.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-btn"
                disabled={deletingTask}
                onClick={() => setConfirmDelete(false)}
              >
                Cancelar
              </button>
              <button
                className="danger-btn"
                disabled={deletingTask}
                onClick={async () => {
                  setDeletingTask(true);
                  try {
                    await deleteTask(selected.id);
                    setConfirmDelete(false);
                    setSelected(null);
                  } catch (cause) {
                    setToast(
                      cause instanceof Error
                        ? cause.message
                        : "Não foi possível excluir a atividade.",
                    );
                  } finally {
                    setDeletingTask(false);
                  }
                }}
              >
                {deletingTask && <i className="button-spinner" />}
                {deletingTask ? "Excluindo..." : "Excluir definitivamente"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {historyTask && (
        <EntryHistoryModal
          task={historyTask}
          entries={entries.filter((entry) => entry.taskId === historyTask.id)}
          onClose={() => setHistoryTask(null)}
          onUpdate={editEntry}
          onDelete={deleteEntry}
        />
      )}
    </div>
  );
}

function WorkCalendarModal({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  onSave: (days: number[]) => Promise<void>;
}) {
  const labels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const [days, setDays] = useState(projectWorkDays(project.workDays));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Calendário de trabalho"
      subtitle="Defina quais dias entram no cálculo das durações e dependências."
      onClose={onClose}
    >
      <div className="work-calendar-form">
        <div className="weekday-options">
          {labels.map((label, day) => (
            <label key={label} className={days.includes(day) ? "active" : ""}>
              <input
                type="checkbox"
                checked={days.includes(day)}
                onChange={() =>
                  setDays((current) =>
                    current.includes(day)
                      ? current.filter((item) => item !== day)
                      : [...current, day].sort(),
                  )
                }
              />
              <strong>{label}</strong>
              <small>{days.includes(day) ? "Trabalho" : "Folga"}</small>
            </label>
          ))}
        </div>
        <div className="modal-note">
          <Icon name="calendar" />
          <p>
            Ao salvar, as durações existentes são preservadas e as datas são
            recalculadas. Dependências FS começam no próximo dia de trabalho.
          </p>
        </div>
        {error && (
          <div className="access-message">
            <Icon name="alert" />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-btn"
            disabled={saving || !days.length}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                await onSave(days);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Não foi possível salvar o calendário.",
                );
                setSaving(false);
              }
            }}
          >
            {saving && <i className="button-spinner" />}
            {saving ? "Recalculando..." : "Salvar calendário"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TaskForm({
  project,
  tasks,
  members,
  projectTeams,
  initial,
  onClose,
  onSave,
}: {
  project: Project;
  tasks: Task[];
  members: Member[];
  projectTeams: ProjectTeam[];
  initial?: Task;
  onClose: () => void;
  onSave: (task: Task) => void | Promise<void>;
}) {
  const workDays = projectWorkDays(project.workDays);
  const derivesPeriod = Boolean(
    initial && tasks.some((task) => task.parentId === initial.id),
  );
  const [nextId] = useState(() => initial?.id ?? crypto.randomUUID());
  const [name, setName] = useState(initial?.name ?? "");
  const [phase, setPhase] = useState(initial?.phase ?? "");
  const [plannedStart, setPlannedStart] = useState(
    initial?.plannedStart ?? project.start,
  );
  const [plannedEnd, setPlannedEnd] = useState(
    initial?.plannedEnd ?? project.start,
  );
  const [durationWorkDays, setDurationWorkDays] = useState(() =>
    workingDuration(
      initial?.plannedStart ?? project.start,
      initial?.plannedEnd ?? project.start,
      workDays,
    ),
  );
  const [baselineStart, setBaselineStart] = useState(
    initial?.baselineStart ?? project.start,
  );
  const [baselineEnd, setBaselineEnd] = useState(
    initial?.baselineEnd ?? project.start,
  );
  const [responsible, setResponsible] = useState(initial?.responsible ?? "");
  const [responsibleKind, setResponsibleKind] = useState<
    TaskResponsibleKind | undefined
  >(initial?.responsibleKind);
  const [responsibleRefId, setResponsibleRefId] = useState(
    initial?.responsibleRefId ?? "",
  );
  const [parentId, setParentId] = useState(initial?.parentId ?? "");
  const [dependencyId, setDependencyId] = useState(initial?.dependencyId ?? "");
  const [dependencyType, setDependencyType] = useState<DependencyType>(
    initial?.dependencyType ?? "FS",
  );
  const [lagDays, setLagDays] = useState(initial?.lagDays ?? 0);
  const [weight, setWeight] = useState(initial?.weight ?? 1);
  const [critical, setCritical] = useState(Boolean(initial?.critical));
  const [milestone, setMilestone] = useState(Boolean(initial?.milestone));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const siblingPosition =
    tasks.filter(
      (task) =>
        task.id !== initial?.id &&
        (parentId ? task.parentId === parentId : !task.parentId),
    ).length + 1;
  const generatedCode = parentId
    ? `${tasks.find((task) => task.id === parentId)?.code ?? "1"}.${siblingPosition}`
    : String(siblingPosition);
  function synchronizeDependency(
    nextDependencyId: string,
    nextType = dependencyType,
    nextLag = lagDays,
  ) {
    const predecessor = tasks.find((task) => task.id === nextDependencyId);
    if (!predecessor) return;
    const activityDuration = Math.max(1, durationWorkDays);
    if (nextType === "FS" || nextType === "SS") {
      const anchor =
        nextType === "FS"
          ? nextWorkingDay(predecessor.plannedEnd, workDays)
          : predecessor.plannedStart;
      const start = shiftWorkingDays(anchor, nextLag, workDays);
      setPlannedStart(start);
      const end = workingEnd(start, activityDuration, workDays);
      setPlannedEnd(end);
      if (!initial) {
        setBaselineStart(start);
        setBaselineEnd(end);
      }
    } else {
      const anchor =
        nextType === "FF" ? predecessor.plannedEnd : predecessor.plannedStart;
      const end = shiftWorkingDays(anchor, nextLag, workDays);
      setPlannedEnd(end);
      const start = shiftWorkingDays(end, -(activityDuration - 1), workDays);
      setPlannedStart(start);
      if (!initial) {
        setBaselineStart(start);
        setBaselineEnd(end);
      }
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const safePlannedEnd =
        plannedEnd < plannedStart ? plannedStart : plannedEnd;
      const safeBaselineEnd =
        baselineEnd < baselineStart ? baselineStart : baselineEnd;
      await onSave({
        id: nextId,
        code: generatedCode,
        name,
        phase: phase || "Sem etapa",
        plannedStart,
        plannedEnd: milestone ? plannedStart : safePlannedEnd,
        baselineStart,
        baselineEnd: milestone ? baselineStart : safeBaselineEnd,
        progress: initial?.progress ?? 0,
        weight,
        responsible,
        responsibleKind,
        responsibleRefId: responsibleRefId || undefined,
        parentId: parentId || undefined,
        dependencyId: dependencyId || undefined,
        dependencyType: dependencyId ? dependencyType : undefined,
        lagDays: dependencyId ? lagDays : undefined,
        color: initial?.color ?? taskStatusPalette.waiting.period,
        critical,
        milestone,
        notes,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar a atividade.",
      );
      setSaving(false);
    }
  }
  const availableTasks = tasks.filter((task) => task.id !== initial?.id);
  const responsibleOptions = [
    ...members
      .filter((member) => !member.pending)
      .map((member) => ({
        key: `user:${member.id}`,
        id: member.id,
        kind: "user" as const,
        label: member.name,
        group: "Usuários da plataforma",
      })),
    ...projectTeams.flatMap((team) => [
      {
        key: `team:${team.id}`,
        id: team.id,
        kind: "team" as const,
        label: team.company || team.name,
        group: "Empresas e equipes de campo",
      },
      ...(team.members ?? [])
        .filter((worker) => worker.active)
        .map((worker) => ({
          key: `worker:${worker.id}`,
          id: worker.id,
          kind: "worker" as const,
          label: worker.name,
          group: `Colaboradores · ${team.company || team.name}`,
        })),
    ]),
  ];
  const responsibleValue =
    responsibleKind && responsibleRefId
      ? `${responsibleKind}:${responsibleRefId}`
      : responsible
        ? (responsibleOptions.find((option) => option.label === responsible)
            ?.key ?? "")
        : "";
  const responsibleGroups = Array.from(
    new Set(responsibleOptions.map((option) => option.group)),
  );
  const form = (
    <form className="task-form" onSubmit={submit}>
      <label>
        <span>Código EAP automático</span>
        <input
          readOnly
          value={generatedCode}
          title="EAP atualizada automaticamente conforme a hierarquia"
        />
      </label>
      <label className="grow">
        <span>Nome da atividade</span>
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex.: Armação da laje"
        />
      </label>
      <label>
        <span>Etapa / disciplina</span>
        <input
          required
          value={phase}
          onChange={(event) => setPhase(event.target.value)}
          placeholder="Estrutura"
        />
      </label>
      <label>
        <span>Item pai</span>
        <select
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
        >
          <option value="">Sem item pai</option>
          {availableTasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.code} · {task.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Início planejado</span>
        <input
          type="date"
          min={project.start}
          required
          disabled={derivesPeriod}
          value={plannedStart}
          onChange={(event) => {
            const value = event.target.value;
            setPlannedStart(value);
            if (value > plannedEnd) {
              setPlannedEnd(value);
              setDurationWorkDays(1);
              if (!initial) setBaselineEnd(value);
            } else {
              setDurationWorkDays(workingDuration(value, plannedEnd, workDays));
            }
            if (!initial) setBaselineStart(value);
          }}
        />
      </label>
      <label>
        <span>Término planejado</span>
        <input
          type="date"
          min={plannedStart}
          required
          disabled={milestone || derivesPeriod}
          value={milestone ? plannedStart : plannedEnd}
          onChange={(event) => {
            const value =
              event.target.value < plannedStart
                ? plannedStart
                : event.target.value;
            setPlannedEnd(value);
            setDurationWorkDays(workingDuration(plannedStart, value, workDays));
            if (!initial) setBaselineEnd(value);
          }}
        />
      </label>
      <label>
        <span>Duração em dias úteis</span>
        <input
          type="number"
          min="1"
          required
          disabled={milestone || derivesPeriod}
          value={milestone ? 1 : durationWorkDays}
          onChange={(event) => {
            const value = Math.max(1, Number(event.target.value));
            setDurationWorkDays(value);
            const end = workingEnd(plannedStart, value, workDays);
            setPlannedEnd(end);
            if (!initial) setBaselineEnd(end);
          }}
        />
      </label>
      <label>
        <span>Início da linha de base</span>
        <input
          type="date"
          disabled={derivesPeriod}
          value={baselineStart}
          onChange={(event) => {
            const value = event.target.value;
            setBaselineStart(value);
            if (value > baselineEnd) setBaselineEnd(value);
          }}
        />
      </label>
      <label>
        <span>Término da linha de base</span>
        <input
          type="date"
          min={baselineStart}
          disabled={milestone || derivesPeriod}
          value={milestone ? baselineStart : baselineEnd}
          onChange={(event) =>
            setBaselineEnd(
              event.target.value < baselineStart
                ? baselineStart
                : event.target.value,
            )
          }
        />
      </label>
      <label>
        <span>Responsável</span>
        <select
          value={responsibleValue}
          onChange={(event) => {
            const option = responsibleOptions.find(
              (item) => item.key === event.target.value,
            );
            setResponsible(option?.label ?? "");
            setResponsibleKind(option?.kind);
            setResponsibleRefId(option?.id ?? "");
          }}
        >
          <option value="">Definir depois</option>
          {responsibleGroups.map((group) => (
            <optgroup key={group} label={group}>
              {responsibleOptions
                .filter((option) => option.group === group)
                .map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        <span>Peso no avanço</span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          required
          value={weight}
          onChange={(event) => setWeight(Number(event.target.value))}
        />
      </label>
      <div className="task-dependency-row">
        <label>
          <span>Atividade predecessora</span>
          <select
            value={dependencyId}
            onChange={(event) => {
              const value = event.target.value;
              setDependencyId(value);
              if (value) synchronizeDependency(value);
            }}
          >
            <option value="">Sem dependência</option>
            {availableTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.code} · {task.name}
              </option>
            ))}
          </select>
        </label>
        {dependencyId && (
          <>
            <label>
              <span>Relação</span>
              <select
                value={dependencyType}
                onChange={(event) => {
                  const value = event.target.value as DependencyType;
                  setDependencyType(value);
                  synchronizeDependency(dependencyId, value, lagDays);
                }}
              >
                <option value="FS">Término → Início (FS)</option>
                <option value="SS">Início → Início (SS)</option>
                <option value="FF">Término → Término (FF)</option>
                <option value="SF">Início → Término (SF)</option>
              </select>
            </label>
            <label className="dependency-lag-field">
              <span>Defasagem</span>
              <input
                aria-label="Defasagem em dias, positiva ou negativa"
                title="Use dias positivos para esperar e negativos para antecipar"
                type="number"
                value={lagDays}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setLagDays(value);
                  synchronizeDependency(dependencyId, dependencyType, value);
                }}
              />
              <small>+ espera · − antecipa</small>
            </label>
          </>
        )}
      </div>
      <div className="task-checks">
        <label>
          <input
            type="checkbox"
            checked={critical}
            onChange={(event) => setCritical(event.target.checked)}
          />
          <span>Caminho crítico</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={milestone}
            onChange={(event) => setMilestone(event.target.checked)}
          />
          <span title="Evento de duração zero que representa uma entrega, aprovação ou decisão importante">
            Marco do projeto
          </span>
        </label>
      </div>
      <label className="full">
        <span>Observações técnicas</span>
        <textarea
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Premissas, restrições, critérios de aceite..."
        />
      </label>
      {error && (
        <div className="access-message full">
          <Icon name="alert" />
          {error}
        </div>
      )}
      <div className="modal-actions full">
        <button type="button" className="secondary-btn" onClick={onClose}>
          Cancelar
        </button>
        <button className="primary-btn" disabled={saving}>
          {saving ? <span className="button-spinner" /> : <Icon name="check" />}{" "}
          {saving
            ? "Salvando..."
            : initial
              ? "Salvar correções"
              : "Adicionar atividade"}
        </button>
      </div>
    </form>
  );
  return initial ? (
    form
  ) : (
    <Modal
      title="Nova atividade do Gantt"
      subtitle="Configure planejamento, hierarquia, responsabilidade e dependências."
      onClose={onClose}
      wide
    >
      {form}
    </Modal>
  );
}
