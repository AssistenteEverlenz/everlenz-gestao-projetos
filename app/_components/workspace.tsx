"use client";
/* eslint-disable @next/next/no-img-element -- identidade visual local */

import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { currentUser, initialWorkspaces } from "./data";
import {
  AuthScreen,
  ConnectionError,
  LoadingScreen,
  OrganizationSetup,
} from "./auth";
import { Icon, type IconName } from "./icons";
import type {
  JournalEntry,
  Member,
  Project,
  ProjectWorkspace,
  Task,
  ViewId,
} from "./types";
import { Modal } from "./ui";
import { normalizeTaskHierarchy } from "./task-structure";
import { Overview } from "./views/overview";
import { Schedule } from "./views/schedule";
import { Journal } from "./views/journal";
import { Reports } from "./views/reports";
import { Team } from "./views/team";
import { Settings } from "./views/settings";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  approveRemoteStatusReport,
  createRemoteProject,
  createRemoteTask,
  deleteRemoteEntry,
  deleteRemoteTask,
  ensureRemoteStatusReport,
  getProfile,
  inviteRemoteMember,
  loadAvailableWorkspaces,
  recordRemoteEntry,
  reorderRemoteTasks,
  updateRemoteEntry,
  updateRemoteTask,
  updateRemoteTaskProgress,
} from "@/lib/supabase/repository";

const nav: Array<{ id: ViewId; label: string; short: string; icon: IconName }> =
  [
    { id: "overview", label: "Visão geral", short: "Início", icon: "home" },
    { id: "schedule", label: "Cronograma", short: "Gantt", icon: "gantt" },
    {
      id: "journal",
      label: "Diário de obra",
      short: "Diário",
      icon: "journal",
    },
    {
      id: "reports",
      label: "Status reports",
      short: "Reports",
      icon: "report",
    },
    { id: "team", label: "Equipe", short: "Equipe", icon: "team" },
  ];

const titles: Record<
  ViewId,
  { eyebrow: string; title: string; description: string }
> = {
  overview: {
    eyebrow: "CONTROLE DA OBRA",
    title: "Visão geral da obra",
    description: "Acompanhe os principais indicadores e o ritmo da execução.",
  },
  schedule: {
    eyebrow: "PLANEJAMENTO E CONTROLE",
    title: "Cronograma da obra",
    description:
      "Estruture a EAP, dependências, responsáveis, linha de base e avanço realizado.",
  },
  journal: {
    eyebrow: "ACOMPANHAMENTO DE CAMPO",
    title: "Diário de obra",
    description:
      "Registre evidências e meça o avanço diretamente nas atividades do Gantt.",
  },
  reports: {
    eyebrow: "COMUNICAÇÃO COM O CLIENTE",
    title: "Status reports",
    description:
      "Consolide o diário, as fotos e o cronograma completo em um relatório diário.",
  },
  team: {
    eyebrow: "PESSOAS E ACESSOS",
    title: "Equipe do projeto",
    description: "Controle quem registra, aprova e acompanha cada informação.",
  },
  settings: {
    eyebrow: "PREFERÊNCIAS",
    title: "Configurações",
    description: "Personalize a experiência e os padrões dos relatórios.",
  },
};

const storageKey = "emdia-workspaces-v3";

function withRecalculatedProgress(
  tasks: Task[],
  taskId: string,
  progress: number,
) {
  let next = tasks.map((task) =>
    task.id === taskId
      ? { ...task, progress: Math.max(0, Math.min(100, progress)) }
      : task,
  );
  let parentId = next.find((task) => task.id === taskId)?.parentId;
  while (parentId) {
    const children = next.filter((task) => task.parentId === parentId);
    const weight = children.reduce((sum, child) => sum + child.weight, 0);
    const parentProgress = weight
      ? Math.round(
          children.reduce(
            (sum, child) => sum + child.progress * child.weight,
            0,
          ) / weight,
        )
      : 0;
    const currentParentId: string = parentId;
    next = next.map((task) =>
      task.id === currentParentId
        ? { ...task, progress: parentProgress }
        : task,
    );
    parentId = next.find((task) => task.id === currentParentId)?.parentId;
  }
  return next;
}

