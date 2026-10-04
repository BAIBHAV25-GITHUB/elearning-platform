import { useRef, useCallback } from 'react';
import api from '../api/axios';

export function useProgressThrottler(enrollmentId, contentId, onProgressUpdate) {
  const lastSentTimeRef = useRef(0);

  const sendHeartbeat = useCallback(
    async (currentTime, force = false) => {
      if (!enrollmentId || !contentId) return;

      // Throttle: send every 30 seconds unless forced (pause / end)
      if (force || Math.abs(currentTime - lastSentTimeRef.current) >= 30) {
        lastSentTimeRef.current = currentTime;
        try {
          const res = await api.post('/progress', {
            enrollmentId,
            contentId,
            watchDuration: Math.round(currentTime)
          });
          if (onProgressUpdate) {
            onProgressUpdate(contentId, res.data.completed);
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

