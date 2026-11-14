import Phaser from 'phaser';

/**
 * Sound effects synthesised with Web Audio: no sound files, nothing to license.
 * Uses Phaser's audio context (Phaser unlocks it on the first click / key press).
 *  - rifleShot: a crack (filtered noise) + a low thump + a far echo (he is up on a tower)
 *  - gunBurst: one short, punchy machine-gun shot (called per burst)
 *  - boltAction: two metal clicks (bolt back, bolt forward): the sound of your window to run
 */

let noiseBuffer: AudioBuffer | null = null;

function context(scene: Phaser.Scene): AudioContext | null {
  const sound = scene.sound as Phaser.Sound.WebAudioSoundManager;
  return sound.context ?? null;
}

/** One second of white noise, shared by every shot. */
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

/** Disconnect a sound's nodes once it has died out (the echo is a feedback loop: it would live forever). */
function release(nodes: AudioNode[], seconds: number): void {
  setTimeout(() => {
    for (let i = 0; i < nodes.length; i++) nodes[i].disconnect();
  }, seconds * 1000);
}

/** Filtered noise with a fast attack and an exponential decay, into `out`. */
function crack(ctx: AudioContext, out: AudioNode, at: number, length: number, freq: number, volume: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 0.6;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(filter).connect(gain).connect(out);
  src.start(at, Math.random() * 0.5, length + 0.05);
}

/** A falling sine: the body of a gunshot. */
function thump(ctx: AudioContext, out: AudioNode, at: number, from: number, to: number, length: number, volume: number): void {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** A short metallic tick. */
function click(ctx: AudioContext, out: AudioNode, at: number, freq: number, volume: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.05);
  crack(ctx, out, at, 0.03, 3500, volume * 0.8);
}

export function rifleShot(scene: Phaser.Scene): void {
  const ctx = context(scene);
  if (!ctx) return;
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);
  crack(ctx, master, now, 0.22, 1400, 1);
  crack(ctx, master, now, 0.5, 300, 0.5); // low rumble
  thump(ctx, master, now, 110, 40, 0.25, 0.9);
  // the echo off the village walls: a delayed, darker copy that fades
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.21;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const dark = ctx.createBiquadFilter();
  dark.type = 'lowpass';
  dark.frequency.value = 1100;
  master.connect(delay);
  delay.connect(dark).connect(feedback).connect(delay);
  dark.connect(ctx.destination);
  release([master, delay, dark, feedback], 2.5);
}

export function gunBurst(scene: Phaser.Scene): void {
  const ctx = context(scene);
  if (!ctx) return;
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
  crack(ctx, master, now, 0.07, 1800, 1);
  thump(ctx, master, now, 160, 60, 0.08, 0.7);
  release([master], 0.5);
}

/** Bolt back, bolt forward: starts `delay` s from now (after the shot's echo). */
export function boltAction(scene: Phaser.Scene, delay: number): void {
  const ctx = context(scene);
  if (!ctx) return;
  const at = ctx.currentTime + delay;
  const master = ctx.createGain();
  master.gain.value = 0.25;
  master.connect(ctx.destination);
  click(ctx, master, at, 1900, 0.5);
  click(ctx, master, at + 0.32, 1500, 0.6);
  release([master], delay + 1);
}
