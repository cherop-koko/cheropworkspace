declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void };
