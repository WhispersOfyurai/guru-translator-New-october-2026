import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { TranslationResult } from '../src/types';

// Load OpenAI API client server-side only
const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
const geminiApiKey = process.env.GEMINI_API_KEY?.trim();

export const openaiClient = openaiApiKey
  ? new OpenAI({ apiKey: openaiApiKey })
  : null;

export const geminiClient = geminiApiKey
  ? new GoogleGenAI({ apiKey: geminiApiKey })
  : null;

export function isOpenAIConfigured(): boolean {
  return Boolean(openaiApiKey);
}

/**
 * System instruction enforcing the faithful interpreter principle:
 * 1. Translation must be faithful to the speaker's original meaning, tone, and intent.
 * 2. Do not add explanations, interpretations, advice, or information that was not spoken.
 * 3. Preserve sacred spiritual terminology (Gurudev, Guruthva, Sadhana, Diksha, Atma, Paramatma, Moksha, Guru Seva, etc.).
 * 4. Do not replace these terms with approximate English concepts when preserving the original term is more faithful.
 * 5. Malayalam -> English sounds natural while remaining faithful.
 * 6. English -> Malayalam sounds natural while remaining faithful.
 * 7. Always generate Roman transliteration for Malayalam text.
 * 8. Use consistent, readable Roman transliteration rather than unnecessarily academic transliteration with diacritics.
 * 9. Keep original text unchanged.
 * 10. Never modify the original text to make the translation easier.
 * 11. Do NOT answer questions; translate them strictly as questions.
 * 12. Do NOT summarize or rewrite the speaker's message.
 * 13. Maintain exact JSON output format.
 */
const FAITHFUL_INTERPRETER_SYSTEM_PROMPT = `
You are the dedicated interpreter engine for "GURU LIVE TRANSLATOR", a two-person Malayalam ↔ English faithful real-time interpretation application.

You must strictly obey these translation rules:

1. ABSOLUTE FAITHFULNESS:
   - Translate the speaker's original meaning, tone, emotion, and intent with complete accuracy.
   - Do NOT summarize, condense, or rewrite the speaker's message.
   - Do NOT add any extra information, pleasantries, preambles, or background context.

2. NO ASSISTANT / CHATBOT BEHAVIOR:
   - You are an INTERPRETER, not a conversational assistant or teacher.
   - NEVER answer questions asked by the speaker. If the speaker asks a question, translate it verbatim as a question with a question mark.
     * Example: "എപ്പോഴാണ് സാധന ആരംഭിക്കുന്നത്?" -> "When does the Sadhana begin?" (NEVER answer "It begins at 6 AM").
     * Example: "How do I attain peace of mind?" -> "എനിക്ക് എങ്ങനെയാണ് മനഃസമാധാനം ലഭിക്കുക?" (NEVER provide meditation advice).
   - NEVER add explanations, parenthetical notes, unsolicited advice, or editorial interpretations.

3. PRESERVATION OF SPIRITUAL TERMINOLOGY:
   Preserve vital spiritual and philosophical terms in their original form. Do NOT replace them with approximate or diluted English words when preserving the original term is more faithful.
   Specifically preserve:
   - Gurudev (ഗുരുദേവ്) — do not translate as "Teacher" or "Master"
   - Guruthva (ഗുരുത്വം / ഗുരുത്വ) — do not translate as "gravity" or generic "dignity"
   - Sadhana (സാധന) — do not replace with "exercise", "routine", or generic "practice"
   - Diksha (ദീക്ഷ) — do not replace with generic "initiation"
   - Atma (ആത്മാവ്) — do not replace with generic "soul" or "ghost"
   - Paramatma (പരമാത്മാവ്) — do not replace with "supreme being"
   - Moksha (മോക്ഷം) — do not replace with "salvation" or "heaven"
   - Guru Seva (ഗുരു സേവ) — do not replace with "work for the teacher"
   - Darshan (ദർശനം) — preserve as Darshan
   - Satsang (സത്സംഗം) — preserve as Satsang
   - Pranayama (പ്രാണായാമം) — preserve as Pranayama
   - Ashram (ആശ്രമം) — preserve as Ashram
   - Prasad / Prasadam (പ്രസാദം) — preserve as Prasad / Prasadam
   - Bhakti (ഭക്തി) — preserve as Bhakti
   - Karma (കർമ്മം) — preserve as Karma
   - Dharma (ധർമ്മം) — preserve as Dharma
   - Ahimsa (അഹിംസ) — preserve as Ahimsa
   When translating English to Malayalam, map these concepts back to their accurate Malayalam script (e.g., "Gurudev's grace" -> "ഗുരുദേവന്റെ കൃപ / അനുഗ്രഹം").

4. NATURAL YET FAITHFUL LANGUAGE:
   - Malayalam → English: Fluent, respectful, and natural English that conveys the exact feeling and tone of the Malayalam speaker.
   - English → Malayalam: Fluent, natural, and respectful Malayalam script (മലയാള ലിപി). Maintain appropriate respect and honorifics where suited.

5. READABLE ROMAN TRANSLITERATION (NO OBSCURE ACADEMIC DIACRITICS):
   - Always provide Roman transliteration for Malayalam text.
     * If the input is Malayalam, transliterate the original Malayalam into readable English letters.
     * If the input is English, transliterate the translated Malayalam text into readable English letters.
   - Use natural, phonetically intuitive English spelling (e.g., "Gurudevanodu sadhanayeppatti chodichu", "Ningalkku sugamano?", "Mokshathilekkulla vazhi").
   - Do NOT use academic Sanskrit/ISO diacritics (like ā, ī, ū, ṛ, ḻ, ṟ, ṇ, ś, ṣ, ṭ). Keep it instantly readable for everyday speakers on mobile phones.

6. STRICT JSON OUTPUT FORMAT:
You MUST respond with a single valid JSON object with NO surrounding markdown or backticks:
{
  "sourceLanguage": "ml" | "en",
  "targetLanguage": "ml" | "en",
  "translatedText": "Faithful translation string",
  "transliteration": "Readable Roman transliteration of the Malayalam text"
}
`.trim();

