import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { ArmPoseLandmarks, DetectedHand, Point3D } from '../types/jutsu';

const LOCAL_WASM_ROOT = '/mediapipe/wasm';
const CDN_WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';

const LOCAL_HAND_MODEL_PATH = '/mediapipe/hand_landmarker.task';
const REMOTE_HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class NinjaHandTracker {
  private handLandmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  private latestArmPose: ArmPoseLandmarks | null = null;

  public async initialize(onStatus?: (msg: string) => void): Promise<void> {
    if (this.handLandmarker) return;

    onStatus?.('Inicializando runtime WASM do MediaPipe Vision (60 FPS)...');

    let visionFileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
    try {
      const localCheck = await fetch(`${LOCAL_WASM_ROOT}/vision_wasm_internal.js`, {
        method: 'HEAD',
      });
      const wasmRoot = localCheck.ok ? LOCAL_WASM_ROOT : CDN_WASM_ROOT;
      visionFileset = await FilesetResolver.forVisionTasks(wasmRoot);
    } catch {
      visionFileset = await FilesetResolver.forVisionTasks(CDN_WASM_ROOT);
    }

    let handModelAssetPath = REMOTE_HAND_MODEL_URL;
    try {
      const modelCheck = await fetch(LOCAL_HAND_MODEL_PATH, { method: 'HEAD' });
      if (
        modelCheck.ok &&
        modelCheck.headers.get('content-type')?.includes('text/html') === false
      ) {
        handModelAssetPath = LOCAL_HAND_MODEL_PATH;
      }
    } catch {
      handModelAssetPath = REMOTE_HAND_MODEL_URL;
    }

    onStatus?.('Carregando HandLandmarker em GPU (Ultra-Baixa Latência)...');

    try {
      this.handLandmarker = await HandLandmarker.createFromOptions(visionFileset, {
        baseOptions: {
          modelAssetPath: handModelAssetPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.38,
      });
    } catch {
      this.handLandmarker = await HandLandmarker.createFromOptions(visionFileset, {
        baseOptions: {
          modelAssetPath: handModelAssetPath,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.38,
      });
    }

    onStatus?.('Motor Shinobi 60 FPS pronto!');
  }

  public detectFrame(
    video: HTMLVideoElement,
    timestampMs: number
  ): DetectedHand[] | null {
    if (!this.handLandmarker || video.readyState < 2) {
      return null;
    }

    if (video.currentTime === this.lastVideoTime) {
      return null;
    }
    this.lastVideoTime = video.currentTime;

    const result = this.handLandmarker.detectForVideo(video, timestampMs);
    const detectedHands: DetectedHand[] = [];

    const count = result.landmarks?.length ?? 0;
    for (let i = 0; i < count; i++) {
      const rawLandmarks = result.landmarks[i];
      const category = result.handednesses?.[i]?.[0];
      const rawName = category?.categoryName === 'Left' ? 'Left' : 'Right';
      const score = category?.score ?? 0.8;

      detectedHands.push({
        handedness: rawName,
        score,
        landmarks: rawLandmarks.map((pt) => ({
          x: pt.x,
          y: pt.y,
          z: pt.z,
        })),
      });
    }

    this.latestArmPose = this.deriveFastArmVectorsFromHands(detectedHands);

    return detectedHands;
  }

  private deriveFastArmVectorsFromHands(
    hands: DetectedHand[]
  ): ArmPoseLandmarks | null {
    if (hands.length < 2) {
      return null;
    }

    const sortedByX = [...hands].sort(
      (a, b) => a.landmarks[0].x - b.landmarks[0].x
    );
    const leftSideHand = sortedByX[0];
    const rightSideHand = sortedByX[1];

    const projectElbow = (hand: DetectedHand, sideSign: number): Point3D => {
      const wrist = hand.landmarks[0];
      const midMcp = hand.landmarks[9];
      const vx = wrist.x - midMcp.x;
      const vy = wrist.y - midMcp.y;
      return {
        x: Math.min(0.98, Math.max(0.02, wrist.x + vx * 2.1 + sideSign * 0.04)),
        y: Math.min(0.98, Math.max(0.02, wrist.y + vy * 2.1)),
        z: wrist.z,
        visibility: 0.9,
      };
    };

    const leftWrist = { ...leftSideHand.landmarks[0], visibility: 0.95 };
    const rightWrist = { ...rightSideHand.landmarks[0], visibility: 0.95 };
    const leftElbow = projectElbow(leftSideHand, -1);
    const rightElbow = projectElbow(rightSideHand, 1);

    return {
      leftShoulder: {
        x: Math.max(0.05, leftElbow.x - 0.06),
        y: Math.max(0.15, leftElbow.y - 0.28),
        z: 0,
        visibility: 0.6,
      },
      rightShoulder: {
        x: Math.min(0.95, rightElbow.x + 0.06),
        y: Math.max(0.15, rightElbow.y - 0.28),
        z: 0,
        visibility: 0.6,
      },
      leftElbow,
      rightElbow,
      leftWrist,
      rightWrist,
    };
  }

  public getLatestArmPose(): ArmPoseLandmarks | null {
    return this.latestArmPose;
  }

  public dispose(): void {
    if (this.handLandmarker) {
      this.handLandmarker.close();
      this.handLandmarker = null;
    }
    this.lastVideoTime = -1;
    this.latestArmPose = null;
  }
}
