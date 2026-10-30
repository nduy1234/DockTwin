/**
 * Mono 16-bit PCM WAV encoding. Muse Voice Transcribe's file endpoint wants a
 * mono 16-bit WAV at 16 or 24 kHz; browsers record webm/opus, so the client
 * decodes, resamples, and re-encodes with this before upload.
 */
export const TRANSCRIBE_SAMPLE_RATE = 16_000;

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Browser only: decode any recorded blob, downmix + resample to 16 kHz mono, encode WAV. */
export async function blobToTranscribeWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const length = Math.ceil(decoded.duration * TRANSCRIBE_SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, length, TRANSCRIBE_SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded; // multi-channel input is downmixed by the 1-channel destination
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return new Blob([encodeWav(rendered.getChannelData(0), TRANSCRIBE_SAMPLE_RATE)], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}
