"use client";
/* eslint-disable @next/next/no-img-element -- evidências privadas do Diário de Obra */

import { useMemo, useState } from "react";
import { compressJournalPhoto } from "@/lib/images";
import { EntryHistoryModal } from "../entry-history";
import { Icon } from "../icons";
import type {
  JournalEntry,
  JournalPhoto,
  Member,
  Project,
  ProjectTeam,
  Task,
  ViewId,
} from "../types";
import { EmptyPhoto, Modal } from "../ui";

type PeriodMode = "day" | "week" | "month";
type Props = {
  project: Project;
  tasks: Task[];
  entries: JournalEntry[];
  members: Member[];
  projectTeams?: ProjectTeam[];
  navigate: (view: ViewId) => void;
  metrics: { overall: number; active: number };
  addEntry: (entry: JournalEntry) => void;
  editEntry: (entry: JournalEntry) => Promise<void>;
  deleteEntry: (entry: JournalEntry) => Promise<void>;
};
const isoToday = () => new Date().toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T12:00:00`);
const toIso = (date: Date) => date.toISOString().slice(0, 10);
const dateLabel = (value: string) =>
  asDate(value).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
const startOfWeek = (value: string) => {
  const date = asDate(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
};

export function Journal({
  tasks,
  entries,
  members,
  projectTeams = [],
  metrics,
  navigate,
  addEntry,
  editEntry,
  deleteEntry,
}: Props) {
  const [open, setOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [selectedEditing, setSelectedEditing] = useState(false);
  const [actionMenuEntry, setActionMenuEntry] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(isoToday());
  const [period, setPeriod] = useState<PeriodMode>("day");
  const executableTasks = useMemo(
    () =>
      tasks.filter(
        (task) => !tasks.some((child) => child.parentId === task.id),
      ),
    [tasks],
  );
  const visibleEntries = useMemo(() => {
    if (period === "day")
      return entries.filter((entry) => entry.date === selectedDate);
    if (period === "month")
      return entries.filter((entry) =>
        entry.date.startsWith(selectedDate.slice(0, 7)),
      );
    const start = startOfWeek(selectedDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return entries.filter(
      (entry) => entry.date >= toIso(start) && entry.date <= toIso(end),
    );
  }, [entries, period, selectedDate]);
  const summary = useMemo(
    () => ({
      activities: new Set(visibleEntries.map((entry) => entry.taskId)).size,
      progress: visibleEntries.reduce(
        (sum, entry) => sum + entry.progressAdded,
        0,
      ),
      photos: visibleEntries.reduce(
        (sum, entry) => sum + entry.photos.length,
        0,
      ),
      crew: Math.max(0, ...visibleEntries.map((entry) => entry.crew)),
    }),
    [visibleEntries],
  );
  const orderedEntries = useMemo(
    () =>
      [...visibleEntries].sort((a, b) =>
        `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`),
      ),
    [visibleEntries],
  );

  function movePeriod(direction: number) {
    const date = asDate(selectedDate);
    if (period === "month") date.setMonth(date.getMonth() + direction);
    else date.setDate(date.getDate() + direction * (period === "week" ? 7 : 1));
    setSelectedDate(toIso(date));
  }
  const periodLabel =
    period === "day"
      ? dateLabel(selectedDate)
      : period === "month"
        ? asDate(selectedDate).toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric",
          })
        : (() => {
            const start = startOfWeek(selectedDate);
            const end = new Date(start);
            end.setDate(end.getDate() + 6);
            return `${start.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} — ${end.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
          })();

  if (!executableTasks.length)
    return (
      <section className="empty-schedule glass">
        <span className="empty-workspace-icon">
          <Icon name="journal" />
        </span>
        <span className="overline">DIÁRIO AGUARDANDO O CRONOGRAMA</span>
        <h2>Crie uma atividade executável</h2>
        <p>
          Itens-pai com filhos representam o resultado consolidado e não recebem
          apontamento direto. Crie ou selecione uma atividade sem subitens para
          registrar fotos, descrição e medição.
        </p>
        <button className="primary-btn" onClick={() => navigate("schedule")}>
          <Icon name="gantt" /> Montar cronograma
        </button>
      </section>
    );

  return (
    <div className="view-stack journal-view">
      <section className="journal-toolbar glass">
        <div className="date-navigator">
          <button
            className="icon-btn"
            onClick={() => movePeriod(-1)}
            aria-label="Período anterior"
          >
            <Icon name="chevron" className="flip" />
          </button>
          <button
            className="date-button"
            onClick={() => setSelectedDate(isoToday())}
          >
            <span>
              {selectedDate === isoToday()
                ? "HOJE"
                : period === "day"
                  ? "DIA SELECIONADO"
                  : "PERÍODO SELECIONADO"}
            </span>
            <strong>{periodLabel}</strong>
          </button>
          <button
            className="icon-btn"
            onClick={() => movePeriod(1)}
            aria-label="Próximo período"
          >
            <Icon name="chevron" />
          </button>
        </div>
        <div className="period-segmented">
          <button
            className={period === "day" ? "active" : ""}
            onClick={() => setPeriod("day")}
          >
            Dia
          </button>
          <button
            className={period === "week" ? "active" : ""}
            onClick={() => setPeriod("week")}
          >
            Semana
          </button>
          <button
            className={period === "month" ? "active" : ""}
            onClick={() => setPeriod("month")}
          >
            Mês
          </button>
        </div>
        <div className="day-context">
          <span>
            <Icon name="camera" /> {summary.photos} evidências
          </span>
          <span>
            <Icon name="trend" /> +{summary.progress}% no período
          </span>
        </div>
        <button className="primary-btn" onClick={() => setOpen(true)}>
          <Icon name="plus" /> Novo registro
        </button>
      </section>
      {period === "week" && (
        <WeekStrip
          selectedDate={selectedDate}
          entries={entries}
          onSelect={setSelectedDate}
        />
      )}
      {period === "month" && (
        <MonthCalendar
          selectedDate={selectedDate}
          entries={entries}
          onSelect={(date) => {
            setSelectedDate(date);
            setPeriod("day");
          }}
        />
      )}

      <div className="journal-layout">
        <section className="journal-feed">
          <div className="day-divider">
            <span>
              {orderedEntries.length
                ? `${orderedEntries.length} REGISTRO${orderedEntries.length > 1 ? "S" : ""} NO PERÍODO`
                : "SEM REGISTROS NO PERÍODO"}
            </span>
            <i />
          </div>
          {!orderedEntries.length && (
            <button
              className="empty-journal glass"
              onClick={() => setOpen(true)}
            >
              <span>
                <Icon name="camera" />
              </span>
              <strong>Registrar atividade executada</strong>
              <small>
                Adicione fotos, descrição, equipe e percentual medido.
              </small>
            </button>
          )}
          {orderedEntries.map((entry) => {
            const task = tasks.find((item) => item.id === entry.taskId);
            return (
              <article
                key={entry.id}
                className="journal-card glass"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedEditing(false);
                  setSelectedEntry(entry);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setSelectedEditing(false);
                    setSelectedEntry(entry);
                  }
                }}
              >
                <div
                  className={`journal-photo ${entry.photos.length > 1 ? "photo-grid" : ""}`}
                >
                  {entry.photos.length ? (
                    entry.photos
                      .slice(0, 4)
                      .map((photo, index) => (
                        <img
                          key={photo.id ?? index}
                          src={photo.url}
                          alt={`${entry.title} · evidência ${index + 1}`}
                        />
                      ))
                  ) : (
                    <EmptyPhoto>Sem foto</EmptyPhoto>
                  )}
                  <span>
                    <Icon name="camera" /> {entry.photos.length} foto
                    {entry.photos.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="journal-content">
                  <div className="journal-card-head">
                    <span className="task-chip">
                      {task?.code} · {task?.phase}
                    </span>
                    <button
                      className="icon-btn tiny"
                      aria-label="Abrir e editar diário"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActionMenuEntry((current) =>
                          current === entry.id ? null : entry.id,
                        );
                      }}
                    >
                      <Icon name="more" />
                    </button>
                    {actionMenuEntry === entry.id && (
                      <div
                        className="journal-actions-menu"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setSelectedEditing(false);
                            setSelectedEntry(entry);
                            setActionMenuEntry(null);
                          }}
                        >
                          Abrir diário
                        </button>
                        <button
                          onClick={() => {
                            setSelectedEditing(true);
                            setSelectedEntry(entry);
                            setActionMenuEntry(null);
                          }}
                        >
                          Editar
                        </button>
                        <button
                          className="danger"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Excluir definitivamente o diário “${entry.title}”?`,
                              )
                            )
                              return;
                            try {
                              await deleteEntry(entry);
                              setActionMenuEntry(null);
                            } catch (cause) {
                              window.alert(
                                cause instanceof Error
                                  ? cause.message
                                  : "Não foi possível excluir o diário.",
                              );
                            }
                          }}
                        >
                          Excluir
                        </button>
                      </div>
                    )}
                  </div>
                  <h3>{entry.title}</h3>
                  <p>{entry.description}</p>
                  <div className="progress-measure">
                    <span>
                      <small>ANTES</small>
                      <strong>{entry.progressBefore}%</strong>
                    </span>
                    <Icon name="arrow" />
                    <span className="daily-measure">
                      <small>MEDIDO</small>
                      <strong>+{entry.progressAdded}%</strong>
                    </span>
                    <Icon name="arrow" />
                    <span>
                      <small>DEPOIS</small>
                      <strong>{entry.progressAfter}%</strong>
                    </span>
                  </div>
                  <footer>
                    <span className="avatar small">
                      {entry.author
                        .split(" ")
                        .map((word) => word[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <span>
                      <strong>{entry.author}</strong>
                      <small>
                        {entry.date.split("-").reverse().join("/")} ·{" "}
                        {entry.time}
                      </small>
                    </span>
                    <em />
                    <span>
                      <Icon name="users" />
                      {entry.crew}
                    </span>
                    <span>
                      <Icon name="weather" />
                      {entry.weather}
                    </span>
                  </footer>
                </div>
              </article>
            );
          })}
        </section>

        <aside className="journal-aside">
          <section className="panel glass daily-summary-panel">
            <span className="overline">RESUMO DO PERÍODO</span>
            <h3>Evolução da obra</h3>
            <div className="overall-progress-stat">
              <span>AVANÇO GERAL DA OBRA</span>
              <strong>{metrics.overall}%</strong>
              <div>
                <i style={{ width: `${metrics.overall}%` }} />
              </div>
              <small>
                Percentual ponderado de todas as atividades executáveis.
              </small>
            </div>
            <div className="daily-stats">
              <div>
                <strong>+{summary.progress}%</strong>
                <span>medido no período</span>
              </div>
              <div>
                <strong>{summary.activities}</strong>
                <span>atividades atualizadas</span>
              </div>
              <div>
                <strong>{summary.photos}</strong>
                <span>fotos anexadas</span>
              </div>
              <div>
                <strong>{summary.crew}</strong>
                <span>maior efetivo informado</span>
              </div>
            </div>
          </section>
          <section className="panel glass">
            <span className="overline">RASTREABILIDADE</span>
            <div className="check-list">
              <span className={orderedEntries.length ? "" : "pending"}>
                <Icon name={orderedEntries.length ? "check" : "clock"} />{" "}
                Atividades vinculadas
              </span>
              <span className={summary.photos ? "" : "pending"}>
                <Icon name={summary.photos ? "check" : "clock"} /> Evidências
                fotográficas
              </span>
              <span className={summary.progress ? "" : "pending"}>
                <Icon name={summary.progress ? "check" : "clock"} /> Avanço
                medido
              </span>
              <span className="pending">
                <Icon name="clock" /> Aprovação do responsável
              </span>
            </div>
          </section>
        </aside>
      </div>

      {open && (
        <JournalForm
          tasks={executableTasks}
          projectTeams={projectTeams}
          date={selectedDate}
          author={members.find((member) => member.online)?.name ?? "Usuário"}
          onClose={() => setOpen(false)}
          onSave={(entry) => {
            addEntry(entry);
            setOpen(false);
          }}
        />
      )}
      {selectedEntry && (
        <EntryHistoryModal
          task={
            tasks.find((task) => task.id === selectedEntry.taskId) ??
            executableTasks[0]
          }
          entries={[selectedEntry]}
          onClose={() => setSelectedEntry(null)}
          initialEditing={selectedEditing}
          onUpdate={async (entry) => {
            await editEntry(entry);
            setSelectedEntry(entry);
          }}
          onDelete={async (entry) => {
            await deleteEntry(entry);
            setSelectedEntry(null);
          }}
        />
      )}
    </div>
  );
}

function WeekStrip({
  selectedDate,
  entries,
  onSelect,
}: {
  selectedDate: string;
  entries: JournalEntry[];
  onSelect: (date: string) => void;
}) {
  const start = startOfWeek(selectedDate);
  return (
    <section className="week-strip glass">
      {Array.from({ length: 7 }, (_, index) => {
        const date = new Date(start);
        date.setDate(date.getDate() + index);
        const iso = toIso(date);
        const count = entries.filter((entry) => entry.date === iso).length;
        return (
          <button
            className={iso === selectedDate ? "active" : ""}
            key={iso}
            onClick={() => onSelect(iso)}
          >
            <span>
              {date
                .toLocaleDateString("pt-BR", { weekday: "short" })
                .replace(".", "")}
            </span>
            <strong>{date.getDate()}</strong>
            <small>
              {count ? `${count} registro${count > 1 ? "s" : ""}` : "—"}
            </small>
          </button>
        );
      })}
    </section>
  );
}

function MonthCalendar({
  selectedDate,
  entries,
  onSelect,
}: {
  selectedDate: string;
  entries: JournalEntry[];
  onSelect: (date: string) => void;
}) {
  const current = asDate(selectedDate);
  const year = current.getFullYear();
  const month = current.getMonth();
  const first = new Date(year, month, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  return (
    <section className="month-calendar glass">
      <header>
        {["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </header>
      <div>
        {Array.from({ length: offset }, (_, index) => (
          <i key={`empty-${index}`} />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const date = new Date(year, month, index + 1, 12);
          const iso = toIso(date);
          const daily = entries.filter((entry) => entry.date === iso);
          return (
            <button
              key={iso}
              className={
                iso === selectedDate
                  ? "active"
                  : daily.length
                    ? "has-entry"
                    : ""
              }
              onClick={() => onSelect(iso)}
            >
              <strong>{index + 1}</strong>
              {daily.length > 0 && (
                <span>
                  {daily.length} registro{daily.length > 1 ? "s" : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function JournalForm({
  tasks,
  projectTeams,
  date,
  author,
  onClose,
  onSave,
}: {
  tasks: Task[];
  projectTeams: ProjectTeam[];
  date: string;
  author: string;
  onClose: () => void;
  onSave: (entry: JournalEntry) => void;
}) {
  const [step, setStep] = useState(1);
  const executableTasks = tasks.filter((task) => !tasks.some((child) => child.parentId === task.id));
  const activeTasks = executableTasks.filter((task) => task.progress < 100);
  if (!activeTasks.length) activeTasks.push(...executableTasks);
  const [taskId, setTaskId] = useState(activeTasks[0].id);
  const task = tasks.find((item) => item.id === taskId) ?? tasks[0];
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState(Math.min(5, 100 - task.progress));
  const [crew, setCrew] = useState(0);
  const [selectedTeams, setSelectedTeams] = useState<Record<string, number>>({});
  const [weather, setWeather] = useState("Não informado");
  const [photos, setPhotos] = useState<JournalPhoto[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [dictating, setDictating] = useState(false);
  const maximum = Math.max(0, 100 - task.progress);
  const effectiveCrew = projectTeams.length
    ? Object.values(selectedTeams).reduce((sum, workers) => sum + workers, 0)
    : crew;
  async function selectPhotos(files: FileList | null) {
    if (!files) return;
    setLoadingPhotos(true);
    setPhotoError("");
    try {
      const selected = Array.from(files).slice(
        0,
        Math.max(0, 8 - photos.length),
      );
      const compressed = await Promise.all(selected.map(compressJournalPhoto));
      setPhotos((current) => [...current, ...compressed]);
    } catch (cause) {
      setPhotoError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível processar as imagens.",
      );
    } finally {
      setLoadingPhotos(false);
    }
  }
  function changeTask(value: string) {
    setTaskId(value);
    const next = tasks.find((item) => item.id === value)!;
    setProgress(Math.min(5, 100 - next.progress));
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const after = Math.min(100, task.progress + progress);
    onSave({
      id: crypto.randomUUID(),
      date,
      time: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      taskId,
      title: title || task.name,
      description,
      progressBefore: task.progress,
      progressAdded: progress,
      progressAfter: after,
      author,
      weather,
      crew: effectiveCrew,
      teams: Object.entries(selectedTeams).map(([teamId, workers]) => ({
        teamId,
        name: projectTeams.find((team) => team.id === teamId)?.name ?? "Equipe",
        workers,
      })),
      photos,
    });
  }
  function startDictation() {
    type VoiceEvent = { results: ArrayLike<{ 0: { transcript: string } }> };
    type VoiceRecognition = {
      lang: string;
      interimResults: boolean;
      onresult: (event: VoiceEvent) => void;
      onend: () => void;
      onerror: () => void;
      start: () => void;
    };
    const voiceWindow = window as typeof window & {
      SpeechRecognition?: new () => VoiceRecognition;
      webkitSpeechRecognition?: new () => VoiceRecognition;
    };
    const Recognition =
      voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setPhotoError("O navegador não oferece ditado. Use o microfone do teclado do celular.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const spoken = event.results[0]?.[0]?.transcript ?? "";
      setDescription((current) => `${current}${current ? " " : ""}${spoken}`);
    };
    recognition.onend = () => setDictating(false);
    recognition.onerror = () => setDictating(false);
    setDictating(true);
    recognition.start();
  }
  const canAdvance =
    step === 1
      ? Boolean(taskId)
      : step === 2
        ? progress >= 0
        : step === 3
          ? photos.length > 0
          : step === 4
            ? Boolean(title.trim() && description.trim())
            : true;
  return (
    <Modal
      title="Novo registro de campo"
      subtitle="Somente atividades executáveis aparecem aqui; itens-pai com filhos são calculados automaticamente."
      onClose={onClose}
      wide
    >
      <form className="journal-form field-first" onSubmit={submit}>
        <nav className="journal-wizard-steps full" aria-label="Etapas do diário">
          {["Atividade", "Avanço", "Fotos", "Descrição", "Revisar"].map((label, index) => (
            <button key={label} type="button" className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => index + 1 < step && setStep(index + 1)}>
              <b>{step > index + 1 ? "✓" : index + 1}</b><span>{label}</span>
            </button>
          ))}
        </nav>
        <label className={`full activity-selector wizard-panel ${step === 1 ? "active" : ""}`}>
          <span>1 · Atividade do cronograma</span>
          <select
            value={taskId}
            onChange={(event) => changeTask(event.target.value)}
          >
            {activeTasks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.name} ({item.progress}%)
              </option>
            ))}
          </select>
          <small>
            {task.responsible || "Sem responsável"} · {task.phase}
          </small>
        </label>
        <section className={`measurement-card full wizard-panel ${step === 2 ? "active" : ""}`}>
          <div>
            <span>2 · Medição do avanço</span>
            <p>Informe apenas o percentual executado neste dia.</p>
          </div>
          <div className="measurement-equation">
            <span>
              <small>ATUAL</small>
              <strong>{task.progress}%</strong>
            </span>
            <b>+</b>
            <label>
              <small>HOJE</small>
              <input
                aria-label="Percentual executado hoje"
                type="number"
                min="0"
                max={maximum}
                value={progress}
                onChange={(event) =>
                  setProgress(Math.min(maximum, Number(event.target.value)))
                }
              />
            </label>
            <b>=</b>
            <span className="measure-result">
              <small>NOVO TOTAL</small>
              <strong>{task.progress + progress}%</strong>
            </span>
          </div>
          <input
            className="measurement-range"
            type="range"
            min="0"
            max={maximum}
            value={progress}
            onChange={(event) => setProgress(Number(event.target.value))}
          />
          <small>Disponível para medir: {maximum}%</small>
        </section>
        {projectTeams.length > 0 && <section className={`team-picker full wizard-panel ${step === 2 ? "active" : ""}`}>
          <header><div><span>Equipes nesta frente</span><p>Selecione as empresas envolvidas e informe o efetivo.</p></div><strong>{effectiveCrew} pessoas</strong></header>
          <div>{projectTeams.filter((team) => team.active).map((team) => {
            const selected = team.id in selectedTeams;
            return <label className={selected ? "selected" : ""} key={team.id}>
              <input type="checkbox" checked={selected} onChange={(event) => setSelectedTeams((current) => {
                const next = { ...current };
                if (event.target.checked) next[team.id] = 1; else delete next[team.id];
                return next;
              })}/>
              <span><strong>{team.name}</strong><small>{team.company} · {team.specialty}</small></span>
              {selected && <input aria-label={`Pessoas da ${team.name}`} type="number" min="1" value={selectedTeams[team.id]} onChange={(event) => setSelectedTeams((current) => ({ ...current, [team.id]: Math.max(1, Number(event.target.value)) }))}/>}
            </label>;
          })}</div>
        </section>}
        <label className={`full wizard-panel ${step === 4 ? "active" : ""}`}>
          <span>4 · O que foi realizado</span>
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Título objetivo do serviço executado"
          />
        </label>
        <label className={`full wizard-panel ${step === 4 ? "active" : ""}`}>
          <span className="dictation-label">Descrição técnica <button type="button" className={dictating ? "voice-button listening" : "voice-button"} onClick={startDictation}>{dictating ? "Ouvindo..." : "Ditar"}</button></span>
          <textarea
            required
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Descreva local, quantidades, condições, intercorrências e próximos passos..."
          />
        </label>
        {!projectTeams.length && <label className={`wizard-panel ${step === 2 ? "active" : ""}`}>
          <span>Efetivo nesta frente</span>
          <input
            type="number"
            min="0"
            required
            value={crew}
            onChange={(event) => setCrew(Number(event.target.value))}
          />
        </label>}
        <label className={`wizard-panel ${step === 2 ? "active" : ""}`}>
          <span>Condição do tempo</span>
          <select
            value={weather}
            onChange={(event) => setWeather(event.target.value)}
          >
            <option>Não informado</option>
            <option>Ensolarado</option>
            <option>Parcialmente nublado</option>
            <option>Nublado</option>
            <option>Chuva leve</option>
            <option>Chuva intensa</option>
          </select>
        </label>
        <label className={`photo-drop full wizard-panel ${step === 3 ? "active" : ""}`}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            required={!photos.length}
            onChange={(event) => void selectPhotos(event.target.files)}
          />
          <span className="photo-drop-icon">
            <Icon name="camera" />
          </span>
          <strong>3 · Fotografar ou selecionar evidências</strong>
          <small>
            Até 8 fotos. Antes do envio, cada imagem é redimensionada para até
            1600 px e comprimida para economizar armazenamento.
          </small>
          <em>
            {loadingPhotos
              ? "Redimensionando e compactando..."
              : photos.length
                ? `${photos.length} foto(s) pronta(s) para envio`
                : "Adicionar fotos"}
          </em>
        </label>
        {photoError && (
          <div className={`access-message full wizard-panel ${step === 3 || step === 4 ? "active" : ""}`}>
            <Icon name="alert" />
            {photoError}
          </div>
        )}
        {photos.length > 0 && (
          <div className={`upload-grid full wizard-panel ${step === 3 ? "active" : ""}`}>
            {photos.map((photo, index) => (
              <div key={`${photo.url.slice(0, 24)}-${index}`}>
                <img src={photo.url} alt={`Prévia ${index + 1}`} />
                <button
                  type="button"
                  aria-label={`Remover foto ${index + 1}`}
                  onClick={() =>
                    setPhotos((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <Icon name="close" />
                </button>
                <span>
                  {Math.max(1, Math.round((photo.sizeBytes ?? 0) / 1024))} KB
                </span>
              </div>
            ))}
          </div>
        )}
        <div className={`wizard-review full wizard-panel ${step === 5 ? "active" : ""}`}>
          <div><span>ATIVIDADE</span><strong>{task.code} · {task.name}</strong><small>{task.phase}</small></div>
          <div><span>AVANÇO DO DIA</span><strong>+{progress}%</strong><small>{task.progress}% → {task.progress + progress}%</small></div>
          <div><span>EVIDÊNCIAS</span><strong>{photos.length} fotos</strong><small>{effectiveCrew} pessoas em campo</small></div>
          <div className="full"><span>EXECUÇÃO</span><strong>{title}</strong><small>{description}</small></div>
        </div>
        <div className={`save-summary full wizard-panel ${step === 5 ? "active" : ""}`}>
          <Icon name="check" />
          <span>
            <strong>Ao salvar</strong>
            <small>
              A atividade passará de {task.progress}% para{" "}
              {task.progress + progress}% e este registro entrará
              automaticamente no Status Report de {dateLabel(date)}.
            </small>
          </span>
        </div>
        <div className="modal-actions full">
          <button type="button" className="secondary-btn" onClick={() => step === 1 ? onClose() : setStep((current) => current - 1)}>{step === 1 ? "Cancelar" : "Voltar"}</button>
          {step < 5 ? <button type="button" className="primary-btn" disabled={!canAdvance || loadingPhotos} onClick={() => setStep((current) => current + 1)}>Continuar <Icon name="arrow" /></button> : <button className="primary-btn" disabled={loadingPhotos}><Icon name="check" /> Salvar diário e atualizar Gantt</button>}
        </div>
      </form>
    </Modal>
  );
}
