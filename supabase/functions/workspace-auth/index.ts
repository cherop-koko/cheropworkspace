/// <reference path="./runtime.d.ts" />
import { createHandler } from './handler.mjs';
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key) || '' }));
