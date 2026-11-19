'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Chip, SectionTitle, Sheet, Spinner, Toasts, useToasts } from '@/components/ui';
import { TemplateCard, useTemplates } from '@/components/admin/TemplatePicker';
import { RuleCards } from '@/components/admin/RuleCards';
import { ConfigEditor } from '@/components/admin/ConfigEditor';
import { api } from '@/lib/client';
import { runReadinessCheck } from '@/engine/readiness';
import { validateConfig } from '@/engine/validate';
import type { SessionConfig } from '@/engine/types';
import type { TemplateSummary } from '@/server/game-templates';

/** Manage saved templates: inspect, edit, duplicate, share, delete. */
export default function TemplatesPage() {
  const toasts = useToasts();
  const { templates, error, reload } = useTemplates();
  const [editing, setEditing] = useState<TemplateSummary | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove(template: TemplateSummary) {
    if (!confirm(`Delete the template "${template.name}"? Sessions already created from it are not affected.`)) {
      return;
    }
    setBusy(true);
    try {
      await api(`/api/admin/templates/${template.id}`, { method: 'DELETE' });
      await reload();
      toasts.success('Template deleted');
    } catch (e) {
      toasts.error(e instanceof Error ? e.message : 'Could not delete it.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleShared(template: TemplateSummary) {
    setBusy(true);
    try {
      await api(`/api/admin/templates/${template.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isShared: !template.isShared }),
      });
      await reload();
      toasts.success(template.isShared ? 'No longer shared' : 'Shared with other administrators');
    } catch (e) {
      toasts.error(e instanceof Error ? e.message : 'Could not update it.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/admin" className="text-xs font-semibold uppercase tracking-[0.2em] text-muted hover:text-ink">
        ← Sessions
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Game templates</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        A template is a whole ready-to-play game: a set of companies, which mechanic each one runs,
        the numbers and the session settings. Start a session from one, edit it, and save the result
        as your own.
      </p>

      {error ? <p className="mt-4 rounded-lg bg-down/15 px-3 py-2 text-sm text-down">{error}</p> : null}

      {!templates ? (
        <p className="mt-6 text-sm text-muted">
          <Spinner className="mr-2" /> Loading…
        </p>
      ) : (
        <>
          <section className="mt-8">
            <SectionTitle hint={`${templates.builtIn.length} built in`}>
              Built-in templates
            </SectionTitle>
            <p className="mb-3 text-xs text-muted">
              Every one uses a different set of companies, a different arrangement of mechanics and
              different numbers, so a class that has played one learns nothing transferable about the
              next. These cannot be edited directly — start a session from one, change what you like,
              and save that as your own template.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {templates.builtIn.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  selected={false}
                  onSelect={() => {}}
                />
              ))}
            </div>
          </section>

          <section className="mt-10">
            <SectionTitle hint={`${templates.custom.length} saved`}>Your templates</SectionTitle>
            {templates.custom.length === 0 ? (
              <Card>
                <p className="text-sm text-muted">
                  You have not saved any templates yet. Open a session, adjust the stocks and rules
                  on the <strong className="text-ink">Stocks &amp; rules</strong> tab, then press{' '}
                  <strong className="text-ink">Save as template</strong> on the Configuration tab.
                </p>
              </Card>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {templates.custom.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    selected={false}
                    onSelect={() => {}}
                    footer={
                      template.ownedByYou ? (
                        <span className="flex flex-wrap items-center gap-3">
                          <button
                            className="text-[11px] font-semibold text-lavender hover:underline"
                            onClick={() => setEditing(template)}
                            disabled={busy}
                          >
                            Edit
                          </button>
                          <button
                            className="text-[11px] font-semibold text-muted hover:text-ink"
                            onClick={() => void toggleShared(template)}
                            disabled={busy}
                          >
                            {template.isShared ? 'Stop sharing' : 'Share'}
                          </button>
                          <button
                            className="text-[11px] font-semibold text-down hover:underline"
                            onClick={() => void remove(template)}
                            disabled={busy}
                          >
                            Delete
                          </button>
                        </span>
                      ) : (
                        <Chip tone="neutral">shared with you</Chip>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {editing ? (
        <TemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
            toasts.success('Template saved');
          }}
          onError={toasts.error}
        />
      ) : null}

      <Toasts toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </main>
  );
}

/** Edits a saved template in place, with the same rule cards a session uses. */
function TemplateEditor({
  template,
  onClose,
  onSaved,
  onError,
}: {
  template: TemplateSummary;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [tab, setTab] = useState<'rules' | 'settings'>('rules');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api<{ config: SessionConfig }>(`/api/admin/templates/${template.id}`)
      .then((r) => {
        if (active) setConfig(r.config);
      })
      .catch((e) => onError(e instanceof Error ? e.message : 'Could not load the template.'));
    return () => {
      active = false;
    };
    // onError is recreated each render; the template id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  const issues = config ? validateConfig(config) : [];
  const blocking = issues.filter((i) => i.level === 'error');

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      await api(`/api/admin/templates/${template.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), description: description.trim(), config }),
      });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Edit — ${template.name}`} wide>
      {!config ? (
        <p className="text-sm text-muted">
          <Spinner className="mr-2" /> Loading…
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Template name</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
            <label className="block">
              <span className="label">Description</span>
              <input
                className="field"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={600}
                placeholder="What makes this game different"
              />
            </label>
          </div>

          <div className="mt-4 flex gap-1.5">
            {(['rules', 'settings'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={
                  tab === t
                    ? 'rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-ink'
                    : 'rounded-lg bg-surface2 px-3 py-1.5 text-xs font-semibold text-muted'
                }
              >
                {t === 'rules' ? 'Companies & rules' : 'Settings'}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {tab === 'rules' ? (
              <RuleCards config={config} editable onChange={setConfig} />
            ) : (
              <ConfigEditor config={config} editable onChange={setConfig} />
            )}
          </div>

          {blocking.length > 0 ? (
            <ul className="mt-4 space-y-1">
              {blocking.map((issue, i) => (
                <li key={i} className="rounded-md bg-down/15 px-2 py-1 text-xs text-down">
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-md bg-up/10 px-2 py-1 text-xs text-up">
              {runReadinessCheck(config).summary}
            </p>
          )}

          <button className="btn-primary mt-4 w-full" onClick={save} disabled={saving || blocking.length > 0}>
            {saving ? <Spinner /> : null} Save template
          </button>
        </>
      )}
    </Sheet>
  );
}
