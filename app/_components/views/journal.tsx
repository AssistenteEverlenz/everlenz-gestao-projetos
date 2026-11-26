"use client";
import { SearchableSelect } from "../searchable-select";
/* eslint-disable @next/next/no-img-element -- evidências privadas do Diário de Obra */

import { useMemo, useState } from "react";
import { compressJournalPhoto } from "@/lib/images";
import { canModifyEntry, EntryHistoryModal } from "../entry-history";
import { Icon } from "../icons";
import { ancestorsOf, entriesContribution, formatPercent } from "../progress";
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
  currentUserId: string;
  canModerate: boolean;
  addEntries: (entries: JournalEntry[]) => Promise<void>;
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
  currentUserId,
  canModerate,
  addEntries,
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
      progress: entriesContribution(visibleEntries, tasks),
      photos: visibleEntries.reduce(
        (sum, entry) => sum + entry.photos.length,
        0,
      ),
      crew: Math.max(0, ...visibleEntries.map((entry) => entry.crew)),
    }),
    [visibleEntries, tasks],
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
            <Icon name="trend" /> +{formatPercent(summary.progress)} p.p. da obra no período
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
                        {canModifyEntry(entry, currentUserId, canModerate) && (
                        <>
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
                        </>
                        )}
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
                <strong>+{formatPercent(summary.progress)} p.p.</strong>
                <span>avanço da obra no período</span>
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
          allTasks={tasks}
          onSave={async (newEntries) => {
            await addEntries(newEntries);
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
          currentUserId={currentUserId}
          canModerate={canModerate}
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

type FormItem = { taskId: string; progress: number };
type FormPhoto = { photo: JournalPhoto; taskIds: string[] };
const MAX_PHOTOS = 20;

function JournalForm({
  tasks,
  allTasks,
  projectTeams,
  date,
  author,
  onClose,
  onSave,
}: {
  tasks: Task[];
  /** Cronograma completo, para mostrar a que item-pai cada atividade pertence. */
  allTasks: Task[];
  projectTeams: ProjectTeam[];
  date: string;
  author: string;
  onClose: () => void;
  onSave: (entries: JournalEntry[]) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const executableTasks = tasks.filter(
    (task) => !tasks.some((child) => child.parentId === task.id),
  );
  const openTasks = executableTasks.filter((task) => task.progress < 100);
  const selectable = openTasks.length ? openTasks : executableTasks;
  const taskById = (id: string) =>
    tasks.find((item) => item.id === id) ?? selectable[0];
  const initialProgress = (task: Task) => Math.min(5, 100 - task.progress);
  const [items, setItems] = useState<FormItem[]>([
    { taskId: selectable[0].id, progress: initialProgress(selectable[0]) },
  ]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [crew, setCrew] = useState(0);
  const [selectedTeams, setSelectedTeams] = useState<Record<string, number>>(
    {},
  );
  const [weather, setWeather] = useState("Não informado");
  const [photos, setPhotos] = useState<FormPhoto[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [dictating, setDictating] = useState(false);
  const effectiveCrew = projectTeams.length
    ? Object.values(selectedTeams).reduce((sum, workers) => sum + workers, 0)
    : crew;
  const chosenIds = items.map((item) => item.taskId);
  const remaining = selectable.filter((task) => !chosenIds.includes(task.id));
  const pathLabel = (task: Task) =>
    ancestorsOf(allTasks, task.id)
      .map((parent) => `${parent.code} ${parent.name}`)
      .join(" › ");

  function updateItem(index: number, change: Partial<FormItem>) {
    setItems((current) =>
      current.map((item, position) =>
        position === index ? { ...item, ...change } : item,
      ),
    );
  }
  function changeTask(index: number, taskId: string) {
    const previous = items[index].taskId;
    updateItem(index, { taskId, progress: initialProgress(taskById(taskId)) });
    // As fotos vinculadas à atividade trocada passam para a nova.
    setPhotos((current) =>
      current.map((entry) => ({
        ...entry,
        taskIds: entry.taskIds.map((id) => (id === previous ? taskId : id)),
      })),
    );
  }
  function addItem() {
    const next = remaining[0];
    if (!next) return;
    setItems((current) => [
      ...current,
      { taskId: next.id, progress: initialProgress(next) },
    ]);
  }
  function removeItem(index: number) {
    const removed = items[index].taskId;
    setItems((current) => current.filter((_, position) => position !== index));
    // Foto que ficaria sem atividade passa a valer para todas as que restaram.
    setPhotos((current) =>
      current.map((entry) => {
        const taskIds = entry.taskIds.filter((id) => id !== removed);
        return {
          ...entry,
          taskIds: taskIds.length
            ? taskIds
            : chosenIds.filter((id) => id !== removed),
        };
      }),
    );
  }
  async function selectPhotos(files: FileList | null, target: string | null) {
    if (!files?.length) return;
    setLoadingPhotos(true);
    setPhotoError("");
    try {
      const selected = Array.from(files).slice(
        0,
        Math.max(0, MAX_PHOTOS - photos.length),
      );
      const compressed = await Promise.all(selected.map(compressJournalPhoto));
      setPhotos((current) => [
        ...current,
        ...compressed.map((photo) => ({
          photo,
          taskIds: target ? [target] : [...chosenIds],
        })),
      ]);
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
  function togglePhotoLink(photoIndex: number, taskId: string) {
    setPhotos((current) =>
      current.map((entry, position) => {
        if (position !== photoIndex) return entry;
        const linked = entry.taskIds.includes(taskId);
        // Toda foto precisa continuar vinculada a pelo menos uma atividade.
        if (linked && entry.taskIds.length === 1) return entry;
        return {
          ...entry,
          taskIds: linked
            ? entry.taskIds.filter((id) => id !== taskId)
            : [...entry.taskIds, taskId],
        };
      }),
    );
  }
  const photosOf = (taskId: string) =>
    photos.filter((entry) => entry.taskIds.includes(taskId));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setPhotoError("");
    const time = new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const teams = Object.entries(selectedTeams).map(([teamId, workers]) => ({
      teamId,
      name: projectTeams.find((team) => team.id === teamId)?.name ?? "Equipe",
      workers,
    }));
    try {
      await onSave(
        items.map((item) => {
          const task = taskById(item.taskId);
          return {
            id: crypto.randomUUID(),
            date,
            time,
            taskId: item.taskId,
            title: title.trim() || task.name,
            description,
            progressBefore: task.progress,
            progressAdded: item.progress,
            progressAfter: Math.min(100, task.progress + item.progress),
            author,
            weather,
            crew: effectiveCrew,
            teams,
            // O mesmo objeto de foto em várias atividades é enviado uma única vez.
            photos: photosOf(item.taskId).map((entry) => entry.photo),
          };
        }),
      );
    } catch (cause) {
      setPhotoError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar o diário.",
      );
      setSaving(false);
    }
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
      setPhotoError(
        "O navegador não oferece ditado. Use o microfone do teclado do celular.",
      );
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
      ? items.length > 0
      : step === 2
        ? items.some((item) => item.progress > 0) &&
          items.every((item) => item.progress >= 0)
        : step === 3
          ? photos.length > 0
          : step === 4
            ? Boolean(description.trim())
            : true;
  const totalPhotos = photos.length;
  return (
    <Modal
      title="Novo registro de campo"
      subtitle="Selecione uma ou mais atividades executáveis; itens-pai com filhos são calculados automaticamente."
      onClose={onClose}
      wide
    >
      <form className="journal-form field-first" onSubmit={submit}>
        <nav
          className="journal-wizard-steps full"
          aria-label="Etapas do diário"
        >
          {["Atividades", "Avanço", "Fotos", "Descrição", "Revisar"].map(
            (label, index) => (
              <button
                key={label}
                type="button"
                className={
                  step === index + 1 ? "active" : step > index + 1 ? "done" : ""
                }
                onClick={() => index + 1 < step && setStep(index + 1)}
              >
                <b>{step > index + 1 ? "✓" : index + 1}</b>
                <span>{label}</span>
              </button>
            ),
          )}
        </nav>

        <section
          className={`journal-items full wizard-panel ${step === 1 ? "active" : ""}`}
        >
          <header>
            <span>1 · Atividades do cronograma (EAP)</span>
            <p>Inclua todas as atividades executadas neste registro.</p>
          </header>
          {items.map((item, index) => {
            const task = taskById(item.taskId);
            const path = pathLabel(task);
            return (
              <div className="journal-item-row" key={`${item.taskId}-${index}`}>
                <b className="journal-item-index">{index + 1}</b>
                <div>
                  <SearchableSelect
                    value={item.taskId}
                    onChange={(event) => changeTask(index, event.target.value)}
                  >
                    {selectable
                      .filter(
                        (option) =>
                          option.id === item.taskId ||
                          !chosenIds.includes(option.id),
                      )
                      .map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.code} · {option.name} ({option.progress}%)
                        </option>
                      ))}
                  </SearchableSelect>
                  <small>
                    {path ? `${path} · ` : ""}
                    {task.responsible || "Sem responsável"}
                  </small>
                </div>
                {items.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn tiny danger"
                    aria-label={`Remover ${task.code}`}
                    onClick={() => removeItem(index)}
                  >
                    <Icon name="close" />
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="secondary-btn journal-add-item"
            disabled={!remaining.length}
            onClick={addItem}
          >
            <Icon name="plus" />{" "}
            {remaining.length
              ? "Adicionar outra atividade"
              : "Todas as atividades abertas já foram incluídas"}
          </button>
        </section>

        <section
          className={`journal-items full wizard-panel ${step === 2 ? "active" : ""}`}
        >
          <header>
            <span>2 · Medição do avanço</span>
            <p>Informe, em cada atividade, apenas o percentual executado hoje.</p>
          </header>
          {items.map((item, index) => {
            const task = taskById(item.taskId);
            const maximum = Math.max(0, 100 - task.progress);
            return (
              <div className="journal-measure-row" key={item.taskId}>
                <div>
                  <strong>
                    {task.code} · {task.name}
                  </strong>
                  <small>{pathLabel(task) || task.phase}</small>
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
                      aria-label={`Percentual executado hoje em ${task.code}`}
                      type="number"
                      min="0"
                      max={maximum}
                      value={item.progress}
                      onChange={(event) =>
                        updateItem(index, {
                          progress: Math.max(
                            0,
                            Math.min(maximum, Number(event.target.value)),
                          ),
                        })
                      }
                    />
                  </label>
                  <b>=</b>
                  <span className="measure-result">
                    <small>NOVO TOTAL</small>
                    <strong>{task.progress + item.progress}%</strong>
                  </span>
                </div>
                <input
                  className="measurement-range"
                  type="range"
                  min="0"
                  max={maximum}
                  value={item.progress}
                  aria-label={`Ajustar avanço de ${task.code}`}
                  onChange={(event) =>
                    updateItem(index, { progress: Number(event.target.value) })
                  }
                />
              </div>
            );
          })}
        </section>
        {projectTeams.length > 0 && (
          <section
            className={`team-picker full wizard-panel ${step === 2 ? "active" : ""}`}
          >
            <header>
              <div>
                <span>Equipes nesta frente</span>
                <p>Selecione as empresas envolvidas e informe o efetivo.</p>
              </div>
              <strong>{effectiveCrew} pessoas</strong>
            </header>
            <div>
              {projectTeams
                .filter((team) => team.active)
                .map((team) => {
                  const selected = team.id in selectedTeams;
                  return (
                    <label className={selected ? "selected" : ""} key={team.id}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) =>
                          setSelectedTeams((current) => {
                            const next = { ...current };
                            if (event.target.checked) next[team.id] = 1;
                            else delete next[team.id];
                            return next;
                          })
                        }
                      />
                      <span>
                        <strong>{team.name}</strong>
                        <small>
                          {team.company} · {team.specialty}
                        </small>
                      </span>
                      {selected && (
                        <input
                          aria-label={`Pessoas da ${team.name}`}
                          type="number"
                          min="1"
                          value={selectedTeams[team.id]}
                          onChange={(event) =>
                            setSelectedTeams((current) => ({
                              ...current,
                              [team.id]: Math.max(
                                1,
                                Number(event.target.value),
                              ),
                            }))
                          }
                        />
                      )}
                    </label>
                  );
                })}
            </div>
          </section>
        )}
        {!projectTeams.length && (
          <label className={`wizard-panel ${step === 2 ? "active" : ""}`}>
            <span>Efetivo nesta frente</span>
            <input
              type="number"
              min="0"
              value={crew}
              onChange={(event) => setCrew(Number(event.target.value))}
            />
          </label>
        )}
        <label className={`wizard-panel ${step === 2 ? "active" : ""}`}>
          <span>Condição do tempo</span>
          <SearchableSelect
            value={weather}
            onChange={(event) => setWeather(event.target.value)}
          >
            <option>Não informado</option>
            <option>Ensolarado</option>
            <option>Parcialmente nublado</option>
            <option>Nublado</option>
            <option>Chuva leve</option>
            <option>Chuva intensa</option>
          </SearchableSelect>
        </label>

        <section
          className={`journal-items full wizard-panel ${step === 3 ? "active" : ""}`}
        >
          <header>
            <span>3 · Evidências fotográficas</span>
            <p>
              Uma foto no registro já basta. Cada EAP pode receber várias fotos
              (câmera ou galeria); se a mesma foto mostra várias atividades,
              envie uma vez e marque as atividades nela.
            </p>
          </header>
          {items.length > 1 && (
            <div className="journal-photo-row journal-photo-all">
              <div>
                <strong>Foto que vale para todas as atividades</strong>
                <small>
                  Use quando a mesma imagem mostra várias EAPs; depois ajuste
                  os vínculos em cada foto.
                </small>
              </div>
              <PhotoPickButtons
                disabled={loadingPhotos || totalPhotos >= MAX_PHOTOS}
                onFiles={(files) => void selectPhotos(files, null)}
              />
            </div>
          )}
          {items.map((item) => {
            const task = taskById(item.taskId);
            const linked = photosOf(item.taskId);
            return (
              <div className="journal-photo-row" key={item.taskId}>
                <div>
                  <strong>
                    {task.code} · {task.name}
                  </strong>
                  <small>
                    +{item.progress}% ({task.progress}% →{" "}
                    {task.progress + item.progress}%) ·{" "}
                    {linked.length
                      ? `${linked.length} foto${linked.length > 1 ? "s" : ""} vinculada${linked.length > 1 ? "s" : ""}`
                      : items.length > 1
                        ? "sem foto própria (opcional)"
                        : "nenhuma foto ainda"}
                  </small>
                  {linked.length > 0 && (
                    <span className="journal-photo-strip">
                      {linked.slice(0, 6).map((entry, index) => (
                        <img key={`${entry.photo.url.slice(-24)}-${index}`} src={entry.photo.url} alt="" />
                      ))}
                      {linked.length > 6 && <b>+{linked.length - 6}</b>}
                    </span>
                  )}
                </div>
                <PhotoPickButtons
                  disabled={loadingPhotos || totalPhotos >= MAX_PHOTOS}
                  onFiles={(files) => void selectPhotos(files, item.taskId)}
                />
              </div>
            );
          })}
          <small className="journal-photo-hint">
            {loadingPhotos
              ? "Redimensionando e compactando..."
              : `${totalPhotos} de ${MAX_PHOTOS} fotos · cada EAP pode ter várias fotos. As imagens são redimensionadas para até 1600 px antes do envio.`}
          </small>
          {photos.length > 0 && (
            <div className="journal-photo-links">
              {photos.map((entry, photoIndex) => (
                <article key={`${entry.photo.url.slice(-24)}-${photoIndex}`}>
                  <div className="journal-photo-thumb">
                    <img src={entry.photo.url} alt={`Prévia ${photoIndex + 1}`} />
                    <button
                      type="button"
                      aria-label={`Remover foto ${photoIndex + 1}`}
                      onClick={() =>
                        setPhotos((current) =>
                          current.filter((_, position) => position !== photoIndex),
                        )
                      }
                    >
                      <Icon name="close" />
                    </button>
                    <span>
                      Foto {photoIndex + 1} ·{" "}
                      {Math.max(1, Math.round((entry.photo.sizeBytes ?? 0) / 1024))} KB
                    </span>
                  </div>
                  {items.length > 1 && (
                    <div className="journal-photo-chips" aria-label="Atividades desta foto">
                      {items.map((item) => {
                        const active = entry.taskIds.includes(item.taskId);
                        return (
                          <button
                            type="button"
                            key={item.taskId}
                            className={active ? "active" : ""}
                            aria-pressed={active}
                            onClick={() => togglePhotoLink(photoIndex, item.taskId)}
                          >
                            {taskById(item.taskId).code}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
        {photoError && (
          <div
            className={`access-message full wizard-panel ${step >= 3 ? "active" : ""}`}
          >
            <Icon name="alert" />
            {photoError}
          </div>
        )}

        <label className={`full wizard-panel ${step === 4 ? "active" : ""}`}>
          <span>4 · O que foi realizado</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              items.length > 1
                ? "Título do serviço (opcional — vazio usa o nome de cada atividade)"
                : "Título objetivo do serviço executado (opcional)"
            }
          />
        </label>
        <label className={`full wizard-panel ${step === 4 ? "active" : ""}`}>
          <span className="dictation-label">
            Descrição técnica{" "}
            <button
              type="button"
              className={dictating ? "voice-button listening" : "voice-button"}
              onClick={startDictation}
            >
              {dictating ? "Ouvindo..." : "Ditar"}
            </button>
          </span>
          <textarea
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Descreva local, quantidades, condições, intercorrências e próximos passos..."
          />
        </label>

        <div
          className={`wizard-review full wizard-panel ${step === 5 ? "active" : ""}`}
        >
          {items.map((item) => {
            const task = taskById(item.taskId);
            const linked = photosOf(item.taskId).length;
            return (
              <div key={item.taskId}>
                <span>{task.code}</span>
                <strong>{task.name}</strong>
                <small>
                  +{item.progress}% · {task.progress}% →{" "}
                  {task.progress + item.progress}% · {linked} foto
                  {linked === 1 ? "" : "s"}
                </small>
              </div>
            );
          })}
          <div>
            <span>EVIDÊNCIAS</span>
            <strong>{totalPhotos} fotos</strong>
            <small>{effectiveCrew} pessoas em campo</small>
          </div>
          <div className="full">
            <span>EXECUÇÃO</span>
            <strong>{title || (items.length > 1 ? "Nome de cada atividade" : taskById(items[0].taskId).name)}</strong>
            <small>{description}</small>
          </div>
        </div>
        <div
          className={`save-summary full wizard-panel ${step === 5 ? "active" : ""}`}
        >
          <Icon name="check" />
          <span>
            <strong>Ao salvar</strong>
            <small>
              {items.length > 1
                ? `As ${items.length} atividades serão atualizadas juntas`
                : `A atividade passará de ${taskById(items[0].taskId).progress}% para ${taskById(items[0].taskId).progress + items[0].progress}%`}{" "}
              e o registro entrará automaticamente no Status Report de{" "}
              {dateLabel(date)}.
            </small>
          </span>
        </div>
        <div className="modal-actions full">
          <button
            type="button"
            className="secondary-btn"
            onClick={() =>
              step === 1 ? onClose() : setStep((current) => current - 1)
            }
          >
            {step === 1 ? "Cancelar" : "Voltar"}
          </button>
          {step < 5 ? (
            <button
              type="button"
              className="primary-btn"
              disabled={!canAdvance || loadingPhotos || saving}
              onClick={() => setStep((current) => current + 1)}
            >
              Continuar <Icon name="arrow" />
            </button>
          ) : (
            <button className="primary-btn" disabled={loadingPhotos || saving}>
              {saving ? (
                <>
                  <span className="button-spinner" />
                  Salvando diário...
                </>
              ) : (
                <>
                  <Icon name="check" /> Salvar diário e atualizar Gantt
                </>
              )}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

/** Câmera (uma foto por vez) e galeria (várias de uma vez). No celular, o atributo
 * capture abre direto a câmera e não permite escolher várias imagens, por isso são dois botões. */
function PhotoPickButtons({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <span className="journal-photo-buttons">
      <label className={`secondary-btn compact${disabled ? " disabled" : ""}`}>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          disabled={disabled}
          onChange={(event) => {
            onFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Icon name="camera" /> Câmera
      </label>
      <label className={`secondary-btn compact${disabled ? " disabled" : ""}`}>
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          disabled={disabled}
          onChange={(event) => {
            onFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Icon name="plus" /> Galeria
      </label>
    </span>
  );
}
