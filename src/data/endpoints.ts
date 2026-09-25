/**
 * fal endpoints with a realtime WebSocket worker. The dev server only mints
 * realtime tokens for these, so this file stays dependency-free: vite.config
 * imports it too.
 */
export const REALTIME_ENDPOINTS: readonly string[] = ['fal-ai/flux-2/klein/realtime'];
