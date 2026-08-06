"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Music, VolumeX } from "lucide-react";
import { Flipbook, type FlipbookPage } from "./flipbook";

/**
 * The homepage demo album — real pages from a real wedding album, bundled as
 * static assets so the demo needs no workspace, no B2, and no database.
 */
const DEMO_PAGES: FlipbookPage[] = [
  { kind: "cover", url: "/demo-album/cover.jpg", width: 1200, height: 800 },
  ...Array.from({ length: 8 }, (_, i) => ({
    kind: "spread" as const,
    url: `/demo-album/spread-${String(i + 1).padStart(2, "0")}.jpg`,
    width: 1600,
    height: 533,
  })),
  { kind: "back", url: "/demo-album/back.jpg", width: 1200, height: 800 },
];

/**
 * A soft ambient pad, synthesized with the Web Audio API.
 *
 * Generated rather than shipped as an MP3: nothing to license, nothing to
 * download, and it can start the instant the first page turns. Four warm
 * seventh chords in C major loop with long overlapping envelopes, low-pass
 * filtered so nothing sits above a whisper.
 */
const CHORDS: number[][] = [
  // Cmaj7
  [130.81, 261.63, 329.63, 392.0, 493.88],
  // Am7
  [110.0, 220.0, 261.63, 329.63, 392.0],
  // Fmaj7
  [87.31, 174.61, 220.0, 261.63, 329.63],
  // G6
  [98.0, 196.0, 246.94, 293.66, 329.63],
];
const CHORD_SECONDS = 5.2;
const MASTER_LEVEL = 0.05;

class AmbientPad {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chordIndex = 0;

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /** Must be called from a user gesture the first time. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // No Web Audio: the demo simply stays silent.

    this.ctx = new Ctor();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.4;

    this.master = this.ctx.createGain();
    // Fade the whole bed in over 2s rather than arriving mid-chord.
    this.master.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.master.gain.exponentialRampToValueAtTime(MASTER_LEVEL, this.ctx.currentTime + 2);

    this.master.connect(filter);
    filter.connect(this.ctx.destination);

    this.scheduleNext(this.ctx.currentTime + 0.05);
  }

  pause(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  private scheduleNext(when: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const chord = CHORDS[this.chordIndex % CHORDS.length]!;
    this.chordIndex += 1;

    for (const freq of chord) {
      // A detuned pair per note reads as warmth instead of an organ tone.
      for (const cents of [-4, 4]) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = freq;
        osc.detune.value = cents;

        const gain = ctx.createGain();
        const peak = (freq < 150 ? 0.5 : 0.28) / chord.length;
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(peak, when + 1.8);
        gain.gain.setValueAtTime(peak, when + CHORD_SECONDS - 0.4);
        // Long tail past the chord boundary, so changes are cross-fades.
        gain.gain.exponentialRampToValueAtTime(0.0001, when + CHORD_SECONDS + 2.6);

        osc.connect(gain);
        gain.connect(master);
        osc.start(when);
        osc.stop(when + CHORD_SECONDS + 2.8);
      }
    }

    // Schedule the following chord shortly before this one ends. setTimeout
    // drift doesn't matter — the precise timing lives in the audio clock.
    const delayMs = Math.max(0, (when + CHORD_SECONDS - ctx.currentTime - 0.5) * 1000);
    this.timer = setTimeout(() => this.scheduleNext(when + CHORD_SECONDS), delayMs);
  }
}

export function DemoAlbum() {
  const pad = useRef<AmbientPad | null>(null);
  const [musicOn, setMusicOn] = useState(false);
  // Only auto-start once: if the visitor turned music off, page turns must not
  // keep switching it back on.
  const autoStarted = useRef(false);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) pad.current?.pause();
      else if (musicOn) pad.current?.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [musicOn]);

  // Silence the pad when the demo scrolls away or the page unmounts.
  useEffect(() => () => pad.current?.dispose(), []);

  const startMusic = useCallback(() => {
    pad.current ??= new AmbientPad();
    pad.current.start();
    setMusicOn(true);
  }, []);

  const handleTurn = useCallback(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    startMusic();
  }, [startMusic]);

  const toggleMusic = useCallback(() => {
    autoStarted.current = true; // A manual choice always wins over auto-start.
    if (musicOn) {
      pad.current?.pause();
      setMusicOn(false);
    } else {
      startMusic();
    }
  }, [musicOn, startMusic]);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <Flipbook pages={DEMO_PAGES} onTurn={handleTurn} />

      <button
        type="button"
        onClick={toggleMusic}
        aria-pressed={musicOn}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
          musicOn
            ? "border-primary/50 text-primary"
            : "border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        {musicOn ? <VolumeX className="size-3.5" /> : <Music className="size-3.5" />}
        {musicOn ? "Turn music off" : "Play with music"}
      </button>
    </div>
  );
}
