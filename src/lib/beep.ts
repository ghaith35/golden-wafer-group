"use client";

/// Tiny WebAudio beeps (no assets): add-to-cart blip + success chime.
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, ms: number, delay = 0, gain = 0.12) {
  const c = ac();
  if (!c) return;
  try {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(c.destination);
    const t = c.currentTime + delay;
    o.start(t);
    o.stop(t + ms / 1000);
  } catch { /* silent */ }
}

/// Short blip when a product lands in the facture.
export function beepAdd() {
  tone(880, 90);
}

/// Two-tone chime on confirm.
export function beepConfirm() {
  tone(660, 110);
  tone(990, 140, 0.12);
}
