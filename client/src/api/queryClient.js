import { QueryClient } from '@tanstack/react-query';

/**
 * One QueryClient for the app (main.jsx) and a fresh one per test (src/test/utils.jsx, retry off).
 *
 * staleTime 0: cached data is shown straight away but always re-checked in the background, so pages that are not
 * on TanStack Query yet (course editing, enrolling, progress) can never leave a stale list behind.
 * A client error (4xx: wrong role, not found, validation) will not get better by asking again, so only
 * network / 5xx failures are retried, once.
 */
export const createQueryClient = (overrides = {}) =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          const status = error?.response?.status;
          return failureCount < 1 && !(status >= 400 && status < 500);
        },
        ...overrides,
      },
    },
  });

export const queryClient = createQueryClient();
