import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';
import type { ComponentType } from 'react';

export interface PaletteCommand {
  id: string;
  group: 'Navigation' | 'Concurrency & Presets' | 'Chaos Faults' | 'SRE & Appearance';
  title: string;
  subtitle: string;
  keywords: string;
  icon: ComponentType<{ className?: string }>;
  badge?: string;
  active?: boolean;
  onExecute: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}

export function CommandPalette({ open, onClose, commands }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.subtitle.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        c.keywords.toLowerCase().includes(q)
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) =>
          filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length
        );
      } else if (e.key === 'Enter' && filtered[selectedIdx]) {
        e.preventDefault();
        filtered[selectedIdx].onExecute();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, filtered, selectedIdx, onClose]);

  if (!open) return null;

  // Group filtered commands while keeping flat selection index accurate
  const groups = Array.from(new Set(filtered.map((c) => c.group)));

  return (
    <div
      data-testid="command-palette-modal"
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/70 px-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="AegisPulse Command Palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="surface-panel w-full max-w-xl overflow-hidden rounded-2xl border shadow-2xl">
        {/* Search Input Header */}
        <div className="border-hairline flex items-center gap-3 border-b px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-cyan-500" />
          <input
            ref={inputRef}
            data-testid="command-palette-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to tab, race all 3 engines, toggle chaos fault, or switch theme..."
            className="w-full bg-transparent text-sm text-heading placeholder:text-faint focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="surface-chip rounded-md border p-1 text-dim hover:text-heading"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Command List */}
        <div className="max-h-[56vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-10 text-center font-mono text-xs text-dim">
              No telemetry commands matched &ldquo;{query}&rdquo;
            </div>
          ) : (
            groups.map((grp) => (
              <div key={grp} className="mb-2 last:mb-0">
                <div className="px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
                  {grp}
                </div>
                <div className="space-y-0.5">
                  {filtered
                    .map((cmd, flatIdx) => ({ cmd, flatIdx }))
                    .filter((item) => item.cmd.group === grp)
                    .map(({ cmd, flatIdx }) => {
                      const Icon = cmd.icon;
                      const isSelected = flatIdx === selectedIdx;
                      return (
                        <button
                          key={cmd.id}
                          type="button"
                          data-testid={`cmd-${cmd.id}`}
                          onMouseEnter={() => setSelectedIdx(flatIdx)}
                          onClick={() => {
                            cmd.onExecute();
                            onClose();
                          }}
                          className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                            isSelected
                              ? 'bg-cyan-500/15 text-heading ring-1 ring-cyan-500/40'
                              : 'text-body hover:bg-slate-500/10'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                                isSelected
                                  ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-500 dark:text-cyan-300'
                                  : 'surface-inset text-dim'
                              }`}
                            >
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-xs font-bold text-heading">
                                {cmd.title}
                              </div>
                              <div className="truncate text-[11px] text-dim">{cmd.subtitle}</div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {cmd.badge && (
                              <span
                                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                                  cmd.active
                                    ? 'bg-amber-500 text-slate-950'
                                    : 'surface-chip border text-dim'
                                }`}
                              >
                                {cmd.badge}
                              </span>
                            )}
                            {isSelected && <CornerDownLeft className="h-3.5 w-3.5 text-cyan-500" />}
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Hints */}
        <div className="border-hairline flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 font-mono text-[10.5px] text-faint">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Execute</span>
            <span>Esc Close</span>
          </div>
          <span>AegisPulse v2.0 Command Bus</span>
        </div>
      </div>
    </div>
  );
}
