export type Language = 'ml' | 'en' | 'auto';
export type UserRole = 'malayalam_speaker' | 'english_speaker' | 'observer';

export interface PerformanceTimings {
  t1_userPressSend: number; // 1. User presses Send
  t2_requestLeavesBrowser: number; // 2. Request leaves the browser
  t3_serverReceivesRequest: number; // 3. Server receives the request
  t4_aiRequestStarts: number; // 4. AI/Gemini request starts
  t5_aiResponseReceived: number; // 5. AI/Gemini response is received
  t6_parsedComplete: number; // 6. Translation and transliteration are parsed
  t7_dbWriteStarts: number; // 7. Firebase/Firestore write starts
  t8_dbWriteCompletes: number; // 8. Firebase/Firestore write completes
  t9_responseLeavesServer: number; // 9. Response is returned to the browser
  t10_renderedOnScreen?: number; // 10. The translated message is rendered on screen
  t11_reachedSecondDevice?: number; // 11. Realtime update reaches the second device
  
  // Detailed breakdown
  aiDetails?: {
    attemptedOpenAI?: boolean;
    openAIDurationMs?: number;
    openAIError?: string;
    geminiModelUsed?: string;
    geminiDurationMs?: number;
    aiRequestCount: number;
    aiExecutionMode: 'one AI request' | 'multiple sequential AI requests' | 'multiple parallel AI requests';
    translationAndTransliterationMode: 'single_prompt_combined';
  };
  storageType?: string;
}

export interface TranslationResult {
  sourceLanguage: 'ml' | 'en';
  targetLanguage: 'ml' | 'en';
  originalText: string;
  translatedText: string;
  transliteration?: string; // Roman transliteration for Malayalam text
  providerUsed: 'openai' | 'fallback' | 'gemini';
  aiTimings?: {
    t4_aiRequestStarts: number;
    t5_aiResponseReceived: number;
    t6_parsedComplete: number;
    attemptedOpenAI: boolean;
    openAIDurationMs?: number;
    openAIError?: string;
    geminiModelUsed?: string;
    geminiDurationMs?: number;
    aiRequestCount: number;
    aiExecutionMode: 'one AI request' | 'multiple sequential AI requests' | 'multiple parallel AI requests';
  };
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderRole: UserRole;
  senderName: string;
  sourceLanguage: 'ml' | 'en';
  targetLanguage: 'ml' | 'en';
  originalText: string;
  translatedText: string;
  transliteration?: string;
  messageType: 'text' | 'voice' | 'live';
  createdAt: number;
  audioUrl?: string; // Optional audio synthesis or voice link
  timings?: PerformanceTimings;
}

export interface RoomState {
  roomId: string;
  createdAt: number;
  participants: {
    id: string;
    role: UserRole;
    name: string;
    joinedAt: number;
  }[];
  messages: ChatMessage[];
}

export interface ApiStatusResponse {
  openaiConfigured: boolean;
  model: string;
  status: 'ready' | 'missing_openai_key';
}
