import { describe, expect, it } from 'vitest';
import { JutsuSequenceEngine } from '../engine/jutsuEngine';
import type { ArmPoseLandmarks, DetectedHand, Point3D } from '../types/jutsu';
import { HybridSealCalibrator } from '../vision/hybridCalibrator';
import {
  evaluateKinectTargetSeal,
  HandMotionResetGate,
} from '../vision/kinectAssist';
import { classifyHandSeal } from '../vision/sealClassifier';
import { SealStabilityGate } from '../vision/stabilityGate';

function createSyntheticHand(options: {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
  indexMiddleSpread?: number;
  offsetX?: number;
  interlacedRingPinkyHorizontally?: boolean;
  horizontalCrossFingerBar?: boolean;
}): DetectedHand {
  const ox = options.offsetX ?? 0.5;
  const spread = options.indexMiddleSpread ?? 0.02;

  const landmarks: Point3D[] = Array.from({ length: 21 }, () => ({
    x: ox,
    y: 0.6,
    z: 0,
  }));

  if (options.horizontalCrossFingerBar) {
    landmarks[0] = { x: ox + 0.2, y: 0.5, z: 0 };
    landmarks[1] = { x: ox + 0.15, y: 0.48, z: 0 };
    landmarks[2] = { x: ox + 0.12, y: 0.48, z: 0 };
    landmarks[3] = { x: ox + 0.1, y: 0.49, z: 0 };
    landmarks[4] = { x: ox + 0.09, y: 0.5, z: 0 };
    landmarks[5] = { x: ox + 0.08, y: 0.46, z: 0 };
    landmarks[6] = { x: ox - 0.02, y: 0.46, z: 0 };
    landmarks[7] = { x: ox - 0.09, y: 0.46, z: 0 };
    landmarks[8] = { x: ox - 0.16, y: 0.46, z: 0 };
    landmarks[9] = { x: ox + 0.08, y: 0.49, z: 0 };
    landmarks[10] = { x: ox - 0.02, y: 0.49, z: 0 };
    landmarks[11] = { x: ox - 0.09, y: 0.49, z: 0 };
    landmarks[12] = { x: ox - 0.16, y: 0.49, z: 0 };
    landmarks[13] = { x: ox + 0.08, y: 0.53, z: 0 };
    landmarks[14] = { x: ox + 0.06, y: 0.53, z: 0 };
    landmarks[15] = { x: ox + 0.07, y: 0.53, z: 0 };
    landmarks[16] = { x: ox + 0.08, y: 0.53, z: 0 };
    landmarks[17] = { x: ox + 0.08, y: 0.56, z: 0 };
    landmarks[18] = { x: ox + 0.06, y: 0.56, z: 0 };
    landmarks[19] = { x: ox + 0.07, y: 0.56, z: 0 };
    landmarks[20] = { x: ox + 0.08, y: 0.56, z: 0 };

    return {
      handedness: 'Left',
      score: 0.91,
      landmarks,
    };
  }

  landmarks[0] = { x: ox, y: 0.8, z: 0 };

  landmarks[1] = { x: ox - 0.05, y: 0.72, z: 0 };
  landmarks[2] = { x: ox - 0.08, y: 0.65, z: 0 };
  landmarks[3] = { x: ox - 0.1, y: 0.6, z: 0 };
  landmarks[4] = options.thumb
    ? { x: ox - 0.19, y: 0.55, z: 0 }
    : { x: ox - 0.04, y: 0.62, z: 0 };

  landmarks[5] = { x: ox - 0.02, y: 0.6, z: 0 };
  landmarks[6] = { x: ox - 0.02, y: 0.5, z: 0 };
  landmarks[7] = { x: ox - 0.02, y: 0.42, z: 0 };
  landmarks[8] = options.index
    ? { x: ox - spread / 2, y: 0.3, z: 0 }
    : { x: ox - 0.02, y: 0.58, z: 0 };

  landmarks[9] = { x: ox, y: 0.6, z: 0 };
  landmarks[10] = { x: ox, y: 0.5, z: 0 };
  landmarks[11] = { x: ox, y: 0.42, z: 0 };
  landmarks[12] = options.middle
    ? { x: ox + spread / 2, y: 0.3, z: 0 }
    : { x: ox, y: 0.58, z: 0 };

  landmarks[13] = { x: ox + 0.04, y: 0.6, z: 0 };
  landmarks[14] = { x: ox + 0.04, y: 0.55, z: 0 };
  landmarks[15] = { x: ox + 0.04, y: 0.52, z: 0 };
  landmarks[16] = options.ring
    ? { x: ox + 0.04, y: 0.3, z: 0 }
    : options.interlacedRingPinkyHorizontally
      ? { x: ox + 0.22, y: 0.58, z: 0 }
      : { x: ox + 0.04, y: 0.58, z: 0 };

  landmarks[17] = { x: ox + 0.08, y: 0.6, z: 0 };
  landmarks[18] = { x: ox + 0.08, y: 0.56, z: 0 };
  landmarks[19] = { x: ox + 0.08, y: 0.54, z: 0 };
  landmarks[20] = options.pinky
    ? { x: ox + 0.08, y: 0.3, z: 0 }
    : options.interlacedRingPinkyHorizontally
      ? { x: ox + 0.24, y: 0.6, z: 0 }
      : { x: ox + 0.08, y: 0.58, z: 0 };

  return {
    handedness: 'Right',
    score: 0.92,
    landmarks,
  };
}

