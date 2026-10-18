import type {
  ArmPoseLandmarks,
  DetectedHand,
  FingerExtensionMap,
  Point3D,
  SealClassificationResult,
  SealId,
} from '../types/jutsu';
import {
  analyzeArmKinematics,
  computeClaspBoundingBox,
  distance2D,
  distance3D,
  extractFingerStates,
} from './sealClassifier';

export type DanceJudgmentRating = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

export interface KinectAssistEvaluation {
  matched: boolean;
  effectiveResult: SealClassificationResult;
  similarityScore: number;
  rating: DanceJudgmentRating;
  coachingHint: string;
}

export class HandMotionResetGate {
  private lockedAfterConfirm = false;
  private snapshotWristA: Point3D | null = null;
  private snapshotWristB: Point3D | null = null;
  private snapshotShape: number[] | null = null;
  private snapshotHandsCount = 0;
  private snapshotInterHandDist: number | null = null;
  private snapshotSealId: SealId | null = null;

  public lockOnSealConfirmed(
    hands: DetectedHand[],
    confirmedSeal: SealId,
    interHandDistance: number | null
  ): void {
    this.lockedAfterConfirm = true;
    this.snapshotSealId = confirmedSeal;
    this.snapshotHandsCount = hands.length;
    this.snapshotInterHandDist = interHandDistance;

    if (hands.length > 0) {
      this.snapshotWristA = { ...hands[0].landmarks[0] };
      this.snapshotWristB =
        hands.length > 1 ? { ...hands[1].landmarks[0] } : null;
      this.snapshotShape = this.computeNormalizedFingerShape(
        hands[0].landmarks
      );
    } else {
      this.snapshotWristA = null;
      this.snapshotWristB = null;
      this.snapshotShape = null;
    }
  }

  public forceUnlock(): void {
    this.lockedAfterConfirm = false;
    this.snapshotWristA = null;
    this.snapshotWristB = null;
    this.snapshotShape = null;
    this.snapshotSealId = null;
  }

  public isLocked(): boolean {
    return this.lockedAfterConfirm;
  }

  public checkAndUpdateLock(
    hands: DetectedHand[],
    currentSealId: SealId | null,
    interHandDistance: number | null,
    _nowMs: number
  ): {
    isBlockedByStillness: boolean;
    reasonHint: string;
  } {
    if (!this.lockedAfterConfirm) {
      return { isBlockedByStillness: false, reasonHint: '' };
    }

    if (
      hands.length === 0 ||
      (currentSealId !== null && currentSealId !== this.snapshotSealId)
    ) {
      this.lockedAfterConfirm = false;
      return { isBlockedByStillness: false, reasonHint: '' };
    }

    if (
      this.snapshotInterHandDist !== null &&
      interHandDistance !== null &&
      (Math.abs(interHandDistance - this.snapshotInterHandDist) >= 0.025 ||
        interHandDistance > 0.34)
    ) {
      this.lockedAfterConfirm = false;
      return { isBlockedByStillness: false, reasonHint: '' };
    }

    if (this.snapshotHandsCount !== hands.length) {
      this.lockedAfterConfirm = false;
      return { isBlockedByStillness: false, reasonHint: '' };
    }

    let wristDisplacement = 0;
    if (this.snapshotWristA && hands[0]) {
      wristDisplacement = distance2D(
        this.snapshotWristA,
        hands[0].landmarks[0]
      );
    }
    if (this.snapshotWristB && hands[1]) {
      wristDisplacement = Math.max(
        wristDisplacement,
        distance2D(this.snapshotWristB, hands[1].landmarks[0])
      );
    }

    let fingerShapeDelta = 0;
    if (this.snapshotShape && hands[0]) {
      const currentShape = this.computeNormalizedFingerShape(
        hands[0].landmarks
      );
      fingerShapeDelta = this.computeShapeDifference(
        this.snapshotShape,
        currentShape
      );
    }

    if (wristDisplacement >= 0.024 || fingerShapeDelta >= 0.08) {
      this.lockedAfterConfirm = false;
      return { isBlockedByStillness: false, reasonHint: '' };
    }

    return {
      isBlockedByStillness: true,
      reasonHint:
        '↔️ Mova/separe as mãos para engatar o próximo selo!',
    };
  }

  private computeNormalizedFingerShape(landmarks: Point3D[]): number[] {
    const wrist = landmarks[0];
    const scale = Math.max(distance3D(wrist, landmarks[9]), 0.02);
    const tipIndices = [4, 8, 12, 16, 20];
    return tipIndices.map((idx) => distance3D(wrist, landmarks[idx]) / scale);
  }

  private computeShapeDifference(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.abs(a[i] - b[i]);
    }
    return sum / a.length;
  }
}

function countExtendedLongFingers(f: FingerExtensionMap): number {
  return (
    Number(f.index) + Number(f.middle) + Number(f.ring) + Number(f.pinky)
  );
}

