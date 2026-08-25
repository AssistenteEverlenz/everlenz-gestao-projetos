export type ViewId = "overview" | "schedule" | "journal" | "reports" | "team" | "settings";

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
};

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export type Task = {
  id: number;
  code: string;
  name: string;
  phase: string;
  plannedStart: string;
  plannedEnd: string;
  progress: number;
  weight: number;
  baselineStart?: string;
  baselineEnd?: string;
  parentId?: number;
  dependencyId?: number;
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
  taskId: number;
  title: string;
  description: string;
  progressBefore: number;
  progressAdded: number;
  progressAfter: number;
  author: string;
  weather: string;
  crew: number;
  photos: string[];
};

export type Member = {
  id: string;
  name: string;
  email: string;
  role: "Administrador" | "Gestor" | "Engenheiro" | "Encarregado" | "Cliente";
  initials: string;
  color: string;
  online: boolean;
};

export type ProjectWorkspace = {
  project: Project;
  tasks: Task[];
  entries: JournalEntry[];
  members: Member[];
};
