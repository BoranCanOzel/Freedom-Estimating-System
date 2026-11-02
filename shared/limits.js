// Use the same workbook allowance for imports and every save path.
export const WORKBOOK_LIMIT_MB = 256;
export const WORKBOOK_LIMIT_BYTES = WORKBOOK_LIMIT_MB * 1024 * 1024;
export const WORKBOOK_LIMIT_MESSAGE = `Workbook exceeds the ${WORKBOOK_LIMIT_MB} MB limit.`;
// WebSocket updates are base64 inside JSON, so their transport allowance
// must be larger than the binary workbook, with room for the envelope.
export const SYNC_UPDATE_LIMIT_CHARS = 4 * Math.ceil(WORKBOOK_LIMIT_BYTES / 3);
export const SYNC_MESSAGE_LIMIT_BYTES = SYNC_UPDATE_LIMIT_CHARS + 64 * 1024;
