import type {
  ClaspBoundingBox,
  DetectedHand,
  SealId,
} from '../types/jutsu';
import { computeClaspBoundingBox } from './sealClassifier';

const STORAGE_KEY = 'shinobi_hands_v12_hybrid_prototypes';
const ROI_GRID_SIZE = 8;
const MIN_COSINE_SIMILARITY = 0.86;

export interface CalibratedSealPrototype {
  sealId: SealId;
  sampleCount: number;
  vector: number[];
  updatedAt: number;
}

export class HybridSealCalibrator {
  private prototypes: Partial<Record<SealId, CalibratedSealPrototype>> = {};
  private recordingBuffers: Partial<Record<SealId, number[][]>> = {};
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;

  constructor() {
    this.loadFromStorage();
    if (typeof document !== 'undefined') {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = ROI_GRID_SIZE;
      this.offscreenCanvas.height = ROI_GRID_SIZE;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', {
        willReadFrequently: true,
      });
    }
  }

  public getCalibratedSeals(): SealId[] {
    return Object.keys(this.prototypes) as SealId[];
  }

  public isSealCalibrated(sealId: SealId): boolean {
    return Boolean(this.prototypes[sealId]);
  }

  public clearAllCalibrations(): void {
    this.prototypes = {};
    this.recordingBuffers = {};
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  public startRecording(sealId: SealId): void {
    this.recordingBuffers[sealId] = [];
  }

  public addCalibrationFrame(
    sealId: SealId,
    hands: DetectedHand[],
    video: HTMLVideoElement | null
  ): number {
    const vec = this.extractHybridFeatureVector(hands, video);
    if (!vec) {
      return this.recordingBuffers[sealId]?.length ?? 0;
    }
    if (!this.recordingBuffers[sealId]) {
      this.recordingBuffers[sealId] = [];
    }
    this.recordingBuffers[sealId]!.push(vec);
    return this.recordingBuffers[sealId]!.length;
  }

  public finalizeCalibration(sealId: SealId): boolean {
    const samples = this.recordingBuffers[sealId];
    if (!samples || samples.length < 4) {
      return false;
    }

    const dim = samples[0].length;
    const meanVec = new Array<number>(dim).fill(0);

    for (const sample of samples) {
      for (let i = 0; i < dim; i++) {
        meanVec[i] += sample[i];
      }
    }

    const normalized = this.l2Normalize(meanVec.map((v) => v / samples.length));
    this.prototypes[sealId] = {
      sealId,
      sampleCount: samples.length,
      vector: normalized,
      updatedAt: Date.now(),
    };

    delete this.recordingBuffers[sealId];
    this.saveToStorage();
    return true;
  }

  public predict(
    hands: DetectedHand[],
    video: HTMLVideoElement | null
  ): { sealId: SealId; confidence: number } | null {
    const calibratedKeys = this.getCalibratedSeals();
    if (calibratedKeys.length === 0) return null;

    const liveVec = this.extractHybridFeatureVector(hands, video);
    if (!liveVec) return null;

    let bestSeal: SealId | null = null;
    let bestSim = -1;

    for (const sealId of calibratedKeys) {
      const proto = this.prototypes[sealId];
      if (!proto || proto.vector.length !== liveVec.length) continue;

      const sim = this.cosineSimilarity(liveVec, proto.vector);
      if (sim > bestSim) {
        bestSim = sim;
        bestSeal = sealId;
      }
    }

    if (bestSeal && bestSim >= MIN_COSINE_SIMILARITY) {
      const mappedConfidence = Math.min(
        0.99,
        0.76 + ((bestSim - MIN_COSINE_SIMILARITY) / (1 - MIN_COSINE_SIMILARITY)) * 0.23
      );
      return {
        sealId: bestSeal,
        confidence: Number(mappedConfidence.toFixed(3)),
      };
    }

    return null;
  }

  public extractHybridFeatureVector(
    hands: DetectedHand[],
    video: HTMLVideoElement | null
  ): number[] | null {
    if (hands.length === 0) return null;
    const box = computeClaspBoundingBox(hands);
    if (!box) return null;

    const spanX = Math.max(box.maxX - box.minX, 0.04);
    const spanY = Math.max(box.maxY - box.minY, 0.04);

    const sortedHands = [...hands].sort((a, b) => b.score - a.score);
    const primary = sortedHands[0];
    const secondary = sortedHands.length > 1 ? sortedHands[1] : primary;

    const keyIndices = [0, 4, 5, 6, 8, 9, 10, 12, 13, 16, 17, 20];
    const geoFeatures: number[] = [];

    for (const idx of keyIndices) {
      const ptA = primary.landmarks[idx];
      geoFeatures.push((ptA.x - box.centerX) / spanX);
      geoFeatures.push((ptA.y - box.centerY) / spanY);
    }

    for (const idx of [0, 4, 8, 12, 16, 20]) {
      const ptB = secondary.landmarks[idx];
      geoFeatures.push((ptB.x - box.centerX) / spanX);
      geoFeatures.push((ptB.y - box.centerY) / spanY);
    }

    geoFeatures.push(spanY / (spanX + 0.01));
    geoFeatures.push(hands.length >= 2 ? 1.0 : 0.4);

    const visualFeatures = this.extractVisualRoiDescriptor(video, box);
    return this.l2Normalize([...geoFeatures, ...visualFeatures]);
  }

  private extractVisualRoiDescriptor(
    video: HTMLVideoElement | null,
    box: ClaspBoundingBox
  ): number[] {
    const totalCells = ROI_GRID_SIZE * ROI_GRID_SIZE;
    if (
      !video ||
      video.readyState < 2 ||
      !this.offscreenCanvas ||
      !this.offscreenCtx ||
      video.videoWidth === 0
    ) {
      return new Array<number>(totalCells).fill(0);
    }

    const sx = Math.floor(box.minX * video.videoWidth);
    const sy = Math.floor(box.minY * video.videoHeight);
    const sw = Math.max(8, Math.floor((box.maxX - box.minX) * video.videoWidth));
    const sh = Math.max(8, Math.floor((box.maxY - box.minY) * video.videoHeight));

    try {
      this.offscreenCtx.clearRect(0, 0, ROI_GRID_SIZE, ROI_GRID_SIZE);
      this.offscreenCtx.drawImage(
        video,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        ROI_GRID_SIZE,
        ROI_GRID_SIZE
      );
      const imgData = this.offscreenCtx.getImageData(
        0,
        0,
        ROI_GRID_SIZE,
        ROI_GRID_SIZE
      ).data;

      const luminances: number[] = [];
      let sum = 0;
      for (let i = 0; i < imgData.length; i += 4) {
        const lum =
          (0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2]) /
          255;
        luminances.push(lum);
        sum += lum;
      }

      const mean = sum / totalCells;
      return luminances.map((v) => (v - mean) * 1.5);
    } catch {
      return new Array<number>(totalCells).fill(0);
    }
  }

  private l2Normalize(vec: number[]): number[] {
    let normSq = 0;
    for (const v of vec) {
      normSq += v * v;
    }
    const norm = Math.sqrt(normSq) || 1;
    return vec.map((v) => v / norm);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }

  private saveToStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prototypes));
    } catch {
      // Ignore quota errors
    }
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.prototypes = JSON.parse(raw) as Partial<
          Record<SealId, CalibratedSealPrototype>
        >;
      }
    } catch {
      this.prototypes = {};
    }
  }
}
