import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_DEFAULT_VOICE_ID,
  ELEVENLABS_MODEL_ID,
} from "./config.js";

export async function textToSpeech(
  text: string,
  voiceId?: string,
  modelId?: string,
): Promise<Buffer> {
  const voice = voiceId ?? ELEVENLABS_DEFAULT_VOICE_ID;
  const model = modelId ?? ELEVENLABS_MODEL_ID;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=opus_48000_64`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, model_id: model }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ElevenLabs API error ${response.status}: ${errorText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
