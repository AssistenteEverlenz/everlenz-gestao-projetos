import type { Task } from "./types";
import { normalizeTaskHierarchy } from "./task-structure";

const defaultDays = [1, 2, 3, 4, 5];

export function projectWorkDays(days?: number[]) {
  const valid = [
    ...new Set(
      (days?.length ? days : defaultDays).filter((day) => day >= 0 && day <= 6),
    ),
  ];
  return valid.length ? valid : defaultDays;
}

const localDate = (value: string) => new Date(`${value}T12:00:00`);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export function nextWorkingDay(
  value: string,
  workDays?: number[],
  direction = 1,
) {
  const allowed = projectWorkDays(workDays);
  const date = localDate(value);
  do date.setDate(date.getDate() + direction);
  while (!allowed.includes(date.getDay()));
  return isoDate(date);
}

export function shiftWorkingDays(
  value: string,
  amount: number,
  workDays?: number[],
) {
  if (!amount) return value;
  let result = value;
  const direction = amount > 0 ? 1 : -1;
  for (let index = 0; index < Math.abs(amount); index += 1)
    result = nextWorkingDay(result, workDays, direction);
  return result;
}

const EPSILON = 1e-6;

/**
 * Último dia útil da atividade. `startOffset` é a fração do primeiro dia já
 * ocupada por um antecessor (0,5 começa no meio do dia): 0,5 + 0,5 cabem no mesmo dia.
 */
export function workingEnd(
  start: string,
  duration: number,
  workDays?: number[],
  startOffset = 0,
) {
  const allowed = projectWorkDays(workDays);
  let result = start;
  if (!allowed.includes(localDate(result).getDay()))
    result = nextWorkingDay(result, allowed);
  return shiftWorkingDays(
    result,
    Math.max(1, Math.ceil(Math.max(0.01, startOffset + duration) - EPSILON)) -
      1,
    allowed,
  );
}

/** Ponto do último dia em que a atividade termina: 0,5 = meio do dia, 1 = dia inteiro. */
function finishFraction(startOffset: number, duration: number) {
  const finish = Math.round((startOffset + duration) * 10_000) / 10_000;
  const remainder = finish - Math.floor(finish);
  return remainder < EPSILON ? 1 : remainder;
}

const isParentTask = (tasks: Task[], taskId: string) =>
  tasks.some((task) => task.parentId === taskId);

/**
 * Fração do primeiro dia já ocupada quando cada atividade começa (0 ≤ fração < 1).
 * Só vínculos Término→Início entre atividades executáveis herdam a fração, e apenas
 * quando o sucessor começa no mesmo dia em que o antecessor termina.
 */
export function taskStartOffsets(tasks: Task[], workDays?: number[]) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const offsets = new Map<string, number>();
  const visiting = new Set<string>();
  const offsetOf = (task: Task): number => {
    const cached = offsets.get(task.id);
    if (cached !== undefined) return cached;
    let offset = 0;
    const predecessor = task.dependencyId
      ? byId.get(task.dependencyId)
      : undefined;
    if (
      predecessor &&
      !visiting.has(task.id) &&
      (task.dependencyType ?? "FS") === "FS" &&
      !isParentTask(tasks, task.id) &&
      !isParentTask(tasks, predecessor.id)
    ) {
      visiting.add(task.id);
      const finish = finishFraction(
        offsetOf(predecessor),
        taskWorkingDuration(predecessor, workDays),
      );
      visiting.delete(task.id);
      if (
        finish < 1 &&
        task.plannedStart ===
          shiftWorkingDays(predecessor.plannedEnd, task.lagDays ?? 0, workDays)
      )
        offset = finish;
    }
    offsets.set(task.id, offset);
    return offset;
  };
  tasks.forEach(offsetOf);
  return offsets;
}

/** Ponto do último dia em que a atividade termina; itens-pai ocupam dias inteiros. */
export function taskFinishFraction(
  task: Task,
  tasks: Task[],
  offsets: Map<string, number>,
  workDays?: number[],
) {
  if (isParentTask(tasks, task.id)) return 1;
  return finishFraction(
    offsets.get(task.id) ?? 0,
    taskWorkingDuration(task, workDays),
  );
}

/**
 * Início de um sucessor Término→Início: no mesmo dia quando o antecessor deixa
 * parte do seu último dia livre, senão no dia útil seguinte.
 */
