# -*- coding: utf-8 -*-
"""Step 1 · Audio-First：edge-tts 逐句合成旁白 → 实测时长 → 反推每幕帧数与字幕逐字时间轴.

输出：
  build/tts/*.wav           逐句旁白（48k 单声道，已裁掉首尾静音）
  build/narration.wav       整片旁白轨（按帧精确摆放）
  build/timing.json         时间轴（供混音/渲染使用）
  web/timing.js             同上（供 HTML 动画读取）
"""
import asyncio, json, os, re, subprocess, sys, wave
import numpy as np
import edge_tts
import imageio_ffmpeg

sys.path.insert(0, os.path.dirname(__file__))
from script_data import *  # noqa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
TTS_DIR = os.path.join(BUILD, "tts")
os.makedirs(TTS_DIR, exist_ok=True)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
SR = 48000


def is_sig(ch):
    return ch.isalnum() or ("\u4e00" <= ch <= "\u9fff")


async def synth(text, mp3_path):
    comm = edge_tts.Communicate(text, VOICE, rate=RATE, boundary="WordBoundary")
    words = []
    with open(mp3_path, "wb") as f:
        async for ch in comm.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append({"t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7, "text": ch["text"]})
    return words


def decode(mp3, wav):
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", mp3, "-ac", "1", "-ar", str(SR), wav], check=True)
    with wave.open(wav) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return data


def write_wav(path, data):
    data = np.clip(data, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((data * 32767).astype(np.int16).tobytes())


def trim(data, words):
    thr = 10 ** (-42 / 20)
    env = np.convolve(np.abs(data), np.ones(240) / 240, mode="same")
    idx = np.where(env > thr)[0]
    a = max(0, idx[0] - int(0.02 * SR)); b = min(len(data), idx[-1] + int(0.06 * SR))
    off = a / SR
    for w in words:
        w["t"] = max(0.0, w["t"] - off)
    return data[a:b], words


def char_times(sentence, words, dur):
    """返回 sentence 每个字符的 (start, end) 时间."""
    n = len(sentence)
    st = [None] * n; en = [None] * n
    sig_idx = [i for i, c in enumerate(sentence) if is_sig(c)]
    sig_str = "".join(sentence[i].lower() for i in sig_idx)
    cur = 0
    for w in words:
        tok = "".join(c.lower() for c in w["text"] if is_sig(c))
        if not tok:
            continue
        pos = sig_str.find(tok, cur, cur + len(tok) + 8)
        if pos < 0:
            continue
        for k in range(len(tok)):
            i = sig_idx[pos + k]
            st[i] = w["t"] + w["d"] * k / len(tok)
            en[i] = w["t"] + w["d"] * (k + 1) / len(tok)
        cur = pos + len(tok)
    # 插值补齐未匹配的有效字符
    known = [i for i in sig_idx if st[i] is not None]
    for i in sig_idx:
        if st[i] is None:
            prev = [k for k in known if k < i]; nxt = [k for k in known if k > i]
            a = en[prev[-1]] if prev else 0.0
            b = st[nxt[0]] if nxt else dur
            st[i] = a; en[i] = max(a, b)
    # 标点继承前一个字符
    last = 0.0
    for i in range(n):
        if st[i] is None:
            st[i] = last; en[i] = last
        last = en[i]
    return st, en


async def main():
    sentences = []   # flat list for synthesis
    for si, sc in enumerate(SCENES):
        for ji, lines in enumerate(sc["sentences"]):
            sentences.append((si, ji, lines))

    results = {}
    for si, ji, lines in sentences:
        text = "".join(lines)
        tts_text = text.replace("——", "，").replace("「", "").replace("」", "")
        mp3 = os.path.join(TTS_DIR, f"s{si+1}_{ji+1}.mp3")
        wav = os.path.join(TTS_DIR, f"s{si+1}_{ji+1}.wav")
        for attempt in range(4):
            try:
                words = await synth(tts_text, mp3)
                break
            except Exception as e:  # 网络抖动重试
                print("retry", e); await asyncio.sleep(2)
        data = decode(mp3, wav)
        data, words = trim(data, words)
        write_wav(wav, data)
        results[(si, ji)] = (data, words)
        print(f"scene{si+1} sent{ji+1}: {len(data)/SR:.2f}s  {text}")

    # ---------- 反推时间轴 ----------
    timing = {"fps": FPS, "scenes": []}
    t_frame = 0
    clips = []
    for si, sc in enumerate(SCENES):
        pre = FIRST_PRE if si == 0 else PRE
        post = LAST_POST if si == len(SCENES) - 1 else POST
        local = pre
        cues = []
        sent_info = []
        for ji, lines in enumerate(sc["sentences"]):
            data, words = results[(si, ji)]
            dur = len(data) / SR
            # 句子起点吸附到帧网格
            local = round(local * FPS) / FPS
            clips.append((t_frame / FPS + local, data))
            text = "".join(lines)
            st, en = char_times(text, words, dur)
            pos = 0
            for li, line in enumerate(lines):
                seg = range(pos, pos + len(line))
                sig = [i for i in seg if is_sig(text[i])]
                cs = local + st[sig[0]]
                ce = local + en[sig[-1]]
                disp = re.sub(r"[，。、：；—]+$", "", line)
                cues.append({
                    "text": disp, "start": round(cs, 4), "end": round(ce, 4),
                    "chars": [round(local + st[i], 4) for i in range(pos, pos + len(disp))],
                    "sentence": ji, "lastInSentence": li == len(lines) - 1,
                })
                pos += len(line)
            sent_info.append({"start": round(local, 4), "end": round(local + dur, 4)})
            local += dur + GAP
        local = local - GAP + post
        frames = int(round(local * FPS))
        # 字幕显示区间：到下一行开始；句末行延长到下一句开始；全幕最后一行延到幕尾
        for k, c in enumerate(cues):
            if k + 1 < len(cues):
                nxt = cues[k + 1]["start"]
                c["hide"] = round(nxt - 0.02, 4)
            else:
                c["hide"] = round(min(frames / FPS - 0.25, c["end"] + 1.2), 4)
        timing["scenes"].append({
            "id": sc["id"], "title": sc["title"], "startFrame": t_frame, "frames": frames,
            "start": t_frame / FPS, "duration": frames / FPS, "cues": cues, "sentences": sent_info,
        })
        print(f"== {sc['id']} {frames} frames = {frames/FPS:.2f}s")
        t_frame += frames
    timing["totalFrames"] = t_frame
    timing["duration"] = t_frame / FPS
    timing["keywords"] = sorted(KEYWORDS, key=len, reverse=True)

    total = np.zeros(int(t_frame / FPS * SR) + SR, dtype=np.float32)
    for t0, data in clips:
        a = int(round(t0 * SR)); total[a:a + len(data)] += data
    total = total[: int(t_frame / FPS * SR)]
    write_wav(os.path.join(BUILD, "narration.wav"), total)

    with open(os.path.join(BUILD, "timing.json"), "w", encoding="utf-8") as f:
        json.dump(timing, f, ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, "web", "timing.js"), "w", encoding="utf-8") as f:
        f.write("window.TIMING = " + json.dumps(timing, ensure_ascii=False) + ";\n")
    print(f"TOTAL {t_frame} frames = {t_frame/FPS:.2f}s")


if __name__ == "__main__":
    os.makedirs(os.path.join(ROOT, "web"), exist_ok=True)
    asyncio.run(main())