function parseInterpreterJson(rawText: string): any {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

export type TranslationProviderConfig = 'gemini' | 'openai' | 'auto';

/**
 * Returns the active translation provider configuration.
 * Supported modes:
 * - 'gemini': Gemini is primary translator (zero OpenAI API calls).
 * - 'openai': OpenAI is primary translator.
 * - 'auto': OpenAI is primary with fallback to Gemini on failure.
 *
 * Current environment defaults to 'gemini' because the OpenAI API account
 * currently has no credits (HTTP 429).
 */
export function getTranslationProvider(): TranslationProviderConfig {
  const configured = (process.env.TRANSLATION_PROVIDER || '').trim().toLowerCase();
  if (configured === 'openai') return 'openai';
  if (configured === 'auto') return 'auto';
  return 'gemini'; // Default for current environment
}

/**
 * Translates with OpenAI (gpt-4o-mini).
 * Preserves the exact original prompt, model, temperature, and parsing.
 */
async function translateWithOpenAI(
  trimmed: string,
  prompt: string,
  t4_aiRequestStarts: number
): Promise<TranslationResult> {
  if (!openaiClient) {
    throw new Error('OpenAI client is not configured. OPENAI_API_KEY is missing.');
  }

  const t_oa_start = Date.now();
  console.log(`[STAGE 3: OpenAI Request Started] Model: "gpt-4o-mini"`);
  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: FAITHFUL_INTERPRETER_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1, // Low temperature for maximum faithfulness
  });

  const t5_aiResponseReceived = Date.now();
  const openAIDurationMs = t5_aiResponseReceived - t_oa_start;
  console.log(`[STAGE 4: OpenAI Response Completed] in ${openAIDurationMs}ms`);
  console.log(`[STAGE 5: Total OpenAI Latency] ${openAIDurationMs}ms`);

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error('Empty response from OpenAI');
  }

  const parsed = parseInterpreterJson(raw);
  const t6_parsedComplete = Date.now();
  console.log(`[STAGE 6: Translation Result Parsed] in ${t6_parsedComplete - t5_aiResponseReceived}ms`);

  return {
    sourceLanguage: parsed.sourceLanguage === 'ml' ? 'ml' : 'en',
    targetLanguage: parsed.targetLanguage === 'ml' ? 'ml' : 'en',
    originalText: trimmed, // Preserved exact original text
    translatedText: parsed.translatedText || '',
    transliteration: parsed.transliteration || undefined,
    providerUsed: 'openai',
    aiTimings: {
      t4_aiRequestStarts,
      t5_aiResponseReceived,
      t6_parsedComplete,
      attemptedOpenAI: true,
      openAIDurationMs,
      aiRequestCount: 1,
      aiExecutionMode: 'one AI request',
    },
  };
}

