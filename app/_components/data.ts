import type { JournalEntry, Member, Project, Task } from "./types";

export const projects: Project[] = [
  { id: "reserva-serra", name: "Residência Reserva da Serra", client: "Família Albuquerque", location: "Nova Lima · MG", start: "12 mai 2026", end: "18 fev 2027", progress: 38, status: "No prazo" },
  { id: "loja-horizonte", name: "Loja Horizonte", client: "Grupo Horizonte", location: "Belo Horizonte · MG", start: "03 ago 2026", end: "22 nov 2026", progress: 17, status: "Atenção" },
];

export const initialTasks: Task[] = [
  { id: 1, code: "1", name: "Mobilização e serviços preliminares", phase: "Preliminares", start: 0, duration: 8, baselineStart: 0, baselineDuration: 7, progress: 100, responsible: "Rafael Lima" },
  { id: 2, code: "2", name: "Infraestrutura", phase: "Estrutura", start: 7, duration: 14, baselineStart: 7, baselineDuration: 12, progress: 100, dependency: "1 FS", responsible: "Bruno Costa", critical: true },
  { id: 3, code: "2.1", name: "Escavação e blocos de fundação", phase: "Estrutura", start: 7, duration: 8, baselineStart: 7, baselineDuration: 7, progress: 100, dependency: "1 FS", responsible: "Bruno Costa" },
  { id: 4, code: "2.2", name: "Vigas baldrame", phase: "Estrutura", start: 15, duration: 6, baselineStart: 14, baselineDuration: 5, progress: 100, dependency: "3 FS", responsible: "Bruno Costa", critical: true },
  { id: 5, code: "3", name: "Superestrutura", phase: "Estrutura", start: 21, duration: 24, baselineStart: 19, baselineDuration: 22, progress: 58, dependency: "4 FS", responsible: "Rafael Lima", critical: true },
  { id: 6, code: "3.1", name: "Pilares do pavimento térreo", phase: "Estrutura", start: 21, duration: 9, baselineStart: 19, baselineDuration: 8, progress: 100, dependency: "4 FS", responsible: "Rafael Lima" },
  { id: 7, code: "3.2", name: "Formas e armação da laje", phase: "Estrutura", start: 30, duration: 10, baselineStart: 27, baselineDuration: 9, progress: 72, dependency: "6 FS", responsible: "Camila Souza", critical: true },
  { id: 8, code: "3.3", name: "Concretagem da laje", phase: "Estrutura", start: 40, duration: 5, baselineStart: 36, baselineDuration: 5, progress: 0, dependency: "7 FS", responsible: "Camila Souza", critical: true },
  { id: 9, code: "4", name: "Alvenaria e vedações", phase: "Vedações", start: 42, duration: 20, baselineStart: 41, baselineDuration: 18, progress: 15, dependency: "7 SS +12d", responsible: "Diego Reis" },
  { id: 10, code: "5", name: "Instalações elétricas e hidráulicas", phase: "Instalações", start: 51, duration: 24, baselineStart: 50, baselineDuration: 22, progress: 0, dependency: "9 SS +9d", responsible: "Marina Alves" },
  { id: 11, code: "6", name: "Cobertura concluída", phase: "Marcos", start: 66, duration: 1, baselineStart: 63, baselineDuration: 1, progress: 0, dependency: "9 FS", responsible: "Rafael Lima", milestone: true },
];

export const initialEntries: JournalEntry[] = [
  { id: "rdo-104", date: "24 AGO", time: "16:42", taskId: 7, title: "Armação positiva da laje", description: "Concluída a armação positiva dos panos L3 e L4. Aguardando conferência antes da armação negativa.", progressAdded: 12, author: "Camila Souza", weather: "Ensolarado · 26 °C", crew: 8, image: "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1000&q=80" },
  { id: "rdo-103", date: "24 AGO", time: "11:18", taskId: 9, title: "Elevação de alvenaria — setor norte", description: "Executadas quatro fiadas no setor norte, com vergas pré-moldadas posicionadas conforme projeto.", progressAdded: 5, author: "Diego Reis", weather: "Ensolarado · 24 °C", crew: 5, image: "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=1000&q=80" },
  { id: "rdo-102", date: "23 AGO", time: "17:05", taskId: 7, title: "Montagem das formas de bordo", description: "Finalizada a montagem e o travamento das formas de bordo do pavimento superior.", progressAdded: 9, author: "Rafael Lima", weather: "Parcialmente nublado · 22 °C", crew: 6, image: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1000&q=80" },
];

export const initialMembers: Member[] = [
  { id: "1", name: "Gustavo Adriano", email: "gustavo@everlenz.com.br", role: "Administrador", initials: "GA", color: "#17211e", online: true },
  { id: "2", name: "Rafael Lima", email: "rafael@everlenz.com.br", role: "Engenheiro", initials: "RL", color: "#d5743f", online: true },
  { id: "3", name: "Camila Souza", email: "camila@everlenz.com.br", role: "Engenheiro", initials: "CS", color: "#54756a", online: false },
  { id: "4", name: "Diego Reis", email: "diego@empreiteira.com.br", role: "Encarregado", initials: "DR", color: "#67748d", online: false },
  { id: "5", name: "Ricardo Albuquerque", email: "ricardo@cliente.com.br", role: "Cliente", initials: "RA", color: "#8c654f", online: false },
];
