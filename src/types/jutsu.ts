export type SealId =
  | 'tora'    // Tigre (寅) — 2 Mãos unidas + Braços simétricos + Indicador e Médio juntos para cima
  | 'mi'      // Serpente (巳) — 2 Mãos unidas com todos os dedos entrelaçados fechados
  | 'tori'    // Pássaro (酉) — 2 Mãos unidas com Indicador + Mínimo erguidos
  | 'hitsuji' // Bode (未) — 2 Mãos unidas com Indicador + Médio + Anelar erguidos
  | 'i'       // Javali (亥) — Palmas de Chakra abertas unidas (5 dedos estendidos)
  | 'inu'     // Cavalo/Cachorro (午/戌) — 2 Mãos unidas formando Triângulo /\ com Indicadores
  | 'bunshin';// Clone (壬) — Cruz Ninja + (1 braço vertical para baixo e 1 braço mais reto na lateral)

export type ChakraElement = 'katon' | 'raiton' | 'suiton' | 'fuuton' | 'yin-yang';

export type HandConnectionMode = 'clasped-hybrid' | 'strict-dual';

export interface SealMetadata {
  id: SealId;
  namePt: string;
  nameJp: string;
  kanji: string;
  emoji: string;
  gestureHint: string;
  colorHex: string;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface DetectedHand {
  handedness: 'Left' | 'Right';
  score: number;
  landmarks: Point3D[];
}

export interface ArmPoseLandmarks {
  leftShoulder: Point3D;
  rightShoulder: Point3D;
  leftElbow: Point3D;
  rightElbow: Point3D;
  leftWrist: Point3D;
  rightWrist: Point3D;
}

export type ArmPostureType =
  | 'symmetric-aligned' // Braços simétricos (ambos para baixo ou em linha reta -> favorece Tigre, Bode, Serpente)
  | 'asymmetric-cross'  // Um braço para baixo e outro mais reto/lateral (-> favorece Clone / Cruz)
  | 'neutral';          // Cotovelos fora do quadro ou apenas 1 braço visível (não bloqueia nada)

export interface ArmKinematicsState {
  posture: ArmPostureType;
  leftForearmAngleDeg: number | null;
  rightForearmAngleDeg: number | null;
  angleDiffDeg: number | null;
  elbowsVisible: boolean;
}

export interface FingerExtensionMap {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

export interface ClaspBoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

export interface SealClassificationResult {
  sealId: SealId | null;
  confidence: number;
  dualHandResonance: boolean;
  handsJoined: boolean;
  interHandDistance: number | null;
  primaryFingers: FingerExtensionMap | null;
  claspBox: ClaspBoundingBox | null;
  armKinematics: ArmKinematicsState;
  source: 'geometry' | 'calibrated-hybrid' | 'none';
}

export interface StabilityGateState {
  candidateSeal: SealId | null;
  progress: number; // 0 to 1
  lastConfirmedSeal: SealId | null;
  justConfirmedSeal: SealId | null;
  dualHandActive: boolean;
  confidence: number;
}

export interface JutsuRecipe {
  id: string;
  nameJp: string;
  namePt: string;
  element: ChakraElement;
  elementLabel: string;
  seals: SealId[];
  description: string;
  colorPrimary: string;
  colorSecondary: string;
  rank: 'C' | 'B' | 'A' | 'S';
}

export interface JutsuMatchStatus {
  recipe: JutsuRecipe;
  matchedCount: number;
  isComplete: boolean;
  nextSeal: SealId | null;
}

export interface JutsuExecutionRecord {
  id: string;
  recipe: JutsuRecipe;
  timestamp: number;
  durationMs: number;
}