/**
 * Translates with Gemini server-side API.
 * Preserves the exact original models (gemini-3.1-flash-lite, etc.), prompts, and parameters.
 */
async function translateWithGemini(
  trimmed: string,
  prompt: string,
  t4_aiRequestStarts: number,
  isFallback: boolean = false,
  openAIDurationMs?: number,
  openAIError?: string
): Promise<TranslationResult> {
  if (!geminiClient) {
    throw new Error('Gemini client is not configured. GEMINI_API_KEY is missing.');
  }

  const modelsToTry = [
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-3.8-flash',
  ];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    const t_gem_start = Date.now();
    try {
      console.log(`[STAGE 3: Gemini Request Started] Model: "${modelName}"`);
      const response = await geminiClient.models.generateContent({
        model: modelName,
        contents: `${FAITHFUL_INTERPRETER_SYSTEM_PROMPT}\n\n${prompt}`,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const t5_aiResponseReceived = Date.now();
      const geminiDurationMs = t5_aiResponseReceived - t_gem_start;
      console.log(`[STAGE 4: Gemini Response Completed] in ${geminiDurationMs}ms (Model: ${modelName})`);
      console.log(`[STAGE 5: Total Gemini Latency] ${geminiDurationMs}ms`);

      const raw = response.text;
      if (raw) {
        const parsed = parseInterpreterJson(raw);
        const t6_parsedComplete = Date.now();
        console.log(`[STAGE 6: Translation Result Parsed] in ${t6_parsedComplete - t5_aiResponseReceived}ms`);

        return {
          sourceLanguage: parsed.sourceLanguage === 'ml' ? 'ml' : 'en',
          targetLanguage: parsed.targetLanguage === 'ml' ? 'ml' : 'en',
          originalText: trimmed, // Preserved exact original text
          translatedText: parsed.translatedText || '',
          transliteration: parsed.transliteration || undefined,
          providerUsed: isFallback ? 'fallback' : 'gemini',
          aiTimings: {
            t4_aiRequestStarts,
            t5_aiResponseReceived,
            t6_parsedComplete,
            attemptedOpenAI: isFallback,
            openAIDurationMs,
            openAIError,
            geminiModelUsed: modelName,
            geminiDurationMs,
            aiRequestCount: isFallback ? 2 : 1,
            aiExecutionMode: isFallback ? 'multiple sequential AI requests' : 'one AI request',
          },
        };
      }
    } catch (err: any) {
      const failedDuration = Date.now() - t_gem_start;
      lastError = err;
      console.warn(`[Gemini Model ${modelName} warning in ${failedDuration}ms]:`, err?.message || err);
    }
  }

  throw new Error(`Translation service encountered an issue: ${lastError?.message || 'Temporary capacity limit'}`);
}

/**
 * Translates between Malayalam and English faithfully based on the configured TRANSLATION_PROVIDER.
 * - 'gemini': Directly calls Gemini (zero OpenAI requests, retries, or timeouts).
 * - 'openai': Calls OpenAI as primary.
 * - 'auto': Calls OpenAI as primary, falling back to Gemini only if OpenAI fails.
 */
export async function translateFaithfully(
  text: string,
  forcedSourceLang?: 'ml' | 'en' | 'auto'
): Promise<TranslationResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Input text cannot be empty');
  }

  // Direction hint enforcing the 13 faithful interpretation rules
  let directionHint =
    'TASK: Faithfully interpret between Malayalam and English. Preserve terms like Gurudev, Guruthva, Sadhana, Diksha, Atma, Paramatma, Moksha, Guru Seva without replacing them with generic approximations. If the input is a question, translate it faithfully as a question without answering it. Never add commentary, explanations, or summaries. Provide readable Roman transliteration for the Malayalam text.';
  if (forcedSourceLang === 'ml') {
    directionHint =
      'TASK: The speaker spoke Malayalam. Translate faithfully into natural, fluent English. Preserve sacred terms (Gurudev, Guruthva, Sadhana, Diksha, Atma, Paramatma, Moksha, Guru Seva). If this is a question, translate it strictly as a question without answering. Generate readable Roman transliteration for the original Malayalam.';
  } else if (forcedSourceLang === 'en') {
    directionHint =
      'TASK: The speaker spoke English. Translate faithfully into natural, respectful Malayalam script (മലയാള ലിപി). Preserve spiritual terms (ഗുരുദേവ്, ഗുരുത്വം, സാധന, ദീക്ഷ, ആത്മാവ്, പരമാത്മാവ്, മോക്ഷം, ഗുരുസേവ). If this is a question, translate it strictly as a question without answering. Generate readable Roman transliteration for the translated Malayalam text.';
  }

  const prompt = `${directionHint}\n\nSPEAKER TEXT (Translate faithfully without answering or adding):\n"${trimmed}"\n\nREMINDER: Strict JSON output only. Never answer questions or add commentary.`;

  const t4_aiRequestStarts = Date.now();
  const provider = getTranslationProvider();
  console.log(`[STAGE 2: Translation Provider Selected] "${provider.toUpperCase()}"`);

  // PATH 1: TRANSLATION_PROVIDER=gemini (Default/Current requirement: Direct Gemini, zero OpenAI requests)
  if (provider === 'gemini') {
    console.log(`[PROVIDER EXECUTION] Invoking Gemini directly (no OpenAI requests, timeouts, or retries).`);
    return await translateWithGemini(trimmed, prompt, t4_aiRequestStarts, false);
  }

  // PATH 2: TRANSLATION_PROVIDER=openai (OpenAI is primary)
  if (provider === 'openai') {
    console.log(`[PROVIDER EXECUTION] Invoking OpenAI directly as configured primary provider.`);
    return await translateWithOpenAI(trimmed, prompt, t4_aiRequestStarts);
  }

  // PATH 3: TRANSLATION_PROVIDER=auto (OpenAI is primary, Gemini is genuine fallback on error)
  console.log(`[PROVIDER EXECUTION] Auto mode: Attempting OpenAI first with Gemini fallback.`);
  const t_oa_start = Date.now();
  try {
    return await translateWithOpenAI(trimmed, prompt, t4_aiRequestStarts);
  } catch (err: any) {
    const openAIDurationMs = Date.now() - t_oa_start;
    const openAIError = err?.message || String(err);
    console.warn(`[PROVIDER AUTO-FALLBACK] OpenAI failed in ${openAIDurationMs}ms: ${openAIError}. Falling back to Gemini...`);
    return await translateWithGemini(trimmed, prompt, t4_aiRequestStarts, true, openAIDurationMs, openAIError);
  }
}

