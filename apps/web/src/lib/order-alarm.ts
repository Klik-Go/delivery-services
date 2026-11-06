"use client";

/**
 * The new-order alarm: a loud two-tone chime every 2.5 seconds (plus a vibration on phones) until
 * the store accepts or rejects every new order. Generated with Web Audio, so there is no sound file
 * to download. Browsers only allow audio after a tap: call unlock() from a click.
 */
export class OrderAlarm {
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  unlock(): void {
    this.context ??= new AudioContext();
    void this.context.resume();
  }

  start(): void {
    if (this.timer) return;
    this.ring();
    this.timer = setInterval(() => this.ring(), 2500);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private ring(): void {
    navigator.vibrate?.([300, 150, 300]);
    const context = this.context;
    if (!context || context.state !== "running") return;
    [880, 1320].forEach((frequency, i) => {
      const start = context.currentTime + i * 0.25;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.24);
    });
  }
}
