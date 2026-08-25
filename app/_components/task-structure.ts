import type { Task } from "./types";

export type TaskExecutionStatus = "waiting" | "active" | "done" | "late";

export const taskStatusPalette: Record<
  TaskExecutionStatus,
  { period: string; progress: string; label: string }
> = {
  waiting: { period: "#d96f32", progress: "#f5a36f", label: "Não iniciada" },
  active: { period: "#3f6f8a", progress: "#79abc7", label: "Em andamento" },
  done: { period: "#3f735f", progress: "#79ad92", label: "Concluída" },
  late: { period: "#a84640", progress: "#db746c", label: "Em atraso" },
};

export function taskExecutionStatus(
  task: Task,
  now = new Date(),
): TaskExecutionStatus {
  if (task.progress >= 100) return "done";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (new Date(`${task.plannedEnd}T23:59:59`).getTime() < today.getTime())
    return "late";
  if (task.progress > 0) return "active";
  return "waiting";
}

export function normalizeTaskHierarchy(tasks: Task[]) {
  const ids = new Set(tasks.map((task) => task.id));
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const task of tasks) {
    if (task.parentId && task.parentId !== task.id && ids.has(task.parentId))
      children.set(task.parentId, [
        ...(children.get(task.parentId) ?? []),
        task,
      ]);
    else roots.push({ ...task, parentId: undefined });
  }
  const result: Task[] = [];
  const visited = new Set<string>();
  const visit = (task: Task, code: string, parentId?: string) => {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    result.push({ ...task, code, parentId });
    (children.get(task.id) ?? []).forEach((child, index) =>
      visit(child, `${code}.${index + 1}`, task.id),
    );
  };
  roots.forEach((task, index) => visit(task, String(index + 1)));
  tasks
    .filter((task) => !visited.has(task.id))
    .forEach((task) =>
      visit(
        { ...task, parentId: undefined },
        String(result.filter((item) => !item.parentId).length + 1),
      ),
    );
  return deriveParentPeriods(result);
}

export function deriveParentPeriods(tasks: Task[]) {
  const result = tasks.map((task) => ({ ...task }));
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const parent = result[index];
    const children = result.filter((task) => task.parentId === parent.id);
    if (!children.length) continue;
    parent.plannedStart = children.reduce(
      (value, child) =>
        child.plannedStart < value ? child.plannedStart : value,
      children[0].plannedStart,
    );
    parent.plannedEnd = children.reduce(
      (value, child) => (child.plannedEnd > value ? child.plannedEnd : value),
      children[0].plannedEnd,
    );
    const baselineChildren = children.filter(
      (child) => child.baselineStart && child.baselineEnd,
    );
    if (baselineChildren.length) {
      parent.baselineStart = baselineChildren.reduce(
        (value, child) =>
          child.baselineStart! < value ? child.baselineStart! : value,
        baselineChildren[0].baselineStart!,
      );
      parent.baselineEnd = baselineChildren.reduce(
        (value, child) =>
          child.baselineEnd! > value ? child.baselineEnd! : value,
        baselineChildren[0].baselineEnd!,
      );
    }
  }
  return result;
}

export function ancestorIds(tasks: Task[], taskIds: Iterable<string>) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ancestors = new Set<string>();
  for (const taskId of taskIds) {
    let parentId = byId.get(taskId)?.parentId;
    while (parentId && !ancestors.has(parentId)) {
      ancestors.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  }
  return ancestors;
}
