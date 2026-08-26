"use client";
/* eslint-disable @next/next/no-img-element -- evidências privadas da obra */

import { useMemo, useState } from "react";
import { EntryHistoryModal } from "../entry-history";
import { Icon } from "../icons";
import type { JournalEntry, Project, Task, ViewId } from "../types";
import { Modal } from "../ui";

type Props = {
  project: Project;
  tasks: Task[];
  entries: JournalEntry[];
  editEntry: (entry: JournalEntry) => Promise<void>;
  deleteEntry: (entry: JournalEntry) => Promise<void>;
  navigate: (view: ViewId) => void;
};

export function Photos({ project, tasks, entries, editEntry, deleteEntry, navigate }: Props) {
  const [eap, setEap] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [historyEntry, setHistoryEntry] = useState<JournalEntry | null>(null);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const photos = useMemo(() => entries.flatMap((entry) => {
    const task = tasks.find((item) => item.id === entry.taskId);
    return entry.photos.map((photo, index) => ({
      key: photo.id ?? `${entry.id}-${index}`,
      photo,
      entry,
      task,
      index,
    }));
  }).filter((item) => {
    const matchesEap = eap === "all" || item.task?.code === eap || item.task?.code.startsWith(`${eap}.`);
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return matchesEap && (!term || `${item.entry.title} ${item.entry.description} ${item.task?.name ?? ""}`.toLocaleLowerCase("pt-BR").includes(term));
  }), [eap, entries, search, tasks]);
  const selectedPhotos = photos.filter((item) => selected.has(item.key));
  const eaps = [...new Map(tasks.map((task) => [task.code.split(".")[0], tasks.find((item) => item.code === task.code.split(".")[0]) ?? task])).values()];
  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  return <div className="view-stack photo-library-view">
    <section className="photo-library-toolbar glass">
      <div><span className="overline">ACERVO VISUAL</span><h2>{entries.reduce((sum, entry) => sum + entry.photos.length, 0)} evidências da obra</h2><p>As imagens permanecem vinculadas ao diário e à atividade que originou o avanço.</p></div>
      <div className="photo-library-filters">
        <label className="search-box"><Icon name="search"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar foto ou atividade..."/></label>
        <select value={eap} onChange={(event) => setEap(event.target.value)}><option value="all">Todas as EAPs</option>{eaps.map((task) => <option key={task.code} value={task.code}>EAP {task.code} · {task.name}</option>)}</select>
        <button className="primary-btn" disabled={!selected.size} onClick={() => setBatchOpen(true)}><Icon name="report"/> Relatório em lote ({selected.size})</button>
      </div>
    </section>
    {!photos.length ? <section className="empty-schedule glass"><span className="empty-workspace-icon"><Icon name="camera"/></span><h2>Nenhuma evidência encontrada</h2><p>Altere os filtros ou registre novas fotos pelo Diário de Obra.</p></section> : <section className="photo-library-grid">
      {photos.map((item) => <article className={selected.has(item.key) ? "photo-library-card selected" : "photo-library-card"} key={item.key}>
        <button className="photo-library-image" onClick={() => setPreview({ url:item.photo.url, label:`${item.task?.code ?? ""} · ${item.entry.title}` })}><img src={item.photo.url} alt={item.entry.title}/><span>Foto {item.index + 1}</span></button>
        <button className="photo-select" aria-label="Selecionar para relatório" onClick={() => toggle(item.key)}><span>{selected.has(item.key) ? "✓" : ""}</span></button>
        <div><span className="photo-eap">EAP {item.task?.code ?? "—"}</span><strong>{item.entry.title}</strong><small>{item.entry.date.split("-").reverse().join("/")} · +{item.entry.progressAdded}% medido</small><footer><span><button onClick={() => setHistoryEntry(item.entry)}>Abrir diário</button><button onClick={() => navigate("schedule")}>Ver atividade</button></span><em>{item.task?.name}</em></footer></div>
      </article>)}
    </section>}
    {historyEntry && <EntryHistoryModal task={tasks.find((task) => task.id === historyEntry.taskId) ?? tasks[0]} entries={[historyEntry]} onClose={() => setHistoryEntry(null)} onUpdate={async (entry) => { await editEntry(entry); setHistoryEntry(entry); }} onDelete={async (entry) => { await deleteEntry(entry); setHistoryEntry(null); }}/>} 
    {preview && <div className="photo-lightbox" role="dialog" aria-modal="true" onMouseDown={(event) => event.target === event.currentTarget && setPreview(null)}><header><strong>{preview.label}</strong><button className="icon-btn" onClick={() => setPreview(null)}><Icon name="close"/></button></header><img src={preview.url} alt={preview.label}/></div>}
    {batchOpen && <Modal title="Relatório fotográfico em lote" subtitle={`${selectedPhotos.length} evidências selecionadas`} onClose={() => setBatchOpen(false)} wide><div className="report-preview"><div className="report-paper photo-batch-paper"><header><div className="report-logo"><img src="/emdia.svg" alt=""/><strong>em dia</strong><span>BY EVERLENZ</span></div><small>RELATÓRIO FOTOGRÁFICO</small></header><div className="report-cover"><span>ACOMPANHAMENTO VISUAL</span><h2>{project.name}</h2><p>{project.client} · {project.location}</p></div><section className="photo-batch-grid">{selectedPhotos.map((item) => <article key={item.key}><img src={item.photo.url} alt={item.entry.title}/><div><b>EAP {item.task?.code ?? "—"} · {item.task?.name}</b><strong>{item.entry.title}</strong><p>{item.entry.description}</p><span>{item.entry.progressBefore}% → {item.entry.progressAfter}% (+{item.entry.progressAdded}%)</span></div></article>)}</section><footer>Em Dia — acompanhamento técnico com evidências de campo</footer></div><div className="preview-actions"><button className="secondary-btn" onClick={() => setBatchOpen(false)}>Fechar</button><button className="primary-btn" onClick={() => window.print()}><Icon name="download"/> Exportar PDF</button></div></div></Modal>}
  </div>;
}
