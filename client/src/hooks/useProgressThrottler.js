import { useRef, useCallback, useEffect } from 'react';
import api from '../api/axios';

export function useProgressThrottler(enrollmentId, contentId, onProgressUpdate) {
  const lastSentTimeRef = useRef(0);
  const lastSentAtRef = useRef(0); // wall-clock ms of the last request, used to drop duplicates

  // New lesson => start the throttle window from scratch (F20)
  useEffect(() => {
    lastSentTimeRef.current = 0;
    lastSentAtRef.current = 0;
  }, [contentId]);

  const sendHeartbeat = useCallback(
    async (currentTime, force = false) => {
      if (!enrollmentId || !contentId) return;

      const now = Date.now();
      // Browsers fire `pause` right before `ended`: don't send the same position twice
      if (force && now - lastSentAtRef.current < 1500) return;

      // Throttle: send every 30 seconds of playback unless forced (pause / end)
      if (force || Math.abs(currentTime - lastSentTimeRef.current) >= 30) {
        lastSentTimeRef.current = currentTime;
        lastSentAtRef.current = now;
        try {
          const res = await api.post('/progress', {
            enrollmentId,
            contentId,
            watchDuration: Math.round(currentTime),
          });
          if (onProgressUpdate) {
            onProgressUpdate(contentId, res.data.completed, Math.round(currentTime));
          }
        } catch (err) {
          console.error('Failed to update progress heartbeat:', err);
        }
      }
    },
    [enrollmentId, contentId, onProgressUpdate]
  );

  return { sendHeartbeat };
}
