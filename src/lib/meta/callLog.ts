/**
 * Every Meta model invocation produces one ModelCall record. Routes return them
 * to the browser so the UI can show which Meta model handled each step.
 * Shared by server and client, so no server-only imports here.
 */
export type ModelCall = {
  step: string;
  model: string;
  endpoint: string;
  ms: number;
  attempts: number;
  repaired: boolean;
  mock: boolean;
  ok: boolean;
  error?: string;
  usage?: { input: number; output: number };
};
