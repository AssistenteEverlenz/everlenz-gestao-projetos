export type ViewId = "overview" | "schedule" | "journal" | "reports" | "team" | "settings";

export type Project = {
  id: string;
  name: string;
  client: string;
  location: string;
  start: string;
  end: string;
  progress: number;
  status: "No prazo" | "Atenção" | "Atrasada";
};

export type Task = {
  id: number;
  code: string;
  name: string;
  phase: string;
  start: number;
  duration: number;
  progress: number;
  baselineStart: number;
  baselineDuration: number;
  dependency?: string;
  responsible: string;
  critical?: boolean;
  milestone?: boolean;
};

export type JournalEntry = {
  id: string;
  date: string;
  time: string;
  taskId: number;
  title: string;
  description: string;
  progressAdded: number;
  author: string;
  weather: string;
  crew: number;
  image: string;
};

export type Member = {
  id: string;
  name: string;
  email: string;
  role: "Administrador" | "Engenheiro" | "Encarregado" | "Cliente";
  initials: string;
  color: string;
  online: boolean;
};
