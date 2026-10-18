import { JUTSU_RECIPES } from '../data/jutsus';
import type {
  JutsuExecutionRecord,
  JutsuMatchStatus,
  JutsuRecipe,
  SealId,
} from '../types/jutsu';

const MAX_SEQUENCE_BUFFER_LENGTH = 6;
const DEFAULT_COMBO_TIMEOUT_MS = 7500;

export interface JutsuSequencePushResult {
  sequence: SealId[];
  completedJutsu: JutsuRecipe | null;
  executionRecord: JutsuExecutionRecord | null;
  matchStatuses: JutsuMatchStatus[];
}

export class JutsuSequenceEngine {
  private sequence: SealId[] = [];
  private sequenceStartMs: number | null = null;
  private lastInputMs: number | null = null;
  private comboTimeoutMs: number;
  private history: JutsuExecutionRecord[] = [];
  private recipes: JutsuRecipe[];

  constructor(
    recipes: JutsuRecipe[] = JUTSU_RECIPES,
    comboTimeoutMs = DEFAULT_COMBO_TIMEOUT_MS
  ) {
    this.recipes = recipes;
    this.comboTimeoutMs = comboTimeoutMs;
  }

  public getSequence(): SealId[] {
    return [...this.sequence];
  }

  public getHistory(): JutsuExecutionRecord[] {
    return [...this.history];
  }

  public getRemainingTimeoutRatio(nowMs: number): number {
    if (this.lastInputMs === null || this.sequence.length === 0) {
      return 0;
    }
    const elapsed = Math.max(0, nowMs - this.lastInputMs);
    return Math.max(0, 1 - elapsed / this.comboTimeoutMs);
  }

  public checkExpiration(nowMs: number): boolean {
    if (
      this.lastInputMs !== null &&
      this.sequence.length > 0 &&
      nowMs - this.lastInputMs > this.comboTimeoutMs
    ) {
      this.clearSequence();
      return true;
    }
    return false;
  }

  public clearSequence(): void {
    this.sequence = [];
    this.sequenceStartMs = null;
    this.lastInputMs = null;
  }

  public pushSeal(sealId: SealId, nowMs: number): JutsuSequencePushResult {
    this.checkExpiration(nowMs);

    if (this.sequence.length === 0) {
      this.sequenceStartMs = nowMs;
    }

    this.sequence.push(sealId);
    if (this.sequence.length > MAX_SEQUENCE_BUFFER_LENGTH) {
      this.sequence.shift();
    }
    this.lastInputMs = nowMs;

    const matchStatuses = this.computeMatchStatuses();
    const completedStatus = matchStatuses.find((status) => status.isComplete);

    if (completedStatus) {
      const durationMs =
        this.sequenceStartMs !== null
          ? Math.max(100, Math.round(nowMs - this.sequenceStartMs))
          : 500;
      const record: JutsuExecutionRecord = {
        id: `${completedStatus.recipe.id}-${nowMs}`,
        recipe: completedStatus.recipe,
        timestamp: nowMs,
        durationMs,
      };
      this.history.unshift(record);
      if (this.history.length > 15) {
        this.history.pop();
      }

      const completedSequence = [...this.sequence];
      this.clearSequence();

      return {
        sequence: completedSequence,
        completedJutsu: completedStatus.recipe,
        executionRecord: record,
        matchStatuses: this.computeMatchStatuses(),
      };
    }

    return {
      sequence: [...this.sequence],
      completedJutsu: null,
      executionRecord: null,
      matchStatuses,
    };
  }

  public computeMatchStatuses(): JutsuMatchStatus[] {
    return this.recipes.map((recipe) => {
      const matchedCount = this.longestSuffixPrefixMatch(
        this.sequence,
        recipe.seals
      );
      const isComplete = matchedCount === recipe.seals.length;
      const nextSeal =
        matchedCount < recipe.seals.length ? recipe.seals[matchedCount] : null;

      return {
        recipe,
        matchedCount,
        isComplete,
        nextSeal,
      };
    });
  }

  private longestSuffixPrefixMatch(
    activeBuffer: SealId[],
    recipeSeals: SealId[]
  ): number {
    const maxLen = Math.min(activeBuffer.length, recipeSeals.length);
    for (let len = maxLen; len >= 1; len--) {
      let matches = true;
      for (let i = 0; i < len; i++) {
        const bufferItem = activeBuffer[activeBuffer.length - len + i];
        if (bufferItem !== recipeSeals[i]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return len;
      }
    }
    return 0;
  }
}
