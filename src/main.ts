import './style.css';
import { JUTSU_RECIPES, SEAL_LIST, SEALS_BY_ID } from './data/jutsus';
import { JutsuSequenceEngine } from './engine/jutsuEngine';
import { ninjaAudio } from './engine/soundEffects';
import type {
  DetectedHand,
  FingerExtensionMap,
  HandConnectionMode,
  JutsuRecipe,
  SealClassificationResult,
  SealId,
  StabilityGateState,
} from './types/jutsu';
import { NinjaHudCanvasRenderer } from './ui/hudRenderer';
import { NinjaHandTracker } from './vision/handTracker';
import { HybridSealCalibrator } from './vision/hybridCalibrator';
import {
  type DanceJudgmentRating,
  evaluateKinectTargetSeal,
  HandMotionResetGate,
} from './vision/kinectAssist';
import { classifyHandSeal } from './vision/sealClassifier';
import { SealStabilityGate } from './vision/stabilityGate';

const CALIBRATION_DURATION_MS = 1600;
type GameMode = 'just-dance' | 'free-sandbox';

class ShinobiHandsApp {
  private readonly videoEl = document.getElementById('webcamVideo') as HTMLVideoElement;
  private readonly canvasEl = document.getElementById('hudCanvas') as HTMLCanvasElement;
  private readonly ctx = this.canvasEl.getContext('2d')!;
  private readonly placeholderEl = document.getElementById('cameraPlaceholder') as HTMLElement;
  private readonly statusBadgeEl = document.getElementById('trackingStatusBadge') as HTMLElement;
  private readonly statusTextEl = document.getElementById('trackingStatusText') as HTMLElement;
  private readonly playerScoreTextEl = document.getElementById('playerScoreText') as HTMLElement;
  private readonly playerStreakTextEl = document.getElementById('playerStreakText') as HTMLElement;

  private readonly toggleCameraBtn = document.getElementById('toggleCameraBtn') as HTMLButtonElement;
  private readonly startCameraHeroBtn = document.getElementById('startCameraHeroBtn') as HTMLButtonElement;
  private readonly toggleAudioBtn = document.getElementById('toggleAudioBtn') as HTMLButtonElement;
  private readonly gameModeSelect = document.getElementById('gameModeSelect') as HTMLSelectElement;
  private readonly handModeSelect = document.getElementById('handModeSelect') as HTMLSelectElement;
  private readonly gateSpeedSelect = document.getElementById('gateSpeedSelect') as HTMLSelectElement;
  private readonly clearComboBtn = document.getElementById('clearComboBtn') as HTMLButtonElement;
  private readonly resetCalibrationBtn = document.getElementById('resetCalibrationBtn') as HTMLButtonElement;

  private readonly telemetryHeaderLabelEl = document.getElementById('telemetryHeaderLabel') as HTMLElement;
  private readonly currentSealEmojiEl = document.getElementById('currentSealEmoji') as HTMLElement;
  private readonly currentSealNameEl = document.getElementById('currentSealName') as HTMLElement;
  private readonly currentSealConfidenceEl = document.getElementById('currentSealConfidence') as HTMLElement;
  private readonly gateProgressBarEl = document.getElementById('gateProgressBar') as HTMLElement;
  private readonly fingerPillsContainer = document.getElementById('fingerPillsContainer') as HTMLElement;
  private readonly dualHandBadgeEl = document.getElementById('dualHandBadge') as HTMLElement;

  private readonly danceJudgmentPopupEl = document.getElementById('danceJudgmentPopup') as HTMLElement;
  private readonly danceJudgmentTextEl = document.getElementById('danceJudgmentText') as HTMLElement;

  private readonly justDanceStagePanelEl = document.getElementById('justDanceStagePanel') as HTMLElement;
  private readonly targetJutsuTitleEl = document.getElementById('targetJutsuTitle') as HTMLElement;
  private readonly targetJutsuSubtitleEl = document.getElementById('targetJutsuSubtitle') as HTMLElement;
  private readonly justDanceStepsContainerEl = document.getElementById('justDanceStepsContainer') as HTMLElement;
  private readonly prevJutsuBtn = document.getElementById('prevJutsuBtn') as HTMLButtonElement;
  private readonly randomJutsuBtn = document.getElementById('randomJutsuBtn') as HTMLButtonElement;
  private readonly nextJutsuBtn = document.getElementById('nextJutsuBtn') as HTMLButtonElement;

  private readonly freeComboSectionEl = document.getElementById('freeComboSection') as HTMLElement;

