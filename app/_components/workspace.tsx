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
  InventoryItem,
  InventoryMovement,
  InventoryRequest,
  JournalEntry,
  Member,
  Project,
  ProjectIssue,
  ProjectTeam,
  ProjectWorkspace,
  ReportTemplate,
  Task,
  ViewId,
} from "./types";
import { Modal } from "./ui";
import { FirstAccess } from "./first-access";
import { OnboardingTour } from "./onboarding-tour";
import { normalizeTaskHierarchy } from "./task-structure";
import { rescheduleTasks, rescheduleTaskSuccessors } from "./work-calendar";
import { Overview } from "./views/overview";
import { Schedule } from "./views/schedule";
import { Journal } from "./views/journal";
import { Reports } from "./views/reports";
import { Team } from "./views/team";
import { Settings } from "./views/settings";
import { Photos } from "./views/photos";
import { Inventory } from "./views/inventory";
import { Alerts } from "./views/alerts";
import { buildAutomaticAttention, type AutomaticAttention } from "./attention-data";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  approveRemoteStatusReport,
  createRemoteProject,
  createRemoteTask,
  deleteRemoteMember,
  deleteRemoteEntry,
  deleteRemoteTask,
  ensureRemoteStatusReport,
  getProfile,
  inviteRemoteMember,
  loadAvailableWorkspaces,
  recordRemoteEntry,
  resetRemoteMemberPassword,
  reorderRemoteTasks,
  updateRemoteEntry,
  updateRemoteMember,
  updateRemoteProjectWorkDays,
  updateRemoteTaskDates,
  updateRemoteTask,
  updateRemoteTaskProgress,
  deleteRemoteInventoryItem,
  deleteRemoteInventoryMovement,
  deleteRemoteProjectTeam,
  moveRemoteInventory,
  updateRemoteInventoryMovement,
  createRemoteInventoryRequest,
  transitionRemoteInventoryRequest,
  importRemoteInventoryItems,
  saveRemoteInventoryItem,
  saveRemoteIssue,
  saveRemoteProjectTeam,
  saveRemoteReportTemplate,
  saveRemoteReportSummary,
  generateRemoteReportSummary,
  transitionRemoteStatusReport,
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
    { id: "photos", label: "Galeria da obra", short: "Fotos", icon: "camera" },
    { id: "inventory", label: "Estoque", short: "Estoque", icon: "building" },
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
  photos: {
    eyebrow: "EVIDÊNCIAS DA EXECUÇÃO",
    title: "Galeria da obra",
    description: "Localize, relacione e reúna as evidências fotográficas por EAP.",
  },
  inventory: {
    eyebrow: "SUPRIMENTOS E PLANEJAMENTO",
    title: "Estoque da obra",
    description: "Controle saldos e antecipe reposições conforme a necessidade das EAPs.",
  },
  alerts: {
    eyebrow: "GESTÃO PREVENTIVA",
    title: "Central de atenção",
    description: "Acompanhe riscos de prazo, estoque, relatórios e ocorrências do campo.",
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
  const [mobileMenu, setMobileMenu] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [realtimeState, setRealtimeState] = useState<
    "connecting" | "connected" | "updating" | "error"
  >("connecting");
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const workspace =
    workspaces.find((item) => item.project.id === projectId) ?? workspaces[0];
  const authenticatedMember = workspace?.members.find(
    (member) => member.id === (authUser?.id ?? currentUser.id),
  ) ?? (authUser ? {
    ...currentUser,
    id: authUser.id,
    name: authUser.user_metadata.full_name || authUser.email || "Usuário",
    email: authUser.email ?? "",
    initials: String(authUser.user_metadata.full_name || authUser.email || "U").split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
    role: "Usuário" as const,
  } : currentUser);
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
        setRealtimeState("connected");
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
    if (!remoteMode || !authUser) return;
    const supabase = getSupabaseBrowserClient();
    const refresh = () => {
      setRealtimeState("updating");
      if (realtimeRefreshTimer.current)
        clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = setTimeout(
        () => setReloadToken((value) => value + 1),
        320,
      );
    };
    const tables = [
      "profiles",
      "projects",
      "project_members",
      "project_invitations",
      "tasks",
      "daily_logs",
      "task_updates",
      "update_photos",
      "status_reports",
      "project_teams",
      "project_team_members",
      "task_update_teams",
      "inventory_items",
      "inventory_allocations",
      "inventory_movements",
      "inventory_requests",
      "project_issues",
      "report_templates",
      "status_report_events",
    ];
    let channel = supabase.channel(`emdia-live-${authUser.id}`);
    for (const table of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        refresh,
      );
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") setRealtimeState("connected");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        setRealtimeState("error");
    });
    return () => {
      if (realtimeRefreshTimer.current)
        clearTimeout(realtimeRefreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [authUser, remoteMode]);

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

  async function signOut() {
    if (!remoteMode || signingOut) return;
    setSigningOut(true);
    const { error } = await getSupabaseBrowserClient().auth.signOut();
    if (error) {
      setSigningOut(false);
      setToast(error.message);
    }
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
      rescheduleTaskSuccessors(
        workspace.tasks.map((item) => (item.id === task.id ? task : item)),
        task.id,
        workspace.project.workDays,
      ),
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

  async function updateProjectWorkDays(workDays: number[]) {
    if (!workspace) return;
    const tasks = normalizeTaskHierarchy(
      rescheduleTasks(workspace.tasks, workspace.project.workDays, workDays),
    );
    if (remoteMode) {
      await updateRemoteProjectWorkDays(workspace.project.id, workDays);
      await updateRemoteTaskDates(workspace.project.id, tasks);
    }
    updateCurrent((current) => ({
      ...current,
      project: { ...current.project, workDays },
      tasks,
    }));
    setToast("Calendário de trabalho atualizado.");
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

  function updateMembersInAccount(update: (members: Member[]) => Member[]) {
    const organizationId = workspace?.organizationId;
    setWorkspaces((current) => current.map((item) =>
      !organizationId || item.organizationId === organizationId
        ? { ...item, members: update(item.members) }
        : item,
    ));
  }

  async function inviteMember(member: Member) {
    if (!workspace) return {};
    const result = remoteMode
      ? await inviteRemoteMember(workspace.project.id, member)
      : { member, temporaryPassword: undefined };
    updateMembersInAccount((current) => current.some((item) => item.id === result.member.id) ? current : [...current, result.member]);
    setToast(
      remoteMode
        ? "Usuário criado e liberado para acessar o Em Dia."
        : "Pessoa adicionada à equipe.",
    );
    return { temporaryPassword: result.temporaryPassword };
  }

  async function updateMember(member: Member) {
    if (!workspace) return;
    if (remoteMode) await updateRemoteMember(workspace.project.id, member);
    updateMembersInAccount((current) => current.map((item) => item.id === member.id ? { ...item, ...member } : item));
  }

  async function resetMemberPassword(member: Member) {
    if (!workspace || !remoteMode) return { temporaryPassword: "" };
    const result = await resetRemoteMemberPassword(workspace.project.id, member.id);
    return { temporaryPassword: result.senha_provisoria };
  }

  async function deleteMember(member: Member) {
    if (!workspace) return;
    if (remoteMode) await deleteRemoteMember(workspace.project.id, member.id);
    updateMembersInAccount((current) => current.filter((item) => item.id !== member.id));
  }

  async function saveProjectTeam(team: ProjectTeam) {
    if (!workspace) return;
    const persisted = { ...team, id: team.id || crypto.randomUUID() };
    if (remoteMode) {
      await saveRemoteProjectTeam(workspace.project.id, team);
      setReloadToken((value) => value + 1);
    } else updateCurrent((current) => ({ ...current, projectTeams: team.id ? (current.projectTeams ?? []).map((item) => item.id === team.id ? persisted : item) : [...(current.projectTeams ?? []), persisted] }));
    setToast("Equipe operacional salva.");
  }

  async function deleteProjectTeam(team: ProjectTeam) {
    if (!workspace) return;
    if (remoteMode) await deleteRemoteProjectTeam(team.id);
    updateCurrent((current) => ({ ...current, projectTeams: (current.projectTeams ?? []).filter((item) => item.id !== team.id) }));
    setToast("Equipe operacional removida.");
  }

  async function saveInventoryItem(item: InventoryItem) {
    if (!workspace) return;
    const persisted = { ...item, id: item.id || crypto.randomUUID() };
    if (remoteMode) {
      await saveRemoteInventoryItem(workspace.project.id, item);
      setReloadToken((value) => value + 1);
    } else updateCurrent((current) => ({ ...current, inventory: item.id ? (current.inventory ?? []).map((currentItem) => currentItem.id === item.id ? persisted : currentItem) : [...(current.inventory ?? []), persisted] }));
    setToast("Material e reservas atualizados.");
  }

  async function moveInventoryItem(itemId: string, type: "entry" | "exit" | "adjustment", quantity: number, taskId?: string, purpose?: string, receiver?: string, receiverKind?: "user" | "team" | "worker", receiverId?: string, document?: string) {
    if (!workspace) return;
    if (remoteMode) {
      await moveRemoteInventory(itemId, type, quantity, taskId, purpose, receiver, receiverKind, receiverId, document);
      setReloadToken((value) => value + 1);
    } else updateCurrent((current) => ({ ...current, inventory: (current.inventory ?? []).map((item) => {
      if (item.id !== itemId) return item;
      const nextQuantity = type === "entry" ? item.quantity + quantity : type === "exit" ? item.quantity - quantity : quantity;
      const balance = Math.max(0, nextQuantity);
      return { ...item, quantity: balance, allocations: type === "exit" && taskId ? item.allocations.map((allocation) => allocation.taskId === taskId ? { ...allocation, consumed: Math.min(allocation.planned, allocation.consumed + quantity) } : allocation) : item.allocations, movements: [{ id: crypto.randomUUID(), internalCode: `MOV-${Date.now()}`, type, quantity, balanceAfter: balance, taskId, purpose: purpose || "Movimentação de estoque", receiver, receiverKind, receiverId, document, createdBy: currentUser.name, createdAt: new Date().toISOString() }, ...(item.movements ?? [])] };
    }) }));
    setToast("Movimentação registrada no estoque.");
  }

  async function updateInventoryMovement(itemId: string, movement: InventoryMovement, type: "entry" | "exit" | "adjustment", quantity: number, taskId?: string, purpose?: string, receiver?: string, receiverKind?: "user" | "team" | "worker", receiverId?: string, document?: string) {
    if (!workspace) return;
    if (remoteMode) {
      await updateRemoteInventoryMovement(movement.id, type, quantity, taskId, purpose, receiver, receiverKind, receiverId, document);
      setReloadToken((value) => value + 1);
    } else updateCurrent((current) => ({ ...current, inventory: (current.inventory ?? []).map((item) => {
      if (item.id !== itemId) return item;
      const movements = (item.movements ?? []).map((entry) => entry.id === movement.id ? { ...entry, type, quantity, taskId, purpose: purpose || "Movimentação de estoque", receiver: type === "exit" ? receiver : undefined, receiverKind: type === "exit" ? receiverKind : undefined, receiverId: type === "exit" ? receiverId : undefined, document, updatedBy: currentUser.name, updatedAt: new Date().toISOString() } : entry).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      let balance = 0;
      const recalculated = movements.map((entry) => { balance = entry.type === "entry" ? balance + entry.quantity : entry.type === "exit" ? balance - entry.quantity : entry.quantity; return { ...entry, balanceAfter: Math.max(0, balance) }; }).reverse();
      return { ...item, quantity: Math.max(0, balance), movements: recalculated };
    }) }));
    setToast("Movimentação atualizada e saldos recalculados.");
  }

  async function deleteInventoryMovement(itemId: string, movement: InventoryMovement) {
    if (!workspace) return;
    if (remoteMode) {
      await deleteRemoteInventoryMovement(movement.id);
      setReloadToken((value) => value + 1);
    } else updateCurrent((current) => ({ ...current, inventory: (current.inventory ?? []).map((item) => {
      if (item.id !== itemId) return item;
      let balance = 0;
      const recalculated = (item.movements ?? []).filter((entry) => entry.id !== movement.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((entry) => { balance = entry.type === "entry" ? balance + entry.quantity : entry.type === "exit" ? balance - entry.quantity : entry.quantity; return { ...entry, balanceAfter: Math.max(0, balance) }; }).reverse();
      return { ...item, quantity: Math.max(0, balance), movements: recalculated };
    }) }));
    setToast("Movimentação excluída e saldos recalculados.");
  }

  async function createInventoryRequest(request: Pick<InventoryRequest, "itemId" | "taskId" | "quantity" | "purpose">) {
    if (!workspace) return;
    if (remoteMode) {
      await createRemoteInventoryRequest(workspace.project.id, request);
      setReloadToken((value) => value + 1);
    } else updateCurrent((current) => ({ ...current, inventory: (current.inventory ?? []).map((item) => item.id === request.itemId ? { ...item, requests: [{ id: crypto.randomUUID(), ...request, status: "pending", requestedBy: currentUser.name, requestedAt: new Date().toISOString() }, ...(item.requests ?? [])] } : item) }));
    setToast("Requisição criada. Acompanhe em Estoque > Requisições.");
  }

  async function transitionInventoryRequest(requestId: string, status: InventoryRequest["status"], note?: string, receiver?: string, receiverKind?: "user" | "team" | "worker", receiverId?: string, document?: string) {
    if (!workspace) return;
    if (remoteMode) {
      await transitionRemoteInventoryRequest(requestId, status, note, receiver, receiverKind, receiverId, document);
      setReloadToken((value) => value + 1);
    } else updateCurrent((current) => ({ ...current, inventory: (current.inventory ?? []).map((item) => {
      const request = (item.requests ?? []).find((entry) => entry.id === requestId);
      if (!request) return item;
      const balance = status === "fulfilled" ? Math.max(0, item.quantity - request.quantity) : item.quantity;
      return { ...item, quantity: balance, requests: (item.requests ?? []).map((entry) => entry.id === requestId ? { ...entry, status, reviewNote: note, reviewedBy: currentUser.name, fulfilledBy: status === "fulfilled" ? currentUser.name : entry.fulfilledBy } : entry), movements: status === "fulfilled" ? [{ id: crypto.randomUUID(), internalCode: `MOV-${Date.now()}`, type: "exit", quantity: request.quantity, balanceAfter: balance, taskId: request.taskId, purpose: request.purpose, receiver, receiverKind, receiverId, document, createdBy: currentUser.name, createdAt: new Date().toISOString() }, ...(item.movements ?? [])] : item.movements };
    }) }));
    setToast(status === "fulfilled" ? "Requisição atendida e estoque baixado." : "Requisição atualizada.");
  }

  async function importInventoryItems(items: InventoryItem[]) {
    if (!workspace) return 0;
    if (remoteMode) {
      const count = await importRemoteInventoryItems(workspace.project.id, items);
      setReloadToken((value) => value + 1);
      setToast(`${count} materiais importados com sucesso.`);
      return count;
    }
    updateCurrent((current) => ({ ...current, inventory: [...(current.inventory ?? []), ...items.map((item) => ({ ...item, id: crypto.randomUUID() }))] }));
    setToast(`${items.length} materiais importados com sucesso.`);
    return items.length;
  }

  async function deleteInventoryItem(item: InventoryItem) {
    if (!workspace) return;
    if (remoteMode) await deleteRemoteInventoryItem(item.id);
    updateCurrent((current) => ({ ...current, inventory: (current.inventory ?? []).filter((currentItem) => currentItem.id !== item.id) }));
    setToast("Material removido do estoque.");
  }

  async function saveIssue(issue: ProjectIssue) {
    if (!workspace) return;
    const persisted = { ...issue, id: issue.id || crypto.randomUUID() };
    if (remoteMode) {
      await saveRemoteIssue(workspace.project.id, issue);
      setReloadToken((value) => value + 1);
    } else updateCurrent((current) => ({ ...current, issues: issue.id ? (current.issues ?? []).map((item) => item.id === issue.id ? persisted : item) : [persisted, ...(current.issues ?? [])] }));
    setToast(issue.status === "resolved" ? "Ocorrência resolvida." : "Ponto de atenção registrado.");
  }

  async function saveReportTemplate(template: ReportTemplate) {
    if (!workspace) return;
    const persisted = { ...template, id: template.id || crypto.randomUUID() };
    if (remoteMode) {
      await saveRemoteReportTemplate(workspace.project.id, template);
      setReloadToken((value) => value + 1);
    } else updateCurrent((current) => ({ ...current, reportTemplates: template.id ? (current.reportTemplates ?? []).map((item) => item.id === template.id ? persisted : item) : [...(current.reportTemplates ?? []), persisted] }));
    setToast("Modelo de relatório atualizado.");
  }

  async function transitionReport(reportId: string, status: "draft" | "review" | "approved" | "sent", note?: string) {
    if (!workspace) return;
    if (remoteMode) await transitionRemoteStatusReport(reportId, status, note);
    updateCurrent((current) => ({ ...current, reports: (current.reports ?? []).map((report) => report.id === reportId ? { ...report, status, reviewNote: note } : report) }));
    setToast(status === "approved" ? "Relatório aprovado e bloqueado." : status === "draft" ? "Relatório devolvido para correção." : "Status do relatório atualizado.");
  }

  async function generateReportSummary(reportId: string, reportDate: string) {
    if (!workspace) return "";
    const daily = workspace.entries.filter((entry) => entry.date === reportDate);
    const payload = {
      projectId: workspace.project.id,
      project: workspace.project.name,
      date: reportDate,
      overall: metrics.overall,
      entries: daily.map((entry) => {
        const task = workspace.tasks.find((item) => item.id === entry.taskId);
        return { eap: task?.code ?? "—", activity: task?.name ?? "Atividade", title: entry.title, description: entry.description, progress: entry.progressAdded };
      }),
      alerts: (workspace.issues ?? []).filter((issue) => issue.status !== "resolved").map((issue) => ({ title: issue.title, description: issue.description, priority: issue.priority })),
    };
    const summary = remoteMode
      ? await generateRemoteReportSummary(payload)
      : `${workspace.project.name} apresenta avanço físico geral de ${metrics.overall}%. No período, foram registrados ${daily.length} apontamentos de campo em ${new Set(daily.map((entry) => entry.taskId)).size} atividades.`;
    if (remoteMode) await saveRemoteReportSummary(reportId, summary);
    updateCurrent((current) => ({ ...current, reports: (current.reports ?? []).map((report) => report.id === reportId ? { ...report, executiveSummary: summary } : report) }));
    return summary;
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
        projectTeams: workspace.projectTeams ?? [],
        inventory: workspace.inventory ?? [],
        issues: workspace.issues ?? [],
        reportTemplates: workspace.reportTemplates ?? [],
        reports: workspace.reports ?? [],
        navigate,
        metrics,
      }
    : null;
  const automaticAttention = workspace
    ? buildAutomaticAttention(workspace.tasks, workspace.inventory ?? [], workspace.reports ?? [])
    : [];
  const openAttentionIssues = (workspace?.issues ?? []).filter((issue) => issue.status !== "resolved");
  const attentionCount = automaticAttention.length + openAttentionIssues.length;

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
          data-tour="projeto-atual"
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
              data-tour={`nav-${item.id}`}
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
          <button className="user-card" onClick={signOut} disabled={!remoteMode || signingOut} title="Sair do sistema">
            <span className="avatar avatar-dark">{authenticatedMember.initials}</span>
            <span>
              <strong>{authenticatedMember.name}</strong>
              <small>{authenticatedMember.role}</small>
            </span>
            <Icon name="logout" />
          </button>
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
              <span className={realtimeState} /> {remoteMode
                ? realtimeState === "updating"
                  ? "Atualizando em tempo real..."
                  : realtimeState === "error"
                    ? "Reconectando..."
                    : "Sincronização em tempo real"
                : "Modo local"}
            </div>
            <button
              className="icon-btn"
              onClick={() => chooseTheme(!dark)}
              aria-label="Alternar tema"
            >
              <Icon name={dark ? "sun" : "moon"} />
            </button>
            <div className="notification-center">
              <button className="icon-btn notification" aria-label={`${attentionCount} notificações`} aria-haspopup="true" onClick={() => workspace && navigate("alerts")}>
                <Icon name="bell" />
                {attentionCount > 0 && <em className="notification-badge">{attentionCount > 99 ? "99+" : attentionCount}</em>}
              </button>
              {workspace && <NotificationPreview
                automatic={automaticAttention}
                issues={openAttentionIssues}
                onOpen={() => navigate("alerts")}
              />}
            </div>
            <button
              className="avatar avatar-dark desktop-avatar"
              onClick={() => setMobileMenu(true)}
              title="Abrir opções da conta"
            >
              {authenticatedMember.initials}
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
              updateProjectWorkDays={updateProjectWorkDays}
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
          {workspace && common && view === "photos" && (
            <Photos
              project={common.project}
              tasks={common.tasks}
              entries={common.entries}
              navigate={navigate}
              editEntry={editEntry}
              deleteEntry={deleteEntry}
            />
          )}
          {workspace && common && view === "inventory" && (
            <Inventory
              items={common.inventory}
              tasks={common.tasks}
              members={common.members}
              projectTeams={common.projectTeams}
              currentUserRole={authenticatedMember.role}
              saveItem={saveInventoryItem}
              moveItem={moveInventoryItem}
              updateMovement={updateInventoryMovement}
              deleteMovement={deleteInventoryMovement}
              deleteItem={deleteInventoryItem}
              createRequest={createInventoryRequest}
              transitionRequest={transitionInventoryRequest}
              importItems={importInventoryItems}
            />
          )}
          {workspace && common && view === "alerts" && (
            <Alerts
              tasks={common.tasks}
              inventory={common.inventory}
              reports={common.reports}
              issues={common.issues}
              saveIssue={saveIssue}
            />
          )}
          {workspace && common && view === "reports" && (
            <Reports
              {...common}
              ensureReport={ensureReport}
              approveReport={approveReport}
              transitionReport={transitionReport}
              saveReportTemplate={saveReportTemplate}
              generateReportSummary={generateReportSummary}
              setToast={setToast}
            />
          )}
          {workspace && common && view === "team" && (
            <Team
              {...common}
              currentUserId={authUser?.id ?? currentUser.id}
              currentUserRole={workspace.members.find((member) => member.id === (authUser?.id ?? currentUser.id))?.role ?? "Usuário"}
              inviteMember={inviteMember}
              updateMember={updateMember}
              resetMemberPassword={resetMemberPassword}
              deleteMember={deleteMember}
              saveProjectTeam={saveProjectTeam}
              deleteProjectTeam={deleteProjectTeam}
              setToast={setToast}
            />
          )}
          {view === "settings" && (
            <Settings dark={dark} setDark={chooseTheme} setToast={setToast} />
          )}
        </div>
      </main>

      {workspace && (
        <nav className="bottom-nav glass" aria-label="Navegação mobile">
          {nav.filter((item) => ["overview", "schedule", "journal", "reports"].includes(item.id)).map((item) => (
            <button
              key={item.id}
              data-tour={`nav-${item.id}`}
              className={view === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.short}</span>
            </button>
          ))}
          <button
            data-tour="nav-team"
            className={["photos", "inventory", "alerts", "team", "settings"].includes(view) ? "active" : ""}
            onClick={() => setMobileMenu(true)}
          >
            <Icon name="more" />
            <span>Mais</span>
          </button>
        </nav>
      )}

      {mobileMenu && <Modal title="Mais opções" subtitle={`${authenticatedMember.name} · ${authenticatedMember.role}`} onClose={() => !signingOut && setMobileMenu(false)}>
        <div className="mobile-more-list">
          <button onClick={() => { setMobileMenu(false); navigate("photos"); }}><Icon name="camera"/><span><strong>Galeria da obra</strong><small>Fotos e relatórios em lote</small></span><Icon name="chevron"/></button>
          <button onClick={() => { setMobileMenu(false); navigate("inventory"); }}><Icon name="building"/><span><strong>Estoque</strong><small>Materiais e reservas por EAP</small></span><Icon name="chevron"/></button>
          <button onClick={() => { setMobileMenu(false); navigate("alerts"); }}><Icon name="alert"/><span><strong>Central de atenção</strong><small>{attentionCount} alertas e ocorrências</small></span><Icon name="chevron"/></button>
          <button onClick={() => { setMobileMenu(false); navigate("team"); }}><Icon name="team"/><span><strong>Equipe</strong><small>Usuários e permissões</small></span><Icon name="chevron"/></button>
          <button onClick={() => { setMobileMenu(false); navigate("settings"); }}><Icon name="settings"/><span><strong>Configurações</strong><small>Tema, senha e preferências</small></span><Icon name="chevron"/></button>
          {remoteMode && <button className="logout-option" disabled={signingOut} onClick={signOut}><Icon name="logout"/><span><strong>{signingOut ? "Saindo..." : "Sair do sistema"}</strong><small>Entrar com outro usuário</small></span>{signingOut && <span className="button-spinner"/>}</button>}
        </div>
      </Modal>}

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
      {remoteMode && authUser?.user_metadata.must_change_password === true && (
        <FirstAccess user={authUser} onComplete={(user) => {
          setAuthUser(user);
          setToast("Senha atualizada. Seu acesso está protegido.");
        }}/>
      )}
      {authUser && <OnboardingTour
        userId={authUser.id}
        enabled={authUser.user_metadata.must_change_password !== true}
        navigate={navigate}
      />}
    </div>
  );
}

function NotificationPreview({ automatic, issues, onOpen }: { automatic: AutomaticAttention[]; issues: ProjectIssue[]; onOpen: () => void }) {
  const items = [
    ...automatic.map((item) => ({ id: item.id, kind: item.kind, title: item.title, detail: item.detail, tone: item.tone })),
    ...issues.map((issue) => ({ id: `issue-${issue.id}`, kind: "Registrado pela equipe", title: issue.title, detail: issue.description, tone: issue.priority })),
  ].slice(0, 6);
  const total = automatic.length + issues.length;
  return <section className="notification-preview glass" aria-label="Prévia das notificações">
    <header><div><span>ACOMPANHAMENTO DA OBRA</span><strong>{total ? `${total} ${total === 1 ? "ponto pede" : "pontos pedem"} atenção` : "Tudo em dia por aqui"}</strong></div><Icon name={total ? "bell" : "check"}/></header>
    <div className="notification-preview-summary"><span><b>{automatic.length}</b> automáticos</span><span><b>{issues.length}</b> registrados pela equipe</span></div>
    <div className="notification-preview-list">{items.map((item) => <article className={item.tone} key={item.id}><span><Icon name="alert"/></span><div><small>{item.kind}</small><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}{!items.length && <div className="notification-preview-empty"><Icon name="check"/><span>Cronograma, estoque e relatórios estão em ordem.</span></div>}</div>
    <button onClick={onOpen}>Abrir Central de atenção <Icon name="arrow"/></button>
  </section>;
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
        workDays: [1, 2, 3, 4, 5],
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
