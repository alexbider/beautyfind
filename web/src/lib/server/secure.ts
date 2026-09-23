import 'server-only';

// Field-level encryption (AES-256-GCM) for health declarations, clinical records and provider
// credentials. DATA_KEY is 32 random bytes, base64. Rotating it needs a re-encryption job.
export { open, seal } from './seal-core';