  private readonly calibrationOverlayEl = document.getElementById('calibrationOverlay') as HTMLElement;
  private readonly calibrationTitleEl = document.getElementById('calibrationTitle') as HTMLElement;
  private readonly calibrationSubtitleEl = document.getElementById('calibrationSubtitle') as HTMLElement;
  private readonly calibrationProgressBarEl = document.getElementById('calibrationProgressBar') as HTMLElement;

  private readonly jutsuBannerEl = document.getElementById('jutsuBanner') as HTMLElement;
  private readonly jutsuBannerElementEl = document.getElementById('jutsuBannerElement') as HTMLElement;
  private readonly jutsuBannerNameJpEl = document.getElementById('jutsuBannerNameJp') as HTMLElement;
  private readonly jutsuBannerNamePtEl = document.getElementById('jutsuBannerNamePt') as HTMLElement;

  private readonly activeSequenceSlotsEl = document.getElementById('activeSequenceSlots') as HTMLElement;
  private readonly comboTimeoutBarEl = document.getElementById('comboTimeoutBar') as HTMLElement;
  private readonly sealDeckGridEl = document.getElementById('sealDeckGrid') as HTMLElement;
  private readonly jutsuListContainerEl = document.getElementById('jutsuListContainer') as HTMLElement;
  private readonly jutsuHistoryContainerEl = document.getElementById('jutsuHistoryContainer') as HTMLElement;

  private readonly handTracker = new NinjaHandTracker();
  private readonly stabilityGate = new SealStabilityGate({ holdDurationMs: 150 });
  private readonly motionResetGate = new HandMotionResetGate();
  private readonly hybridCalibrator = new HybridSealCalibrator();
  private readonly jutsuEngine = new JutsuSequenceEngine(JUTSU_RECIPES);
  private readonly hudRenderer = new NinjaHudCanvasRenderer();

  private mediaStream: MediaStream | null = null;
  private rafId: number | null = null;
  private isCameraRunning = false;
  private gameMode: GameMode = 'just-dance';
  private handConnectionMode: HandConnectionMode = 'clasped-hybrid';

  private targetJutsuIndex = 1;
  private danceStepIndex = 0;
  private danceStepRatings: DanceJudgmentRating[] = [];
  private danceChoreoStartMs = 0;
  private playerScore = 0;
  private playerStreak = 0;
  private lastDanceRating: DanceJudgmentRating = 'PERFECT';
  private judgmentPopupTimer: number | null = null;

  private activeJutsuBannerTimer: number | null = null;
  private activeJutsuRecipe: JutsuRecipe | null = null;
  private latestHands: DetectedHand[] = [];
  private calibratingSealId: SealId | null = null;
  private calibrationStartMs = 0;

  private latestGateState: StabilityGateState = {
    candidateSeal: null,
    progress: 0,
    lastConfirmedSeal: null,
    justConfirmedSeal: null,
    dualHandActive: false,
    confidence: 0,
  };

  public init(): void {
    this.renderSealDeck();
    this.renderJustDanceStage();
    this.renderSequenceSlots();
    this.renderJutsuGrimoire();
    this.bindEvents();
    this.startUiTicker();
  }

  private getTargetJutsu(): JutsuRecipe {
    return JUTSU_RECIPES[this.targetJutsuIndex] ?? JUTSU_RECIPES[0];
  }

  private getExpectedDanceSeal(): SealId | null {
    const recipe = this.getTargetJutsu();
    return recipe.seals[this.danceStepIndex] ?? null;
  }

  private selectDanceJutsu(index: number): void {
    const count = JUTSU_RECIPES.length;
    this.targetJutsuIndex = ((index % count) + count) % count;
    this.danceStepIndex = 0;
    this.danceStepRatings = [];
    this.danceChoreoStartMs = performance.now();
    this.stabilityGate.reset();
    this.motionResetGate.forceUnlock();
    this.renderJustDanceStage();
    this.renderJutsuGrimoire();
  }

