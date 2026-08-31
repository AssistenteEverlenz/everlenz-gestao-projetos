import type { InventoryItem, ReportSummary, Task } from "./types";

export type AutomaticAttention = {
  id: string;
  kind: string;
  tone: "critical" | "high" | "medium";
  title: string;
  detail: string;
};

export function buildAutomaticAttention(
  tasks: Task[],
  inventory: InventoryItem[],
  reports: ReportSummary[],
  referenceDate = new Date(),
): AutomaticAttention[] {
  const today = referenceDate.toISOString().slice(0, 10);
  const late = tasks
    .filter((task) => task.progress < 100 && task.plannedEnd < today)
    .map((task): AutomaticAttention => ({
      id: `task-${task.id}`,
      kind: "Cronograma",
      tone: "critical",
      title: `${task.code} · ${task.name} está em atraso`,
      detail: `Término previsto em ${task.plannedEnd.split("-").reverse().join("/")} · ${task.progress}% concluído`,
    }));
  const stock = inventory
    .map((item) => ({
      item,
      available: item.quantity - item.allocations.reduce(
        (sum, allocation) => sum + Math.max(0, allocation.planned - allocation.consumed),
        0,
      ),
    }))
    .filter(({ item, available }) => available <= item.minimum)
    .map(({ item, available }): AutomaticAttention => ({
      id: `stock-${item.id}`,
      kind: "Estoque",
      tone: available <= 0 ? "critical" : "high",
      title: available <= 0
        ? `${item.name} está sem estoque disponível`
        : `${item.name} atingiu o estoque mínimo`,
      detail: `Disponível ${available} ${item.unit} · saldo físico ${item.quantity} ${item.unit} · mínimo ${item.minimum} ${item.unit}`,
    }));
  const requests = inventory.flatMap((item) =>
    (item.requests ?? [])
      .filter((request) => request.status === "pending" || request.status === "approved")
      .map((request): AutomaticAttention => ({
        id: `request-${request.id}`,
        kind: "Requisição de estoque",
        tone: request.status === "approved" ? "high" : "medium",
        title: `${item.name} · ${request.quantity} ${item.unit}`,
        detail: request.status === "approved"
          ? `Aprovada e aguardando entrega para ${request.purpose}`
          : `Solicitada por ${request.requestedBy} para ${request.purpose}`,
      })),
  );
  const pendingReports = reports
    .filter((report) => report.status === "draft" || report.status === "review")
    .map((report): AutomaticAttention => ({
      id: `report-${report.id}`,
      kind: "Relatório",
      tone: "medium",
      title: "Status report aguardando aprovação",
      detail: report.date.split("-").reverse().join("/"),
    }));
  return [...late, ...stock, ...requests, ...pendingReports];
}
