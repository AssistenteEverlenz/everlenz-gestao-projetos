"use client";

import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";

type Option = { value: string; label: string; group: string; disabled: boolean };
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
function textContent(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : String(child)).join("");
}
function optionsFrom(children: ReactNode, group = "", disabled = false): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; label?: string; disabled?: boolean }>(child)) return [];
    const props = child.props;
    if (child.type === "option") {
      const label = props.label ?? textContent(props.children);
      return [{ value: String(props.value ?? label), label, group, disabled: disabled || !!props.disabled }];
    }
    return optionsFrom(props.children, props.label ?? group, disabled || !!props.disabled);
  });
}

/** Keeps native form values and change events while adding a searchable popup. */
export function SearchableSelect({ children, className, style, id, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const generatedId = useId();
  const listId = `${generatedId}-options`;
  const native = useRef<HTMLSelectElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [localValue, setLocalValue] = useState(props.defaultValue);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const options = optionsFrom(children);
  const value = String(props.value ?? localValue ?? options.find(option => !option.disabled)?.value ?? "");
  const selected = options.find(option => option.value === value);
  const filtered = options.filter(option => normalize(`${option.label} ${option.group}`).includes(normalize(query)));
  const enabled = filtered.filter(option => !option.disabled);
  const current = enabled[Math.min(active, Math.max(0, enabled.length - 1))];

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const height = Math.min(280, Math.max(below, rect.top - 12));
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)), top: below >= Math.min(280, rect.top - 12) ? rect.bottom + 4 : Math.max(8, rect.top - height - 4), width: Math.min(rect.width, window.innerWidth - 16), maxHeight: height });
    };
    const outside = (event: PointerEvent) => {
      if (!input.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false);
    };
    reposition();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) popup.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, query, open]);

  function choose(option: Option) {
    if (!native.current || option.disabled) return;
    native.current.value = option.value;
    setLocalValue(option.value);
    native.current.dispatchEvent(new Event("change", { bubbles: true }));
    setOpen(false);
    setQuery("");
  }

  return <div className={`searchable-select ${className ?? ""}`} style={style}>
    <select {...props} hidden ref={native} className="searchable-select-native" tabIndex={-1} aria-hidden="true" onInvalid={event => { event.preventDefault(); input.current?.focus(); input.current?.setCustomValidity("Selecione uma opção."); input.current?.reportValidity(); }} onChange={event => { input.current?.setCustomValidity(""); props.onChange?.(event); }}>{children}</select>
    <input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-autocomplete="list" aria-activedescendant={open && current ? `${listId}-${options.indexOf(current)}` : undefined} aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-describedby={props["aria-describedby"]} aria-required={props.required} disabled={props.disabled} autoComplete="off" placeholder={selected?.label ?? "Selecione uma opção"} value={open ? query : selected?.label ?? ""}
      onFocus={event => event.target.select()}
      onClick={() => { if (!open) { setQuery(""); setActive(0); setOpen(true); } }}
      onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); input.current?.setCustomValidity(""); }}
      onBlur={() => setOpen(false)}
      onKeyDown={event => {
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!open) { setOpen(true); setQuery(""); setActive(0); } else setActive(index => Math.max(0, Math.min(enabled.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
        if (event.key === "Enter" && open) { event.preventDefault(); if (current) choose(current); }
      }} />
    <span className="searchable-select-chevron" aria-hidden="true">⌄</span>
    {open && !props.disabled && createPortal(<div ref={popup} className="searchable-select-popup" style={position} onMouseDown={event => event.preventDefault()}>
      <div id={listId} role="listbox" aria-label={props["aria-label"] ?? "Opções"}>
        {filtered.map((option, index) => <div key={`${option.value}-${index}`}>
          {option.group && option.group !== filtered[index - 1]?.group && <div className="searchable-select-group">{option.group}</div>}
          <div id={`${listId}-${options.indexOf(option)}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-active={option === current} className="searchable-select-option" onClick={() => choose(option)}>{option.label}{option.value === value && <span aria-hidden="true"> ✓</span>}</div>
        </div>)}
      </div>
      {!filtered.length && <div className="searchable-select-empty" role="status">Nenhuma opção encontrada.</div>}
    </div>, document.body)}
  </div>;
}