  private bindEvents(): void {
    this.toggleCameraBtn.addEventListener('click', () => {
      void this.toggleCamera();
    });

    this.startCameraHeroBtn.addEventListener('click', () => {
      void this.startCamera();
    });

    this.toggleAudioBtn.addEventListener('click', () => {
      const nextMuted = !ninjaAudio.isMuted();
      ninjaAudio.setMuted(nextMuted);
      this.toggleAudioBtn.textContent = nextMuted ? '🔇 Som Mudo' : '🔊 Som Ativo';
    });

    this.gameModeSelect.addEventListener('change', () => {
      this.gameMode = this.gameModeSelect.value as GameMode;
      const isDance = this.gameMode === 'just-dance';
      this.justDanceStagePanelEl.classList.toggle('hidden', !isDance);
      this.freeComboSectionEl.classList.toggle('hidden', isDance);
      this.telemetryHeaderLabelEl.textContent = isDance
        ? 'ALVO ATUAL (KINECT ASSIST ATIVO)'
        : 'SELO DE MÃOS UNIDAS DETECTADO';
      this.stabilityGate.reset();
      this.motionResetGate.forceUnlock();
      this.renderJustDanceStage();
      this.renderJutsuGrimoire();
    });

    this.handModeSelect.addEventListener('change', () => {
      this.handConnectionMode = this.handModeSelect.value as HandConnectionMode;
      this.stabilityGate.reset();
    });

    this.gateSpeedSelect.addEventListener('change', () => {
      const ms = Number(this.gateSpeedSelect.value);
      this.stabilityGate.setHoldDurationMs(ms);
    });

    this.prevJutsuBtn.addEventListener('click', () => {
      this.selectDanceJutsu(this.targetJutsuIndex - 1);
    });

    this.nextJutsuBtn.addEventListener('click', () => {
      this.selectDanceJutsu(this.targetJutsuIndex + 1);
    });

    this.randomJutsuBtn.addEventListener('click', () => {
      let nextIdx = Math.floor(Math.random() * JUTSU_RECIPES.length);
      if (nextIdx === this.targetJutsuIndex) {
        nextIdx = (nextIdx + 1) % JUTSU_RECIPES.length;
      }
      this.selectDanceJutsu(nextIdx);
    });

    this.clearComboBtn.addEventListener('click', () => {
      this.clearCombo();
    });

    this.resetCalibrationBtn.addEventListener('click', () => {
      this.hybridCalibrator.clearAllCalibrations();
      this.renderSealDeck();
      this.setStatus('Calibrações IA resetadas para geometria padrão', this.isCameraRunning);
    });

    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'r' || ev.key === 'R' || ev.key === 'Escape') {
        this.clearCombo();
        return;
      }
      const num = Number(ev.key);
      if (num >= 1 && num <= SEAL_LIST.length) {
        const seal = SEAL_LIST[num - 1];
        this.motionResetGate.forceUnlock();
        this.handleConfirmedSeal(seal.id, performance.now(), 'PERFECT');
      }
    });

    window.addEventListener('beforeunload', () => {
      this.stopCamera();
      this.handTracker.dispose();
    });
  }

  private async toggleCamera(): Promise<void> {
    if (this.isCameraRunning) {
      this.stopCamera();
    } else {
      await this.startCamera();
    }
  }

  private async startCamera(): Promise<void> {
    if (this.isCameraRunning) return;

    try {
      this.setStatus('Inicializando MediaPipe + Kinect Assist...', false);
      this.toggleCameraBtn.disabled = true;
      this.startCameraHeroBtn.disabled = true;

      await this.handTracker.initialize((statusMsg) => {
        this.setStatus(statusMsg, false);
      });

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 60 },
          facingMode: 'user',
        },
        audio: false,
      });

      this.videoEl.srcObject = this.mediaStream;
      await this.videoEl.play();

      this.isCameraRunning = true;
      this.placeholderEl.classList.add('hidden');
      this.toggleCameraBtn.textContent = '⏹️ Pausar Câmera';
      this.setStatus('Kinect Assist Ativo (Mãos + Braços)', true);

      this.stabilityGate.reset();
      this.motionResetGate.forceUnlock();
      this.danceChoreoStartMs = performance.now();
      this.loopVisionFrame();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Permissão de câmera negada ou indisponível';
      this.setStatus(`Erro: ${message}`, false);
    } finally {
      this.toggleCameraBtn.disabled = false;
      this.startCameraHeroBtn.disabled = false;
    }
  }

  private stopCamera(): void {
    this.isCameraRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    this.videoEl.srcObject = null;
    this.placeholderEl.classList.remove('hidden');
    this.toggleCameraBtn.textContent = '📷 Iniciar Câmera Ninja';
    this.setStatus('Câmera Desligada', false);
    this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
  }

  private startSealCalibration(sealId: SealId): void {
    if (!this.isCameraRunning) {
      void this.startCamera().then(() => {
        if (this.isCameraRunning) {
          this.beginCalibrationWindow(sealId);
        }
      });
      return;
    }
    this.beginCalibrationWindow(sealId);
  }

  private beginCalibrationWindow(sealId: SealId): void {
    const meta = SEALS_BY_ID[sealId];
    this.calibratingSealId = sealId;
    this.calibrationStartMs = performance.now();
    this.hybridCalibrator.startRecording(sealId);

    this.calibrationTitleEl.textContent = `Calibrando ${meta.emoji} ${meta.namePt} (${meta.kanji}) com as 2 Mãos Unidas`;
    this.calibrationSubtitleEl.textContent = `${meta.gestureHint} — mantenha as mãos unidas na câmera!`;
    this.calibrationProgressBarEl.style.width = '0%';
    this.calibrationOverlayEl.classList.remove('hidden');
  }

  private loopVisionFrame = (): void => {
    if (!this.isCameraRunning) return;

    const nowMs = performance.now();
    this.syncCanvasDimensions();

    const detectedHands = this.handTracker.detectFrame(this.videoEl, nowMs);
    let currentClaspBox = null;

    if (detectedHands !== null) {
      this.latestHands = detectedHands;

      if (this.calibratingSealId !== null) {
        const elapsed = nowMs - this.calibrationStartMs;
        const progress = Math.min(1, elapsed / CALIBRATION_DURATION_MS);
        this.calibrationProgressBarEl.style.width = `${Math.round(progress * 100)}%`;

        if (detectedHands.length > 0) {
          this.hybridCalibrator.addCalibrationFrame(
            this.calibratingSealId,
            detectedHands,
            this.videoEl
          );
        }

        if (progress >= 1) {
          const finishedSeal = this.calibratingSealId;
          const ok = this.hybridCalibrator.finalizeCalibration(finishedSeal);
          this.calibratingSealId = null;
          this.calibrationOverlayEl.classList.add('hidden');
          this.renderSealDeck();

          if (ok) {
            ninjaAudio.playSealConfirmed(3);
            this.setStatus(
              `Selo ${SEALS_BY_ID[finishedSeal].namePt} calibrado com sucesso!`,
              true
            );
          } else {
            this.setStatus(
              'Mãos não detectadas durante a calibração. Tente novamente!',
              true
            );
          }
        }
      } else {
        const armPose = this.handTracker.getLatestArmPose();
        const geoResult = classifyHandSeal(
          detectedHands,
          this.handConnectionMode,
          armPose
        );
        const strictOrHybridResult = this.resolveHybridClassification(
          geoResult,
          detectedHands
        );

        let effectiveResult = strictOrHybridResult;
        let coachingHint = '';

        const motionCheck = this.motionResetGate.checkAndUpdateLock(
          detectedHands,
          strictOrHybridResult.sealId,
          strictOrHybridResult.interHandDistance,
          nowMs
        );

        if (motionCheck.isBlockedByStillness) {
          effectiveResult = {
            ...strictOrHybridResult,
            sealId: null,
            confidence: 0,
          };
          coachingHint = motionCheck.reasonHint;
        } else if (this.gameMode === 'just-dance' && !this.activeJutsuRecipe) {
          const expectedSeal = this.getExpectedDanceSeal();
          if (expectedSeal) {
            const kinectEval = evaluateKinectTargetSeal(
              detectedHands,
              strictOrHybridResult,
              expectedSeal,
              armPose
            );
            effectiveResult = kinectEval.effectiveResult;
            coachingHint = kinectEval.coachingHint;
            if (kinectEval.matched) {
              this.lastDanceRating = kinectEval.rating;
            }
          }
        }

        currentClaspBox = effectiveResult.claspBox;
        this.latestGateState = this.stabilityGate.update(effectiveResult, nowMs);

        this.updateTelemetryDom(
          effectiveResult,
          detectedHands.length,
          this.latestGateState.progress,
          coachingHint
        );

        if (this.latestGateState.justConfirmedSeal) {
          const confirmed = this.latestGateState.justConfirmedSeal;
          this.motionResetGate.lockOnSealConfirmed(
            detectedHands,
            confirmed,
            effectiveResult.interHandDistance
          );
          this.handleConfirmedSeal(
            confirmed,
            nowMs,
            this.lastDanceRating
          );
        }

        this.hudRenderer.render(
          this.ctx,
          this.canvasEl.width,
          this.canvasEl.height,
          this.latestHands,
          this.latestGateState,
          this.activeJutsuRecipe,
          currentClaspBox,
          armPose,
          effectiveResult.armKinematics
        );
        this.rafId = requestAnimationFrame(this.loopVisionFrame);
        return;
      }
    }

    this.hudRenderer.render(
      this.ctx,
      this.canvasEl.width,
      this.canvasEl.height,
      this.latestHands,
      this.latestGateState,
      this.activeJutsuRecipe,
      currentClaspBox,
      this.handTracker.getLatestArmPose(),
      null
    );

    this.rafId = requestAnimationFrame(this.loopVisionFrame);
  };

  private resolveHybridClassification(
    geoResult: SealClassificationResult,
    hands: DetectedHand[]
  ): SealClassificationResult {
    if (this.handConnectionMode === 'strict-dual' && !geoResult.handsJoined) {
      return geoResult;
    }

    const calibratedMatch = this.hybridCalibrator.predict(hands, this.videoEl);
    if (
      calibratedMatch &&
      (calibratedMatch.confidence >= geoResult.confidence || !geoResult.sealId)
    ) {
      return {
        ...geoResult,
        sealId: calibratedMatch.sealId,
        confidence: calibratedMatch.confidence,
        source: 'calibrated-hybrid',
      };
    }

    return geoResult;
  }

  private handleConfirmedSeal(
    sealId: SealId,
    nowMs: number,
    rating: DanceJudgmentRating = 'PERFECT'
  ): void {
    const sealMeta = SEALS_BY_ID[sealId];
    this.hudRenderer.spawnBurst(
      this.canvasEl.width || 960,
      this.canvasEl.height || 540,
      sealMeta.colorHex,
      '#ffffff',
      22
    );

    if (this.gameMode === 'just-dance') {
      const expectedSeal = this.getExpectedDanceSeal();
      if (!expectedSeal || sealId !== expectedSeal) {
        return;
      }

      if (this.danceStepIndex === 0) {
        this.danceChoreoStartMs = nowMs;
      }

      this.danceStepRatings.push(rating);
      this.danceStepIndex++;
      this.playerStreak++;

      const pts =
        rating === 'PERFECT' ? 300 : rating === 'GREAT' ? 200 : 120;
      this.playerScore += pts + this.playerStreak * 20;
      this.updateScoreboardDom();
      this.showDanceJudgmentPopup(rating, pts);

      ninjaAudio.playSealConfirmed(this.danceStepIndex);
      this.stabilityGate.reset();

      const targetRecipe = this.getTargetJutsu();
      if (this.danceStepIndex >= targetRecipe.seals.length) {
        this.playerScore += 1000;
        this.updateScoreboardDom();
        this.showDanceJudgmentPopup('PERFECT', 1000, '★ YEAH! JUTSU COMPLETO! +1000');

        this.jutsuEngine.clearSequence();
        targetRecipe.seals.forEach((s, idx) => {
          this.jutsuEngine.pushSeal(
            s,
            idx === 0 ? this.danceChoreoStartMs : nowMs
          );
        });

        this.triggerJutsuCelebration(targetRecipe, true);
        this.renderHistory();
      }

      this.renderJustDanceStage();
      this.renderJutsuGrimoire();
      return;
    }

    const pushResult = this.jutsuEngine.pushSeal(sealId, nowMs);
    ninjaAudio.playSealConfirmed(pushResult.sequence.length);

    if (pushResult.completedJutsu) {
      this.playerScore += 1000;
      this.playerStreak++;
      this.updateScoreboardDom();
      this.triggerJutsuCelebration(pushResult.completedJutsu, false);
      this.renderHistory();
    }

    this.renderSequenceSlots();
    this.renderJutsuGrimoire();
  }

  private showDanceJudgmentPopup(
    rating: DanceJudgmentRating,
    pts: number,
    customLabel?: string
  ): void {
    const emoji =
      rating === 'PERFECT' ? '✨ PERFECT!' : rating === 'GREAT' ? '🔥 GREAT!' : '👍 GOOD!';
    this.danceJudgmentTextEl.textContent = customLabel ?? `${emoji} +${pts}`;
    this.danceJudgmentPopupEl.classList.remove('hidden');

    if (this.judgmentPopupTimer !== null) {
      window.clearTimeout(this.judgmentPopupTimer);
    }
    this.judgmentPopupTimer = window.setTimeout(() => {
      this.danceJudgmentPopupEl.classList.add('hidden');
    }, 1100);
  }

  private updateScoreboardDom(): void {
    this.playerScoreTextEl.textContent = `⭐ ${this.playerScore} pts`;
    this.playerStreakTextEl.textContent = `🔥 ${this.playerStreak}x`;
  }

  private triggerJutsuCelebration(
    recipe: JutsuRecipe,
    autoAdvanceNextDance: boolean
  ): void {
    this.activeJutsuRecipe = recipe;
    ninjaAudio.playJutsuActivated(recipe.element);

    this.hudRenderer.spawnBurst(
      this.canvasEl.width || 960,
      this.canvasEl.height || 540,
      recipe.colorPrimary,
      recipe.colorSecondary,
      65
    );

    this.jutsuBannerElementEl.textContent = `${recipe.elementLabel} · RANK ${recipe.rank}`;
    this.jutsuBannerNameJpEl.textContent = recipe.nameJp;
    this.jutsuBannerNamePtEl.textContent = recipe.namePt;
    this.jutsuBannerEl.classList.remove('hidden');

    if (this.activeJutsuBannerTimer !== null) {
      window.clearTimeout(this.activeJutsuBannerTimer);
    }
    this.activeJutsuBannerTimer = window.setTimeout(() => {
      this.jutsuBannerEl.classList.add('hidden');
      this.activeJutsuRecipe = null;
      if (autoAdvanceNextDance && this.gameMode === 'just-dance') {
        this.selectDanceJutsu(this.targetJutsuIndex + 1);
      }
    }, 2400);
  }

  private clearCombo(): void {
    this.jutsuEngine.clearSequence();
    this.danceStepIndex = 0;
    this.danceStepRatings = [];
    this.stabilityGate.reset();
    this.renderJustDanceStage();
    this.renderSequenceSlots();
    this.renderJutsuGrimoire();
  }

  private startUiTicker(): void {
    window.setInterval(() => {
      if (this.gameMode === 'free-sandbox') {
        const nowMs = performance.now();
        const expired = this.jutsuEngine.checkExpiration(nowMs);
        if (expired) {
          this.renderSequenceSlots();
          this.renderJutsuGrimoire();
        }
        const ratio = this.jutsuEngine.getRemainingTimeoutRatio(nowMs);
        this.comboTimeoutBarEl.style.width = `${Math.round(ratio * 100)}%`;
      }
    }, 100);
  }

  private updateTelemetryDom(
    result: SealClassificationResult,
    handCount: number,
    gateProgress: number,
    coachingHint = ''
  ): void {
    const {
      sealId,
      confidence,
      primaryFingers,
      handsJoined,
      armKinematics,
      source,
    } = result;

    if (this.gameMode === 'just-dance') {
      const expectedSeal = this.getExpectedDanceSeal();
      if (expectedSeal) {
        const expMeta = SEALS_BY_ID[expectedSeal];
        this.currentSealEmojiEl.textContent = expMeta.emoji;
        this.currentSealNameEl.textContent = `Faça: ${expMeta.namePt} (${expMeta.kanji})`;
        this.currentSealConfidenceEl.textContent =
          sealId === expectedSeal
            ? `✨ Reconhecendo ${expMeta.namePt} (${Math.round(confidence * 100)}%)!`
            : coachingHint || expMeta.gestureHint;
      }
    } else if (sealId) {
      const meta = SEALS_BY_ID[sealId];
      const sourceTag = source === 'calibrated-hybrid' ? ' · 🎯 IA Híbrida' : '';
      this.currentSealEmojiEl.textContent = meta.emoji;
      this.currentSealNameEl.textContent = `${meta.namePt} (${meta.nameJp} · ${meta.kanji})`;
      this.currentSealConfidenceEl.textContent = `Confiança: ${Math.round(confidence * 100)}%${sourceTag}`;
    } else {
      this.currentSealEmojiEl.textContent = '—';
      this.currentSealNameEl.textContent =
        handCount > 0 ? 'Transição de selo...' : 'Aguardando mãos';
      this.currentSealConfidenceEl.textContent = 'Confiança: 0%';
    }

    this.gateProgressBarEl.style.width = `${Math.round(gateProgress * 100)}%`;

    const pillEls = this.fingerPillsContainer.querySelectorAll<HTMLElement>('[data-finger]');
    pillEls.forEach((el) => {
      const key = el.dataset.finger as keyof FingerExtensionMap;
      const isExtended = primaryFingers ? primaryFingers[key] : false;
      el.classList.toggle('extended', isExtended);
    });

    const deckCards = this.sealDeckGridEl.querySelectorAll<HTMLElement>('[data-seal-id]');
    deckCards.forEach((card) => {
      card.classList.toggle('active-detected', card.dataset.sealId === sealId);
    });

    const armTag =
      armKinematics.posture === 'asymmetric-cross'
        ? ` · 💪 Braços em Cruz (Δ${armKinematics.angleDiffDeg ?? 0}°)`
        : armKinematics.posture === 'symmetric-aligned'
          ? ` · 💪 Braços Simétricos (Δ${armKinematics.angleDiffDeg ?? 0}°)`
          : '';

    if (handsJoined) {
      this.dualHandBadgeEl.textContent = `⚡ Mãos Conectadas${armTag}`;
      this.dualHandBadgeEl.classList.add('resonant');
    } else if (handCount >= 2) {
      this.dualHandBadgeEl.textContent = `👐 2 Mãos Visíveis${armTag}`;
      this.dualHandBadgeEl.classList.remove('resonant');
    } else if (handCount === 1) {
      this.dualHandBadgeEl.textContent = `🧘 Kinect Assist Ativo${armTag}`;
      this.dualHandBadgeEl.classList.remove('resonant');
    } else {
      this.dualHandBadgeEl.textContent = '👐 Aguardando mãos e braços na câmera';
      this.dualHandBadgeEl.classList.remove('resonant');
    }
  }

  private renderJustDanceStage(): void {
    const recipe = this.getTargetJutsu();
    this.targetJutsuTitleEl.textContent = recipe.namePt;
    this.targetJutsuSubtitleEl.textContent = `${recipe.nameJp} · ${recipe.elementLabel} · RANK ${recipe.rank}`;

    this.justDanceStepsContainerEl.innerHTML = '';

    recipe.seals.forEach((sealId, idx) => {
      const meta = SEALS_BY_ID[sealId];
      const isDone = idx < this.danceStepIndex;
      const isCurrent = idx === this.danceStepIndex;
      const stepRating = this.danceStepRatings[idx];

      const card = document.createElement('div');
      card.className = `dance-step-card ${isDone ? 'step-completed' : ''} ${isCurrent ? 'step-current' : ''}`;
      card.style.cursor = 'pointer';
      card.title = 'Clique para simular este passo da coreografia';

      const statusLabel = isDone
        ? `✓ ${stepRating ?? 'PERFECT'}!`
        : isCurrent
          ? '👉 FAÇA AGORA!'
          : `PASSO ${idx + 1}`;

      card.innerHTML = `
        <div class="dance-step-top">
          <span>PASSO ${idx + 1}/${recipe.seals.length}</span>
          <span>${statusLabel}</span>
        </div>
        <div class="dance-step-main">
          <span class="dance-step-emoji">${meta.emoji}</span>
          <div>
            <div class="dance-step-name">${meta.namePt}</div>
            <div class="dance-step-kanji">${meta.nameJp} · ${meta.kanji}</div>
          </div>
        </div>
        <div class="dance-step-hint">${meta.gestureHint}</div>
      `;

      card.addEventListener('click', () => {
        if (isCurrent) {
          this.handleConfirmedSeal(sealId, performance.now(), 'PERFECT');
        }
      });

      this.justDanceStepsContainerEl.appendChild(card);
    });
  }

  private renderSealDeck(): void {
    this.sealDeckGridEl.innerHTML = '';
    SEAL_LIST.forEach((seal, idx) => {
      const isCalibrated = this.hybridCalibrator.isSealCalibrated(seal.id);
      const card = document.createElement('div');
      card.className = 'seal-card-btn';
      card.dataset.sealId = seal.id;

      card.innerHTML = `
        <div class="seal-card-clickable" data-sim-seal="${seal.id}">
          <div class="seal-card-top">
            <span>${seal.emoji} ${seal.namePt}</span>
            <span class="seal-card-kanji">${idx + 1} · ${seal.kanji}</span>
          </div>
          <div class="seal-card-hint">${seal.gestureHint}</div>
        </div>
        <div class="seal-card-footer">
          <button type="button" class="calibrate-mini-btn ${isCalibrated ? 'calibrated' : ''}" data-cal-seal="${seal.id}">
            ${isCalibrated ? '✓ IA 2 Mãos Salva' : '🎯 Calibrar 2 Mãos'}
          </button>
        </div>
      `;

      const simArea = card.querySelector<HTMLElement>('[data-sim-seal]')!;
      simArea.addEventListener('click', () => {
        this.handleConfirmedSeal(seal.id, performance.now(), 'PERFECT');
      });

      const calBtn = card.querySelector<HTMLButtonElement>('[data-cal-seal]')!;
      calBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.startSealCalibration(seal.id);
      });

      this.sealDeckGridEl.appendChild(card);
    });
  }

  private renderSequenceSlots(): void {
    const seq = this.jutsuEngine.getSequence();
    this.activeSequenceSlotsEl.innerHTML = '';

    if (seq.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'sequence-empty';
      empty.textContent =
        'Una as duas mãos na câmera fazendo um selo para iniciar o combo livre...';
      this.activeSequenceSlotsEl.appendChild(empty);
      return;
    }

    seq.forEach((sealId, idx) => {
      if (idx > 0) {
        const arrow = document.createElement('span');
        arrow.className = 'sequence-arrow';
        arrow.textContent = '→';
        this.activeSequenceSlotsEl.appendChild(arrow);
      }

      const meta = SEALS_BY_ID[sealId];
      const chip = document.createElement('div');
      chip.className = 'sequence-chip';
      chip.style.borderColor = meta.colorHex;
      chip.innerHTML = `<span>${meta.emoji}</span><span>${meta.namePt}</span><small>${meta.kanji}</small>`;
      this.activeSequenceSlotsEl.appendChild(chip);
    });
  }

  private renderJutsuGrimoire(): void {
    const statuses = this.jutsuEngine.computeMatchStatuses();
    const activeTargetId = this.getTargetJutsu().id;
    this.jutsuListContainerEl.innerHTML = '';

    statuses.forEach(({ recipe, matchedCount, nextSeal }, recipeIdx) => {
      const isSelectedTarget =
        this.gameMode === 'just-dance' && recipe.id === activeTargetId;
      const effectiveMatched = isSelectedTarget
        ? this.danceStepIndex
        : matchedCount;
      const effectiveNext = isSelectedTarget
        ? recipe.seals[this.danceStepIndex] ?? null
        : nextSeal;

      const card = document.createElement('div');
      card.className = `jutsu-card ${effectiveMatched > 0 ? 'in-progress' : ''} ${isSelectedTarget ? 'selected-dance-target' : ''}`;

      const stepsHtml = recipe.seals
        .map((sealId, idx) => {
          const meta = SEALS_BY_ID[sealId];
          let stepClass = 'recipe-step-pill';
          if (idx < effectiveMatched) {
            stepClass += ' step-done';
          } else if (idx === effectiveMatched && effectiveNext === sealId) {
            stepClass += ' step-next';
          }
          return `<span class="${stepClass}">${meta.emoji} ${meta.namePt}</span>`;
        })
        .join('');

      card.innerHTML = `
        <div class="jutsu-card-header">
          <div>
            <div class="jutsu-title-pt">${isSelectedTarget ? '🕺 ' : ''}${recipe.namePt}</div>
            <div class="jutsu-title-jp">${recipe.nameJp} · ${recipe.elementLabel}</div>
          </div>
          <span class="jutsu-rank-badge">RANK ${recipe.rank}</span>
        </div>
        <div class="jutsu-recipe-steps">${stepsHtml}</div>
      `;

      card.addEventListener('click', () => {
        this.selectDanceJutsu(recipeIdx);
      });

      this.jutsuListContainerEl.appendChild(card);
    });
  }

  private renderHistory(): void {
    const history = this.jutsuEngine.getHistory();
    this.jutsuHistoryContainerEl.innerHTML = '';

    if (history.length === 0) {
      this.jutsuHistoryContainerEl.innerHTML =
        '<p class="empty-history">Nenhum Jutsu lançado ainda. Complete a coreografia acima!</p>';
      return;
    }

    history.forEach((record) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.style.borderLeftColor = record.recipe.colorPrimary;
      const secs = (record.durationMs / 1000).toFixed(1);
      item.innerHTML = `
        <div>
          <strong>${record.recipe.namePt}</strong>
          <div class="jutsu-title-jp">${record.recipe.nameJp}</div>
        </div>
        <span class="history-item-time">⚡ ${secs}s</span>
      `;
      this.jutsuHistoryContainerEl.appendChild(item);
    });
  }

  private syncCanvasDimensions(): void {
    const rect = this.videoEl.getBoundingClientRect();
    const targetW = Math.max(1, Math.round(rect.width));
    const targetH = Math.max(1, Math.round(rect.height));
    if (this.canvasEl.width !== targetW || this.canvasEl.height !== targetH) {
      this.canvasEl.width = targetW;
      this.canvasEl.height = targetH;
    }
  }

  private setStatus(text: string, isActive: boolean): void {
    this.statusTextEl.textContent = text;
    this.statusBadgeEl.classList.toggle('status-active', isActive);
  }
}

const app = new ShinobiHandsApp();
app.init();
