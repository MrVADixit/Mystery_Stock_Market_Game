/**
 * Engine-level types. This module — and everything else under src/engine —
 * imports nothing from React, Next.js or the database. The engine is a pure
 * function library so that it can be exercised exhaustively by the test
 * suite and reused unchanged by the simulator, the readiness check and the
 * live settlement path.
 */

/** Stable identifier for a stock within one session (e.g. "s1"). */
export type StockId = string;

export const RULE_TEMPLATE_IDS = [
  'HOLDINGS_DELTA',
  'CROSS_STOCK_DIRECTION',
  'HOLDINGS_SWEET_SPOT',
  'RELATIVE_BUY_VOLUME',
  'SECRET_DEPENDENT',
  'MARKET_SENTIMENT',
  'SCRIPTED_PATH',
  'UNCHANGED',
] as const;

export type RuleTemplateId = (typeof RULE_TEMPLATE_IDS)[number];

/** How a branch should treat the exact-equality / no-change case. */
export type TieBranch = 'positive' | 'negative';

/** RULE 1 — price moves against the change in total market-wide holdings. */
export interface HoldingsDeltaParams {
  /** Won of price movement per share of holdings change. Default 200. */
  wonPerShare: number;
  /**
   * false (default): holdings up -> price down, holdings down -> price up.
   * true: the relationship is reversed.
   */
  inverted: boolean;
  /** Optional clamp on the holdings change considered in one round. */
  maxHoldingsChangePerRound: number | null;
}

/** RULE 2 — direction copied from another stock's last completed move. */
export interface CrossStockDirectionParams {
  referenceStockId: StockId;
  /** Applied when the reference stock rose. Basis points. Default +1000. */
  upBps: number;
  /** Applied otherwise. Basis points. Default -1000. */
  downBps: number;
  /** Which branch an unchanged reference price takes. Default 'negative'. */
  unchangedCountsAs: TieBranch;
}

/** RULE 3 — fixed reward while aggregate holdings sit inside a band. */
export interface HoldingsSweetSpotParams {
  /** Inclusive lower bound. Default 10. */
  lower: number;
  /** Inclusive upper bound. Default 30. */
  upper: number;
  /** Won added inside the band. Default +1500. */
  insideWon: number;
  /** Won added outside the band (normally negative). Default -1000. */
  outsideWon: number;
}

/** RULE 4 — gross buying volume compared against another stock. */
export interface RelativeBuyVolumeParams {
  comparisonStockId: StockId;
  /** Won added when the target was bought more. Default +1400. */
  aboveWon: number;
  /** Won added otherwise. Default -700. */
  belowWon: number;
  /** Which branch an exact tie takes. Default 'negative'. */
  tieCountsAs: TieBranch;
}

/** RULE 5 — driven by whether a secret covers another stock next round. */
export interface SecretDependentParams {
  referenceStockId: StockId;
  /** Basis points applied while the reference secret is active. Default +1300. */
  activeBps: number;
  /** Won applied while it is not. Default -1000. */
  inactiveWon: number;
}

/** RULE 6 — reacts to how much of the market moved in each direction. */
export interface MarketSentimentParams {
  /** Stocks counted. Defaults to all seven. */
  universe: StockId[];
  /** Rising stocks needed for the positive branch. Default 4. */
  risingThreshold: number;
  /** Falling stocks needed for the negative branch. Default 4. */
  fallingThreshold: number;
  /** Basis points on the positive branch. Default +2000. */
  risingBps: number;
  /** Basis points on the negative branch. Default -1000. */
  fallingBps: number;
}

/** RULE 7 — an authoritative scripted price for every round. */
export interface ScriptedPathParams {
  /**
   * prices[r] is the authoritative price for round r, 1-indexed, so
   * prices[0] is unused and the array has `rounds + 1` entries.
   */
  prices: number[];
}

/** The unchanged-price rule takes no parameters. */
export type UnchangedParams = Record<never, never>;

export type RuleParams =
  | ({ template: 'HOLDINGS_DELTA' } & HoldingsDeltaParams)
  | ({ template: 'CROSS_STOCK_DIRECTION' } & CrossStockDirectionParams)
  | ({ template: 'HOLDINGS_SWEET_SPOT' } & HoldingsSweetSpotParams)
  | ({ template: 'RELATIVE_BUY_VOLUME' } & RelativeBuyVolumeParams)
  | ({ template: 'SECRET_DEPENDENT' } & SecretDependentParams)
  | ({ template: 'MARKET_SENTIMENT' } & MarketSentimentParams)
  | ({ template: 'SCRIPTED_PATH' } & ScriptedPathParams)
  | { template: 'UNCHANGED' };

/** The four progressive reveals written for one stock's rule. */
export interface DisclosureSegments {
  /** Exactly four strings, shown at the four configured disclosure rounds. */
  segments: [string, string, string, string];
}

export interface StockConfig {
  id: StockId;
  name: string;
  initialPrice: number;
  rule: RuleParams;
  disclosure: DisclosureSegments;
}

export type SecretTradingPolicy = 'enabled' | 'suspended';

