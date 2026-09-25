/**
 * fal endpoints with a realtime WebSocket worker. The server (api/lab.ts) only mints
 * realtime tokens for these and keeps its own copy of the list: keep both in sync.
 */
export const REALTIME_ENDPOINTS: readonly string[] = ['fal-ai/flux-2/klein/realtime'];
