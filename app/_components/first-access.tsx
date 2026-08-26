"use client";

import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Icon } from "./icons";
import { Modal } from "./ui";

export function FirstAccess({ user, onComplete }: { user: User; onComplete: (user: User) => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setError("A nova senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirmation) return setError("As senhas não coincidem.");
    setSaving(true); setError("");
    const { data, error: updateError } = await getSupabaseBrowserClient().auth.updateUser({
      password,
      data: { ...user.user_metadata, must_change_password: false },
    });
    setSaving(false);
    if (updateError || !data.user) return setError(updateError?.message ?? "Não foi possível alterar a senha.");
    onComplete(data.user);
  }

  return <Modal title="Crie sua nova senha" subtitle="Por segurança, substitua a senha provisória antes de acessar a plataforma." dismissible={false} onClose={() => undefined}>
    <form className="invite-form" onSubmit={submit}>
      <div className="modal-note"><Icon name="check"/><p><strong>Seu acesso já está liberado</strong><br/>Depois desta etapa, mostraremos um guia rápido pelas principais funções do Em Dia.</p></div>
      <label><span>Nova senha</span><input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres"/></label>
      <label><span>Confirme a nova senha</span><input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label>
      {error && <div className="access-message"><Icon name="alert"/>{error}</div>}
      <div className="modal-actions"><button className="primary-btn" disabled={saving}>{saving && <span className="button-spinner"/>}{saving ? "Salvando nova senha..." : "Salvar e continuar"}</button></div>
    </form>
  </Modal>;
}