export function Workspace() {
  const remoteMode = isSupabaseConfigured();
  const [view, setView] = useState<ViewId>("overview");
  const [workspaces, setWorkspaces] =
    useState<ProjectWorkspace[]>(initialWorkspaces);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [authReady, setAuthReady] = useState(!remoteMode);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(remoteMode);
  const [needsOrganization, setNeedsOrganization] = useState(false);
  const [remoteError, setRemoteError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [projectMenu, setProjectMenu] = useState(false);
  const [projectModal, setProjectModal] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspace =
    workspaces.find((item) => item.project.id === projectId) ?? workspaces[0];
  const meta = titles[view];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const savedTheme = window.localStorage.getItem("emdia-theme");
      const manualTheme =
        window.localStorage.getItem("emdia-theme-manual") === "true";
      setDark(
        manualTheme && savedTheme
          ? savedTheme === "dark"
          : window.matchMedia("(prefers-color-scheme: dark)").matches,
      );
      const saved = remoteMode ? null : window.localStorage.getItem(storageKey);
      if (saved && !remoteMode) {
        try {
          const parsed = JSON.parse(saved) as ProjectWorkspace[];
          setWorkspaces(parsed);
          setProjectId(parsed[0]?.project.id ?? null);
        } catch {
          window.localStorage.removeItem(storageKey);
        }
      }
      setHydrated(true);
    });
    collapseTimer.current = setTimeout(() => setSidebarExpanded(false), 400);
    return () => {
      window.cancelAnimationFrame(frame);
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    };
  }, [remoteMode]);

  useEffect(() => {
    if (!remoteMode) return;
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      setAuthUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setAuthUser(session?.user ?? null);
        setAuthReady(true);
      },
    );
    return () => listener.subscription.unsubscribe();
  }, [remoteMode]);

  useEffect(() => {
    if (!remoteMode || !authReady || !authUser) return;
    let active = true;
    loadAvailableWorkspaces(authUser.email ?? "")
      .then(({ profile, workspaces: loaded }) => {
        if (!active) return;
        setNeedsOrganization(!profile.organization_id);
        setWorkspaces(loaded);
        setProjectId((current) =>
          loaded.some((item) => item.project.id === current)
            ? current
            : (loaded[0]?.project.id ?? null),
        );
        setRemoteLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setRemoteError(
          cause instanceof Error
            ? cause.message
            : "Falha ao consultar o banco.",
        );
        setRemoteLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authReady, authUser, reloadToken, remoteMode]);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark, hydrated]);

  function chooseTheme(value: boolean) {
    window.localStorage.setItem("emdia-theme", value ? "dark" : "light");
    window.localStorage.setItem("emdia-theme-manual", "true");
    setDark(value);
  }

  useEffect(() => {
    if (!hydrated || remoteMode) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(workspaces));
    } catch {
      console.warn(
        "Limite do modo local atingido. Configure o Supabase para armazenar mais fotos.",
      );
    }
  }, [hydrated, remoteMode, workspaces]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const metrics = useMemo(() => {
    const tasks = workspace?.tasks ?? [];
    const measurable = tasks.filter(
      (task) => !tasks.some((child) => child.parentId === task.id),
    );
    const totalWeight = measurable.reduce((sum, task) => sum + task.weight, 0);
    const overall = totalWeight
      ? Math.round(
          measurable.reduce(
            (sum, task) => sum + task.progress * task.weight,
            0,
          ) / totalWeight,
        )
      : 0;
    return {
      overall,
      active: tasks.filter((task) => task.progress > 0 && task.progress < 100)
        .length,
    };
  }, [workspace]);

  function updateCurrent(
    update: (current: ProjectWorkspace) => ProjectWorkspace,
  ) {
    if (!workspace) return;
    setWorkspaces((current) =>
      current.map((item) =>
        item.project.id === workspace.project.id ? update(item) : item,
      ),
    );
  }

  function navigate(next: ViewId) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateTaskProgress(id: string, progress: number) {
    if (!workspace || workspace.tasks.some((task) => task.parentId === id)) {
      setToast(
        "O avanço do item-pai é calculado automaticamente pelos seus subitens.",
      );
      return;
    }
    updateCurrent((current) => ({
      ...current,
      tasks: withRecalculatedProgress(current.tasks, id, progress),
    }));
    if (remoteMode)
      void updateRemoteTaskProgress(id, progress).catch((cause) =>
        setToast(
          cause instanceof Error
            ? cause.message
            : "Falha ao atualizar a atividade.",
        ),
      );
  }

  function addTask(task: Task) {
    if (!workspace) return;
    const normalized = normalizeTaskHierarchy([...workspace.tasks, task]);
    const created = normalized.find((item) => item.id === task.id) ?? task;
    if (remoteMode) {
      setToast("Salvando atividade no cronograma...");
      void createRemoteTask(
        workspace.project.id,
        { ...created, code: `tmp-${created.id}` },
        workspace.members,
        workspace.tasks.length,
      )
        .then(() => reorderRemoteTasks(workspace.project.id, normalized))
        .then(() => {
          updateCurrent((current) => ({ ...current, tasks: normalized }));
          setToast("Atividade adicionada ao cronograma.");
        })
        .catch((cause) =>
          setToast(
            cause instanceof Error
              ? cause.message
              : "Não foi possível criar a atividade.",
          ),
        );
      return;
    }
    updateCurrent((current) => ({ ...current, tasks: normalized }));
    setToast("Atividade adicionada ao cronograma.");
  }

  async function editTask(task: Task) {
    if (!workspace) return;
    const previousCode =
      workspace.tasks.find((item) => item.id === task.id)?.code ?? task.code;
    const normalized = normalizeTaskHierarchy(
      workspace.tasks.map((item) => (item.id === task.id ? task : item)),
    );
    if (remoteMode) {
      await updateRemoteTask(
        workspace.project.id,
        { ...task, code: previousCode },
        workspace.members,
      );
      await reorderRemoteTasks(workspace.project.id, normalized);
    }
    updateCurrent((current) => ({ ...current, tasks: normalized }));
    setToast("Atividade atualizada no cronograma.");
  }

  async function reorderTasks(tasks: Task[]) {
    if (!workspace) return;
    const normalized = normalizeTaskHierarchy(tasks);
    if (remoteMode) await reorderRemoteTasks(workspace.project.id, normalized);
    updateCurrent((current) => ({ ...current, tasks: normalized }));
    setToast("Ordem e hierarquia do Gantt atualizadas.");
  }

  async function deleteTask(taskId: string) {
    if (!workspace) return;
    if (workspace.tasks.some((task) => task.parentId === taskId))
      throw new Error(
        "Exclua ou mova os subitens antes de excluir este item-pai.",
      );
    if (workspace.entries.some((entry) => entry.taskId === taskId))
      throw new Error(
        "Esta atividade possui Diário de Obra e não pode ser excluída.",
      );
    if (remoteMode) await deleteRemoteTask(workspace.project.id, taskId);
    const normalized = normalizeTaskHierarchy(
      workspace.tasks
        .filter((task) => task.id !== taskId)
        .map((task) =>
          task.dependencyId === taskId
            ? {
                ...task,
                dependencyId: undefined,
                dependencyType: undefined,
                lagDays: undefined,
              }
            : task,
        ),
    );
    updateCurrent((current) => ({ ...current, tasks: normalized }));
    setToast("Atividade excluída e EAP reorganizada.");
  }

  function addEntry(entry: JournalEntry) {
    if (!workspace) return;
    const applyEntry = () =>
      updateCurrent((current) => ({
        ...current,
        entries: [entry, ...current.entries],
        tasks: withRecalculatedProgress(
          current.tasks,
          entry.taskId,
          entry.progressAfter,
        ),
      }));
    if (remoteMode) {
      setToast("Enviando fotos e registrando a medição...");
      void recordRemoteEntry(workspace, entry)
        .then(() => {
          applyEntry();
          setToast(
            "Registro salvo, evidências vinculadas e cronograma atualizado.",
          );
        })
        .catch((cause) =>
          setToast(
            cause instanceof Error
              ? cause.message
              : "Não foi possível salvar o diário.",
          ),
        );
      return;
    }
    applyEntry();
    setToast("Registro salvo, evidências vinculadas e cronograma atualizado.");
  }

  async function editEntry(entry: JournalEntry) {
    if (!workspace) return;
    if (remoteMode) {
      await updateRemoteEntry(workspace, entry);
      setRemoteLoading(true);
      setReloadToken((value) => value + 1);
    } else {
      const previous = workspace.entries.find((item) => item.id === entry.id);
      const difference = entry.progressAdded - (previous?.progressAdded ?? 0);
      updateCurrent((current) => ({
        ...current,
        entries: current.entries.map((item) =>
          item.id === entry.id ? entry : item,
        ),
        tasks: withRecalculatedProgress(
          current.tasks,
          entry.taskId,
          (current.tasks.find((item) => item.id === entry.taskId)?.progress ??
            0) + difference,
        ),
      }));
    }
    setToast("Diário de obra atualizado e avanço recalculado.");
  }

  async function deleteEntry(entry: JournalEntry) {
    if (!workspace) return;
    if (remoteMode) {
      await deleteRemoteEntry(entry.id);
      setRemoteLoading(true);
      setReloadToken((value) => value + 1);
    } else {
      const remaining = workspace.entries.filter(
        (item) => item.id !== entry.id,
      );
      const taskEntries = remaining
        .filter((item) => item.taskId === entry.taskId)
        .sort((a, b) =>
          `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
        );
      let running = 0;
      const recalculated = taskEntries.map((item) => {
        const next = {
          ...item,
          progressBefore: running,
          progressAfter: Math.min(100, running + item.progressAdded),
        };
        running = next.progressAfter;
        return next;
      });
      updateCurrent((current) => ({
        ...current,
        entries: remaining.map(
          (item) => recalculated.find((next) => next.id === item.id) ?? item,
        ),
        tasks: withRecalculatedProgress(current.tasks, entry.taskId, running),
      }));
    }
    setToast("Diário excluído e avanço da atividade recalculado.");
  }

  function setMembers(value: React.SetStateAction<Member[]>) {
    updateCurrent((current) => ({
      ...current,
      members: typeof value === "function" ? value(current.members) : value,
    }));
  }

  async function inviteMember(member: Member) {
    if (!workspace) return;
    if (remoteMode) await inviteRemoteMember(workspace.project.id, member);
    setMembers((current) => [
      ...current,
      remoteMode ? { ...member, pending: true } : member,
    ]);
    setToast(
      remoteMode
        ? "Convite salvo. A pessoa deve acessar o Em Dia com esse e-mail."
        : "Convite adicionado à equipe.",
    );
  }

  async function ensureReport(reportDate: string) {
    if (!workspace) return;
    const id = remoteMode
      ? await ensureRemoteStatusReport(workspace.project.id, reportDate)
      : crypto.randomUUID();
    updateCurrent((current) =>
      current.reports?.some((report) => report.date === reportDate)
        ? current
        : {
            ...current,
            reports: [
              ...(current.reports ?? []),
              { id, date: reportDate, status: "draft" },
            ],
          },
    );
  }

  async function approveReport(reportDate: string) {
    if (!workspace) return;
    if (remoteMode)
      await approveRemoteStatusReport(workspace.project.id, reportDate);
    updateCurrent((current) => ({
      ...current,
      reports: (current.reports ?? []).map((report) =>
        report.date === reportDate
          ? { ...report, status: "approved" as const }
          : report,
      ),
    }));
    setToast("Relatório aprovado e pronto para compartilhamento.");
  }

  async function createProject(project: Project) {
    let persistedProject = project;
    if (remoteMode) {
      const id = await createRemoteProject(project);
      persistedProject = { ...project, id };
    }
    const next: ProjectWorkspace = {
      project: persistedProject,
      organizationId: remoteMode ? await getProfileOrganization() : undefined,
      tasks: [],
      entries: [],
      members: [
        remoteMode && authUser
          ? {
              ...currentUser,
              id: authUser.id,
              email: authUser.email ?? currentUser.email,
              name: authUser.user_metadata.full_name || currentUser.name,
            }
          : currentUser,
      ],
    };
    setWorkspaces((current) => [...current, next]);
    setProjectId(persistedProject.id);
    setProjectModal(false);
    setProjectMenu(false);
    setView("schedule");
    setToast("Projeto criado. Comece estruturando o cronograma.");
  }

  async function getProfileOrganization() {
    const profile = await getProfile();
    return profile.organization_id ?? undefined;
  }

  function expandSidebar() {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    setSidebarExpanded(true);
  }

  function scheduleCollapse() {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => {
      setSidebarExpanded(false);
      setProjectMenu(false);
    }, 400);
  }

  const common = workspace
    ? {
        project: workspace.project,
        tasks: normalizeTaskHierarchy(workspace.tasks),
        entries: workspace.entries,
        members: workspace.members,
        reports: workspace.reports ?? [],
        navigate,
        metrics,
      }
    : null;

  if (remoteMode && !authReady) return <LoadingScreen />;
  if (remoteMode && !authUser) return <AuthScreen />;
  if (remoteMode && remoteLoading)
    return <LoadingScreen message="Carregando projetos e registros..." />;
  if (remoteMode && remoteError)
    return (
      <ConnectionError
        message={remoteError}
        onRetry={() => {
          setRemoteError("");
          setRemoteLoading(true);
          setReloadToken((value) => value + 1);
        }}
      />
    );
  if (remoteMode && needsOrganization)
    return (
      <OrganizationSetup
        onReady={() => {
          setNeedsOrganization(false);
          setRemoteLoading(true);
          setReloadToken((value) => value + 1);
        }}
      />
    );

  return (
    <div
      className={`app-shell ${sidebarExpanded ? "sidebar-open" : "sidebar-compact"}`}
    >
      <aside
        className="sidebar glass"
        onMouseEnter={expandSidebar}
        onMouseLeave={scheduleCollapse}
      >
        <button
          className="brand"
          onClick={() => navigate("overview")}
          aria-label="Ir para visão geral"
        >
          <img src="/emdia.svg" alt="" />
          <span>
            <strong>em dia</strong>
            <small>BY EVERLENZ</small>
          </span>
        </button>

        <div className="sidebar-project-label">PROJETO ATUAL</div>
        <button
          className="sidebar-project"
          onClick={() =>
            workspace ? setProjectMenu((open) => !open) : setProjectModal(true)
          }
        >
          <span className="project-monogram">
            {workspace
              ? workspace.project.name
                  .split(" ")
                  .map((word) => word[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
              : "+"}
          </span>
          <span className="project-copy">
            <strong>{workspace?.project.name ?? "Criar projeto"}</strong>
            <small>
              {workspace?.project.location ?? "Comece uma nova obra"}
            </small>
          </span>
          <Icon name="chevron" />
        </button>
        {projectMenu && workspace && (
          <div className="project-switcher glass">
            {workspaces.map((option) => (
              <button
                key={option.project.id}
                className={
                  option.project.id === workspace.project.id ? "active" : ""
                }
                onClick={() => {
                  setProjectId(option.project.id);
                  setProjectMenu(false);
                }}
              >
                <strong>{option.project.name}</strong>
                <small>{option.project.client}</small>
              </button>
            ))}
            <button
              className="new-project-option"
              onClick={() => setProjectModal(true)}
            >
              <strong>+ Novo projeto</strong>
              <small>Criar uma obra do zero</small>
            </button>
          </div>
        )}

        <nav className="side-nav" aria-label="Navegação principal">
          {nav.map((item) => (
            <button
              key={item.id}
              disabled={!workspace}
              className={view === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === "reports" &&
                workspace &&
                workspace.entries.length > 0 && (
                  <em>{workspace.entries.length}</em>
                )}
            </button>
          ))}
        </nav>

        <div className="side-footer">
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
          >
            <Icon name="settings" />
            <span>Configurações</span>
          </button>
          <div className="user-card">
            <span className="avatar avatar-dark">GA</span>
            <span>
              <strong>Gustavo Adriano</strong>
              <small>Administrador</small>
            </span>
            <Icon name="more" />
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand">
            <img src="/emdia.svg" alt="" />
            <strong>
              em dia <span>BY EVERLENZ</span>
            </strong>
          </div>
          <div className="header-copy">
            <small>
              {workspace ? meta.eyebrow : "NOVO AMBIENTE DE PROJETOS"}
            </small>
            <h1>{workspace ? meta.title : "Vamos colocar sua obra em dia"}</h1>
            <p>
              {workspace
                ? meta.description
                : "Crie o primeiro projeto para montar o cronograma, registrar o campo e gerar relatórios."}
            </p>
          </div>
          <div className="header-actions">
            <div className="sync-state">
              <span /> {remoteMode ? "Supabase sincronizado" : "Modo local"}
            </div>
            <button
              className="icon-btn"
              onClick={() => chooseTheme(!dark)}
              aria-label="Alternar tema"
            >
              <Icon name={dark ? "sun" : "moon"} />
            </button>
            <button className="icon-btn notification" aria-label="Notificações">
              <Icon name="bell" />
            </button>
            <button
              className="avatar avatar-dark desktop-avatar"
              onClick={() =>
                remoteMode && getSupabaseBrowserClient().auth.signOut()
              }
              title={remoteMode ? "Sair" : undefined}
            >
              GA
            </button>
          </div>
        </header>

        <div className="content-area">
          {!workspace && (
            <EmptyWorkspace onCreate={() => setProjectModal(true)} />
          )}
          {workspace && common && view === "overview" && (
            <Overview {...common} />
          )}
          {workspace && common && view === "schedule" && (
            <Schedule
              {...common}
              addTask={addTask}
              editTask={editTask}
              deleteTask={deleteTask}
              editEntry={editEntry}
              deleteEntry={deleteEntry}
              reorderTasks={reorderTasks}
              updateTaskProgress={updateTaskProgress}
              setToast={setToast}
            />
          )}
          {workspace && common && view === "journal" && (
            <Journal
              {...common}
              addEntry={addEntry}
              editEntry={editEntry}
              deleteEntry={deleteEntry}
            />
          )}
          {workspace && common && view === "reports" && (
            <Reports
              {...common}
              ensureReport={ensureReport}
              approveReport={approveReport}
              setToast={setToast}
            />
          )}
          {workspace && common && view === "team" && (
            <Team {...common} inviteMember={inviteMember} setToast={setToast} />
          )}
          {view === "settings" && (
            <Settings dark={dark} setDark={chooseTheme} setToast={setToast} />
          )}
        </div>
      </main>

      {workspace && (
        <nav className="bottom-nav glass" aria-label="Navegação mobile">
          {nav.slice(0, 4).map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.short}</span>
            </button>
          ))}
          <button
            className={view === "team" || view === "settings" ? "active" : ""}
            onClick={() => navigate("team")}
          >
            <Icon name="more" />
            <span>Mais</span>
          </button>
        </nav>
      )}

      {projectModal && (
        <ProjectModal
          onClose={() => setProjectModal(false)}
          onCreate={createProject}
        />
      )}
      {toast && (
        <div className="toast">
          <span>
            <Icon name="check" />
          </span>
          {toast}
        </div>
      )}
    </div>
  );
}

function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="empty-workspace glass">
      <span className="empty-workspace-icon">
        <Icon name="building" />
      </span>
      <span className="overline">PRIMEIRO PASSO</span>
      <h2>Crie o projeto da obra</h2>
      <p>
        O ambiente começa vazio. Depois de cadastrar os dados básicos, você
        poderá estruturar a EAP no Gantt e liberar o Diário de Obra para a
        equipe de campo.
      </p>
      <div className="empty-workspace-flow">
        <span>
          <b>1</b> Projeto
        </span>
        <i />
        <span>
          <b>2</b> Cronograma
        </span>
        <i />
        <span>
          <b>3</b> Diário
        </span>
        <i />
        <span>
          <b>4</b> Relatório
        </span>
      </div>
      <button className="primary-btn" onClick={onCreate}>
        <Icon name="plus" /> Criar primeiro projeto
      </button>
    </section>
  );
}

function ProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (project: Project) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [location, setLocation] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onCreate({
        id: crypto.randomUUID(),
        name,
        client,
        location,
        start,
        end,
        contractNumber,
        description,
        progress: 0,
        status: "Planejamento",
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível criar o projeto.",
      );
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Criar novo projeto"
      subtitle="Cadastre a obra para iniciar o cronograma do zero."
      onClose={onClose}
      wide
    >
      <form className="project-form" onSubmit={submit}>
        <label className="full">
          <span>Nome da obra</span>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Residência Reserva da Serra"
          />
        </label>
        <label>
          <span>Cliente</span>
          <input
            required
            value={client}
            onChange={(event) => setClient(event.target.value)}
            placeholder="Nome ou razão social"
          />
        </label>
        <label>
          <span>Número do contrato</span>
          <input
            value={contractNumber}
            onChange={(event) => setContractNumber(event.target.value)}
            placeholder="Opcional"
          />
        </label>
        <label className="full">
          <span>Local da obra</span>
          <input
            required
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Cidade · UF ou endereço completo"
          />
        </label>
        <label>
          <span>Data de início</span>
          <input
            required
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label>
          <span>Previsão de término</span>
          <input
            required
            type="date"
            min={start}
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
        <label className="full">
          <span>Descrição e escopo</span>
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Resumo técnico do escopo da obra..."
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
            <Icon name="arrow" />{" "}
            {saving ? "Criando projeto..." : "Criar e montar cronograma"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
