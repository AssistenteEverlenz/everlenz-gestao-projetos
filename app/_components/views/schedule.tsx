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
  taskWorkingDuration,
  normalizeWorkingDuration,
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
  addTasks: (tasks: Task[]) => Promise<void>;
  editTask: (task: Task) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  deleteTasks: (taskIds: string[]) => Promise<void>;
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
const formatDuration = (value: number) =>
  `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}d`;
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

type GanttFilters = {
  query: string;
  phases: string[];
  responsibles: string[];
  statuses: TaskExecutionStatus[];
  dateFrom: string;
  dateTo: string;
  criticalOnly: boolean;
  milestonesOnly: boolean;
  dependenciesOnly: boolean;
  hideCompleted: boolean;
};

type FilterChip = {
  id: string;
  kind: keyof GanttFilters | "dates";
  value?: string;
  label: string;
};

const emptyGanttFilters: GanttFilters = {
  query: "",
  phases: [],
  responsibles: [],
  statuses: [],
  dateFrom: "",
  dateTo: "",
  criticalOnly: false,
  milestonesOnly: false,
  dependenciesOnly: false,
  hideCompleted: false,
};

const filterStatusLabels: Record<TaskExecutionStatus, string> = {
  waiting: "Não iniciada",
  active: "Em andamento",
  late: "Em atraso",
  done: "Concluída",
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
  addTasks,
  editTask,
  deleteTask,
  deleteTasks,
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
  const [filters, setFilters] = useState<GanttFilters>(emptyGanttFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [copyOpen, setCopyOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);
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
  const eapColumnResize = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    startPanelWidth: number;
  } | null>(null);
  const [eapColumnWidth, setEapColumnWidth] = useState(() => {
    if (typeof window === "undefined") return 104;
    const stored = Number(window.localStorage.getItem("emdia-gantt-eap-width"));
    return stored >= 90 && stored <= 240 ? stored : 104;
  });
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
  const phaseOptions = useMemo(
    () =>
      [...new Set(orderedTasks.map((task) => task.phase || "Sem etapa"))].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [orderedTasks],
  );
  const responsibleOptions = useMemo(
    () =>
      [
        ...new Set(
          orderedTasks.map((task) => task.responsible || "Sem responsável"),
        ),
      ].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [orderedTasks],
  );
  const activeFilterCount =
    (filters.query ? 1 : 0) +
    filters.phases.length +
    filters.responsibles.length +
    filters.statuses.length +
    (filters.dateFrom || filters.dateTo ? 1 : 0) +
    Number(filters.criticalOnly) +
    Number(filters.milestonesOnly) +
    Number(filters.dependenciesOnly) +
    Number(filters.hideCompleted);
  const makeFilterChip = (
    id: string,
    kind: FilterChip["kind"],
    label: string,
    value?: string,
  ): FilterChip => ({ id, kind, label, value });
  const filterChips: FilterChip[] = [
    ...(filters.query
      ? [makeFilterChip("query", "query", `Busca: ${filters.query}`)]
      : []),
    ...filters.phases.map((value) =>
      makeFilterChip(`phase-${value}`, "phases", `Disciplina: ${value}`, value),
    ),
    ...filters.responsibles.map((value) =>
      makeFilterChip(
        `responsible-${value}`,
        "responsibles",
        `Responsável: ${value}`,
        value,
      ),
    ),
    ...filters.statuses.map((value) =>
      makeFilterChip(
        `status-${value}`,
        "statuses",
        `Status: ${filterStatusLabels[value]}`,
        value,
      ),
    ),
    ...(filters.dateFrom || filters.dateTo
      ? [
          makeFilterChip(
            "dates",
            "dates",
            `Período: ${filters.dateFrom ? formatDate(filters.dateFrom) : "início"} – ${filters.dateTo ? formatDate(filters.dateTo) : "fim"}`,
          ),
        ]
      : []),
    ...(filters.criticalOnly
      ? [makeFilterChip("critical", "criticalOnly", "Caminho crítico")]
      : []),
    ...(filters.milestonesOnly
      ? [makeFilterChip("milestones", "milestonesOnly", "Somente marcos")]
      : []),
    ...(filters.dependenciesOnly
      ? [makeFilterChip("dependencies", "dependenciesOnly", "Com dependências")]
      : []),
    ...(filters.hideCompleted
      ? [makeFilterChip("completed", "hideCompleted", "Ocultar concluídas")]
      : []),
  ];
  const visible = useMemo(() => {
    const normalizedQuery = filters.query.trim().toLocaleLowerCase("pt-BR");
    const matches = orderedTasks.filter((task) => {
      const status = taskExecutionStatus(task);
      const searchable = [
        task.code,
        task.name,
        task.phase,
        task.responsible,
        task.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR");
      if (normalizedQuery && !searchable.includes(normalizedQuery)) return false;
      if (filters.phases.length && !filters.phases.includes(task.phase || "Sem etapa"))
        return false;
      if (
        filters.responsibles.length &&
        !filters.responsibles.includes(task.responsible || "Sem responsável")
      )
        return false;
      if (filters.statuses.length && !filters.statuses.includes(status))
        return false;
      if (filters.hideCompleted && status === "done") return false;
      if (filters.dateFrom && task.plannedEnd < filters.dateFrom) return false;
      if (filters.dateTo && task.plannedStart > filters.dateTo) return false;
      if (filters.criticalOnly && !task.critical) return false;
      if (filters.milestonesOnly && !task.milestone) return false;
      if (
        filters.dependenciesOnly &&
        !task.dependencyId &&
        !orderedTasks.some((item) => item.dependencyId === task.id)
      )
        return false;
      return true;
    });
    const matchIds = new Set(matches.map((task) => task.id));
    const ancestors = ancestorIds(orderedTasks, matchIds);
    const requiredIds = new Set([...matchIds, ...ancestors]);
    const filtering = activeFilterCount > 0;
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
  }, [activeFilterCount, collapsedIds, filters, orderedTasks]);
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
      width: `${Math.max(
        0.8,
        (((!baseline &&
          !tasks.some((child) => child.parentId === task.id) &&
          task.durationDays != null
            ? task.durationDays
            : daysBetween(startValue, endValue) + 1) /
          projectDays) *
          100),
      )}%`,
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
  function hierarchyClass(task: Task, childCount: number) {
    return childCount
      ? `is-parent hierarchy-depth-${Math.min(4, taskDepth(task))}`
      : "";
  }
  function toggleTaskSelection(taskId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }
  function selectAllVisible() {
    const visibleIds = visible.map((task) => task.id);
    const allSelected = visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((current) => {
      const next = new Set(current);
      visibleIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }
  function clearFilters() {
    setFilters({ ...emptyGanttFilters });
  }
  function removeFilter(kind: string, value?: string) {
    setFilters((current) => {
      if (kind === "phases" || kind === "responsibles" || kind === "statuses")
        return {
          ...current,
          [kind]: current[kind].filter((item) => item !== value),
        };
      if (kind === "dates")
        return { ...current, dateFrom: "", dateTo: "" };
      if (kind === "query") return { ...current, query: "" };
      return { ...current, [kind]: false };
    });
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
    event: ReactPointerEvent<HTMLDivElement>,
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
  function moveTaskRowGesture(event: ReactPointerEvent<HTMLDivElement>) {
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
  function endTaskRowGesture(event: ReactPointerEvent<HTMLDivElement>) {
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
  function resizeEapColumn(nextWidth: number, nextPanelWidth?: number) {
    const width = Math.round(Math.max(90, Math.min(240, nextWidth)));
    const panelWidth =
      nextPanelWidth ?? taskPanelWidth + (width - eapColumnWidth);
    setEapColumnWidth(width);
    window.localStorage.setItem("emdia-gantt-eap-width", String(width));
    resizeTaskPanel(panelWidth);
  }
  function beginEapColumnResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    eapColumnResize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: eapColumnWidth,
      startPanelWidth: taskPanelWidth,
    };
  }
  function moveEapColumnResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = eapColumnResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    const width = Math.max(
      90,
      Math.min(240, resize.startWidth + event.clientX - resize.startX),
    );
    resizeEapColumn(
      width,
      resize.startPanelWidth + (width - resize.startWidth),
    );
  }
  function endEapColumnResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (eapColumnResize.current?.pointerId !== event.pointerId) return;
    eapColumnResize.current = null;
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
          <button
            className={`secondary-btn compact gantt-filter-button ${activeFilterCount ? "active" : ""}`}
            onClick={() => setFilterOpen(true)}
          >
            <Icon name="filter" /> Filtros
            {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
          </button>
          <button
            className={`secondary-btn compact gantt-selection-toggle ${selectionMode ? "active" : ""}`}
            onClick={() => {
              setSelectionMode((current) => {
                if (current) {
                  setSelectedIds(new Set());
                  setCopyOpen(false);
                  setBulkDeleteOpen(false);
                }
                return !current;
              });
            }}
          >
            <Icon name="check" />
            {selectionMode ? "Concluir seleção" : "Selecionar itens"}
          </button>
        </div>
        <div className="toolbar-group center">
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
        <div className={`gantt-filter-strip ${filterChips.length ? "has-filters" : ""}`}>
          {filterChips.length ? (
            <>
              <span className="gantt-filter-label">
                <Icon name="filter" /> Filtros aplicados
              </span>
              <div className="gantt-filter-chips">
                {filterChips.map((chip) => (
                  <span key={chip.id} className="gantt-filter-chip">
                    {chip.label}
                    <button
                      type="button"
                      onClick={() => removeFilter(chip.kind, chip.value)}
                      aria-label={`Remover filtro ${chip.label}`}
                    >
                      <Icon name="close" />
                    </button>
                  </span>
                ))}
              </div>
              <button className="gantt-clear-filters" onClick={clearFilters}>
                Limpar todos
              </button>
            </>
          ) : (
            <button className="gantt-filter-empty" onClick={() => setFilterOpen(true)}>
              <Icon name="filter" /> Todas as {orderedTasks.length} atividades estão visíveis
            </button>
          )}
        </div>
        {selectionMode && selectedIds.size > 0 && (
          <div className="gantt-selection-bar">
            <span>
              <b>{selectedIds.size}</b>{" "}
              {selectedIds.size === 1
                ? "item selecionado"
                : "itens selecionados"}
            </span>
            <button
              className="secondary-btn compact"
              disabled={selectedIds.size !== 1}
              onClick={() => setCopyOpen(true)}
              title={
                selectedIds.size === 1
                  ? "Copiar item e seus subitens"
                  : "Selecione apenas um item para copiar"
              }
            >
              <Icon name="copy" /> Copiar estrutura
            </button>
            <button
              className="danger-btn compact"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Icon name="trash" /> Excluir seleção
            </button>
            <button
              className="text-btn"
              onClick={() => setSelectedIds(new Set())}
            >
              Limpar seleção
            </button>
          </div>
        )}
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
          style={
            {
              "--gantt-table-width": `${taskPanelWidth}px`,
              "--gantt-eap-width": `${eapColumnWidth}px`,
            } as CSSProperties
          }
        >
          <div
            className={`gantt-task-panel ${selectionMode ? "selection-mode" : ""}`}
          >
            <div className="task-table-head">
              <span className="task-eap-head">
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={
                      visible.length > 0 &&
                      visible.every((task) => selectedIds.has(task.id))
                    }
                    onChange={selectAllVisible}
                    aria-label="Selecionar todas as atividades visíveis"
                  />
                )}
                EAP
                <button
                  type="button"
                  className="gantt-eap-resizer"
                  role="separator"
                  aria-label="Ajustar largura da coluna EAP"
                  aria-orientation="vertical"
                  aria-valuemin={90}
                  aria-valuemax={240}
                  aria-valuenow={eapColumnWidth}
                  title="Arraste para ajustar a largura da coluna EAP"
                  onPointerDown={beginEapColumnResize}
                  onPointerMove={moveEapColumnResize}
                  onPointerUp={endEapColumnResize}
                  onPointerCancel={endEapColumnResize}
                  onKeyDown={(event) => {
                    if (
                      event.key !== "ArrowLeft" &&
                      event.key !== "ArrowRight"
                    )
                      return;
                    event.preventDefault();
                    resizeEapColumn(
                      eapColumnWidth +
                        (event.key === "ArrowRight" ? 12 : -12),
                    );
                  }}
                />
              </span>
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
                  className={`gantt-task-line status-${status} ${hierarchyClass(task, childCount)} ${selectedIds.has(task.id) ? "is-selected" : ""} ${collapsedIds.has(task.id) ? "is-collapsed" : ""} ${task.critical ? "critical" : ""} ${draggingId === task.id ? "is-dragging" : ""} ${dropIntent?.targetId === task.id ? (dropIntent.asChild ? "drop-as-child" : "drop-as-root") : ""}`}
                  key={task.id}
                >
                  <div
                    className="task-row"
                    role="button"
                    tabIndex={0}
                    onPointerDown={(event) =>
                      beginTaskRowGesture(event, task.id)
                    }
                    onPointerMove={moveTaskRowGesture}
                    onPointerUp={endTaskRowGesture}
                    onPointerCancel={endTaskRowGesture}
                    onClick={(event) => openTaskFromTable(event, task)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected(task);
                      }
                    }}
                  >
                    <span className="task-eap-cell">
                      {selectionMode && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(task.id)}
                          onChange={() => toggleTaskSelection(task.id)}
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                          aria-label={`Selecionar ${task.name}`}
                        />
                      )}
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
                      {task.milestone && childCount === 0
                        ? "Marco"
                        : formatDuration(
                            childCount
                              ? workingDuration(
                                  task.plannedStart,
                                  task.plannedEnd,
                                  project.workDays,
                                )
                              : taskWorkingDuration(task, project.workDays),
                          )}
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
                  </div>
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
                    const barBounds = (candidate: Task) => {
                      const start = dateX(candidate.plannedStart, false);
                      const span =
                        ((!tasks.some(
                          (child) => child.parentId === candidate.id,
                        ) && candidate.durationDays != null
                          ? candidate.durationDays
                          : daysBetween(
                              candidate.plannedStart,
                              candidate.plannedEnd,
                            ) + 1) /
                          projectDays) *
                        1000;
                      return {
                        start: Math.max(3, start - 7),
                        end: Math.min(997, start + span + 7),
                      };
                    };
                    const betweenStart = Math.min(sourceIndex, targetIndex) + 1;
                    const betweenEnd = Math.max(sourceIndex, targetIndex);
                    const laneShift = ((dependencyIndex % 7) - 3) * 3;
                    const candidates = [
                      sourceX + (sourceUsesFinish ? 12 : -12),
                      targetX + (targetUsesFinish ? 12 : -12),
                      Math.min(sourceX, targetX) - 16,
                      Math.max(sourceX, targetX) + 16,
                      ...Array.from(
                        { length: 49 },
                        (_, index) => 20 + index * 20,
                      ),
                    ].map((value) => Math.max(4, Math.min(996, value + laneShift)));
                    const laneX = candidates.reduce(
                      (best, candidateX) => {
                        const collisions = visible
                          .slice(betweenStart, betweenEnd)
                          .reduce((count, rowTask) => {
                            const bounds = barBounds(rowTask);
                            return (
                              count +
                              Number(
                                candidateX >= bounds.start &&
                                  candidateX <= bounds.end,
                              )
                            );
                          }, 0);
                        const wrongSourceSide = sourceUsesFinish
                          ? candidateX < sourceX + 7
                          : candidateX > sourceX - 7;
                        const wrongTargetSide = targetUsesFinish
                          ? candidateX < targetX + 7
                          : candidateX > targetX - 7;
                        const distance =
                          Math.abs(candidateX - sourceX) +
                          Math.abs(candidateX - targetX);
                        const score =
                          collisions * 10000 +
                          Number(wrongSourceSide) * 900 +
                          Number(wrongTargetSide) * 700 +
                          distance +
                          (dependencyIndex % 7) *
                            Math.abs(candidateX - sourceX) *
                            0.01;
                        return score < best.score ? { x: candidateX, score } : best;
                      },
                      { x: sourceX, score: Number.POSITIVE_INFINITY },
                    ).x;
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
                        { x: laneX, y: sourceY },
                        { x: laneX, y: approachY },
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
                      className={`timeline-row status-${status} ${hierarchyClass(task, childCount)} ${task.critical ? "critical" : ""}`}
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
                      {childCount > 0 ? (
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
                      ) : task.milestone ? (
                        <span
                          className="milestone"
                          style={{
                            ...barStyle(task),
                            width: undefined,
                            background: palette.period,
                          }}
                        />
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
                          {taskWorkingDuration(task, project.workDays) > 2 && <b>{task.progress}%</b>}
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
                (taskWorkingDuration(task, project.workDays) / projectDays) * 100,
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
      {filterOpen && (
        <GanttFilterModal
          filters={filters}
          phases={phaseOptions}
          responsibles={responsibleOptions}
          statusCounts={statusCounts}
          onClose={() => setFilterOpen(false)}
          onApply={(nextFilters) => {
            setFilters(nextFilters);
            setFilterOpen(false);
          }}
          onClear={() => {
            clearFilters();
            setFilterOpen(false);
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
      {copyOpen && selectedIds.size === 1 && (
        <DuplicateTaskModal
          source={orderedTasks.find((task) => selectedIds.has(task.id))!}
          tasks={orderedTasks}
          onClose={() => setCopyOpen(false)}
          onDuplicate={async (source, destinationParentId) => {
            const sourceTreeIds = new Set([source.id, ...descendantIds(source.id)]);
            const sourceTree = orderedTasks.filter((task) => sourceTreeIds.has(task.id));
            const idMap = new Map(sourceTree.map((task) => [task.id, crypto.randomUUID()]));
            const copies = sourceTree.map((task) => ({
              ...task,
              id: idMap.get(task.id)!,
              code: `copy-${idMap.get(task.id)}`,
              name: task.id === source.id ? `${task.name} (cópia)` : task.name,
              parentId:
                task.id === source.id
                  ? destinationParentId || undefined
                  : task.parentId
                    ? idMap.get(task.parentId)
                    : undefined,
              dependencyId: task.dependencyId
                ? (idMap.get(task.dependencyId) ?? task.dependencyId)
                : undefined,
              progress: 0,
            }));
            await addTasks(copies);
            setSelectedIds(new Set());
            setCopyOpen(false);
          }}
        />
      )}
      {bulkDeleteOpen && (
        <Modal
          title="Excluir itens selecionados"
          subtitle="A seleção será validada antes de qualquer exclusão."
          onClose={() => !bulkProcessing && setBulkDeleteOpen(false)}
        >
          <div className="confirm-delete-modal">
            <span className="confirm-delete-icon"><Icon name="alert" /></span>
            <h3>Excluir {selectedIds.size} {selectedIds.size === 1 ? "item" : "itens"}?</h3>
            <p>
              Todos os descendentes dos itens-pai também serão removidos. Se qualquer
              atividade tiver registros no Diário de Obra, a operação inteira será bloqueada.
            </p>
            <div className="modal-actions">
              <button className="secondary-btn" disabled={bulkProcessing} onClick={() => setBulkDeleteOpen(false)}>
                Cancelar
              </button>
              <button
                className="danger-btn"
                disabled={bulkProcessing}
                onClick={async () => {
                  setBulkProcessing(true);
                  try {
                    await deleteTasks([...selectedIds]);
                    setSelectedIds(new Set());
                    setBulkDeleteOpen(false);
                  } catch (cause) {
                    setToast(cause instanceof Error ? cause.message : "Não foi possível excluir a seleção.");
                  } finally {
                    setBulkProcessing(false);
                  }
                }}
              >
                {bulkProcessing && <i className="button-spinner" />}
                {bulkProcessing ? "Excluindo..." : "Excluir definitivamente"}
              </button>
            </div>
          </div>
        </Modal>
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

function DuplicateTaskModal({
  source,
  tasks,
  onClose,
  onDuplicate,
}: {
  source: Task;
  tasks: Task[];
  onClose: () => void;
  onDuplicate: (source: Task, destinationParentId: string) => Promise<void>;
}) {
  const [destinationParentId, setDestinationParentId] = useState(
    source.parentId ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const blockedIds = new Set([source.id]);
  let changed = true;
  while (changed) {
    changed = false;
    tasks.forEach((task) => {
      if (task.parentId && blockedIds.has(task.parentId) && !blockedIds.has(task.id)) {
        blockedIds.add(task.id);
        changed = true;
      }
    });
  }
  const copiedCount = blockedIds.size;
  return (
    <Modal
      title="Copiar estrutura do Gantt"
      subtitle="A cópia preserva subitens, durações, disciplinas e dependências internas."
      onClose={() => !saving && onClose()}
    >
      <form
        className="duplicate-task-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError("");
          try {
            await onDuplicate(source, destinationParentId);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Não foi possível copiar a estrutura.");
            setSaving(false);
          }
        }}
      >
        <div className="copy-source-card">
          <Icon name="copy" />
          <div>
            <small>ESTRUTURA DE ORIGEM</small>
            <strong>{source.code} · {source.name}</strong>
            <span>{copiedCount} {copiedCount === 1 ? "atividade será copiada" : "atividades serão copiadas"}</span>
          </div>
        </div>
        <label>
          <span>Inserir dentro de</span>
          <select value={destinationParentId} onChange={(event) => setDestinationParentId(event.target.value)}>
            <option value="">Nível principal do projeto</option>
            {tasks.filter((task) => !blockedIds.has(task.id)).map((task) => (
              <option key={task.id} value={task.id}>{task.code} · {task.name}</option>
            ))}
          </select>
          <small>A nova estrutura entrará como o último subitem do destino escolhido.</small>
        </label>
        <div className="modal-note">
          <Icon name="info" />
          <p>O progresso da cópia começa em 0%. As datas são preservadas para você ajustar somente o novo conjunto.</p>
        </div>
        {error && <div className="access-message"><Icon name="alert" />{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" disabled={saving} onClick={onClose}>Cancelar</button>
          <button className="primary-btn" disabled={saving}>
            {saving ? <span className="button-spinner" /> : <Icon name="copy" />}
            {saving ? "Copiando..." : "Criar cópia"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GanttFilterModal({
  filters,
  phases,
  responsibles,
  statusCounts,
  onClose,
  onApply,
  onClear,
}: {
  filters: GanttFilters;
  phases: string[];
  responsibles: string[];
  statusCounts: Record<TaskExecutionStatus, number>;
  onClose: () => void;
  onApply: (filters: GanttFilters) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState<GanttFilters>(() => ({
    ...filters,
    phases: [...filters.phases],
    responsibles: [...filters.responsibles],
    statuses: [...filters.statuses],
  }));
  const toggleArrayValue = (
    field: "phases" | "responsibles" | "statuses",
    value: string,
  ) =>
    setDraft((current) => ({
      ...current,
      [field]: current[field].includes(value as never)
        ? current[field].filter((item) => item !== value)
        : [...current[field], value],
    }) as GanttFilters);

  return (
    <Modal
      title="Filtrar cronograma"
      subtitle="Combine critérios; atividades correspondentes mantêm toda a cadeia de pais visível."
      onClose={onClose}
      wide
    >
      <div className="gantt-filter-modal">
        <label className="gantt-filter-search">
          <span>Buscar em qualquer campo</span>
          <span className="search-box">
            <Icon name="search" />
            <input
              autoFocus
              value={draft.query}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  query: event.target.value,
                }))
              }
              placeholder="Atividade, EAP, disciplina, responsável ou observação"
            />
          </span>
        </label>

        <section className="gantt-filter-section">
          <header>
            <div><strong>Status</strong><small>Selecione um ou mais</small></div>
          </header>
          <div className="gantt-filter-options status-options">
            {(Object.keys(filterStatusLabels) as TaskExecutionStatus[]).map(
              (status) => (
                <label key={status} className={draft.statuses.includes(status) ? "active" : ""}>
                  <input
                    type="checkbox"
                    checked={draft.statuses.includes(status)}
                    onChange={() => toggleArrayValue("statuses", status)}
                  />
                  <span><i style={{ background: taskStatusPalette[status].period }} />{filterStatusLabels[status]}</span>
                  <b>{statusCounts[status]}</b>
                </label>
              ),
            )}
          </div>
        </section>

        <div className="gantt-filter-columns">
          <FilterOptionGroup
            title="Etapa / disciplina"
            options={phases}
            selected={draft.phases}
            emptyLabel="Nenhuma disciplina cadastrada"
            onToggle={(value) => toggleArrayValue("phases", value)}
          />
          <FilterOptionGroup
            title="Responsável"
            options={responsibles}
            selected={draft.responsibles}
            emptyLabel="Nenhum responsável cadastrado"
            onToggle={(value) => toggleArrayValue("responsibles", value)}
          />
        </div>

        <section className="gantt-filter-section">
          <header><div><strong>Período planejado</strong><small>Mostra atividades que cruzam o intervalo</small></div></header>
          <div className="gantt-filter-dates">
            <label><span>De</span><input type="date" value={draft.dateFrom} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
            <label><span>Até</span><input type="date" min={draft.dateFrom || undefined} value={draft.dateTo} onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))} /></label>
          </div>
        </section>

        <section className="gantt-filter-section">
          <header><div><strong>Características</strong><small>Refine por propriedades do planejamento</small></div></header>
          <div className="gantt-filter-flags">
            {([
              ["criticalOnly", "Caminho crítico", "Atividades marcadas como críticas"],
              ["milestonesOnly", "Somente marcos", "Entregas e decisões de duração zero"],
              ["dependenciesOnly", "Com dependências", "Predecessoras ou sucessoras vinculadas"],
              ["hideCompleted", "Ocultar concluídas", "Remove atividades finalizadas"],
            ] as const).map(([field, label, description]) => (
              <label key={field} className="setting-toggle">
                <span><strong>{label}</strong><small>{description}</small></span>
                <input type="checkbox" checked={draft[field]} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.checked }))} />
                <i />
              </label>
            ))}
          </div>
        </section>

        <div className="gantt-filter-hierarchy-note">
          <Icon name="info" />
          <span><strong>Contexto hierárquico preservado</strong><small>Se um neto corresponder ao filtro, o filho e o pai também serão exibidos para manter a leitura da EAP.</small></span>
        </div>
        <div className="modal-actions gantt-filter-actions">
          <button className="text-btn" onClick={onClear}>Limpar filtros</button>
          <button className="secondary-btn" onClick={onClose}>Cancelar</button>
          <button className="primary-btn" onClick={() => onApply(draft)}><Icon name="filter" /> Aplicar filtros</button>
        </div>
      </div>
    </Modal>
  );
}

function FilterOptionGroup({
  title,
  options,
  selected,
  emptyLabel,
  onToggle,
}: {
  title: string;
  options: string[];
  selected: string[];
  emptyLabel: string;
  onToggle: (value: string) => void;
}) {
  return (
    <section className="gantt-filter-section option-group">
      <header><div><strong>{title}</strong><small>{selected.length ? `${selected.length} selecionado(s)` : "Todos"}</small></div></header>
      <div className="gantt-filter-checklist">
        {options.length ? options.map((option) => (
          <label key={option} className={selected.includes(option) ? "active" : ""}>
            <input type="checkbox" checked={selected.includes(option)} onChange={() => onToggle(option)} />
            <span>{option}</span>
            <Icon name="check" />
          </label>
        )) : <small>{emptyLabel}</small>}
      </div>
    </section>
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
  const [creatingPhase, setCreatingPhase] = useState(false);
  const [plannedStart, setPlannedStart] = useState(
    initial?.plannedStart ?? project.start,
  );
  const [plannedEnd, setPlannedEnd] = useState(
    initial?.plannedEnd ?? project.start,
  );
  const [durationWorkDays, setDurationWorkDays] = useState(() =>
    initial?.durationDays != null
      ? normalizeWorkingDuration(initial.durationDays)
      : workingDuration(
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
  const [milestone, setMilestone] = useState(
    Boolean(initial?.milestone) && !derivesPeriod,
  );
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
    const activityDuration = normalizeWorkingDuration(durationWorkDays);
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
      const effectiveMilestone = milestone && !derivesPeriod;
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
        plannedEnd: effectiveMilestone ? plannedStart : safePlannedEnd,
        durationDays: effectiveMilestone
          ? 0.25
          : normalizeWorkingDuration(durationWorkDays),
        baselineStart,
        baselineEnd: effectiveMilestone ? baselineStart : safeBaselineEnd,
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
        milestone: effectiveMilestone,
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
  const phaseOptions = [...new Set(tasks.map((task) => task.phase).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
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
        <select
          required={!creatingPhase}
          value={creatingPhase ? "__new__" : phase}
          onChange={(event) => {
            if (event.target.value === "__new__") {
              setCreatingPhase(true);
              setPhase("");
            } else {
              setCreatingPhase(false);
              setPhase(event.target.value);
            }
          }}
        >
          <option value="" disabled>Selecione uma disciplina</option>
          {phaseOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          <option value="__new__">+ Criar nova disciplina</option>
        </select>
        {creatingPhase && (
          <input
            autoFocus
            required
            value={phase}
            onChange={(event) => setPhase(event.target.value)}
            placeholder="Nome da nova disciplina"
          />
        )}
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
          min="0.25"
          step="0.25"
          required
          disabled={milestone || derivesPeriod}
          value={milestone ? 1 : durationWorkDays}
          onChange={(event) => {
            const value = normalizeWorkingDuration(Number(event.target.value));
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
            disabled={derivesPeriod}
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