describe('Classificador Geométrico 3D de Selos, União de 2 Mãos e Cinemática dos Braços', () => {
  it('classifica corretamente os 7 selos fundamentais de Naruto', () => {
    const toraHand = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      indexMiddleSpread: 0.02,
    });
    expect(classifyHandSeal([toraHand]).sealId).toBe('tora');

    const bunshinHand = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      indexMiddleSpread: 0.12,
    });
    expect(classifyHandSeal([bunshinHand]).sealId).toBe('bunshin');

    const miHand = createSyntheticHand({
      thumb: false,
      index: false,
      middle: false,
      ring: false,
      pinky: false,
    });
    expect(classifyHandSeal([miHand]).sealId).toBe('mi');

    const toriHand = createSyntheticHand({
      thumb: false,
      index: true,
      middle: false,
      ring: false,
      pinky: true,
    });
    expect(classifyHandSeal([toriHand]).sealId).toBe('tori');

    const hitsujiHand = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: true,
      pinky: false,
    });
    expect(classifyHandSeal([hitsujiHand]).sealId).toBe('hitsuji');

    const iHand = createSyntheticHand({
      thumb: true,
      index: true,
      middle: true,
      ring: true,
      pinky: true,
    });
    expect(classifyHandSeal([iHand]).sealId).toBe('i');

    const inuHand = createSyntheticHand({
      thumb: false,
      index: true,
      middle: false,
      ring: false,
      pinky: false,
    });
    expect(classifyHandSeal([inuHand]).sealId).toBe('inu');
  });

  it('reconhece o selo Tigre (Tora) com as 2 mãos conectadas mesmo quando Anelar e Mínimo estão entrelaçados na horizontal', () => {
    const leftClasped = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      offsetX: 0.48,
      interlacedRingPinkyHorizontally: true,
    });
    const rightClasped = createSyntheticHand({
      thumb: false,
      index: true,
      middle: false,
      ring: false,
      pinky: false,
      offsetX: 0.53,
      interlacedRingPinkyHorizontally: true,
    });

    const res = classifyHandSeal([leftClasped, rightClasped], 'strict-dual');
    expect(res.handsJoined).toBe(true);
    expect(res.sealId).toBe('tora');
    expect(res.confidence).toBeGreaterThan(0.9);
  });

  it('distingue perfeitamente a Cruz (+) do Clone (bunshin) do Tigre (tora) quando uma mão está vertical e a outra cruza na horizontal', () => {
    const verticalHand = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      offsetX: 0.5,
    });
    const horizontalCrossHand = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      offsetX: 0.5,
      horizontalCrossFingerBar: true,
    });

    const dualRes = classifyHandSeal([verticalHand, horizontalCrossHand]);
    expect(dualRes.sealId).toBe('bunshin');
    expect(dualRes.confidence).toBeGreaterThan(0.9);

    const singleOccludedRes = classifyHandSeal([horizontalCrossHand]);
    expect(singleOccludedRes.sealId).toBe('bunshin');
  });

  it('usa a cinemática dos braços (1 braço para baixo vs 1 braço mais reto) para desempatar Clone (bunshin) vs Tigre (tora) mesmo sob oclusão', () => {
    const occludedHand = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      indexMiddleSpread: 0.02,
    });

    const symmetricArms: ArmPoseLandmarks = {
      leftShoulder: { x: 0.3, y: 0.4, z: 0, visibility: 0.9 },
      rightShoulder: { x: 0.7, y: 0.4, z: 0, visibility: 0.9 },
      leftElbow: { x: 0.35, y: 0.85, z: 0, visibility: 0.9 },
      rightElbow: { x: 0.65, y: 0.85, z: 0, visibility: 0.9 },
      leftWrist: { x: 0.47, y: 0.55, z: 0, visibility: 0.9 },
      rightWrist: { x: 0.53, y: 0.55, z: 0, visibility: 0.9 },
    };
    const toraWithSymArms = classifyHandSeal(
      [occludedHand],
      'clasped-hybrid',
      symmetricArms
    );
    expect(toraWithSymArms.armKinematics.posture).toBe('symmetric-aligned');
    expect(toraWithSymArms.sealId).toBe('tora');

    const asymmetricCloneArms: ArmPoseLandmarks = {
      leftShoulder: { x: 0.3, y: 0.4, z: 0, visibility: 0.9 },
      rightShoulder: { x: 0.7, y: 0.4, z: 0, visibility: 0.9 },
      leftElbow: { x: 0.46, y: 0.88, z: 0, visibility: 0.9 },
      rightElbow: { x: 0.78, y: 0.54, z: 0, visibility: 0.9 },
      leftWrist: { x: 0.48, y: 0.52, z: 0, visibility: 0.9 },
      rightWrist: { x: 0.52, y: 0.51, z: 0, visibility: 0.9 },
    };
    const cloneWithAsymArms = classifyHandSeal(
      [occludedHand],
      'clasped-hybrid',
      asymmetricCloneArms
    );
    expect(cloneWithAsymArms.armKinematics.posture).toBe('asymmetric-cross');
    expect(cloneWithAsymArms.sealId).toBe('bunshin');
  });
});

