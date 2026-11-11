export declare const MAX_ARCHIVE_IMAGE_BYTES: number;
export declare const IMAGE_MEDIA_TYPES: readonly ["image/png", "image/jpeg", "image/webp", "image/gif"];
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
export declare function imageResourceBinding(key: MessageImageKey): string;
export declare function imageDigest(bytes: Uint8Array): string;
/** Header recognition only; the Harness attachment service validates raster decoding and dimensions. */
export declare function sniffImageMediaType(bytes: Uint8Array): ImageMediaType | undefined;
export declare const imageQuerySchema: {
    type: "object";
    additionalProperties: boolean;
    required: string[];
    properties: {
        accountId: {
            description: string;
            type: "string";
            minLength: 1;
            maxLength: 512;
            pattern: "^(?=.*\\S)[^\\u0000-\\u001f\\u007f]+$";
        };
        groupId: {
            description: string;
            type: "string";
            minLength: 1;
            maxLength: 512;
            pattern: "^(?=.*\\S)[^\\u0000-\\u001f\\u007f]+$";
        };
        messageId: {
            description: string;
            type: "string";
            minLength: 1;
            maxLength: 512;
            pattern: "^(?=.*\\S)[^\\u0000-\\u001f\\u007f]+$";
        };
        assetType: {
            maxLength: number;
            description: string;
            type: "string";
            minLength: 1;
            pattern: "^(?=.*\\S)[^\\u0000-\\u001f\\u007f]+$";
        };
        assetKey: {
            maxLength: number;
            description: string;
            type: "string";
            minLength: 1;
            pattern: "^(?=.*\\S)[^\\u0000-\\u001f\\u007f]+$";
        };
        imageIndex: {
            type: string;
            minimum: number;
            maximum: number;
            default: number;
            description: string;
        };
    };
};
