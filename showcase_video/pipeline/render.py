# -*- coding: utf-8 -*-
"""Step 3 · 60fps 矢量渲染器（解耦纯净母版 + 透明字幕覆盖层极速合成）.

用法：
  python pipeline/render.py                  # 若无纯净母版则先渲染无字幕母版，再用 PIL+FFmpeg ~20s 叠加干净整句字幕
  python pipeline/render.py --subs-only      # 已有母版，修改字幕/样式后 ~20s 极速重烧成品 MP4 并导出 .srt
  python pipeline/render.py --qa             # 仅导出 8 幕抽检帧
"""
import asyncio, json, math, os, subprocess, sys, time
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

sys.path.insert(0, os.path.dirname(__file__))
import audio_mix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
WEB_INDEX = "file:///" + os.path.join(ROOT, "web", "index.html").replace("\\", "/")
OUT_MP4 = os.path.join(os.path.dirname(ROOT), "SakuraFlow_Showcase.mp4")
CLEAN_MP4 = os.path.join(BUILD, "clean_master.mp4")
OUT_SRT = os.path.join(os.path.dirname(ROOT), "SakuraFlow_Showcase.srt")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
WORKERS = 16


def fmt_srt_time(sec):
    ms = int(round(max(0.0, sec) * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def export_srt():
    with open(os.path.join(BUILD, "timing.json"), encoding="utf-8") as f:
        T = json.load(f)
    lines = []
    idx = 1
    for sc in T["scenes"]:
        for cue in sc["cues"]:
            t0 = sc["start"] + cue["start"] - 0.05
            t1 = sc["start"] + cue["hide"]
            lines.append(f"{idx}\n{fmt_srt_time(t0)} --> {fmt_srt_time(t1)}\n{cue['text'].strip()}\n")
            idx += 1
    with open(OUT_SRT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Exported {idx - 1} SRT cues -> {OUT_SRT}")


def render_sub_card_png(text, path):
    """用 Pillow 渲染 1920x150 透明 PNG 干净整句胶囊字幕（与樱花瓷白视觉 100% 统一）."""
    W, H = 1920, 150
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    font = ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc", 40)
    draw_tmp = ImageDraw.Draw(img)
    bbox = draw_tmp.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad_x = 44
    pill_w = tw + pad_x * 2
    pill_h = 78
    x0 = (W - pill_w) // 2
    y0 = (H - pill_h) // 2 - 4
    x1, y1 = x0 + pill_w, y0 + pill_h
    # 柔阴影
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([x0, y0 + 6, x1, y1 + 6], radius=pill_h // 2, fill=(45, 22, 36, 30))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    img = Image.alpha_composite(img, shadow)
    # 瓷白胶囊本体 + 淡粉描边
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x0, y0, x1, y1], radius=pill_h // 2, fill=(255, 255, 255, 238), outline=(243, 212, 225, 255), width=2)
    # 居中深梅墨文字
    tx = (W - tw) // 2 - bbox[0]
    ty = y0 + (pill_h - th) // 2 - bbox[1] - 1
    d.text((tx, ty), text, font=font, fill=(45, 22, 36, 255))
    img.save(path)


def burn_subs_on_clean():
    """在无字幕纯净母版上极速叠加干净整句透明字幕层（~20s 完成，以后改字幕无需重渲动画）."""
    export_srt()
    if not os.path.exists(CLEAN_MP4):
        raise FileNotFoundError(f"Clean master not found: {CLEAN_MP4}")
    t0 = time.time()
    with open(os.path.join(BUILD, "timing.json"), encoding="utf-8") as f:
        T = json.load(f)
    sub_dir = os.path.join(BUILD, "sub_pngs")
    os.makedirs(sub_dir, exist_ok=True)
    # 生成空白透明帧
    blank_png = os.path.join(sub_dir, "blank.png")
    Image.new("RGBA", (1920, 150), (0, 0, 0, 0)).save(blank_png)
    # 构建时间轴序列（按秒精确切换，无逐字蹦）
    events = []
    for sc in T["scenes"]:
        for cue in sc["cues"]:
            events.append((sc["start"] + cue["start"] - 0.05, sc["start"] + cue["hide"], cue["text"].strip()))
    events.sort(key=lambda x: x[0])

    concat_lines = []
    cur = 0.0
    for idx, (s, e, txt) in enumerate(events):
        s = max(cur, s)
        if s > cur + 0.005:
            concat_lines.append(f"file '{blank_png.replace(chr(92), '/')}'\nduration {s - cur:.4f}\n")
        png = os.path.join(sub_dir, f"sub_{idx:03d}.png")
        render_sub_card_png(txt, png)
        dur = max(0.05, e - s)
        concat_lines.append(f"file '{png.replace(chr(92), '/')}'\nduration {dur:.4f}\n")
        cur = s + dur
    if T["duration"] > cur:
        concat_lines.append(f"file '{blank_png.replace(chr(92), '/')}'\nduration {T['duration'] - cur + 0.5:.4f}\n")
    concat_lines.append(f"file '{blank_png.replace(chr(92), '/')}'\n")
    sub_list = os.path.join(sub_dir, "subs_concat.txt")
    with open(sub_list, "w", encoding="utf-8") as f:
        f.writelines(concat_lines)

    # 仅叠加底部 1920x150 透明条（y=920），编码速度极快
    cmd = [
        FFMPEG, "-y", "-loglevel", "error",
        "-i", CLEAN_MP4,
        "-f", "concat", "-safe", "0", "-i", sub_list,
        "-filter_complex", "[0:v][1:v]overlay=0:920:shortest=1[v]",
        "-map", "[v]", "-map", "0:a",
        "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-movflags", "+faststart",
        OUT_MP4,
    ]
    subprocess.run(cmd, check=True)
    sz = os.path.getsize(OUT_MP4) / (1024 * 1024)
    print(f"SUBS BURNED -> {OUT_MP4} ({sz:.2f} MB) in {time.time() - t0:.1f}s")


async def export_qa_and_sfx(url_suffix=""):
    qa_dir = os.path.join(BUILD, "qa")
    os.makedirs(qa_dir, exist_ok=True)
    with open(os.path.join(BUILD, "timing.json"), encoding="utf-8") as f:
        T = json.load(f)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        await page.goto(WEB_INDEX + url_suffix)
        await page.wait_for_function("window.__ready === true")
        sfx = await page.evaluate("window.SFX_EVENTS")
        with open(os.path.join(BUILD, "sfx_events.json"), "w", encoding="utf-8") as f:
            json.dump(sfx, f, ensure_ascii=False, indent=1)
        for sc in T["scenes"]:
            for tag, ratio in [("mid", 0.42), ("late", 0.78)]:
                fr = sc["startFrame"] + int(sc["frames"] * ratio)
                await page.evaluate(f"window.renderFrame({fr})")
                out = os.path.join(qa_dir, f"{sc['id']}_{tag}_f{fr}.png")
                await page.screenshot(path=out, type="png")
        await browser.close()
    return sfx


async def render_chunk(browser, idx, f_start, f_end, seg_dir, url_suffix=""):
    page = await browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
    await page.goto(WEB_INDEX + url_suffix)
    await page.wait_for_function("window.__ready === true")
    seg_path = os.path.join(seg_dir, f"seg_{idx:02d}.mp4")
    cmd = [
        FFMPEG, "-y", "-loglevel", "error",
        "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", "60", "-i", "-",
        "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p",
        "-r", "60", seg_path,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    t0 = time.time()
    total = f_end - f_start
    for i, f in enumerate(range(f_start, f_end)):
        await page.evaluate(f"window.renderFrame({f})")
        buf = await page.screenshot(type="jpeg", quality=96)
        proc.stdin.write(buf)
        if (i + 1) % 240 == 0 or i + 1 == total:
            dt = time.time() - t0
            print(f"[worker {idx:02d}] {i+1}/{total} frames ({(i+1)/max(dt,1e-3):.1f} fps)", flush=True)
    proc.stdin.close()
    rc = proc.wait()
    await page.close()
    if rc != 0:
        raise RuntimeError(f"FFmpeg worker {idx} exited with {rc}")
    return seg_path


async def render_video_base(out_path, url_suffix="?nosub=1"):
    audio_path = os.path.join(BUILD, "master_audio.wav")
    if not os.path.exists(audio_path):
        sfx = await export_qa_and_sfx(url_suffix)
        audio_mix.main(sfx)
    with open(os.path.join(BUILD, "timing.json"), encoding="utf-8") as f:
        T = json.load(f)
    total_frames = T["totalFrames"]
    seg_dir = os.path.join(BUILD, "segments_clean")
    os.makedirs(seg_dir, exist_ok=True)
    step = math.ceil(total_frames / WORKERS)
    ranges = [(i, i * step, min(total_frames, (i + 1) * step)) for i in range(WORKERS) if i * step < total_frames]
    print(f"Rendering {total_frames} frames ({T['duration']:.2f}s @ 60fps, suffix='{url_suffix}') across {len(ranges)} workers...")
    t0 = time.time()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        segs = await asyncio.gather(*(render_chunk(browser, idx, a, b, seg_dir, url_suffix) for idx, a, b in ranges))
        await browser.close()
    list_file = os.path.join(seg_dir, "concat.txt")
    with open(list_file, "w", encoding="utf-8") as f:
        for s in segs:
            f.write("file '" + s.replace("\\", "/") + "'\n")
    cmd = [
        FFMPEG, "-y", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", list_file,
        "-i", audio_path,
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        "-shortest", out_path,
    ]
    subprocess.run(cmd, check=True)
    dt = time.time() - t0
    sz = os.path.getsize(out_path) / (1024 * 1024)
    print(f"CLEAN MASTER DONE -> {out_path} ({sz:.2f} MB) in {dt:.1f}s")


if __name__ == "__main__":
    if "--qa" in sys.argv:
        export_srt()
        asyncio.run(export_qa_and_sfx(""))
    elif "--subs-only" in sys.argv:
        burn_subs_on_clean()
    else:
        if not os.path.exists(CLEAN_MP4) or "--force-base" in sys.argv:
            asyncio.run(render_video_base(CLEAN_MP4, url_suffix="?nosub=1"))
        burn_subs_on_clean()
