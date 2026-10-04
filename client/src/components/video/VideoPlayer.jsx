import { useRef, useEffect } from 'react';
import { useProgressThrottler } from '../../hooks/useProgressThrottler';

export default function VideoPlayer({ videoUrl, enrollmentId, contentId, onProgressUpdate }) {
  const videoRef = useRef(null);
  const { sendHeartbeat } = useProgressThrottler(enrollmentId, contentId, onProgressUpdate);

  useEffect(() => {
    // Reset video player when contentId changes
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.load();
    }
  }, [contentId]);

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
        onTimeUpdate={handleTimeUpdate}
        onPause={() => handlePauseOrEnd(true)}
        onEnded={() => handlePauseOrEnd(true)}
      />
    </div>
  );
}