import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../api/queryClient';

/** render() inside a fresh QueryClientProvider (no retries, no cache sharing between tests). */
export function renderWithQuery(ui, options) {
  const client = createQueryClient({ retry: false, gcTime: 0 });
  const wrap = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...render(ui, { wrapper: wrap, ...options }) };
}
