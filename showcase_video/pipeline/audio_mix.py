# -*- coding: utf-8 -*-
"""Step 2 · 音频工程：112 BPM F 大调 Sakura Lo-fi 电子木琴 BGM + 交互微音效 + 人声优先 Ducking 混音.

输出：
  build/bgm.wav          112 BPM 电子木琴 & 暖垫 Lo-fi BGM（立体声 48k）
  build/sfx.wav          帧级对齐的交互微音效轨（立体声 48k）
  build/master_audio.wav 最终混音轨（旁白 0dB + BGM -16dB + Ducking + SFX -8dB）
"""
import json, os, wave
import numpy as np
from scipy.signal import butter, lfilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
SR = 48000
BPM = 112.0
BEAT = 60.0 / BPM


def read_mono(path):
    with wave.open(path) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def write_stereo(path, L, R):
    n = min(len(L), len(R))
    st = np.empty((n, 2), dtype=np.float32)
    st[:, 0] = np.clip(L[:n], -0.98, 0.98)
    st[:, 1] = np.clip(R[:n], -0.98, 0.98)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((st * 32767.0).astype(np.int16).tobytes())


def add_at(bufL, bufR, t0, sig, gain=1.0, pan=0.0):
    i0 = int(round(t0 * SR))
    if i0 < 0 or i0 >= len(bufL):
        return
    n = min(len(sig), len(bufL) - i0)
    if n <= 0:
        return
    gL = gain * np.cos((pan + 1) * np.pi / 4)
    gR = gain * np.sin((pan + 1) * np.pi / 4)
    bufL[i0:i0 + n] += sig[:n] * gL
    bufR[i0:i0 + n] += sig[:n] * gR


def marimba(freq, dur=0.45):
    t = np.arange(int(dur * SR), dtype=np.float32) / SR
    att = 1.0 - np.exp(-t / 0.003)
    w = (np.sin(2 * np.pi * freq * t) * np.exp(-t * 8.5)
         + 0.32 * np.sin(2 * np.pi * freq * 4 * t) * np.exp(-t * 26.0)
         + 0.10 * np.sin(2 * np.pi * freq * 10 * t) * np.exp(-t * 65.0))
    return (w * att).astype(np.float32)


def warm_pad(freqs, dur):
    t = np.arange(int(dur * SR), dtype=np.float32) / SR
    env = np.minimum(t / 0.18, 1.0) * np.minimum((dur - t) / 0.25, 1.0)
    out = np.zeros_like(t)
    for f in freqs:
        out += np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * (f * 2.001) * t)
    return (out / max(1, len(freqs)) * env * 0.35).astype(np.float32)


