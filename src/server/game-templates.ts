/**
 * Game templates: the built-in library plus the ones an administrator saved.
 *
 * Built-ins live in code so they are versioned with the application. Custom
 * ones are rows in `game_templates`, each holding a complete SessionConfig
 * that is validated by the engine before it is stored — a saved template can
 * never be one that would not run.
 */

import { query, queryOne, isUniqueViolation } from './db';
import { recordAudit } from './audit';
import {
  blankTemplate,
  buildGameTemplate,
  gameTemplateById,
  listGameTemplates,
} from '@/engine/game-templates';
import type { GameTemplateMeta } from '@/engine/game-templates';
import { hasBlockingErrors, validateConfig } from '@/engine/validate';
import { templateOf } from '@/engine/templates';
import type { SessionConfig } from '@/engine/types';

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type TemplateSource = 'built-in' | 'custom' | 'blank';

export interface TemplateSummary extends GameTemplateMeta {
  /** Which mechanic each company runs. Useful to the teacher, not the class. */
  mechanics: { stockName: string; template: string; templateTitle: string }[];
  ownedByYou?: boolean;
  isShared?: boolean;
  updatedAt?: string;
}

interface TemplateRow {
  id: string;
  owner_user_id: string;
  name: string;
  description: string;
  designer_note: string;
  config: SessionConfig;
  is_shared: boolean;
  derived_from: string | null;
  updated_at: Date;
}

function summarise(config: SessionConfig): TemplateSummary['mechanics'] {
  return config.stocks.map((stock) => ({
    stockName: stock.name,
    template: stock.rule.template,
    templateTitle: templateOf(stock.rule).title,
  }));
}

