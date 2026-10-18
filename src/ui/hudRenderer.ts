import { SEALS_BY_ID } from '../data/jutsus';
import type {
  ArmKinematicsState,
  ArmPoseLandmarks,
  ClaspBoundingBox,
  DetectedHand,
  JutsuRecipe,
  Point3D,
  StabilityGateState,
} from '../types/jutsu';

const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const FINGERTIP_INDICES = new Set([4, 8, 12, 16, 20]);

interface ChakraParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: string;
}

export class NinjaHudCanvasRenderer {
  private particles: ChakraParticle[] = [];

  public spawnBurst(
    canvasWidth: number,
    canvasHeight: number,
    colorPrimary: string,
    colorSecondary: string,
    count = 42
  ): void {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
      const speed = 2.5 + Math.random() * 7.5;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 3 + Math.random() * 5,
        alpha: 1,
        color: i % 2 === 0 ? colorPrimary : colorSecondary,
      });
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    hands: DetectedHand[],
    gateState: StabilityGateState,
    activeJutsuEffect: JutsuRecipe | null,
    claspBox: ClaspBoundingBox | null = null,
    armPose: ArmPoseLandmarks | null = null,
    armKinematics: ArmKinematicsState | null = null
  ): void {
    ctx.clearRect(0, 0, width, height);

    const activeSealMeta = gateState.candidateSeal
      ? SEALS_BY_ID[gateState.candidateSeal]
      : gateState.lastConfirmedSeal
        ? SEALS_BY_ID[gateState.lastConfirmedSeal]
        : null;

    const primaryAuraColor = activeJutsuEffect
      ? activeJutsuEffect.colorPrimary
      : activeSealMeta
        ? activeSealMeta.colorHex
        : '#38bdf8';

    if (armPose) {
      this.drawArmSkeleton(
        ctx,
        armPose,
        width,
        height,
        primaryAuraColor,
        armKinematics
      );
    }

    if (claspBox && hands.length > 0) {
      this.drawClaspZoneFrame(
        ctx,
        claspBox,
        width,
        height,
        gateState.dualHandActive,
        primaryAuraColor
      );
    }

    if (hands.length >= 2) {
      const palmA = this.toScreenCoords(hands[0].landmarks[9], width, height);
      const palmB = this.toScreenCoords(hands[1].landmarks[9], width, height);
      this.drawDualHandChakraBridge(
        ctx,
        palmA,
        palmB,
        gateState.dualHandActive,
        primaryAuraColor
      );
    }

    hands.forEach((hand, index) => {
      const handColor =
        index === 0 ? primaryAuraColor : gateState.dualHandActive ? '#facc15' : '#94a3b8';
      this.drawHandSkeleton(ctx, hand.landmarks, width, height, handColor);
    });

    if (hands.length > 0 && gateState.candidateSeal && gateState.progress > 0) {
      const anchorPt = claspBox
        ? { x: (1 - claspBox.centerX) * width, y: claspBox.centerY * height }
        : this.toScreenCoords(hands[0].landmarks[9], width, height);
      const sealMeta = SEALS_BY_ID[gateState.candidateSeal];
      this.drawStabilityGateRing(
        ctx,
        anchorPt.x,
        anchorPt.y,
        gateState.progress,
        sealMeta.colorHex,
        `${sealMeta.kanji} ${sealMeta.namePt.toUpperCase()}`
      );
    }

    this.updateAndDrawParticles(ctx);
  }

  private toScreenCoords(
    pt: Point3D,
    width: number,
    height: number
  ): { x: number; y: number } {
    return {
      x: (1 - pt.x) * width,
      y: pt.y * height,
    };
  }

  private drawArmSkeleton(
    ctx: CanvasRenderingContext2D,
    armPose: ArmPoseLandmarks,
    width: number,
    height: number,
    color: string,
    armKinematics: ArmKinematicsState | null
  ): void {
    const isAsymmetric = armKinematics?.posture === 'asymmetric-cross';
    const armStrokeColor = isAsymmetric ? '#38bdf8' : color;

    const segments: Array<[Point3D, Point3D]> = [
      [armPose.leftShoulder, armPose.leftElbow],
      [armPose.leftElbow, armPose.leftWrist],
      [armPose.rightShoulder, armPose.rightElbow],
      [armPose.rightElbow, armPose.rightWrist],
      [armPose.leftShoulder, armPose.rightShoulder],
    ];

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = armStrokeColor;
    ctx.shadowColor = armStrokeColor;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.65;
    ctx.setLineDash([8, 6]);

    for (const [a, b] of segments) {
      if ((a.visibility ?? 0.8) < 0.35 || (b.visibility ?? 0.8) < 0.35) {
        continue;
      }
      const p1 = this.toScreenCoords(a, width, height);
      const p2 = this.toScreenCoords(b, width, height);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;

    const joints: Array<{ pt: Point3D; angleLabel?: string }> = [
      { pt: armPose.leftShoulder },
      { pt: armPose.rightShoulder },
      {
        pt: armPose.leftElbow,
        angleLabel:
          armKinematics?.leftForearmAngleDeg != null
            ? `${armKinematics.leftForearmAngleDeg}°`
            : undefined,
      },
      {
        pt: armPose.rightElbow,
        angleLabel:
          armKinematics?.rightForearmAngleDeg != null
            ? `${armKinematics.rightForearmAngleDeg}°`
            : undefined,
      },
    ];

    for (const { pt, angleLabel } of joints) {
      if ((pt.visibility ?? 0.8) < 0.35) continue;
      const screenPt = this.toScreenCoords(pt, width, height);
      ctx.beginPath();
      ctx.arc(screenPt.x, screenPt.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = armStrokeColor;
      ctx.stroke();

      if (angleLabel) {
        ctx.font = '700 11px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(angleLabel, screenPt.x + 10, screenPt.y + 4);
      }
    }

    ctx.restore();
  }

  private drawClaspZoneFrame(
    ctx: CanvasRenderingContext2D,
    box: ClaspBoundingBox,
    width: number,
    height: number,
    isDualJoined: boolean,
    color: string
  ): void {
    const x1 = (1 - box.maxX) * width;
    const y1 = box.minY * height;
    const w = (box.maxX - box.minX) * width;
    const h = (box.maxY - box.minY) * height;
    const cornerLen = Math.min(22, w * 0.2, h * 0.2);

    ctx.save();
    ctx.strokeStyle = isDualJoined ? '#facc15' : color;
    ctx.shadowColor = isDualJoined ? '#facc15' : color;
    ctx.shadowBlur = isDualJoined ? 14 : 6;
    ctx.lineWidth = isDualJoined ? 2.8 : 1.8;

    ctx.beginPath();
    ctx.moveTo(x1, y1 + cornerLen);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 + cornerLen, y1);
    ctx.moveTo(x1 + w - cornerLen, y1);
    ctx.lineTo(x1 + w, y1);
    ctx.lineTo(x1 + w, y1 + cornerLen);
    ctx.moveTo(x1, y1 + h - cornerLen);
    ctx.lineTo(x1, y1 + h);
    ctx.lineTo(x1 + cornerLen, y1 + h);
    ctx.moveTo(x1 + w - cornerLen, y1 + h);
    ctx.lineTo(x1 + w, y1 + h);
    ctx.lineTo(x1 + w, y1 + h - cornerLen);
    ctx.stroke();

    if (isDualJoined) {
      ctx.font = '700 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#facc15';
      ctx.fillText('⚡ MÃOS CONECTADAS (CLASP ROI)', x1 + 6, Math.max(16, y1 - 6));
    }
    ctx.restore();
  }

  private drawHandSkeleton(
    ctx: CanvasRenderingContext2D,
    landmarks: Point3D[],
    width: number,
    height: number,
    auraColor: string
  ): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = auraColor;
    ctx.lineWidth = 3.8;

    ctx.beginPath();
    for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
      const p1 = this.toScreenCoords(landmarks[startIdx], width, height);
      const p2 = this.toScreenCoords(landmarks[endIdx], width, height);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#0f172a';
    for (let i = 0; i < landmarks.length; i++) {
      const pt = this.toScreenCoords(landmarks[i], width, height);
      const isTip = FINGERTIP_INDICES.has(i);
      const radius = isTip ? 6 : i === 0 ? 6.5 : 4;

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isTip ? '#ffffff' : auraColor;
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawDualHandChakraBridge(
    ctx: CanvasRenderingContext2D,
    palmA: { x: number; y: number },
    palmB: { x: number; y: number },
    isResonant: boolean,
    color: string
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(palmA.x, palmA.y);
    ctx.lineTo(palmB.x, palmB.y);

    ctx.strokeStyle = isResonant ? '#facc15' : color;
    ctx.shadowColor = isResonant ? '#facc15' : color;
    ctx.shadowBlur = isResonant ? 20 : 8;
    ctx.lineWidth = isResonant ? 3.5 : 1.5;
    ctx.setLineDash(isResonant ? [] : [6, 6]);
    ctx.stroke();

    if (isResonant) {
      const midX = (palmA.x + palmB.x) / 2;
      const midY = (palmA.y + palmB.y) / 2;
      ctx.beginPath();
      ctx.arc(midX, midY, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
      ctx.fill();
    }
    ctx.restore();
  }

  private drawStabilityGateRing(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    progress: number,
    color: string,
    label: string
  ): void {
    const radius = 56;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * progress;

    ctx.save();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.font = '700 13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 6;
    ctx.fillText(label, cx, cy - radius - 12);

    ctx.restore();
  }

  private updateAndDrawParticles(ctx: CanvasRenderingContext2D): void {
    if (this.particles.length === 0) return;

    ctx.save();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= 0.024;

      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fill();
    }
    ctx.restore();
  }
}