# -------------------- 微音效合成器 --------------------
def make_sfx(kind, ev):
    rng = np.random.default_rng(int(round(ev.get("t", 0) * 1000)) % 99991 + 7)
    if kind in ("pop", "softpop"):
        d = 0.09 if kind == "pop" else 0.07
        t = np.arange(int(d * SR)) / SR
        f0, f1 = (320, 780) if kind == "pop" else (420, 680)
        ph = 2 * np.pi * (f0 * t + 0.5 * (f1 - f0) / d * t * t)
        return (np.sin(ph) * np.exp(-t * 32) * (1 - np.exp(-t * 700)) * (0.9 if kind == "pop" else 0.55)).astype(np.float32)
    if kind in ("tick", "click"):
        d = 0.032
        t = np.arange(int(d * SR)) / SR
        p = int(ev.get("p", 0)) % 6
        f = (1150 if kind == "tick" else 1480) + p * 65
        return ((np.sin(2 * np.pi * f * t) * 0.7 + rng.standard_normal(len(t)) * 0.18) * np.exp(-t * 130) * 0.65).astype(np.float32)
    if kind == "whoosh":
        d = 0.32
        t = np.arange(int(d * SR)) / SR
        n = rng.standard_normal(len(t)).astype(np.float32)
        b, a = butter(2, [350 / (SR / 2), 2600 / (SR / 2)], btype="band")
        w = lfilter(b, a, n)
        env = np.sin(np.pi * t / d) ** 1.6
        return (w * env * 0.55).astype(np.float32)
    if kind in ("chime", "ding", "lock", "outro"):
        notes = {
            "chime": ([523.25, 659.25, 783.99, 1046.5], 0.9, 0.055),
            "ding": ([880.0, 1318.5], 0.55, 0.03),
            "lock": ([349.23, 523.25, 698.46, 1046.5], 0.85, 0.04),
            "outro": ([349.23, 440.0, 523.25, 659.25, 783.99, 1174.66], 2.6, 0.08),
        }[kind]
        freqs, d, step = notes
        out = np.zeros(int((d + 0.5) * SR), dtype=np.float32)
        for i, f in enumerate(freqs):
            m = marimba(f, d)
            i0 = int(i * step * SR)
            out[i0:i0 + len(m)] += m * (0.55 / np.sqrt(len(freqs)))
        return out
    if kind == "blip":
        f = float(ev.get("p", 659.25))
        return (marimba(f, 0.22) * 0.75).astype(np.float32)
    if kind == "bloop":
        d = 0.13
        t = np.arange(int(d * SR)) / SR
        ph = 2 * np.pi * (380 * t + 1800 * t * t)
        return (np.sin(ph) * np.exp(-t * 22) * 0.75).astype(np.float32)
    if kind in ("boop", "error"):
        d = 0.28
        t = np.arange(int(d * SR)) / SR
        w = (np.sin(2 * np.pi * 240 * t) + 0.6 * np.sin(2 * np.pi * 228 * t)) * np.exp(-t * 9)
        return (w * 0.55).astype(np.float32)
    if kind == "glass":
        out = np.zeros(int(0.75 * SR), dtype=np.float32)
        for i, f in enumerate([1567.98, 2093.0, 2637.0, 3135.96, 3951.07]):
            m = marimba(f, 0.45) * 0.35
            i0 = int(i * 0.035 * SR)
            out[i0:i0 + len(m)] += m
        return out
    if kind in ("scratch", "chalk", "zip"):
        d = float(ev.get("dur", 0.28 if kind != "zip" else 0.42))
        t = np.arange(int(d * SR)) / SR
        n = rng.standard_normal(len(t)).astype(np.float32)
        b, a = butter(2, [1200 / (SR / 2), 5200 / (SR / 2)], btype="band")
        w = lfilter(b, a, n)
        mod = 0.55 + 0.45 * np.sin(2 * np.pi * (28 if kind == "zip" else 16) * t)
        return (w * mod * np.sin(np.pi * t / d) * 0.35).astype(np.float32)
    if kind == "radar":
        d = 0.55
        t = np.arange(int(d * SR)) / SR
        return (np.sin(2 * np.pi * 1046.5 * t) * np.exp(-t * 6.5) * 0.45).astype(np.float32)
    if kind == "rise":
        d = 1.05
        t = np.arange(int(d * SR)) / SR
        ph = 2 * np.pi * (260 * t + 320 * t * t)
        return (np.sin(ph) * np.sin(np.pi * t / d) * 0.45).astype(np.float32)
    if kind in ("kick", "thud", "stamp"):
        d = 0.18
        t = np.arange(int(d * SR)) / SR
        ph = 2 * np.pi * (135 * t * np.exp(-t * 14) + 48 * t)
        return (np.sin(ph) * np.exp(-t * 16) * 0.85).astype(np.float32)
    if kind == "clap":
        d = 0.12
        t = np.arange(int(d * SR)) / SR
        n = rng.standard_normal(len(t)).astype(np.float32)
        b, a = butter(2, [800 / (SR / 2), 3800 / (SR / 2)], btype="band")
        return (lfilter(b, a, n) * np.exp(-t * 28) * 0.65).astype(np.float32)
    if kind == "drone":
        d = min(float(ev.get("dur", 3.5)), 12.0)
        t = np.arange(int(d * SR)) / SR
        env = np.minimum(t / 0.4, 1.0) * np.minimum((d - t) / 0.25, 1.0)
        return ((np.sin(2 * np.pi * 73.4 * t) + 0.5 * np.sin(2 * np.pi * 110.0 * t)) * env * 0.22).astype(np.float32)
    return np.zeros(128, dtype=np.float32)


