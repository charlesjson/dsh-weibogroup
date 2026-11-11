import { createHash } from 'node:crypto';

export const MAX_ARCHIVE_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];
export interface MessageImageKey {
  accountId: string;
  groupId: string;
  messageId: string;
  assetType: string;
  assetKey: string;
  imageIndex?: number;
}

/** Bind a binary response to the exact archived resource without exposing its URL. */
export function imageResourceBinding(key: MessageImageKey): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        key.accountId,
        key.groupId,
        key.messageId,
        key.assetType,
        key.assetKey,
        key.imageIndex ?? 0,
      ]),
    )
    .digest('hex');
}
export function imageDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
const ascii = (bytes: Uint8Array, offset: number, value: string): boolean =>
  [...value].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
/** Header recognition only; the Harness attachment service validates raster decoding and dimensions. */
export function sniffImageMediaType(bytes: Uint8Array): ImageMediaType | undefined {
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte) &&
    ascii(bytes, 12, 'IHDR')
  )
    return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 13 && (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a'))) return 'image/gif';
  if (bytes.length >= 16 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
  return undefined;
}

const identifier = {
  type: 'string',
  minLength: 1,
  maxLength: 512,
  pattern: '^(?=.*\\S)[^\\u0000-\\u001f\\u007f]+$',
} as const;
export const imageQuerySchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['accountId', 'groupId', 'messageId', 'assetType', 'assetKey'],
  properties: {
    accountId: { ...identifier, description: 'Owned account ID from group/message discovery.' },
    groupId: { ...identifier, description: 'Group ID paired with that account.' },
    messageId: {
      ...identifier,
      description: 'Non-deleted message ID from searchMessages/getMessageContext.',
    },
    assetType: {
      ...identifier,
      maxLength: 64,
      description: 'Exact assetType from the selected message assets.',
    },
    assetKey: {
      ...identifier,
      maxLength: 4096,
      description: 'Exact assetKey from that message; never invent a URL or key.',
    },
    imageIndex: {
      type: 'integer',
      minimum: 0,
      maximum: 255,
      default: 0,
      description: 'Zero-based image within the selected asset; use 0 for a normal image attachment.',
    },
  },
};
