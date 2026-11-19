/**
 * The optional ADMIN AI ASSISTANT.
 *
 * Nothing in the game depends on this module. No price, rule, settlement,
 * transaction, portfolio figure or leaderboard position is ever produced
 * by a model: those all come from the engine. The assistant can only read
 * the stored configuration and ask the engine to run the same readiness
 * check, preview and simulation functions the administrator can press
 * themselves, and it has no ability to change a setting or touch the
 * database.
 *
 * With no ANTHROPIC_API_KEY configured the assistant reports itself as
 * unconfigured and the rest of the application carries on normally.
 */

import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config-store';
import { previewFor, readinessFor, runScenarioFor, listScenarios } from './simulation';
import { aiConfigured } from './env';
import { templateOf } from '@/engine/templates';
import { fromBps } from '@/engine/money';
import type { StockId } from '@/engine/types';

const MODEL = 'claude-opus-5-5';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantToolCall {
  name: string;
  input: unknown;
  /** The engine's real output, shown to the administrator alongside the reply. */
  result: unknown;
}

export interface AssistantReply {
  configured: boolean;
  reply: string;
  /** Every engine call the assistant made, so its figures can be checked. */
  calculations: AssistantToolCall[];
  reason?: string;
}

const SYSTEM = `You are the setup assistant inside Mystery Stock Market, a classroom market-deduction game. You are talking to the teacher or administrator configuring a game session.

The game has exactly seven rule templates. Their structures are fixed; only their numbers and their stock references can be changed. There is no formula language and no way to invent a new rule type. The templates are:
1. HOLDINGS_DELTA — the price moves against the change in total market-wide holdings, by a fixed won amount per share.
2. CROSS_STOCK_DIRECTION — a percentage move up or down depending on whether another stock rose in the previous completed round.
3. HOLDINGS_SWEET_SPOT — a fixed won gain while total holdings sit inside a band, a fixed loss outside it.
4. RELATIVE_BUY_VOLUME — a fixed won gain or loss depending on whether this stock had more gross purchases than another stock. Purchases only; sales are never subtracted.
5. SECRET_DEPENDENT — a percentage gain while a secret covers a nominated other stock, a fixed loss otherwise.
6. MARKET_SENTIMENT — a percentage up on a broad rally, down on a broad sell-off, unchanged otherwise. The two thresholds must add up to more than the number of stocks counted, or they could both fire at once.
7. SCRIPTED_PATH — an authoritative price per round, fixed in advance and completely unaffected by trading.

How you must behave:
- You never change a setting. You can only read the configuration and run calculations. The administrator makes every change themselves.
- When you give a number, it must come from a tool call. Use preview_settlement for "what would this rule do", run_scenario for "what happens over the game" and run_readiness_check to interpret a test report. Do not do the arithmetic in your head and do not estimate.
- Clearly separate the two kinds of statement. Label a figure that came from a tool as a calculated result, and say plainly when something is your opinion or a judgement call ("that is a design judgement, not a calculation").
- If you cannot get a figure from a tool, say so rather than guessing.
- High volatility is a legitimate design choice, not an error. Explain what a setting will do and let the administrator decide.
- Be brief and concrete. Teachers are setting up a game, not reading an essay. Prefer a few sentences and a specific number to a long explanation.`;

