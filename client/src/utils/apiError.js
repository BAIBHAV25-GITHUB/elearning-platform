/** The server's message for a failed request, or the fallback text. */
export const apiError = (err, fallback) => err?.response?.data?.message || fallback;