describe('Modo Just Dance & Kinect Assist + Gate de Movimento (HandMotionResetGate)', () => {
  it('não permite que manter o sinal do Tigre parado pontue outros selos como Serpente, Bode ou Javali', () => {
    const toraHand = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
    });
    const strictRes = classifyHandSeal([toraHand]);
    expect(strictRes.sealId).toBe('tora');

    expect(
      evaluateKinectTargetSeal([toraHand], strictRes, 'tora').matched
    ).toBe(true);

    expect(evaluateKinectTargetSeal([toraHand], strictRes, 'mi').matched).toBe(
      false
    );
    expect(
      evaluateKinectTargetSeal([toraHand], strictRes, 'hitsuji').matched
    ).toBe(false);
    expect(evaluateKinectTargetSeal([toraHand], strictRes, 'i').matched).toBe(
      false
    );
    expect(
      evaluateKinectTargetSeal([toraHand], strictRes, 'tori').matched
    ).toBe(false);
  });

  it('bloqueia o reconhecimento do próximo selo se o usuário continuar parado e libera ao separar/mover as mãos', () => {
    const motionGate = new HandMotionResetGate();
    const handA = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      offsetX: 0.48,
    });
    const handB = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      offsetX: 0.52,
    });

    motionGate.lockOnSealConfirmed([handA, handB], 'tora', 0.04);

    const stillCheck = motionGate.checkAndUpdateLock(
      [handA, handB],
      'tora',
      0.04,
      1000
    );
    expect(stillCheck.isBlockedByStillness).toBe(true);

    motionGate.checkAndUpdateLock([handA, handB], null, 0.22, 1100);
    const afterSeparateCheck = motionGate.checkAndUpdateLock(
      [handA, handB],
      'mi',
      0.05,
      1350
    );
    expect(afterSeparateCheck.isBlockedByStillness).toBe(false);
  });
});

