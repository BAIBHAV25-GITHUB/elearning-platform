import { useEffect, useRef, useState } from "react";
import { Play, Pause, Maximize, Volume2, VolumeX, RotateCcw, RotateCw } from "lucide-react";
import { useProgressThrottler } from "../../hooks/useProgressThrottler";

// Plays several consecutive video parts (one `content` row each) as ONE continuous video:
//   * one seek bar / one clock covering the whole lesson
//   * the next part is preloaded while the current one plays, so the hand-over is seamless
//   * progress is still saved per part (same API / DB rules as before)
// Parts are expected in order, each with { content_id, video_url, duration_sec }.

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

const fmt = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

export default function LessonPlayer({
  parts,
  enrollmentId,
  positions = {},
  completedIds = new Set(),
  onProgressUpdate,
  onEnded,
  autoPlay = false,
}) {
  const durOf = (p) => Number(p.duration_sec) || 0;
  const offsets = [];
  let total = 0;
  parts.forEach((p) => {
    offsets.push(total);
    total += durOf(p);
  });

  // Where to start: first part not finished yet (at its saved position); a finished lesson restarts at 0.
  const [start] = useState(() => {
    const i = parts.findIndex((p) => !completedIds.has(p.content_id));
    if (i === -1) return { idx: 0, local: 0 };
    const saved = positions[parts[i].content_id] || 0;
    return { idx: i, local: saved > 0 && saved < durOf(parts[i]) - 5 ? saved : 0 };
  });

  const [idx, setIdx] = useState(start.idx);
  const [current, setCurrent] = useState(start.local); // seconds inside the current part
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [scrub, setScrub] = useState(null); // global seconds while dragging the bar
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const idxRef = useRef(idx);
  idxRef.current = idx;
  const els = useRef({}); // part index -> <video>
  const pendingSeek = useRef(start.local);
  const shouldPlay = useRef(autoPlay);
  const box = useRef(null);

  const part = parts[idx];
  const { sendHeartbeat } = useProgressThrottler(enrollmentId, part?.content_id, onProgressUpdate);

  const active = () => els.current[idxRef.current];

  // Whenever the active part changes: jump to the wanted time, keep playing if we were playing.
  useEffect(() => {
    const v = els.current[idx];
    if (!v) return;
    const go = () => {
      v.currentTime = pendingSeek.current || 0;
      pendingSeek.current = 0;
      v.playbackRate = speed;
      if (shouldPlay.current) v.play().catch(() => {});
    };
    if (v.readyState >= 1) go();
    else v.addEventListener("loadedmetadata", go, { once: true });
    return () => v.removeEventListener("loadedmetadata", go);
    // speed is applied separately below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  useEffect(() => {
    const v = active();
    if (v) v.playbackRate = speed;
  }, [speed, idx]);

  useEffect(() => {
    const v = active();
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
  }, [volume, muted, idx]);

  const globalTime = (offsets[idx] || 0) + current;

  const seekTo = (g) => {
    const t = Math.min(Math.max(0, g), Math.max(0, total - 0.5));
    let p = 0;
    for (let i = 0; i < parts.length; i++) if (offsets[i] <= t) p = i;
    const local = t - offsets[p];
    if (p === idxRef.current) {
      const v = active();
      if (v) v.currentTime = local;
      setCurrent(local);
    } else {
      const v = active();
      if (v) sendHeartbeat(v.currentTime, true); // save where we left the old part
      pendingSeek.current = local;
      shouldPlay.current = playing;
      setCurrent(local);
      setIdx(p);
    }
  };

  const togglePlay = () => {
    const v = active();
    if (!v) return;
    if (v.paused) {
      shouldPlay.current = true;
      v.play().catch(() => {});
    } else {
      shouldPlay.current = false;
      v.pause();
    }
  };

  const fullscreen = () => {
    const el = box.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const onKeyDown = (e) => {
    if (e.target.tagName === "SELECT") return;
    if (e.key === " " || e.key === "k") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); seekTo(globalTime + 10); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); seekTo(globalTime - 10); }
    else if (e.key === "f") fullscreen();
    else if (e.key === "m") setMuted((m) => !m);
  };

  // Per-element handlers: p is the part index the element belongs to; ignore events from other parts.
  const handlers = (p) => ({
    onTimeUpdate: (e) => {
      if (p !== idxRef.current) return;
      setCurrent(e.currentTarget.currentTime);
      sendHeartbeat(e.currentTarget.currentTime, false);
    },
    onPlay: () => p === idxRef.current && setPlaying(true),
    onPlaying: () => p === idxRef.current && setWaiting(false),
    onWaiting: () => p === idxRef.current && setWaiting(true),
    onPause: (e) => {
      if (p !== idxRef.current || e.currentTarget.ended) return;
      setPlaying(false);
      sendHeartbeat(e.currentTarget.currentTime, true);
    },
    onEnded: (e) => {
      if (p !== idxRef.current) return;
      sendHeartbeat(e.currentTarget.currentTime, true);
      if (p < parts.length - 1) {
        shouldPlay.current = true;
        pendingSeek.current = 0;
        setCurrent(0);
        setIdx(p + 1); // the next part is already preloaded, so this is instant
      } else {
        setPlaying(false);
        if (onEnded) onEnded();
      }
    },
  });

  // Only the current part and the next one live in the DOM; the next one just preloads.
  const mounted = [idx, idx + 1].filter((i) => i < parts.length);
  const shown = scrub ?? globalTime;

  return (
    <div
      ref={box}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative bg-black rounded-xl overflow-hidden aspect-video shadow-xl select-none outline-none group"
    >
      {mounted.map((p) => (
        <video
          key={parts[p].content_id}
          ref={(el) => {
            if (el) els.current[p] = el;
            else delete els.current[p];
          }}
          src={parts[p].video_url}
          preload="auto"
          playsInline
          onClick={p === idx ? togglePlay : undefined}
          className="absolute inset-0 w-full h-full"
          style={{ visibility: p === idx ? "visible" : "hidden" }}
          {...handlers(p)}
        />
      ))}

      {waiting && playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-10 h-10 rounded-full border-4 border-white/30 border-t-white animate-spin" />
        </div>
      )}

      {!playing && !waiting && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
        >
          <Play size={28} />
        </button>
      )}

      {/* Controls: always shown when paused, otherwise on hover/focus */}
      <div
        className={`absolute inset-x-0 bottom-0 px-4 pt-8 pb-3 bg-gradient-to-t from-black/80 to-transparent text-white transition-opacity ${
          playing ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" : "opacity-100"
        }`}
      >
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(total))}
          step={1}
          value={Math.floor(shown)}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => {
            if (scrub !== null) seekTo(scrub);
            setScrub(null);
          }}
          onKeyUp={(e) => {
            if (scrub !== null && e.key.startsWith("Arrow")) {
              seekTo(scrub);
              setScrub(null);
            }
          }}
          aria-label="Seek"
          className="w-full h-1.5 accent-indigo-500 cursor-pointer"
        />
        <div className="mt-2 flex items-center gap-3 text-sm">
          <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className="hover:text-indigo-300">
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button onClick={() => seekTo(globalTime - 10)} aria-label="Back 10 seconds" className="hover:text-indigo-300">
            <RotateCcw size={18} />
          </button>
          <button onClick={() => seekTo(globalTime + 10)} aria-label="Forward 10 seconds" className="hover:text-indigo-300">
            <RotateCw size={18} />
          </button>
          <span className="tabular-nums text-xs sm:text-sm">
            {fmt(shown)} / {fmt(total)}
          </span>
          <span className="flex-1" />
          <button onClick={() => setMuted((m) => !m)} aria-label="Mute" className="hover:text-indigo-300">
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              setVolume(Number(e.target.value));
              setMuted(false);
            }}
            aria-label="Volume"
            className="w-20 h-1 accent-indigo-500 hidden sm:block"
          />
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            aria-label="Speed"
            className="bg-black/50 border border-white/20 rounded px-1 py-0.5 text-xs"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <button onClick={fullscreen} aria-label="Fullscreen" className="hover:text-indigo-300">
            <Maximize size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