function rowToSummary(row: TemplateRow, viewerId: string): TemplateSummary {
  return {
    id: row.id,
    name: row.name,
    theme: row.derived_from ? `Saved from ${row.derived_from}` : 'Saved template',
    description: row.description,
    designerNote: row.designer_note,
    stockCount: row.config.stocks.length,
    defaultRounds: row.config.rounds,
    defaultRoundSeconds: row.config.roundSeconds,
    startingCash: row.config.startingCash,
    source: 'custom',
    stockNames: row.config.stocks.map((s) => s.name),
    mechanics: summarise(row.config),
    ownedByYou: row.owner_user_id === viewerId,
    isShared: row.is_shared,
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Everything this administrator can start a game from. */
export async function listTemplates(userId: string): Promise<{
  builtIn: TemplateSummary[];
  custom: TemplateSummary[];
}> {
  const builtIn = listGameTemplates().map<TemplateSummary>((meta) => ({
    ...meta,
    mechanics: summarise(buildGameTemplate(meta.id)),
  }));

  const rows = await query<TemplateRow>(
    `SELECT * FROM game_templates
      WHERE owner_user_id = $1 OR is_shared
      ORDER BY updated_at DESC
      LIMIT 200`,
    [userId],
  );

  return { builtIn, custom: rows.map((row) => rowToSummary(row, userId)) };
}

/** Resolves a template choice into a configuration ready to build a game from. */
export async function configForTemplate(
  userId: string,
  choice: { source: TemplateSource; id?: string; stocks?: number },
  overrides: { name?: string; rounds?: number; roundSeconds?: number } = {},
): Promise<{ config: SessionConfig; templateName: string }> {
  if (choice.source === 'blank') {
    return {
      config: blankTemplate({ stocks: choice.stocks ?? 7, ...overrides }),
      templateName: 'Built from scratch',
    };
  }

  if (choice.source === 'built-in') {
    const template = choice.id ? gameTemplateById(choice.id) : undefined;
    if (!template) throw new TemplateError('That template does not exist.', 404);
    return { config: template.build(overrides), templateName: template.name };
  }

  if (!choice.id) throw new TemplateError('No template was chosen.', 422);
  const row = await queryOne<TemplateRow>(
    `SELECT * FROM game_templates WHERE id = $1 AND (owner_user_id = $2 OR is_shared)`,
    [choice.id, userId],
  );
  if (!row) throw new TemplateError('That saved template does not exist, or is not yours.', 404);

  // Overrides are applied on top of the stored configuration.
  const config: SessionConfig = {
    ...structuredClone(row.config),
    ...(overrides.name ? { name: overrides.name } : {}),
    ...(overrides.rounds ? { rounds: overrides.rounds } : {}),
    ...(overrides.roundSeconds ? { roundSeconds: overrides.roundSeconds } : {}),
  };

  // Changing the round count can leave a scripted path or a reveal schedule
  // out of range, so re-check and tell the caller rather than storing a
  // session that cannot start.
  if (overrides.rounds && overrides.rounds !== row.config.rounds) {
    const issues = validateConfig(config);
    if (hasBlockingErrors(issues)) {
      throw new TemplateError(
        `This template cannot run over ${overrides.rounds} rounds: ` +
          issues
            .filter((i) => i.level === 'error')
            .map((i) => i.message)
            .join(' ') +
          ' Start it at its own length, or edit it after creating the session.',
        422,
      );
    }
  }

  return { config, templateName: row.name };
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

export interface SaveTemplateInput {
  name: string;
  description?: string;
  designerNote?: string;
  config: SessionConfig;
  derivedFrom?: string | null;
  isShared?: boolean;
}

export async function saveTemplate(userId: string, input: SaveTemplateInput): Promise<{ id: string }> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw new TemplateError('A template name needs between 2 and 80 characters.', 422);
  }

  // A template that would not run is not worth saving.
  const issues = validateConfig(input.config);
  if (hasBlockingErrors(issues)) {
    throw new TemplateError(
      `This configuration has ${issues.filter((i) => i.level === 'error').length} problem(s) to fix before it can be saved as a template.`,
      422,
    );
  }

  try {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO game_templates (owner_user_id, name, description, designer_note, config, derived_from, is_shared)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id`,
      [
        userId,
        name,
        input.description?.trim() ?? '',
        input.designerNote?.trim() ?? '',
        JSON.stringify(input.config),
        input.derivedFrom ?? null,
        input.isShared ?? false,
      ],
    );
    await recordAudit({
      userId,
      actorType: 'admin',
      eventType: 'template.saved',
      payload: { name, stocks: input.config.stocks.length },
    });
    return { id: row!.id };
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new TemplateError('You already have a template with that name.', 409);
    }
    throw e;
  }
}

export async function updateTemplate(
  id: string,
  userId: string,
  patch: Partial<SaveTemplateInput>,
): Promise<void> {
  const row = await queryOne<TemplateRow>('SELECT * FROM game_templates WHERE id = $1', [id]);
  if (!row) throw new TemplateError('That template does not exist.', 404);
  if (row.owner_user_id !== userId) {
    throw new TemplateError('That template belongs to another administrator.', 403);
  }

  if (patch.config) {
    const issues = validateConfig(patch.config);
    if (hasBlockingErrors(issues)) {
      throw new TemplateError('That configuration has problems that must be fixed first.', 422);
    }
  }

  try {
    await query(
      `UPDATE game_templates
          SET name = COALESCE($3, name),
              description = COALESCE($4, description),
              designer_note = COALESCE($5, designer_note),
              config = COALESCE($6::jsonb, config),
              is_shared = COALESCE($7, is_shared),
              updated_at = now()
        WHERE id = $1 AND owner_user_id = $2`,
      [
        id,
        userId,
        patch.name?.trim() ?? null,
        patch.description?.trim() ?? null,
        patch.designerNote?.trim() ?? null,
        patch.config ? JSON.stringify(patch.config) : null,
        patch.isShared ?? null,
      ],
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new TemplateError('You already have a template with that name.', 409);
    }
    throw e;
  }
  await recordAudit({ userId, actorType: 'admin', eventType: 'template.updated', payload: { id } });
}

export async function deleteTemplate(id: string, userId: string): Promise<void> {
  const result = await query('DELETE FROM game_templates WHERE id = $1 AND owner_user_id = $2 RETURNING id', [
    id,
    userId,
  ]);
  if (result.length === 0) {
    throw new TemplateError('That template does not exist, or is not yours to delete.', 404);
  }
  await recordAudit({ userId, actorType: 'admin', eventType: 'template.deleted', payload: { id } });
}

/** The full configuration of one saved template, for editing. */
export async function loadTemplateConfig(id: string, userId: string): Promise<{
  summary: TemplateSummary;
  config: SessionConfig;
}> {
  const row = await queryOne<TemplateRow>(
    'SELECT * FROM game_templates WHERE id = $1 AND (owner_user_id = $2 OR is_shared)',
    [id, userId],
  );
  if (!row) throw new TemplateError('That template does not exist, or is not yours.', 404);
  return { summary: rowToSummary(row, userId), config: row.config };
}
