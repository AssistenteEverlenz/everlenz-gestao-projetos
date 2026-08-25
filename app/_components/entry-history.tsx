"use client";
/* eslint-disable @next/next/no-img-element -- evidências privadas com URL assinada */

import { useState } from "react";
import { compressJournalPhoto } from "@/lib/images";
import { Icon } from "./icons";
import type { JournalEntry, JournalPhoto, Task } from "./types";
import { Modal } from "./ui";

const fullDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

export function EntryHistoryModal({ task, entries, onClose, onUpdate }: { task: Task; entries: JournalEntry[]; onClose: () => void; onUpdate: (entry: JournalEntry) => Promise<void> }) {
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const ordered = [...entries].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return <Modal title={task.name} subtitle={`${task.code} · ${ordered.length} registro${ordered.length === 1 ? "" : "s"} no Diário de Obra`} onClose={onClose} wide>
    {editing ? <EntryEditForm task={task} entry={editing} onCancel={() => setEditing(null)} onSave={async (entry) => { await onUpdate(entry); setEditing(null); }} /> : <div className="entry-history">
      {!ordered.length && <div className="entry-history-empty"><Icon name="journal"/><strong>Nenhum diário vinculado</strong><span>Os registros de campo desta atividade aparecerão aqui.</span></div>}
      {ordered.map((entry) => <article className="entry-history-item" key={entry.id}>
        <header><div><span>{fullDate(entry.date)} · {entry.time}</span><h3>{entry.title}</h3><small>{entry.author} · {entry.weather} · {entry.crew} pessoa{entry.crew === 1 ? "" : "s"}</small></div><button className="secondary-btn compact" onClick={() => setEditing(entry)}><Icon name="settings"/> Editar</button></header>
        <p>{entry.description}</p>
        <div className="history-progress"><span><small>ANTES</small><b>{entry.progressBefore}%</b></span><Icon name="arrow"/><span className="daily"><small>MEDIDO</small><b>+{entry.progressAdded}%</b></span><Icon name="arrow"/><span><small>DEPOIS</small><b>{entry.progressAfter}%</b></span></div>
        {entry.photos.length > 0 && <div className="history-photos">{entry.photos.map((photo, index) => <a href={photo.url} target="_blank" rel="noreferrer" key={photo.id ?? `${entry.id}-${index}`}><img src={photo.url} alt={`${entry.title} · foto ${index + 1}`}/><span>Foto {index + 1}</span></a>)}</div>}
      </article>)}
    </div>}
  </Modal>;
}

function EntryEditForm({ task, entry, onCancel, onSave }: { task: Task; entry: JournalEntry; onCancel: () => void; onSave: (entry: JournalEntry) => Promise<void> }) {
  const [title, setTitle] = useState(entry.title);
  const [description, setDescription] = useState(entry.description);
  const [progress, setProgress] = useState(entry.progressAdded);
  const [crew, setCrew] = useState(entry.crew);
  const [weather, setWeather] = useState(entry.weather);
  const [photos, setPhotos] = useState<JournalPhoto[]>(entry.photos);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const progressWithoutEntry = Math.max(0, task.progress - entry.progressAdded);
  const maximum = Math.max(0, 100 - progressWithoutEntry);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setProcessing(true); setError("");
    try {
      const selected = Array.from(files).slice(0, Math.max(0, 8 - photos.length));
      const compressed = await Promise.all(selected.map(compressJournalPhoto));
      setPhotos((current) => [...current, ...compressed]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível processar as fotos.");
    } finally { setProcessing(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await onSave({ ...entry, title, description, progressAdded: progress, progressAfter: entry.progressBefore + progress, crew, weather, photos });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o diário.");
      setSaving(false);
    }
  }

  return <form className="entry-edit-form" onSubmit={submit}>
    <div className="edit-context"><Icon name="journal"/><span><strong>Editando registro de {fullDate(entry.date)}</strong><small>A atividade e a data permanecem vinculadas para preservar a rastreabilidade.</small></span></div>
    <label><span>Título do serviço</span><input required value={title} onChange={(event) => setTitle(event.target.value)}/></label>
    <label><span>Descrição técnica</span><textarea required rows={4} value={description} onChange={(event) => setDescription(event.target.value)}/></label>
    <div className="entry-edit-grid"><label><span>Avanço medido</span><input type="number" min="0" max={maximum} value={progress} onChange={(event) => setProgress(Math.min(maximum, Number(event.target.value)))}/><small>Avanço atual da atividade após a correção: {progressWithoutEntry + progress}%</small></label><label><span>Efetivo</span><input type="number" min="0" value={crew} onChange={(event) => setCrew(Number(event.target.value))}/></label><label><span>Tempo</span><select value={weather} onChange={(event) => setWeather(event.target.value)}><option>Não informado</option><option>Ensolarado</option><option>Parcialmente nublado</option><option>Nublado</option><option>Chuva leve</option><option>Chuva intensa</option></select></label></div>
    <label className="photo-drop compact-photo-drop"><input type="file" accept="image/*" capture="environment" multiple onChange={(event) => void addPhotos(event.target.files)}/><span className="photo-drop-icon"><Icon name="camera"/></span><strong>Adicionar fotos</strong><small>As novas imagens serão redimensionadas e comprimidas antes do envio.</small><em>{processing ? "Compactando..." : `${photos.length}/8 fotos`}</em></label>
    {photos.length > 0 && <div className="upload-grid">{photos.map((photo, index) => <div key={photo.id ?? `${photo.url.slice(0, 24)}-${index}`}><img src={photo.url} alt={`Foto ${index + 1}`}/><button type="button" aria-label={`Excluir foto ${index + 1}`} onClick={() => setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Icon name="close"/></button><span>{index + 1}</span></div>)}</div>}
    {error && <div className="access-message"><Icon name="alert"/>{error}</div>}
    <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onCancel}>Voltar</button><button className="primary-btn" disabled={saving || processing}><Icon name="check"/>{saving ? "Salvando..." : "Salvar correções"}</button></div>
  </form>;
}