const tools: Anthropic.Tool[] = [
  {
    name: 'get_configuration',
    description:
      "Read the game's current configuration: its stocks, which rule template each one uses, the configured numbers, and the secret, intelligence and disclosure settings.",
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: 'run_readiness_check',
    description:
      'Run the full TEST MY GAME readiness check: configuration validation, a probe of every assigned rule, and a real simulation of the whole game. Returns the verdict, the counts, the warnings and any failures.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: 'preview_settlement',
    description:
      'Settle one hypothetical round through the real engine and return the resulting price for every stock, with the arithmetic. Use this for any "what would happen if..." question about a single round.',
    input_schema: {
      type: 'object',
      properties: {
        round: { type: 'integer', description: 'Which round is closing. Defaults to 1.' },
        holdings: {
          type: 'object',
          description: 'Aggregate holdings at the close, keyed by stock id (e.g. {"s1": 50}).',
          additionalProperties: { type: 'integer' },
        },
        previousHoldings: {
          type: 'object',
          description: 'Aggregate holdings one round earlier, keyed by stock id.',
          additionalProperties: { type: 'integer' },
        },
        grossBuys: {
          type: 'object',
          description: 'Shares bought during the round, keyed by stock id.',
          additionalProperties: { type: 'integer' },
        },
        secretActive: {
          type: 'object',
          description: 'Which stocks a secret covers next round, keyed by stock id.',
          additionalProperties: { type: 'boolean' },
        },
        forceRisingCount: {
          type: 'integer',
          description: 'Force exactly this many stocks to count as having risen.',
        },
        forceFallingCount: {
          type: 'integer',
          description: 'Force exactly this many stocks to count as having fallen.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'run_scenario',
    description:
      'Run one of the built-in scenarios across the whole game and return the per-round prices, holdings, volumes, floor events and extreme movements. Call get_configuration first if you need the scenario ids.',
    input_schema: {
      type: 'object',
      properties: {
        scenarioId: { type: 'string', description: 'The scenario id, e.g. "full-game" or "floor-crash".' },
        maxRounds: { type: 'integer', description: 'Stop after this many rounds.' },
      },
      required: ['scenarioId'],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function executeTool(gameId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_configuration': {
      const config = await loadConfig(gameId);
      if (!config) return { error: 'That game does not exist.' };
      const scenarios = await listScenarios(gameId);
      return {
        name: config.name,
        rounds: config.rounds,
        roundSeconds: config.roundSeconds,
        startingCash: config.startingCash,
        minPrice: config.minPrice,
        maxPrice: config.maxPrice,
        stocks: config.stocks.map((s) => ({
          id: s.id,
          name: s.name,
          initialPrice: s.initialPrice,
          template: s.rule.template,
          templateTitle: templateOf(s.rule).title,
          parameters: s.rule,
          plainEnglish: templateOf(s.rule).describe(s.rule, {
            stockName: s.name,
            nameOf: (id: StockId) => config.stocks.find((x) => x.id === id)?.name ?? id,
            minPrice: config.minPrice,
          }),
        })),
        secrets: config.secrets,
        intel: config.intel,
        disclosureRounds: config.disclosure.rounds,
        trading: config.trading,
        availableScenarioIds: scenarios.map((s) => s.id),
      };
    }

    case 'run_readiness_check': {
      const report = await readinessFor(gameId);
      if (!report) return { error: 'That game does not exist.' };
      return {
        verdict: report.verdict,
        summary: report.summary,
        testsPassed: report.testsPassed,
        testsFailed: report.testsFailed,
        warnings: report.issues.filter((i) => i.level === 'warning').map((i) => i.message),
        errors: report.issues.filter((i) => i.level === 'error').map((i) => i.message),
        failedProbes: report.probes
          .filter((p) => !p.passed)
          .map((p) => ({ stock: p.stockName, check: p.check, expected: p.expected, actual: p.actual })),
        expectedFloorEvents: report.expectedFloorEvents.slice(0, 20),
        extremeMoves: report.extremeMoves.slice(0, 20),
      };
    }

    case 'preview_settlement': {
      try {
        const result = await previewFor(gameId, input as never);
        if (!result) return { error: 'That game does not exist.' };
        return {
          prices: result.prices,
          evaluations: result.evaluations.map((e) => ({
            stock: e.stockName,
            template: e.template,
            branch: e.branch,
            openingPrice: e.openingPrice,
            appliedMovement: e.appliedDelta,
            finalPrice: e.finalPrice,
            hitFloor: e.flooredAtMin,
            calculation: e.explanation,
          })),
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'That rule could not be evaluated.' };
      }
    }

    case 'run_scenario': {
      const scenarioId = String(input.scenarioId ?? '');
      const maxRounds = typeof input.maxRounds === 'number' ? input.maxRounds : undefined;
      const result = await runScenarioFor(gameId, scenarioId, { maxRounds });
      if (!result) return { error: `No scenario called "${scenarioId}" exists for this game.` };
      return {
        name: result.name,
        roundsRun: result.roundsRun,
        finalPrices: result.finalPrices,
        floorEvents: result.floorEvents.slice(0, 20),
        extremeMoves: result.extremeMoves.slice(0, 20),
        // A sample rather than every round, to keep the reply focused.
        sampleRounds: result.rounds
          .filter((_, i) => i === 0 || i === result.rounds.length - 1 || i % 6 === 0)
          .map((r) => ({
            round: r.round,
            prices: r.prices,
            holdings: r.holdings,
            branches: Object.fromEntries(r.evaluations.map((e) => [e.stockName, e.branch])),
          })),
      };
    }

    default:
      return { error: `Unknown tool "${name}".` };
  }
}

/** Runs one assistant turn. Returns a disabled reply when no key is set. */
export async function askAssistant(
  gameId: string,
  history: AssistantMessage[],
): Promise<AssistantReply> {
  if (!aiConfigured()) {
    return {
      configured: false,
      reply: '',
      calculations: [],
      reason:
        'The AI assistant is not configured on this server. Everything else in the game works without it: set ANTHROPIC_API_KEY to enable it.',
    };
  }

  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const calculations: AssistantToolCall[] = [];

  // A bounded manual loop: the assistant may call the engine a few times
  // before answering, and then must answer.
  for (let iteration = 0; iteration < 8; iteration++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      // Effort is explicit because this model defaults to medium and a
      // setup assistant does not need deep reasoning.
      output_config: { effort: 'medium' },
      // If a safety classifier declines, fall back rather than fail.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools: tools as unknown as Anthropic.Beta.BetaToolUnion[],
      tool_choice: { type: 'auto' },
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return {
        configured: true,
        reply: '',
        calculations,
        reason: 'The assistant declined to answer that. Please rephrase, or carry on without it.',
      };
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { configured: true, reply: text, calculations };
    }

    messages.push({ role: 'assistant', content: response.content });

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of toolUses) {
      // Tool inputs are always parsed as JSON by the SDK; never matched as
      // strings. Nothing here can write to the database.
      const input = (call.input ?? {}) as Record<string, unknown>;
      const result = await executeTool(gameId, call.name, input);
      calculations.push({ name: call.name, input, result });
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    configured: true,
    reply: '',
    calculations,
    reason: 'The assistant used too many steps without reaching an answer. Please try a narrower question.',
  };
}

export { fromBps };