describe('Calibrador Híbrido Few-Shot (HybridSealCalibrator)', () => {
  it('aprende um protótipo de 2 mãos unidas e reconhece a pose por similaridade de cosseno', () => {
    const calibrator = new HybridSealCalibrator();
    calibrator.clearAllCalibrations();

    const handA = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      offsetX: 0.49,
      interlacedRingPinkyHorizontally: true,
    });
    const handB = createSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      offsetX: 0.52,
      interlacedRingPinkyHorizontally: true,
    });

    calibrator.startRecording('tora');
    for (let i = 0; i < 6; i++) {
      calibrator.addCalibrationFrame('tora', [handA, handB], null);
    }
    expect(calibrator.finalizeCalibration('tora')).toBe(true);

    const prediction = calibrator.predict([handA, handB], null);
    expect(prediction?.sealId).toBe('tora');
    expect(prediction?.confidence).toBeGreaterThan(0.9);
  });
});

describe('Gate Temporal de Estabilidade (SealStabilityGate)', () => {
  it('confirma um selo após holdDurationMs, bloqueia repetição parada e permite troca direta de selo', () => {
    const gate = new SealStabilityGate({ holdDurationMs: 300 });
    const miResult = {
      sealId: 'mi' as const,
      confidence: 0.88,
      dualHandResonance: true,
      handsJoined: true,
      interHandDistance: 0.12,
      primaryFingers: null,
      claspBox: null,
      armKinematics: {
        posture: 'symmetric-aligned' as const,
        leftForearmAngleDeg: 65,
        rightForearmAngleDeg: 65,
        angleDiffDeg: 0,
        elbowsVisible: true,
      },
      source: 'geometry' as const,
    };

    expect(gate.update(miResult, 1000).justConfirmedSeal).toBeNull();
    expect(gate.update(miResult, 1150).justConfirmedSeal).toBeNull();
    const confirmedStep = gate.update(miResult, 1310);
    expect(confirmedStep.justConfirmedSeal).toBe('mi');

    expect(gate.update(miResult, 1500).justConfirmedSeal).toBeNull();

    const toraResult = {
      ...miResult,
      sealId: 'tora' as const,
    };
    expect(gate.update(toraResult, 1600).candidateSeal).toBe('tora');
    expect(gate.update(toraResult, 1800).justConfirmedSeal).toBeNull();
    expect(gate.update(toraResult, 1920).justConfirmedSeal).toBe('tora');
  });
});

describe('Motor de Sequência de Jutsus (JutsuSequenceEngine)', () => {
  it('dispara Katon: Gōkakyū no Jutsu ao completar Serpente -> Bode -> Javali -> Tigre', () => {
    const engine = new JutsuSequenceEngine();

    expect(engine.pushSeal('mi', 1000).completedJutsu).toBeNull();
    expect(engine.pushSeal('hitsuji', 1500).completedJutsu).toBeNull();
    expect(engine.pushSeal('i', 2000).completedJutsu).toBeNull();

    const finalPush = engine.pushSeal('tora', 2500);
    expect(finalPush.completedJutsu?.id).toBe('katon-gokakyu');
    expect(engine.getHistory().length).toBe(1);
    expect(engine.getSequence().length).toBe(0);
  });

  it('reconhece o combo mesmo se houver um selo extra antes (suffix-prefix match)', () => {
    const engine = new JutsuSequenceEngine();

    engine.pushSeal('tori', 1000);
    engine.pushSeal('mi', 1400);
    const result = engine.pushSeal('i', 1800);

    expect(result.completedJutsu?.id).toBe('rasengan');
  });
});