export function finishToStart(
  predecessor: Task,
  tasks: Task[],
  offsets: Map<string, number>,
  lag: number,
  workDays?: number[],
) {
  const finish = taskFinishFraction(predecessor, tasks, offsets, workDays);
  const sameDay = finish < 1;
  return {
    start: shiftWorkingDays(
      sameDay
        ? predecessor.plannedEnd
        : nextWorkingDay(predecessor.plannedEnd, workDays),
      lag,
      workDays,
    ),
    offset: sameDay ? finish : 0,
  };
}

export function taskWorkingDuration(task: Task, workDays?: number[]) {
  return normalizeWorkingDuration(
    task.durationDays ??
      workingDuration(task.plannedStart, task.plannedEnd, workDays),
  );
}

export function normalizeWorkingDuration(value: number) {
  return Math.max(0.25, Math.round(value * 4) / 4);
}

export function workingDuration(
  start: string,
  end: string,
  workDays?: number[],
) {
  const allowed = projectWorkDays(workDays);
  const cursor = localDate(start);
  const finish = localDate(end);
  let count = 0;
  while (cursor <= finish) {
    if (allowed.includes(cursor.getDay())) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.max(1, count);
}

function workingShiftBetween(
  from: string,
  to: string,
  workDays?: number[],
) {
  if (from === to) return 0;
  const direction = from < to ? 1 : -1;
  let cursor = from;
  let amount = 0;
  let guard = 0;
  while (
    (direction > 0 ? cursor < to : cursor > to) &&
    guard < 20_000
  ) {
    cursor = nextWorkingDay(cursor, workDays, direction);
    amount += direction;
    guard += 1;
  }
  return amount;
}

export function rescheduleTasks(
  tasks: Task[],
  previousDays: number[] | undefined,
  nextDays: number[],
) {
  const durations = new Map(
    tasks.map((task) => [
      task.id,
      tasks.some((child) => child.parentId === task.id)
        ? workingDuration(task.plannedStart, task.plannedEnd, previousDays)
        : taskWorkingDuration(task, previousDays),
    ]),
  );
  let result = tasks.map((task) => ({
    ...task,
    plannedEnd: workingEnd(
      task.plannedStart,
      durations.get(task.id) ?? 1,
      nextDays,
    ),
  }));
  for (let pass = 0; pass < tasks.length; pass += 1) {
    const current = result;
    const offsets = taskStartOffsets(current, nextDays);
    result = current.map((task) => {
      const predecessor = current.find((item) => item.id === task.dependencyId);
      if (!predecessor) return task;
      const lag = task.lagDays ?? 0;
      const relation = task.dependencyType ?? "FS";
      const length = durations.get(task.id) ?? 1;
      if (relation === "FS") {
        const { start, offset } = finishToStart(
          predecessor,
          current,
          offsets,
          lag,
          nextDays,
        );
        return {
          ...task,
          plannedStart: start,
          plannedEnd: workingEnd(
            start,
            length,
            nextDays,
            isParentTask(current, task.id) ? 0 : offset,
          ),
        };
      }
      if (relation === "SS") {
        const plannedStart = shiftWorkingDays(
          predecessor.plannedStart,
          lag,
          nextDays,
        );
        return {
          ...task,
          plannedStart,
          plannedEnd: workingEnd(plannedStart, length, nextDays),
        };
      }
      const anchor =
        relation === "FF" ? predecessor.plannedEnd : predecessor.plannedStart;
      const plannedEnd = shiftWorkingDays(anchor, lag, nextDays);
      return {
        ...task,
        plannedEnd,
        plannedStart: shiftWorkingDays(
          plannedEnd,
          -(Math.ceil(length) - 1),
          nextDays,
        ),
      };
    });
  }
  return result;
}

/**
 * Reagenda, em cascata, todos os sucessores da atividade alterada.
 * A duração de cada sucessor é preservada e somente as datas são movidas.
 */
export function rescheduleTaskSuccessors(
  tasks: Task[],
  changedTaskId: string,
  workDays?: number[],
) {
  let result = tasks.map((task) => ({ ...task }));
  const originalDates = new Map(
    result.map((task) => [task.id, `${task.plannedStart}|${task.plannedEnd}`]),
  );
  const durations = new Map(
    result.map((task) => [
      task.id,
      result.some((child) => child.parentId === task.id)
        ? workingDuration(task.plannedStart, task.plannedEnd, workDays)
        : taskWorkingDuration(task, workDays),
    ]),
  );
  result = normalizeTaskHierarchy(result);
  let byId = new Map(result.map((task) => [task.id, task]));
  const editedDependencyId = byId.get(changedTaskId)?.dependencyId;
  const queue = [
    ...(editedDependencyId ? [editedDependencyId] : []),
    changedTaskId,
    ...result
      .filter(
        (task) =>
          originalDates.get(task.id) !==
          `${task.plannedStart}|${task.plannedEnd}`,
      )
      .map((task) => task.id),
  ];
  const processedSignatures = new Map<string, string>();
  const maximumSteps = Math.max(1, tasks.length * tasks.length * 4);
  let steps = 0;

  while (queue.length && steps < maximumSteps) {
    steps += 1;
    const predecessorId = queue.shift();
    if (!predecessorId) continue;
    const predecessor = byId.get(predecessorId);
    if (!predecessor) continue;

    const successorIds = result
      .filter((task) => task.dependencyId === predecessorId)
      .map((task) => task.id);
    for (const successorId of successorIds) {
      const successor = byId.get(successorId);
      if (!successor) continue;
      const relation = successor.dependencyType ?? "FS";
      const lag = successor.lagDays ?? 0;
      const duration = durations.get(successor.id) ?? 1;
      const offsets = taskStartOffsets(result, workDays);
      const predecessorFinish = taskFinishFraction(
        predecessor,
        result,
        offsets,
        workDays,
      );
      const signature = `${predecessor.plannedStart}|${predecessor.plannedEnd}|${predecessorFinish}|${relation}|${lag}|${duration}`;
      if (processedSignatures.get(successor.id) === signature) continue;
      processedSignatures.set(successor.id, signature);
      // Compara datas e fração inicial: um antecessor pode mudar só a fração do dia.
      const stateBefore = new Map(
        result.map((task) => [
          task.id,
          `${task.plannedStart}|${task.plannedEnd}|${offsets.get(task.id) ?? 0}`,
        ]),
      );
      const fsStart = finishToStart(
        predecessor,
        result,
        offsets,
        lag,
        workDays,
      );

      const descendantIds = new Set<string>();
      const collectDescendants = (parentId: string) => {
        result
          .filter((task) => task.parentId === parentId)
          .forEach((child) => {
            if (descendantIds.has(child.id)) return;
            descendantIds.add(child.id);
            collectDescendants(child.id);
          });
      };
      collectDescendants(successor.id);

      if (descendantIds.size) {
        const targetDate =
          relation === "FS"
            ? fsStart.start
            : relation === "SS"
            ? shiftWorkingDays(predecessor.plannedStart, lag, workDays)
            : shiftWorkingDays(
                relation === "FF"
                  ? predecessor.plannedEnd
                  : predecessor.plannedStart,
                lag,
                workDays,
              );
        const currentAnchor =
          relation === "FS" || relation === "SS"
            ? successor.plannedStart
            : successor.plannedEnd;
        const shift = workingShiftBetween(currentAnchor, targetDate, workDays);
        result.forEach((task) => {
          if (!descendantIds.has(task.id)) return;
          task.plannedStart = shiftWorkingDays(
            task.plannedStart,
            shift,
            workDays,
          );
          task.plannedEnd = shiftWorkingDays(
            task.plannedEnd,
            shift,
            workDays,
          );
        });
      } else if (relation === "FS") {
        successor.plannedStart = fsStart.start;
        successor.plannedEnd = workingEnd(
          fsStart.start,
          duration,
          workDays,
          fsStart.offset,
        );
      } else if (relation === "SS") {
        successor.plannedStart = shiftWorkingDays(
          predecessor.plannedStart,
          lag,
          workDays,
        );
        successor.plannedEnd = workingEnd(
          successor.plannedStart,
          duration,
          workDays,
        );
      } else {
        const anchor =
          relation === "FF"
            ? predecessor.plannedEnd
            : predecessor.plannedStart;
        successor.plannedEnd = shiftWorkingDays(anchor, lag, workDays);
        successor.plannedStart = shiftWorkingDays(
          successor.plannedEnd,
          -(Math.ceil(duration) - 1),
          workDays,
        );
      }

      result = normalizeTaskHierarchy(result);
      byId = new Map(result.map((task) => [task.id, task]));
      const offsetsAfter = taskStartOffsets(result, workDays);
      for (const changed of result) {
        if (
          stateBefore.get(changed.id) !==
          `${changed.plannedStart}|${changed.plannedEnd}|${offsetsAfter.get(changed.id) ?? 0}`
        )
          queue.push(changed.id);
      }
    }
  }

  return result;
}