export interface SecretConfig {
  enabled: boolean;
  /** Secret tokens granted to each participant. Default 1. */
  tokensPerParticipant: number;
  /** Rounds a secret covers, starting with the round after activation. */
  durationRounds: number;
  /** Last round in which a secret may be imposed. Default 20. */
  latestActivationRound: number;
  hidePrice: boolean;
  hideVolume: boolean;
  hideHoldings: boolean;
  /** Hide each participant's own total asset figure from others. */
  hideParticipantAssets: boolean;
  /** Also mask cash/asset summaries of anyone touching the affected stock. */
  maskHolderAssets: boolean;
  tradingDuringSecret: SecretTradingPolicy;
  /** Whether a second participant may target an already-secret stock. */
  allowSimultaneous: boolean;
  /**
   * false (default): simultaneous activations consume every token but the
   * stock still receives exactly one normal secret period.
   */
  simultaneousExtendsDuration: boolean;
}

export type IntelMode = 'pieces' | 'cash' | 'disabled';

export interface IntelConfig {
  mode: IntelMode;
  /** Pieces each participant starts with. Default 1. */
  startingPieces: number;
  /** Cash cost to buy one extra Piece, or null if Pieces cannot be bought. */
  piecePurchaseCostWon: number | null;
  /** Won received per Piece when converting, when allowed. Default 10000. */
  pieceToCashWon: number;
  allowPieceToCash: boolean;
  /** Won per intel purchase when mode === 'cash'. */
  cashPricePerIntelWon: number;
  /** Last round in which intelligence may be purchased. Default 20. */
  deadlineRound: number;
}

export interface DisclosureConfig {
  /** Four ascending round numbers. The last is full disclosure. */
  rounds: [number, number, number, number];
}

export interface TradingConfig {
  /** Maximum shares in a single order, or null for no cap. */
  maxSharesPerOrder: number | null;
  /** Maximum shares one participant may hold of one stock, or null. */
  maxSharesPerParticipantPerStock: number | null;
}

export interface PublicInfoConfig {
  showAggregateHoldings: boolean;
  showVolumes: boolean;
  showLeaderboard: boolean;
  showParticipantAssets: boolean;
}

export interface SessionConfig {
  name: string;
  startingCash: number;
  /** Floor applied to every stock after every settlement. Default 100. */
  minPrice: number;
  /** Optional ceiling. null by default so the classic preset is untouched. */
  maxPrice: number | null;
  /**
   * Optional cap on one round's absolute movement, in basis points of the
   * opening price. null by default: the classic preset is uncapped.
   */
  maxMovePerRoundBps: number | null;
  rounds: number;
  roundSeconds: number;
  stocks: StockConfig[];
  secrets: SecretConfig;
  intel: IntelConfig;
  disclosure: DisclosureConfig;
  trading: TradingConfig;
  publicInfo: PublicInfoConfig;
}

/* ------------------------------------------------------------------ */
/* Settlement input                                                    */
/* ------------------------------------------------------------------ */

/**
 * The frozen market facts for one completed round. Settlement is a pure
 * function of this snapshot, which is why the same snapshot always
 * produces the same prices (see the replay property test).
 *
 * §8.1 of the specification insists these five quantities stay distinct;
 * they are deliberately separate fields here and are never derived from
 * one another.
 */
export interface RoundSnapshot {
  /** The round that has just closed. 1-indexed. */
  round: number;
  /** Price each stock traded at during the completed round. */
  prices: Record<StockId, number>;
  /** Price each stock traded at during the round before that. */
  previousPrices: Record<StockId, number>;
  /** Aggregate shares held by all participants at the end of this round. */
  holdings: Record<StockId, number>;
  /** Aggregate shares held at the end of the previous round. */
  previousHoldings: Record<StockId, number>;
  /** Shares bought during this round. Gross, never netted. */
  grossBuys: Record<StockId, number>;
  /** Shares sold during this round. Gross, never netted. */
  grossSells: Record<StockId, number>;
  /**
   * Whether a secret will be in force on each stock during the NEXT round,
   * which is the round the prices being computed will apply to.
   */
  secretActiveNextRound: Record<StockId, boolean>;
}

/** One stock's settlement result, with the arithmetic kept for the audit. */
export interface RuleEvaluation {
  stockId: StockId;
  stockName: string;
  template: RuleTemplateId;
  /** Price during the completed round; the base for every percentage. */
  openingPrice: number;
  /** Which side of the rule fired, e.g. 'holdings-increased'. */
  branch: string;
  /** Movement the rule asked for, before floor/cap. */
  rawDelta: number;
  /** Price the rule asked for, before floor/cap. */
  rawPrice: number;
  /** Movement actually applied after floor/cap. */
  appliedDelta: number;
  /** The authoritative new price. */
  finalPrice: number;
  flooredAtMin: boolean;
  cappedAtMax: boolean;
  /** True when maxMovePerRoundBps trimmed the movement. */
  movementCapped: boolean;
  /** Plain-English arithmetic, shown in the admin settlement view. */
  explanation: string;
  /** Named inputs the rule actually consulted, for the audit trail. */
  inputs: Record<string, number | string | boolean>;
}

export interface SettlementResult {
  /** The round that closed. */
  round: number;
  /** The round these prices apply to. */
  nextRound: number;
  evaluations: RuleEvaluation[];
  prices: Record<StockId, number>;
}
