"use client";

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import type { ProjectWorkspace } from "../types";
import { Modal } from "../ui";

type PortfolioStatus = "all" | "active" | "waiting" | "completed" | "archived";

type Props = {
  workspaces: ProjectWorkspace[];
  currentUserId: string;
  onCreate: () => void;
  onOpen: (projectId: string) => void;
  onArchive: (projectId: string, archived: boolean) => Promise<void>;
};

const formatDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

function projectProgress(workspace: ProjectWorkspace) {
  const measurable = workspace.tasks.filter(
    (task) => !workspace.tasks.some((child) => child.parentId === task.id),
  );
  const weight = measurable.reduce((sum, task) => sum + task.weight, 0);
  return weight
    ? Math.round(
        measurable.reduce(
          (sum, task) => sum + task.progress * task.weight,
          0,
        ) / weight,
      )
    : 0;
}

function portfolioStatus(workspace: ProjectWorkspace): Exclude<PortfolioStatus, "all"> {
  if (workspace.project.archivedAt) return "archived";
  const progress = projectProgress(workspace);
  if (progress >= 100 || workspace.project.status === "Concluída") return "completed";
  if (progress > 0 || workspace.tasks.some((task) => task.progress > 0)) return "active";
  return "waiting";
}

const statusLabels = {
  active: "Em andamento",
  waiting: "Não iniciado",
  completed: "Concluído",
  archived: "Excluído",
} as const;

export function Projects({
  workspaces,
  currentUserId,
  onCreate,
  onOpen,
  onArchive,
}: Props) {
  const [filter, setFilter] = useState<PortfolioStatus>("all");
  const [search, setSearch] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<ProjectWorkspace | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const items = useMemo(
    () =>
      workspaces.filter((workspace) => {
        const status = portfolioStatus(workspace);
        const query = search.trim().toLocaleLowerCase("pt-BR");
        return (
          (filter === "all" || status === filter) &&
          (!query ||
            workspace.project.name.toLocaleLowerCase("pt-BR").includes(query) ||
            workspace.project.client.toLocaleLowerCase("pt-BR").includes(query) ||
            workspace.project.location.toLocaleLowerCase("pt-BR").includes(query))
        );
      }),
    [filter, search, workspaces],
  );
  const counts = useMemo(
    () =>
      workspaces.reduce(
        (result, workspace) => {
          result[portfolioStatus(workspace)] += 1;
          return result;
        },
        { active: 0, waiting: 0, completed: 0, archived: 0 },
      ),
    [workspaces],
  );

  function canManage(workspace: ProjectWorkspace) {
    const role = workspace.members.find((member) => member.id === currentUserId)?.role;
    return role === "Administrador" || role === "Gestor";
  }

  async function changeArchived(workspace: ProjectWorkspace, archived: boolean) {
    setProcessingId(workspace.project.id);
    try {
      await onArchive(workspace.project.id, archived);
      setArchiveTarget(null);
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div className="view-stack projects-view">
      <section className="portfolio-toolbar glass">
        <div>
          <span className="overline">PORTFÓLIO DA OPERAÇÃO</span>
          <h2>Todos os projetos em um só lugar</h2>
          <p>Acompanhe obras ativas, concluídas e arquivadas sem perder o histórico.</p>
        </div>
        <button className="primary-btn" onClick={onCreate}>
          <Icon name="plus" /> Novo projeto
        </button>
        <label className="search-box">
          <Icon name="search" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar projeto, cliente ou local..."
          />
        </label>
        <div className="portfolio-filters">
          {([
            ["all", "Todos", workspaces.length],
            ["active", "Em andamento", counts.active],
            ["waiting", "Não iniciados", counts.waiting],
            ["completed", "Concluídos", counts.completed],
            ["archived", "Excluídos", counts.archived],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label} <b>{count}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="portfolio-grid">
        {items.map((workspace) => {
          const status = portfolioStatus(workspace);
          const progress = projectProgress(workspace);
          const activeTasks = workspace.tasks.filter(
            (task) => task.progress > 0 && task.progress < 100,
          ).length;
          return (
            <article className={`project-card glass project-${status}`} key={workspace.project.id}>
              <header>
                <span className="project-card-monogram">
                  {workspace.project.name
                    .split(/\s+/)
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
                <div>
                  <small>{workspace.project.client}</small>
                  <h3>{workspace.project.name}</h3>
                  <p><Icon name="building" /> {workspace.project.location}</p>
                </div>
                <span className={`portfolio-status ${status}`}><i />{statusLabels[status]}</span>
              </header>
              <div className="project-card-progress">
                <span><b>Avanço físico</b><strong>{progress}%</strong></span>
                <i><b style={{ width: `${progress}%` }} /></i>
              </div>
              <div className="project-card-facts">
                <span><small>INÍCIO</small><strong>{formatDate(workspace.project.start)}</strong></span>
                <span><small>TÉRMINO</small><strong>{formatDate(workspace.project.end)}</strong></span>
                <span><small>CRONOGRAMA</small><strong>{workspace.tasks.length} atividades</strong></span>
                <span><small>EM EXECUÇÃO</small><strong>{activeTasks} atividades</strong></span>
              </div>
              <footer>
                {status !== "archived" ? (
                  <button className="primary-btn" onClick={() => onOpen(workspace.project.id)}>
                    Abrir projeto <Icon name="arrow" />
                  </button>
                ) : (
                  <button
                    className="primary-btn"
                    disabled={processingId === workspace.project.id || !canManage(workspace)}
                    onClick={() => void changeArchived(workspace, false)}
                  >
                    {processingId === workspace.project.id && <i className="button-spinner" />}
                    Reabrir projeto
                  </button>
                )}
                {status !== "archived" && canManage(workspace) && (
                  <button className="secondary-btn danger" onClick={() => setArchiveTarget(workspace)}>
                    <Icon name="trash" /> Excluir
                  </button>
                )}
              </footer>
            </article>
          );
        })}
        {!items.length && (
          <div className="portfolio-empty glass">
            <Icon name="building" />
            <strong>Nenhum projeto encontrado</strong>
            <p>Ajuste os filtros ou crie uma nova obra.</p>
          </div>
        )}
      </section>

      {archiveTarget && (
        <Modal
          title="Excluir projeto"
          subtitle="Esta operação é reversível e preserva todo o histórico."
          onClose={() => processingId === null && setArchiveTarget(null)}
        >
          <div className="confirm-delete-modal">
            <span className="confirm-delete-icon"><Icon name="trash" /></span>
            <h3>Arquivar {archiveTarget.project.name}?</h3>
            <p>O projeto sairá das obras ativas, mas continuará disponível no filtro Excluídos para reabertura.</p>
            <div className="modal-actions">
              <button className="secondary-btn" disabled={processingId !== null} onClick={() => setArchiveTarget(null)}>Cancelar</button>
              <button className="primary-btn danger" disabled={processingId !== null} onClick={() => void changeArchived(archiveTarget, true)}>
                {processingId !== null && <i className="button-spinner" />}
                {processingId !== null ? "Excluindo..." : "Excluir projeto"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
