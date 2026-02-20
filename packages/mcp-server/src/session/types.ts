export type ControlMode = 'autonomous' | 'manual' | 'collaborative';

export interface TurnState {
  mode: ControlMode;
  aiCanAct: boolean;
  userCanAct: boolean;
  aiCanRead: boolean;
  userCanRead: boolean;
}

export const MODES: Record<ControlMode, TurnState> = {
  autonomous: {
    mode: 'autonomous',
    aiCanAct: true,
    userCanAct: false,
    aiCanRead: true,
    userCanRead: true,
  },
  manual: {
    mode: 'manual',
    aiCanAct: false,
    userCanAct: true,
    aiCanRead: true,
    userCanRead: true,
  },
  collaborative: {
    mode: 'collaborative',
    aiCanAct: true,
    userCanAct: true,
    aiCanRead: true,
    userCanRead: true,
  },
};

export type SessionPhase = 'setup' | 'hunt' | 'found' | 'fix' | 'complete';

export interface SessionStats {
  toolCalls: number;
  tokensUsed: number;
  estimatedCostUsd: number;
  eventsTotal: number;
  bugsFound: number;
}

export interface BugRecord {
  id: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  location: string;
  rootCause: string;
  fix?: {
    type: string;
    file: string;
    status: 'proposed' | 'applied' | 'rejected';
  };
}

export interface SessionComparison {
  traditionalEstimatedTokens: number;
  traditionalEstimatedTimeMin: number;
  tokenSavingsPct: number;
  timeSavingsPct: number;
}

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stats: SessionStats;
  bugs: BugRecord[];
  comparison?: SessionComparison;
}