/**
 * Server-side Text-to-Speech using OpenAI TTS (with speech synthesis fallback).
 */
export async function generateSpeechBuffer(
  text: string,
  lang: 'ml' | 'en'
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (openaiClient) {
    try {
      const response = await openaiClient.audio.speech.create({
        model: 'tts-1',
        voice: lang === 'ml' ? 'alloy' : 'nova',
        input: text,
        speed: 0.95,
      });

      const arrayBuffer = await response.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        mimeType: 'audio/mpeg',
      };
    } catch (err: any) {
      console.error('[OpenAI TTS Error]', err?.message || err);
      throw new Error(`OpenAI TTS error: ${err?.message || 'TTS failure'}`);
    }
  }

  throw new Error('OpenAI API Key required for high-fidelity server TTS. Client Web Speech API will be used as client fallback.');
}

/**
 * Server-side Whisper Audio Transcription using OpenAI Whisper.
 */
export async function transcribeAudioBuffer(
  fileBuffer: Buffer,
  filename: string = 'recording.webm',
  forcedLanguage?: 'ml' | 'en'
): Promise<{ text: string; language?: string }> {
  if (openaiClient) {
    try {
      const file = new File([new Uint8Array(fileBuffer)], filename, { type: 'audio/webm' });
      const transcription = await openaiClient.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: forcedLanguage,
      });

      return {
        text: transcription.text,
        language: forcedLanguage,
      };
    } catch (err: any) {
      console.error('[OpenAI Whisper Error]', err?.message || err);
      throw new Error(`Whisper transcription error: ${err?.message || 'Whisper failure'}`);
    }
  }

  throw new Error('OpenAI API Key is required for server-side Whisper transcription.');
}
