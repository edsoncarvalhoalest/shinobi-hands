import type {
  ArmKinematicsState,
  ArmPoseLandmarks,
  ClaspBoundingBox,
  DetectedHand,
  FingerExtensionMap,
  HandConnectionMode,
  Point3D,
  SealClassificationResult,
  SealId,
} from '../types/jutsu';

const LANDMARK_COUNT = 21;
const MIN_PALM_SCALE = 0.02;
const DUAL_HAND_PROXIMITY_THRESHOLD = 0.44;
const TIGRE_MAX_TIP_SEPARATION_RATIO = 0.33;
const MIN_HAND_SCORE = 0.38;
const BASE_CONFIDENCE = 0.78;
const DUAL_HAND_BONUS = 0.15;

export function distance2D(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function distance3D(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

function computeElevationAngleDeg(fromPt: Point3D, toPt: Point3D): number {
  const dx = Math.abs(toPt.x - fromPt.x);
  const dy = Math.abs(fromPt.y - toPt.y);
  if (dx < 0.001 && dy < 0.001) return 45;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function analyzeArmKinematics(
  hands: DetectedHand[],
  armPose: ArmPoseLandmarks | null = null
): ArmKinematicsState {
  if (armPose) {
    const leftVis =
      Math.min(
        armPose.leftElbow.visibility ?? 0.8,
        armPose.leftWrist.visibility ?? 0.8
      ) >= 0.4 &&
      armPose.leftElbow.y <= 0.99 &&
      armPose.leftElbow.y >= 0.01;

    const rightVis =
      Math.min(
        armPose.rightElbow.visibility ?? 0.8,
        armPose.rightWrist.visibility ?? 0.8
      ) >= 0.4 &&
      armPose.rightElbow.y <= 0.99 &&
      armPose.rightElbow.y >= 0.01;

    if (leftVis && rightVis) {
      const leftAngle = computeElevationAngleDeg(
        armPose.leftElbow,
        armPose.leftWrist
      );
      const rightAngle = computeElevationAngleDeg(
        armPose.rightElbow,
        armPose.rightWrist
      );
      const angleDiff = Math.abs(leftAngle - rightAngle);
      const elbowHeightDiff = Math.abs(
        armPose.leftElbow.y - armPose.rightElbow.y
      );

      const isAsymmetricCross =
        angleDiff >= 20 || (elbowHeightDiff >= 0.09 && angleDiff >= 14);

      return {
        posture: isAsymmetricCross ? 'asymmetric-cross' : 'symmetric-aligned',
        leftForearmAngleDeg: Math.round(leftAngle),
        rightForearmAngleDeg: Math.round(rightAngle),
        angleDiffDeg: Math.round(angleDiff),
        elbowsVisible: true,
      };
    }
  }

  if (hands.length >= 2) {
    const angleA = computeElevationAngleDeg(
      hands[0].landmarks[0],
      hands[0].landmarks[9]
    );
    const angleB = computeElevationAngleDeg(
      hands[1].landmarks[0],
      hands[1].landmarks[9]
    );
    const angleDiff = Math.abs(angleA - angleB);

    return {
      posture: angleDiff >= 22 ? 'asymmetric-cross' : 'symmetric-aligned',
      leftForearmAngleDeg: Math.round(angleA),
      rightForearmAngleDeg: Math.round(angleB),
      angleDiffDeg: Math.round(angleDiff),
      elbowsVisible: false,
    };
  }

  return {
    posture: 'neutral',
    leftForearmAngleDeg: null,
    rightForearmAngleDeg: null,
    angleDiffDeg: null,
    elbowsVisible: false,
  };
}

function computeFingerVerticality(mcp: Point3D, tip: Point3D): number {
  const dx = tip.x - mcp.x;
  const dyUp = mcp.y - tip.y;
  const len = Math.hypot(dx, dyUp) || 0.001;
  return dyUp / len;
}

function isFingerExtendedInSeal(
  wrist: Point3D,
  mcp: Point3D,
  pip: Point3D,
  tip: Point3D,
  palmScale: number,
  isClaspedProfile: boolean
): boolean {
  const wristToTip = distance3D(wrist, tip);
  const wristToPip = distance3D(wrist, pip);
  const wristToMcp = distance3D(wrist, mcp);

  const dyUp = mcp.y - tip.y;
  const verticalityRatio = computeFingerVerticality(mcp, tip);

  if (isClaspedProfile) {
    const isPointingUp =
      dyUp > palmScale * 0.36 &&
      tip.y < pip.y - palmScale * 0.05 &&
      verticalityRatio > 0.48;
    return isPointingUp && wristToTip > wristToPip * 1.06;
  }

  const radialExtended =
    wristToTip > wristToPip * 1.13 && wristToTip > wristToMcp * 1.32;
  const notFoldedHorizontally =
    verticalityRatio > 0.38 || wristToTip > wristToMcp * 1.62;

  return radialExtended && notFoldedHorizontally;
}

function extractRadialTwoFingerState(landmarks: Point3D[]): {
  indexRadial: boolean;
  middleRadial: boolean;
  ringRadial: boolean;
  pinkyRadial: boolean;
  indexVerticality: number;
  middleVerticality: number;
} {
  const wrist = landmarks[0];
  const indexTipDist = distance3D(wrist, landmarks[8]);
  const indexPipDist = distance3D(wrist, landmarks[6]);
  const middleTipDist = distance3D(wrist, landmarks[12]);
  const middlePipDist = distance3D(wrist, landmarks[10]);
  const ringTipDist = distance3D(wrist, landmarks[16]);
  const ringPipDist = distance3D(wrist, landmarks[14]);
  const pinkyTipDist = distance3D(wrist, landmarks[20]);
  const pinkyPipDist = distance3D(wrist, landmarks[18]);

  const indexRadial =
    indexTipDist > indexPipDist * 1.08 &&
    distance2D(landmarks[5], landmarks[8]) >
      distance2D(landmarks[5], landmarks[6]) * 1.22;

  const middleRadial =
    middleTipDist > middlePipDist * 1.08 &&
    distance2D(landmarks[9], landmarks[12]) >
      distance2D(landmarks[9], landmarks[10]) * 1.22;

  const ringRadial =
    ringTipDist > ringPipDist * 1.12 && ringTipDist > indexTipDist * 0.88;

  const pinkyRadial =
    pinkyTipDist > pinkyPipDist * 1.12 && pinkyTipDist > middleTipDist * 0.86;

  return {
    indexRadial,
    middleRadial,
    ringRadial,
    pinkyRadial,
    indexVerticality: computeFingerVerticality(landmarks[5], landmarks[8]),
    middleVerticality: computeFingerVerticality(landmarks[9], landmarks[12]),
  };
}

function detectClaspedProfileOrientation(
  landmarks: Point3D[],
  palmScale: number,
  handsJoined: boolean
): boolean {
  if (handsJoined) return true;
  const knuckleSpreadX = Math.abs(landmarks[5].x - landmarks[17].x);
  const knuckleSpreadY = Math.abs(landmarks[5].y - landmarks[17].y);
  return (
    knuckleSpreadX < palmScale * 0.62 || knuckleSpreadY > knuckleSpreadX * 0.75
  );
}

export function extractFingerStates(
  landmarks: Point3D[],
  handsJoined = false
): FingerExtensionMap {
  const wrist = landmarks[0];
  const palmScale = Math.max(distance3D(wrist, landmarks[9]), MIN_PALM_SCALE);
  const isClaspedProfile = detectClaspedProfileOrientation(
    landmarks,
    palmScale,
    handsJoined
  );

  const thumbToPinkyMcp = distance2D(landmarks[4], landmarks[17]);
  const thumbMcpToPinkyMcp = distance2D(landmarks[2], landmarks[17]);
  const thumbToIndexMcpRatio =
    distance2D(landmarks[4], landmarks[5]) / palmScale;

  const thumb =
    thumbToPinkyMcp > thumbMcpToPinkyMcp * 1.14 &&
    thumbToIndexMcpRatio > 0.52;

  const index = isFingerExtendedInSeal(
    wrist,
    landmarks[5],
    landmarks[6],
    landmarks[8],
    palmScale,
    isClaspedProfile
  );
  const middle = isFingerExtendedInSeal(
    wrist,
    landmarks[9],
    landmarks[10],
    landmarks[12],
    palmScale,
    isClaspedProfile
  );
  const ring = isFingerExtendedInSeal(
    wrist,
    landmarks[13],
    landmarks[14],
    landmarks[16],
    palmScale,
    isClaspedProfile
  );
  const pinky = isFingerExtendedInSeal(
    wrist,
    landmarks[17],
    landmarks[18],
    landmarks[20],
    palmScale,
    isClaspedProfile
  );

  return { thumb, index, middle, ring, pinky };
}

export function computeClaspBoundingBox(
  hands: DetectedHand[]
): ClaspBoundingBox | null {
  if (hands.length === 0) return null;

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (const hand of hands) {
    for (const pt of hand.landmarks) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  const pad = 0.04;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(1, maxX + pad);
  maxY = Math.min(1, maxY + pad);

  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function computeAbsCosAngle(
  p1: Point3D,
  p2: Point3D,
  q1: Point3D,
  q2: Point3D
): number {
  const v1x = p2.x - p1.x;
  const v1y = p2.y - p1.y;
  const v2x = q2.x - q1.x;
  const v2y = q2.y - q1.y;
  const mag1 = Math.hypot(v1x, v1y) || 0.001;
  const mag2 = Math.hypot(v2x, v2y) || 0.001;
  return Math.abs((v1x * v2x + v1y * v2y) / (mag1 * mag2));
}

function fuseTwoHandsFingerStates(
  handA: DetectedHand,
  handB: DetectedHand,
  fingersA: FingerExtensionMap,
  fingersB: FingerExtensionMap,
  armKinematics: ArmKinematicsState
): {
  fusedFingers: FingerExtensionMap;
  asymmetricDogSeal: boolean;
  triangleHorseSeal: boolean;
  crossCloneSeal: boolean;
} {
  const palmScale = Math.max(
    distance2D(handA.landmarks[0], handA.landmarks[9]),
    MIN_PALM_SCALE
  );

  const radialA = extractRadialTwoFingerState(handA.landmarks);
  const radialB = extractRadialTwoFingerState(handB.landmarks);

  const tipDist = distance2D(handA.landmarks[8], handB.landmarks[8]);
  const pipDist = distance2D(handA.landmarks[6], handB.landmarks[6]);
  const middlePipDist = distance2D(handA.landmarks[10], handB.landmarks[10]);
  const crossProximity = Math.min(tipDist, pipDist, middlePipDist);

  const indexAbsCos = computeAbsCosAngle(
    handA.landmarks[5],
    handA.landmarks[8],
    handB.landmarks[5],
    handB.landmarks[8]
  );
  const middleAbsCos = computeAbsCosAngle(
    handA.landmarks[9],
    handA.landmarks[12],
    handB.landmarks[9],
    handB.landmarks[12]
  );
  const minFingerAbsCos = Math.min(indexAbsCos, middleAbsCos);

  const handAHasTwoFingers =
    (fingersA.index &&
      fingersA.middle &&
      !fingersA.ring &&
      !fingersA.pinky) ||
    (radialA.indexRadial &&
      radialA.middleRadial &&
      !radialA.ringRadial &&
      !radialA.pinkyRadial);

  const handBHasTwoFingers =
    (fingersB.index &&
      fingersB.middle &&
      !fingersB.ring &&
      !fingersB.pinky) ||
    (radialB.indexRadial &&
      radialB.middleRadial &&
      !radialB.ringRadial &&
      !radialB.pinkyRadial);

  const handAHasAtLeastIndex =
    (radialA.indexRadial && !radialA.ringRadial && !radialA.pinkyRadial) ||
    (fingersA.index && !fingersA.ring && !fingersA.pinky);
  const handBHasAtLeastIndex =
    (radialB.indexRadial && !radialB.ringRadial && !radialB.pinkyRadial) ||
    (fingersB.index && !fingersB.ring && !fingersB.pinky);

  const oneHandIsHorizontalBar =
    Math.abs(radialA.indexVerticality) < 0.76 ||
    Math.abs(radialB.indexVerticality) < 0.76 ||
    Math.abs(radialA.middleVerticality) < 0.76 ||
    Math.abs(radialB.middleVerticality) < 0.76;

  let crossCloneSeal = false;
  if (crossProximity < palmScale * 1.95) {
    if (
      (handAHasTwoFingers && handBHasAtLeastIndex) ||
      (handBHasTwoFingers && handAHasAtLeastIndex)
    ) {
      if (
        minFingerAbsCos < 0.9 ||
        oneHandIsHorizontalBar ||
        armKinematics.posture === 'asymmetric-cross'
      ) {
        crossCloneSeal = true;
      }
    }
    if (
      (handAHasTwoFingers || handBHasTwoFingers) &&
      (indexAbsCos < 0.82 ||
        oneHandIsHorizontalBar ||
        armKinematics.posture === 'asymmetric-cross') &&
      (radialA.indexRadial || radialB.indexRadial)
    ) {
      crossCloneSeal = true;
    }
  }

  const countA =
    Number(fingersA.index) +
    Number(fingersA.middle) +
    Number(fingersA.ring) +
    Number(fingersA.pinky);
  const countB =
    Number(fingersB.index) +
    Number(fingersB.middle) +
    Number(fingersB.ring) +
    Number(fingersB.pinky);

  const asymmetricDogSeal =
    !crossCloneSeal &&
    ((countA >= 3 && countB === 0) || (countB >= 3 && countA === 0));

  const triangleHorseSeal =
    !crossCloneSeal &&
    fingersA.index &&
    !fingersA.middle &&
    !fingersA.ring &&
    fingersB.index &&
    !fingersB.middle &&
    !fingersB.ring &&
    tipDist < palmScale * 1.4;

  const fusedFingers: FingerExtensionMap = {
    thumb: fingersA.thumb && fingersB.thumb,
    index: fingersA.index || fingersB.index,
    middle: fingersA.middle || fingersB.middle,
    ring: fingersA.ring || fingersB.ring,
    pinky: fingersA.pinky || fingersB.pinky,
  };

  return {
    fusedFingers,
    asymmetricDogSeal,
    triangleHorseSeal,
    crossCloneSeal,
  };
}

function classifyFromFingersAndLandmarks(
  landmarks: Point3D[],
  fingers: FingerExtensionMap,
  armKinematics: ArmKinematicsState,
  dualExtras?: {
    asymmetricDogSeal: boolean;
    triangleHorseSeal: boolean;
    crossCloneSeal: boolean;
  }
): { sealId: SealId | null; rawConfidence: number } {
  if (dualExtras?.crossCloneSeal) {
    const armBoost = armKinematics.posture === 'asymmetric-cross' ? 0.04 : 0;
    return { sealId: 'bunshin', rawConfidence: Math.min(0.99, 0.94 + armBoost) };
  }
  if (dualExtras?.triangleHorseSeal || dualExtras?.asymmetricDogSeal) {
    return { sealId: 'inu', rawConfidence: 0.92 };
  }

  const wrist = landmarks[0];
  const palmScale = Math.max(distance2D(wrist, landmarks[9]), MIN_PALM_SCALE);
  const radial = extractRadialTwoFingerState(landmarks);

  if (
    radial.indexRadial &&
    radial.middleRadial &&
    !radial.ringRadial &&
    !radial.pinkyRadial &&
    (Math.abs(radial.indexVerticality) < 0.76 ||
      Math.abs(radial.middleVerticality) < 0.76)
  ) {
    return { sealId: 'bunshin', rawConfidence: 0.91 };
  }

  if (
    fingers.thumb &&
    fingers.index &&
    fingers.middle &&
    fingers.ring &&
    fingers.pinky
  ) {
    return { sealId: 'i', rawConfidence: 0.89 };
  }

  if (fingers.index && fingers.middle && fingers.ring && !fingers.pinky) {
    return { sealId: 'hitsuji', rawConfidence: 0.88 };
  }

  if (fingers.index && !fingers.middle && !fingers.ring && fingers.pinky) {
    return { sealId: 'tori', rawConfidence: 0.9 };
  }

  if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
    return { sealId: 'inu', rawConfidence: 0.88 };
  }

  if (fingers.index && fingers.middle && !fingers.ring && !fingers.pinky) {
    const indexMiddleTipDist = distance2D(landmarks[8], landmarks[12]);
    const separationRatio = indexMiddleTipDist / palmScale;

    if (
      armKinematics.posture === 'asymmetric-cross' ||
      separationRatio >= TIGRE_MAX_TIP_SEPARATION_RATIO ||
      radial.indexVerticality < 0.78 ||
      radial.middleVerticality < 0.78
    ) {
      return { sealId: 'bunshin', rawConfidence: 0.92 };
    }

    const symmetricBoost =
      armKinematics.posture === 'symmetric-aligned' ? 0.04 : 0;
    return { sealId: 'tora', rawConfidence: 0.9 + symmetricBoost };
  }

  if (!fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
    return { sealId: 'mi', rawConfidence: BASE_CONFIDENCE + 0.05 };
  }

  return { sealId: null, rawConfidence: 0 };
}

export function classifyHandSeal(
  hands: DetectedHand[],
  mode: HandConnectionMode = 'clasped-hybrid',
  armPose: ArmPoseLandmarks | null = null
): SealClassificationResult {
  const validHands = hands.filter(
    (hand) =>
      hand.landmarks.length === LANDMARK_COUNT && hand.score >= MIN_HAND_SCORE
  );

  const armKinematics = analyzeArmKinematics(validHands, armPose);

  if (validHands.length === 0) {
    return {
      sealId: null,
      confidence: 0,
      dualHandResonance: false,
      handsJoined: false,
      interHandDistance: null,
      primaryFingers: null,
      claspBox: null,
      armKinematics,
      source: 'none',
    };
  }

  const sortedHands = [...validHands].sort((a, b) => b.score - a.score);
  const primaryHand = sortedHands[0];
  const secondaryHand = sortedHands.length > 1 ? sortedHands[1] : null;

  let interHandDistance: number | null = null;
  let handsJoined = false;

  if (secondaryHand) {
    const palmDist = distance2D(
      primaryHand.landmarks[9],
      secondaryHand.landmarks[9]
    );
    const knuckleDist = distance2D(
      primaryHand.landmarks[5],
      secondaryHand.landmarks[5]
    );
    const indexTipDist = distance2D(
      primaryHand.landmarks[8],
      secondaryHand.landmarks[8]
    );
    const indexPipDist = distance2D(
      primaryHand.landmarks[6],
      secondaryHand.landmarks[6]
    );
    interHandDistance = Math.min(
      palmDist,
      knuckleDist,
      indexTipDist,
      indexPipDist
    );
    handsJoined = interHandDistance <= DUAL_HAND_PROXIMITY_THRESHOLD;
  }

  if (mode === 'strict-dual' && !handsJoined) {
    return {
      sealId: null,
      confidence: 0,
      dualHandResonance: false,
      handsJoined: false,
      interHandDistance,
      primaryFingers: extractFingerStates(primaryHand.landmarks, false),
      claspBox: computeClaspBoundingBox(validHands),
      armKinematics,
      source: 'none',
    };
  }

  const fingersA = extractFingerStates(primaryHand.landmarks, handsJoined);
  let effectiveFingers = fingersA;
  let dualExtras:
    | {
        asymmetricDogSeal: boolean;
        triangleHorseSeal: boolean;
        crossCloneSeal: boolean;
      }
    | undefined;

  if (secondaryHand && handsJoined) {
    const fingersB = extractFingerStates(secondaryHand.landmarks, true);
    const fusion = fuseTwoHandsFingerStates(
      primaryHand,
      secondaryHand,
      fingersA,
      fingersB,
      armKinematics
    );
    effectiveFingers = fusion.fusedFingers;
    dualExtras = fusion;
  }

  const classification = classifyFromFingersAndLandmarks(
    primaryHand.landmarks,
    effectiveFingers,
    armKinematics,
    dualExtras
  );

  const claspBox = computeClaspBoundingBox(validHands);

  if (!classification.sealId) {
    return {
      sealId: null,
      confidence: 0,
      dualHandResonance: handsJoined,
      handsJoined,
      interHandDistance,
      primaryFingers: effectiveFingers,
      claspBox,
      armKinematics,
      source: 'none',
    };
  }

  const resonanceBoost = handsJoined ? DUAL_HAND_BONUS : 0;
  const finalConfidence = Math.min(
    0.99,
    classification.rawConfidence * 0.85 +
      primaryHand.score * 0.15 +
      resonanceBoost
  );

  return {
    sealId: classification.sealId,
    confidence: Number(finalConfidence.toFixed(3)),
    dualHandResonance: handsJoined,
    handsJoined,
    interHandDistance,
    primaryFingers: effectiveFingers,
    claspBox,
    armKinematics,
    source: 'geometry',
  };
}
