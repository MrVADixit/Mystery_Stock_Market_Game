import type { GameStateView } from '@/server/state';
import type { SessionConfig } from '@/engine/types';
import type { ConfigIssue } from '@/engine/validate';
import type { ReadinessReport } from '@/engine/readiness';

export interface AdminState extends GameStateView {
  admin: {
    connectedParticipants: number;
    totalParticipants: number;
    recentTrades: {
      at: string;
      round: number;
      participant: string;
      stockId: string;
      side: string;
      quantity: number;
      price: number;
    }[];
    activeSecrets: { stockId: string; firstRound: number; lastRound: number; imposedBy: string }[];
  };
}

export interface ConfigResponse {
  config: SessionConfig;
  issues: ConfigIssue[];
  game: {
    id: string;
    status: GameStateView['game']['status'];
    joinCode: string;
    currentRound: number;
    hasDisplayToken: boolean;
    displayToken: string | null;
    warningsAcknowledged: boolean;
    templateId: string | null;
    templateName: string | null;
    scrambleSeed: number | null;
  };
}

export interface ParticipantSummary {
  id: string;
  displayName: string;
  cash: number;
  startingCash: number;
  holdingsValue: number;
  totalAssets: number;
  pieces: number;
  secretTokens: number;
  intelSpendWon: number;
  trades: number;
  joinedAt: string;
  lastSeenAt: string | null;
  connected: boolean;
  isBlocked: boolean;
}

export interface SettlementView {
  round: number;
  stocks: {
    stockId: string;
    stockName: string;
    openingPrice: number | null;
    previousClosePrice: number | null;
    aggregateHoldings: number;
    holdingsChange: number;
    grossBuys: number;
    grossSells: number;
    template: string | null;
    branch: string | null;
    rawMovement: number | null;
    appliedMovement: number | null;
    finalPrice: number | null;
    hitFloor: boolean;
    movementCapped: boolean;
    calculation: string;
    inputs: Record<string, unknown>;
  }[];
  frozenSnapshot: unknown;
}

export type { ReadinessReport, SessionConfig, ConfigIssue };