# -------------------- 112 BPM F 大调电子木琴 BGM --------------------
def build_bgm(total_sec, music_start, outro_t):
    N = int(total_sec * SR) + SR
    L = np.zeros(N, dtype=np.float32)
    R = np.zeros(N, dtype=np.float32)
    # Fmaj7 -> Dm7 -> Gm7 -> C9（温暖轻快 F 大调进行）
    prog_chords = [
        ([174.61, 220.00, 261.63, 329.63], [523.25, 587.33, 659.25, 783.99, 880.00, 659.25, 587.33, 523.25]),
        ([146.83, 174.61, 220.00, 261.63], [440.00, 523.25, 587.33, 698.46, 659.25, 587.33, 523.25, 440.00]),
        ([196.00, 233.08, 293.66, 349.23], [466.16, 587.33, 698.46, 783.99, 698.46, 587.33, 523.25, 587.33]),
        ([130.81, 164.81, 233.08, 293.66], [523.25, 659.25, 783.99, 880.00, 783.99, 659.25, 587.33, 659.25]),
    ]
    bar_dur = 4 * BEAT
    t = music_start
    bar_idx = 0
    kick_sig = make_sfx("kick", {}) * 0.45
    tick_sig = make_sfx("tick", {"p": 2}) * 0.28
    while t < total_sec - 2.2:
        pad_freqs, arp = prog_chords[bar_idx % len(prog_chords)]
        pad = warm_pad(pad_freqs, bar_dur + 0.15)
        add_at(L, R, t, pad, gain=0.55, pan=0.0)
        # 轻柔 Lo-fi 律动
        for b in range(4):
            bt = t + b * BEAT
            if b in (0, 2):
                add_at(L, R, bt, kick_sig, gain=0.55)
            else:
                add_at(L, R, bt, tick_sig, gain=0.65)
        # 8 分音符木琴琶音
        for s_i, f in enumerate(arp):
            nt = t + s_i * (BEAT * 0.5)
            m = marimba(f, 0.42)
            pan = -0.35 if s_i % 2 == 0 else 0.35
            add_at(L, R, nt, m, gain=0.62, pan=pan)
            if s_i in (2, 6):
                add_at(L, R, nt + 0.02, marimba(f * 2, 0.28), gain=0.22, pan=-pan)
        t += bar_dur
        bar_idx += 1
    # 片尾 Fmaj9 温暖终止和弦 + 风铃余韵淡出至 0dB
    end_chord = warm_pad([174.61, 220.00, 261.63, 329.63, 392.00], 3.2)
    add_at(L, R, min(outro_t, total_sec - 3.3), end_chord, gain=0.75)
    for i, f in enumerate([349.23, 440.0, 523.25, 659.25, 783.99, 1046.5]):
        add_at(L, R, min(outro_t, total_sec - 3.3) + i * 0.08, marimba(f, 1.8), gain=0.45, pan=(i - 2.5) * 0.2)
    # 末尾平滑淡出至静音
    fade_len = int(1.6 * SR)
    end_i = int(total_sec * SR)
    if end_i > fade_len:
        fade = np.linspace(1.0, 0.0, fade_len, dtype=np.float32) ** 1.5
        L[end_i - fade_len:end_i] *= fade
        R[end_i - fade_len:end_i] *= fade
        L[end_i:] = 0; R[end_i:] = 0
    return L[:end_i], R[:end_i]


def main(sfx_events=None):
    with open(os.path.join(BUILD, "timing.json"), encoding="utf-8") as f:
        T = json.load(f)
    total_sec = T["duration"]
    narr = read_mono(os.path.join(BUILD, "narration.wav"))
    N = int(total_sec * SR)
    if len(narr) < N:
        narr = np.pad(narr, (0, N - len(narr)))
    narr = narr[:N]

    if sfx_events is None:
        sfx_path = os.path.join(BUILD, "sfx_events.json")
        sfx_events = json.load(open(sfx_path, encoding="utf-8")) if os.path.exists(sfx_path) else []

    music_start = 12.8
    outro_t = total_sec - 3.2
    for ev in sfx_events:
        if ev.get("type") == "music":
            music_start = ev["t"]
        elif ev.get("type") == "outro":
            outro_t = ev["t"]

    bgmL, bgmR = build_bgm(total_sec, music_start, outro_t)
    write_stereo(os.path.join(BUILD, "bgm.wav"), bgmL, bgmR)

    sfxL = np.zeros(N, dtype=np.float32)
    sfxR = np.zeros(N, dtype=np.float32)
    for ev in sfx_events:
        tp = ev.get("type", "")
        if tp == "music":
            continue
        sig = make_sfx(tp, ev)
        add_at(sfxL, sfxR, float(ev["t"]), sig, gain=float(ev.get("gain", 1.0)), pan=float(ev.get("pan", 0.0)))
    write_stereo(os.path.join(BUILD, "sfx.wav"), sfxL, sfxR)

    # 人声优先混音：旁白 0dB，BGM -16dB + 人声闪避 Ducking，SFX -8dB
    win = int(0.08 * SR)
    env = np.convolve(np.abs(narr), np.ones(win, dtype=np.float32) / win, mode="same")
    duck = 1.0 - 0.42 * np.clip(env / 0.06, 0.0, 1.0)
    g_bgm = (10 ** (-16.0 / 20.0)) * duck
    g_sfx = 10 ** (-8.0 / 20.0)
    mixL = narr * 0.96 + bgmL * g_bgm + sfxL * g_sfx
    mixR = narr * 0.96 + bgmR * g_bgm + sfxR * g_sfx
    peak = max(float(np.max(np.abs(mixL))), float(np.max(np.abs(mixR))), 1e-6)
    if peak > 0.96:
        mixL *= 0.96 / peak; mixR *= 0.96 / peak
    write_stereo(os.path.join(BUILD, "master_audio.wav"), mixL, mixR)
    print(f"Audio mixed: {total_sec:.2f}s, {len(sfx_events)} SFX events, peak={peak:.3f}")


if __name__ == "__main__":
    main()
