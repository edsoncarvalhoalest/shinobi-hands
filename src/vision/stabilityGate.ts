import type {
  SealClassificationResult,
  SealId,
  StabilityGateState,
} from '../types/jutsu';

export interface StabilityGateConfig {
  holdDurationMs: number;
  entryConfidence: number;
  continuityConfidence: number;
  gracePeriodMs: number;
  neutralReleaseMs: number;
}

const DEFAULT_GATE_CONFIG: StabilityGateConfig = {
  holdDurationMs: 420,
  entryConfidence: 0.68,
  continuityConfidence: 0.62,
  gracePeriodMs: 180,
  neutralReleaseMs: 240,
};

export class SealStabilityGate {
  private config: StabilityGateConfig;
  private candidateSeal: SealId | null = null;
  private accumulatedMs = 0;
  private lastFrameTimestamp: number | null = null;
  private uncertainElapsedMs = 0;
  private lockedSealBlock: SealId | null = null;
  private neutralElapsedMs = 0;
  private lastConfirmedSeal: SealId | null = null;

  constructor(config: Partial<StabilityGateConfig> = {}) {
    this.config = { ...DEFAULT_GATE_CONFIG, ...config };
  }

  public setHoldDurationMs(holdDurationMs: number): void {
    this.config.holdDurationMs = Math.max(120, Math.min(1200, holdDurationMs));
  }

  public getHoldDurationMs(): number {
    return this.config.holdDurationMs;
  }

  public reset(): void {
    this.candidateSeal = null;
    this.accumulatedMs = 0;
    this.lastFrameTimestamp = null;
    this.uncertainElapsedMs = 0;
    this.lockedSealBlock = null;
    this.neutralElapsedMs = 0;
    this.lastConfirmedSeal = null;
  }

  public update(
    classification: SealClassificationResult,
    nowMs: number
  ): StabilityGateState {
    const dt =
      this.lastFrameTimestamp !== null
        ? Math.max(0, Math.min(250, nowMs - this.lastFrameTimestamp))
        : 16;
    this.lastFrameTimestamp = nowMs;

    const { sealId, confidence, dualHandResonance } = classification;

    if (this.lockedSealBlock !== null) {
      if (sealId !== this.lockedSealBlock) {
        this.neutralElapsedMs += dt;
        if (this.neutralElapsedMs >= this.config.neutralReleaseMs) {
          this.lockedSealBlock = null;
          this.neutralElapsedMs = 0;
        }
      } else {
        this.neutralElapsedMs = 0;
      }
    }

    if (sealId !== null && sealId === this.lockedSealBlock) {
      return {
        candidateSeal: null,
        progress: 0,
        lastConfirmedSeal: this.lastConfirmedSeal,
        justConfirmedSeal: null,
        dualHandActive: dualHandResonance,
        confidence,
      };
    }

    const isContinuingCandidate =
      sealId !== null && sealId === this.candidateSeal;
    const requiredThreshold = isContinuingCandidate
      ? this.config.continuityConfidence
      : this.config.entryConfidence;

    if (sealId !== null && confidence >= requiredThreshold) {
      if (this.candidateSeal !== sealId) {
        this.candidateSeal = sealId;
        this.accumulatedMs = 0;
        this.uncertainElapsedMs = 0;
      } else {
        this.accumulatedMs += dt;
        this.uncertainElapsedMs = 0;
      }

      const progress = Math.min(1, this.accumulatedMs / this.config.holdDurationMs);

      if (progress >= 1) {
        const confirmed = this.candidateSeal;
        this.lastConfirmedSeal = confirmed;
        this.lockedSealBlock = confirmed;
        this.neutralElapsedMs = 0;
        this.candidateSeal = null;
        this.accumulatedMs = 0;

        return {
          candidateSeal: confirmed,
          progress: 1,
          lastConfirmedSeal: confirmed,
          justConfirmedSeal: confirmed,
          dualHandActive: dualHandResonance,
          confidence,
        };
      }

      return {
        candidateSeal: this.candidateSeal,
        progress,
        lastConfirmedSeal: this.lastConfirmedSeal,
        justConfirmedSeal: null,
        dualHandActive: dualHandResonance,
        confidence,
      };
    }

    if (this.candidateSeal !== null) {
      this.uncertainElapsedMs += dt;
      if (this.uncertainElapsedMs > this.config.gracePeriodMs) {
        this.candidateSeal = null;
        this.accumulatedMs = 0;
        this.uncertainElapsedMs = 0;
      }
    }

    return {
      candidateSeal: this.candidateSeal,
      progress:
        this.candidateSeal !== null
          ? Math.min(1, this.accumulatedMs / this.config.holdDurationMs)
          : 0,
      lastConfirmedSeal: this.lastConfirmedSeal,
      justConfirmedSeal: null,
      dualHandActive: dualHandResonance,
      confidence,
    };
  }
}