export function evaluateKinectTargetSeal(
  hands: DetectedHand[],
  strictResult: SealClassificationResult,
  targetSeal: SealId,
  armPose: ArmPoseLandmarks | null = null
): KinectAssistEvaluation {
  const armKinematics = analyzeArmKinematics(hands, armPose);
  const claspBox = computeClaspBoundingBox(hands);

  if (hands.length === 0) {
    return {
      matched: false,
      effectiveResult: strictResult,
      similarityScore: 0,
      rating: 'MISS',
      coachingHint: 'Coloque as mãos na frente da câmera!',
    };
  }

  if (strictResult.sealId === targetSeal) {
    const score = Math.max(0.92, strictResult.confidence);
    return {
      matched: true,
      effectiveResult: {
        ...strictResult,
        sealId: targetSeal,
        confidence: score,
      },
      similarityScore: score,
      rating: 'PERFECT',
      coachingHint: 'Pose perfeita! Segure um instante...',
    };
  }

  const primaryHand = hands[0];
  const secondaryHand = hands.length > 1 ? hands[1] : null;
  const fingersA = extractFingerStates(primaryHand.landmarks, false);
  const fingersB = secondaryHand
    ? extractFingerStates(secondaryHand.landmarks, false)
    : null;

  const combinedFingers: FingerExtensionMap = {
    thumb: fingersA.thumb || Boolean(fingersB?.thumb),
    index: fingersA.index || Boolean(fingersB?.index),
    middle: fingersA.middle || Boolean(fingersB?.middle),
    ring: fingersA.ring || Boolean(fingersB?.ring),
    pinky: fingersA.pinky || Boolean(fingersB?.pinky),
  };

  const longCount = countExtendedLongFingers(combinedFingers);

  let fuzzyScore = 0;
  let hint = 'Ajuste os dedos conforme o card na tela!';

  switch (targetSeal) {
    case 'bunshin': {
      const hasTwoFingersOnly =
        combinedFingers.index &&
        combinedFingers.middle &&
        !combinedFingers.ring &&
        !combinedFingers.pinky;
      const hasAsymmetricArms =
        armKinematics.posture === 'asymmetric-cross' ||
        (armKinematics.angleDiffDeg !== null && armKinematics.angleDiffDeg >= 14);

      if (hasTwoFingersOnly && (hasAsymmetricArms || hands.length >= 2)) {
        fuzzyScore = 0.88;
      } else {
        fuzzyScore = 0.25;
        hint = 'Cruze Indicador + Médio em (+) com um braço mais reto!';
      }
      break;
    }

    case 'tora': {
      const noRingOrPinky = !combinedFingers.ring && !combinedFingers.pinky;
      if (
        noRingOrPinky &&
        combinedFingers.index &&
        (combinedFingers.middle || hands.length >= 2)
      ) {
        fuzzyScore = 0.88;
      } else {
        fuzzyScore = 0.2;
        hint = 'Entrelace Anelar/Mínimo e erga Indicador + Médio juntos!';
      }
      break;
    }

    case 'mi': {
      if (longCount === 0) {
        fuzzyScore = 0.9;
      } else {
        fuzzyScore = 0.15;
        hint = 'Abaixe e entrelace todos os dedos (nenhum dedo em pé)!';
      }
      break;
    }

    case 'hitsuji': {
      if (
        combinedFingers.index &&
        combinedFingers.middle &&
        combinedFingers.ring &&
        !combinedFingers.pinky
      ) {
        fuzzyScore = 0.9;
      } else {
        fuzzyScore = 0.2;
        hint = 'Levante o 3º dedo (Indicador + Médio + Anelar erguidos)!';
      }
      break;
    }

    case 'i': {
      if (longCount >= 4) {
        fuzzyScore = 0.9;
      } else {
        fuzzyScore = 0.15;
        hint = 'Abra todos os 5 dedos das mãos!';
      }
      break;
    }

    case 'inu': {
      if (
        combinedFingers.index &&
        !combinedFingers.middle &&
        !combinedFingers.ring &&
        !combinedFingers.pinky
      ) {
        fuzzyScore = 0.88;
      } else {
        fuzzyScore = 0.2;
        hint = 'Deixe APENAS os Indicadores erguidos formando um triângulo (/\\)!';
      }
      break;
    }

    case 'tori': {
      if (
        combinedFingers.index &&
        combinedFingers.pinky &&
        !combinedFingers.middle &&
        !combinedFingers.ring
      ) {
        fuzzyScore = 0.9;
      } else {
        fuzzyScore = 0.2;
        hint = 'Abaixe o Médio/Anelar e erga Indicador + Mínimo!';
      }
      break;
    }
  }

  const matched = fuzzyScore >= 0.8;
  const rating: DanceJudgmentRating =
    fuzzyScore >= 0.88
      ? 'PERFECT'
      : fuzzyScore >= 0.8
        ? 'GREAT'
        : matched
          ? 'GOOD'
          : 'MISS';

  if (matched) {
    return {
      matched: true,
      effectiveResult: {
        ...strictResult,
        sealId: targetSeal,
        confidence: Number(fuzzyScore.toFixed(3)),
        primaryFingers: combinedFingers,
        claspBox,
        armKinematics,
      },
      similarityScore: fuzzyScore,
      rating,
      coachingHint: `${rating}! Segure o selo...`,
    };
  }

  return {
    matched: false,
    effectiveResult: {
      ...strictResult,
      sealId: null,
      confidence: 0,
      primaryFingers: combinedFingers,
      claspBox,
      armKinematics,
    },
    similarityScore: fuzzyScore,
    rating: 'MISS',
    coachingHint: hint,
  };
}
