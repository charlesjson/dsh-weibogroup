export declare const DEFAULT_CONNECTION_FILE: string;
export interface Connection {
    baseUrl: URL;
    apiToken: string;
}
export declare function loadConnection(file?: string): Promise<Connection>;
