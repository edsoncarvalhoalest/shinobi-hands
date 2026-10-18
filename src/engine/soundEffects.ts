import type { ChakraElement } from '../types/jutsu';

class NinjaSoundSynthesizer {
  private ctx: AudioContext | null = null;
  private muted = false;

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') {
      return null;
    }
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public playSealConfirmed(stepIndex: number): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const baseFreq = 220 + Math.min(stepIndex, 6) * 35;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * 1.8, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.65, now + 0.085);

    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);

    const chime = ctx.createOscillator();
    const chimeGain = ctx.createGain();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(baseFreq * 3.0, now);
    chimeGain.gain.setValueAtTime(0.12, now);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    chime.connect(chimeGain);
    chimeGain.connect(ctx.destination);
    chime.start(now);
    chime.stop(now + 0.15);
  }

  public playJutsuActivated(element: ChakraElement): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const scaleNotes =
      element === 'raiton'
        ? [523.25, 659.25, 783.99, 1046.5]
        : element === 'katon'
          ? [293.66, 349.23, 440.0, 587.33]
          : [329.63, 392.0, 493.88, 659.25];

    scaleNotes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = now + idx * 0.055;

      osc.type = element === 'raiton' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.02, startTime + 0.45);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.18, startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.55);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.58);
    });
  }
}

export const ninjaAudio = new NinjaSoundSynthesizer();
