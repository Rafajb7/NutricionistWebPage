"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { parseGuidanceEntries, serializeGuidanceEntries } from "@/lib/nutrition/guidance";

type Entry = { id: number; text: string };

export function NutritionGuidanceEditor({ title, value, onChange, disabled = false }: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const nextId = useRef(0);
  const [entries, setEntries] = useState<Entry[]>(() =>
    parseGuidanceEntries(value).map((text) => ({ id: nextId.current++, text })));
  const entriesRef = useRef(entries);
  const lastValue = useRef(value);

  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    const replacement = parseGuidanceEntries(value).map((text) => ({ id: nextId.current++, text }));
    entriesRef.current = replacement;
    setEntries(replacement);
  }, [value]);

  function commit(next: Entry[]) {
    if (disabled) return;
    const serialized = serializeGuidanceEntries(next.map((entry) => entry.text));
    if (serialized.length > 3000) return;
    entriesRef.current = next;
    setEntries(next);
    if (serialized !== lastValue.current) {
      lastValue.current = serialized;
      onChange(serialized);
    }
  }

  function move(index: number, direction: number) {
    const next = [...entriesRef.current];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  }

  const iconClass = "rounded-md p-1.5 text-brand-muted transition hover:bg-white/10 hover:text-brand-text disabled:cursor-not-allowed disabled:opacity-30";
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-brand-text">{title}</h3>
        <span className="text-xs text-brand-muted">{serializeGuidanceEntries(entries.map((entry) => entry.text)).length}/3000</span>
      </div>
      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div key={entry.id} className="rounded-lg border border-white/10 bg-black/20 p-2">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent" />
              <input
                aria-label={`${title}: entrada ${index + 1}`}
                value={entry.text}
                disabled={disabled}
                maxLength={Math.max(entry.text.length, 3000 - entries.filter((other) => other.id !== entry.id).reduce((sum, other) => sum + other.text.length + 1, 0))}
                onChange={(event) => commit(entriesRef.current.map((other) => other.id === entry.id ? { ...other, text: event.target.value } : other))}
                placeholder="Escribe la entrada"
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div className="mt-1 flex justify-end gap-1">
              <button type="button" aria-label={`Subir entrada ${index + 1} de ${title}`} disabled={disabled || index === 0} onClick={() => move(index, -1)} className={iconClass}><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label={`Bajar entrada ${index + 1} de ${title}`} disabled={disabled || index === entries.length - 1} onClick={() => move(index, 1)} className={iconClass}><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label={`Eliminar entrada ${index + 1} de ${title}`} disabled={disabled} onClick={() => commit(entriesRef.current.filter((other) => other.id !== entry.id))} className={iconClass}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
        {!entries.length && <p className="py-2 text-xs text-brand-muted">Sin entradas.</p>}
      </div>
      <button type="button" aria-label={`Añadir entrada en ${title}`} disabled={disabled} onClick={() => commit([...entriesRef.current, { id: nextId.current++, text: "" }])} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-xs font-semibold text-brand-text transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">
        <Plus className="h-3.5 w-3.5" /> Añadir entrada
      </button>
    </section>
  );
}
