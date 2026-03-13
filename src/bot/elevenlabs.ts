import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_DEFAULT_VOICE_ID,
  ELEVENLABS_MODEL_ID,
} from "./config.js";

// Cache: "language|accent" -> voice_id (already added to our account)
const voiceCache = new Map<string, string>();

interface SharedVoice {
  voice_id: string;
  public_owner_id: string;
  name: string;
  accent: string | null;
  language: string | null;
  category: string | null;
}

interface SharedVoicesResponse {
  voices: SharedVoice[];
  has_more: boolean;
}

/**
 * Search the ElevenLabs shared voice library for a voice matching the given
 * language and optional accent, add it to our account, and return its voice_id.
 * Results are cached in-memory so subsequent calls reuse the same voice.
 * Returns null if no matching voice is found.
 */
export async function findVoiceForLanguage(
  language: string,
  accent?: string,
): Promise<string | null> {
  const cacheKey = `${language.toLowerCase()}|${(accent ?? "").toLowerCase()}`;
  const cached = voiceCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    page_size: "5",
    language,
    ...(accent && { accent }),
  });

  const response = await fetch(
    `https://api.elevenlabs.io/v1/shared-voices?${params}`,
    {
      headers: { "xi-api-key": ELEVENLABS_API_KEY! },
    },
  );

  if (!response.ok) {
    console.error(
      `ElevenLabs shared-voices search failed (${response.status}): ${await response.text()}`,
    );
    return null;
  }

  const data = (await response.json()) as SharedVoicesResponse;
  if (data.voices.length === 0) {
    // If accent search returned nothing, retry with just the language
    if (accent) return findVoiceForLanguage(language);
    return null;
  }

  const voice = data.voices[0];

  // Add the shared voice to our account
  const addResponse = await fetch(
    `https://api.elevenlabs.io/v1/voices/add/${voice.public_owner_id}/${voice.voice_id}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ new_name: `${voice.name} (${language}${accent ? ` - ${accent}` : ""})` }),
    },
  );

  if (!addResponse.ok) {
    console.error(
      `ElevenLabs add-voice failed (${addResponse.status}): ${await addResponse.text()}`,
    );
    return null;
  }

  const addData = (await addResponse.json()) as { voice_id: string };
  const addedVoiceId = addData.voice_id;

  voiceCache.set(cacheKey, addedVoiceId);
  console.log(
    `Added shared voice "${voice.name}" (${addedVoiceId}) for ${language}${accent ? ` / ${accent}` : ""}`,
  );
  return addedVoiceId;
}

export async function textToSpeech(
  text: string,
  voiceId?: string,
  modelId?: string,
  languageCode?: string,
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
      body: JSON.stringify({
        text,
        model_id: model,
        ...(languageCode && { language_code: languageCode }),
      }),
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

export async function generateMusic(
  prompt: string,
  durationMs: number = 30000,
  instrumental: boolean = false,
): Promise<Buffer> {
  const response = await fetch(
    "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        model_id: "music_v1",
        music_length_ms: durationMs,
        force_instrumental: instrumental,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ElevenLabs Music API error ${response.status}: ${errorText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function speechToText(
  audioBuffer: Buffer,
  filename: string,
): Promise<string> {
  const formData = new FormData();
  formData.append("model_id", "scribe_v2");
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)]),
    filename,
  );

  const response = await fetch(
    "https://api.elevenlabs.io/v1/speech-to-text",
    {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY! },
      body: formData,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ElevenLabs STT error ${response.status}: ${errorText}`,
    );
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}
