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

export function workingEnd(
  start: string,
  duration: number,
  workDays?: number[],
) {
  const allowed = projectWorkDays(workDays);
  let result = start;
  if (!allowed.includes(localDate(result).getDay()))
    result = nextWorkingDay(result, allowed);
  return shiftWorkingDays(result, Math.max(1, duration) - 1, allowed);
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

export function rescheduleTasks(
  tasks: Task[],
  previousDays: number[] | undefined,
  nextDays: number[],
) {
  const durations = new Map(
    tasks.map((task) => [
      task.id,
      workingDuration(task.plannedStart, task.plannedEnd, previousDays),
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
    result = result.map((task) => {
      const predecessor = result.find((item) => item.id === task.dependencyId);
      if (!predecessor) return task;
      const lag = task.lagDays ?? 0;
      const relation = task.dependencyType ?? "FS";
      const length = durations.get(task.id) ?? 1;
      if (relation === "FS" || relation === "SS") {
        const anchor =
          relation === "FS"
            ? nextWorkingDay(predecessor.plannedEnd, nextDays)
            : predecessor.plannedStart;
        const plannedStart = shiftWorkingDays(anchor, lag, nextDays);
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
        plannedStart: shiftWorkingDays(plannedEnd, -(length - 1), nextDays),
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
      workingDuration(task.plannedStart, task.plannedEnd, workDays),
    ]),
  );
  result = normalizeTaskHierarchy(result);
  let byId = new Map(result.map((task) => [task.id, task]));
  const queue = [
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
      const signature = `${predecessor.plannedStart}|${predecessor.plannedEnd}|${relation}|${lag}|${duration}`;
      if (processedSignatures.get(successor.id) === signature) continue;
      processedSignatures.set(successor.id, signature);
      const datesBefore = new Map(
        result.map((task) => [
          task.id,
          `${task.plannedStart}|${task.plannedEnd}`,
        ]),
      );

      if (relation === "FS" || relation === "SS") {
        const anchor =
          relation === "FS"
            ? nextWorkingDay(predecessor.plannedEnd, workDays)
            : predecessor.plannedStart;
        successor.plannedStart = shiftWorkingDays(anchor, lag, workDays);
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
          -(duration - 1),
          workDays,
        );
      }

      result = normalizeTaskHierarchy(result);
      byId = new Map(result.map((task) => [task.id, task]));
      for (const changed of result) {
        if (
          datesBefore.get(changed.id) !==
          `${changed.plannedStart}|${changed.plannedEnd}`
        )
          queue.push(changed.id);
      }
    }
  }

  return result;
}
