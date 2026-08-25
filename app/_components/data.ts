import type { Member, ProjectWorkspace } from "./types";

export const currentUser: Member = {
  id: "local-admin",
  name: "Gustavo Adriano",
  email: "gustavo@everlenz.com.br",
  role: "Administrador",
  initials: "GA",
  color: "#26332f",
  online: true,
};

export const initialWorkspaces: ProjectWorkspace[] = [];
