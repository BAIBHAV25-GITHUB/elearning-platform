import { useRef, useEffect } from "react";
import { useProgressThrottler } from "../../hooks/useProgressThrottler";

export default function VideoPlayer({
  videoUrl,
  enrollmentId,
  contentId,
  onProgressUpdate,
  onEnded,
  autoPlay = false,
  startAt = 0,
}) {
  const videoRef = useRef(null);
  const { sendHeartbeat } = useProgressThrottler(
    enrollmentId,
    contentId,
    onProgressUpdate,
  );

  useEffect(() => {
    // Reset video player when contentId changes
    if (videoRef.current) {
      videoRef.current.load();
      // When we moved here because the previous part ended, keep playing without a click.
      if (autoPlay) {
        videoRef.current.play().catch(() => {});
      }
    }
    // autoPlay is read only when the content changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId]);

  // Resume where the student stopped (F20), but restart a finished lesson from the top
  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (v && startAt > 0 && v.duration && startAt < v.duration - 5) v.currentTime = startAt;
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      sendHeartbeat(videoRef.current.currentTime, false);
    }
  };

  const handlePauseOrEnd = (force = true) => {
    if (videoRef.current) {
      sendHeartbeat(videoRef.current.currentTime, force);
    }
  };

  return (
    <div className="relative bg-black rounded-xl overflow-hidden aspect-video shadow-xl">
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        className="w-full h-full"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPause={() => handlePauseOrEnd(true)}
        onEnded={() => {
          handlePauseOrEnd(true);
          if (onEnded) onEnded();
        }}
      />
    </div>
  );
}
