export type ViewId =
  "overview" | "schedule" | "journal" | "reports" | "team" | "settings";

export type Project = {
  id: string;
  name: string;
  client: string;
  location: string;
  start: string;
  end: string;
  progress: number;
  status: "Planejamento" | "No prazo" | "Atenção" | "Atrasada" | "Concluída";
  description?: string;
  contractNumber?: string;
  workDays?: number[];
};

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export type Task = {
  id: string;
  code: string;
  name: string;
  phase: string;
  plannedStart: string;
  plannedEnd: string;
  progress: number;
  weight: number;
  baselineStart?: string;
  baselineEnd?: string;
  parentId?: string;
  dependencyId?: string;
  dependencyType?: DependencyType;
  lagDays?: number;
  responsible: string;
  color: string;
  critical?: boolean;
  milestone?: boolean;
  notes?: string;
};

export type JournalEntry = {
  id: string;
  date: string;
  time: string;
  taskId: string;
  title: string;
  description: string;
  progressBefore: number;
  progressAdded: number;
  progressAfter: number;
  author: string;
  weather: string;
  crew: number;
  photos: JournalPhoto[];
};

export type JournalPhoto = {
  id?: string;
  url: string;
  storagePath?: string;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type Member = {
  id: string;
  name: string;
  email: string;
  role: "Administrador" | "Gestor" | "Usuário";
  initials: string;
  color: string;
  online: boolean;
  pending?: boolean;
};

export type ProjectWorkspace = {
  project: Project;
  organizationId?: string;
  tasks: Task[];
  entries: JournalEntry[];
  members: Member[];
  reports?: ReportSummary[];
};

export type ReportSummary = {
  id: string;
  date: string;
  status: "draft" | "review" | "approved" | "sent";
};
