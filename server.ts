import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  translateFaithfully,
  generateSpeechBuffer,
  transcribeAudioBuffer,
  isOpenAIConfigured,
  getTranslationProvider,
} from './server/openai-service.js';
import { roomManager } from './server/room-manager.js';
import type { ChatMessage } from './src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const port = parseInt(process.env.PORT || '3000', 10);

  // Parse JSON payloads up to 10MB (for voice messages)
  app.use(express.json({ limit: '10mb' }));

  // WebSocket Server for Realtime Room Communication
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    let currentRoomId: string | null = null;

    ws.on('message', async (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'PING': {
            ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
            break;
          }

          case 'JOIN_ROOM': {
            const { roomId, participant } = msg.payload;
            currentRoomId = roomId;
            const state = await roomManager.joinRoom(roomId, ws, participant);
            ws.send(JSON.stringify({ type: 'ROOM_STATE_INIT', payload: state }));
            break;
          }

          case 'LEAVE_ROOM': {
            if (currentRoomId) {
              roomManager.leaveRoom(currentRoomId, ws);
              currentRoomId = null;
            }
            break;
          }

          case 'SEND_MESSAGE': {
            // Client sends a raw message to be interpreted and broadcast
            const t3_serverReceivesRequest = Date.now();
            const { roomId, senderId, senderName, senderRole, text, sourceLang, messageType, clientTimings } = msg.payload;
            const t1 = clientTimings?.t1_userPressSend || t3_serverReceivesRequest;
            const t2 = clientTimings?.t2_requestLeavesBrowser || t3_serverReceivesRequest;
            const activeProvider = getTranslationProvider();

            console.log(`\n================== TRANSLATION PIPELINE TIMING ==================`);
            console.log(`[STAGE 1: Translation Request Received] User pressed send at t1: ${t1}, received on server at t3: ${t3_serverReceivesRequest} (Transit: ${t3_serverReceivesRequest - t2}ms)`);
            console.log(`[STAGE 2: Translation Provider Selected] "${activeProvider.toUpperCase()}" (Zero OpenAI requests if GEMINI)`);
            
            try {
              // 3 - 6: Perform server-side faithful translation & transliteration
              const translation = await translateFaithfully(text, sourceLang);

              // 7: Firebase / Firestore write starts
              const t7_dbWriteStarts = Date.now();
              console.log(`[STAGE 7: Firestore Persistence Started] at ${new Date(t7_dbWriteStarts).toISOString()}`);

              const chatMessage: ChatMessage = {
                id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                roomId,
                senderId,
                senderName,
                senderRole,
                sourceLanguage: translation.sourceLanguage,
                targetLanguage: translation.targetLanguage,
                originalText: translation.originalText,
                translatedText: translation.translatedText,
                transliteration: translation.transliteration,
                messageType: messageType || 'text',
                createdAt: Date.now(),
              };

              const t8_dbWriteStarts = Date.now();
              const t8_estimatedFirestoreWrite = t8_dbWriteStarts;
              const t9_responseLeavesServer = Date.now();

              chatMessage.timings = {
                t1_userPressSend: t1,
                t2_requestLeavesBrowser: t2,
                t3_serverReceivesRequest,
                t4_aiRequestStarts: translation.aiTimings?.t4_aiRequestStarts || t3_serverReceivesRequest,
                t5_aiResponseReceived: translation.aiTimings?.t5_aiResponseReceived || t3_serverReceivesRequest,
                t6_parsedComplete: translation.aiTimings?.t6_parsedComplete || t3_serverReceivesRequest,
                t7_dbWriteStarts,
                t8_dbWriteCompletes: t8_estimatedFirestoreWrite,
                t9_responseLeavesServer,
                aiDetails: translation.aiTimings ? {
                  attemptedOpenAI: translation.aiTimings.attemptedOpenAI,
                  openAIDurationMs: translation.aiTimings.openAIDurationMs,
                  openAIError: translation.aiTimings.openAIError,
                  geminiModelUsed: translation.aiTimings.geminiModelUsed,
                  geminiDurationMs: translation.aiTimings.geminiDurationMs,
                  aiRequestCount: translation.aiTimings.aiRequestCount,
                  aiExecutionMode: translation.aiTimings.aiExecutionMode as any,
                  translationAndTransliterationMode: 'single_prompt_combined',
                } : undefined,
                storageType: 'Durable Google Cloud Firestore',
              };

              // 8: Firebase / Firestore write completes & broadcast
              await roomManager.addMessage(roomId, chatMessage);
              const t8_dbWriteCompletes = Date.now();
              chatMessage.timings.t8_dbWriteCompletes = t8_dbWriteCompletes;

              console.log(`[STAGE 8: WebSocket Broadcast] Message broadcast to room "${roomId}" at ${t9_responseLeavesServer}`);
              console.log(`[STAGE 9: Total End-to-End Translation Latency] ${t9_responseLeavesServer - t1}ms (Server duration: ${t9_responseLeavesServer - t3_serverReceivesRequest}ms)`);
              console.log(`[PROVIDER HANDLED] Message handled by: ${translation.providerUsed.toUpperCase()} (Model: ${translation.aiTimings?.geminiModelUsed || 'gpt-4o-mini'})`);
              console.log(`=================================================================\n`);
            } catch (err: any) {
              console.error('[Translation Pipeline Error]', err);
              ws.send(JSON.stringify({
                type: 'TRANSLATION_ERROR',
                payload: {
                  error: err?.message || 'Translation failed. Please try again.',
                },
              }));
            }
            break;
          }

          case 'TYPING_INDICATOR': {
            if (currentRoomId) {
              roomManager.broadcast(currentRoomId, {
                type: 'USER_TYPING',
                payload: msg.payload,
              }, ws);
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error('[WebSocket Message Parse Error]', err);
      }
    });

    ws.on('close', () => {
      if (currentRoomId) {
        roomManager.leaveRoom(currentRoomId, ws);
      } else {
        roomManager.handleDisconnect(ws);
      }
    });
  });

  // ==========================================
  // REST API ENDPOINTS
  // ==========================================

  // Health and provider status
  app.get('/api/status', (_req, res) => {
    const provider = getTranslationProvider();
    res.json({
      provider,
      openaiConfigured: isOpenAIConfigured(),
      model: provider === 'openai'
        ? 'OpenAI GPT-4o-mini'
        : provider === 'auto'
          ? 'OpenAI GPT-4o-mini (Primary) with Gemini Fallback'
          : 'Gemini (gemini-3.1-flash-lite / Primary)',
      status: 'ready',
    });
  });

  // Direct Text Translation and Transliteration Endpoint
  app.post('/api/translate', async (req, res) => {
    try {
      const { text, sourceLanguage } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text field is required' });
      }

      const result = await translateFaithfully(text, sourceLanguage);
      return res.json(result);
    } catch (err: any) {
      console.error('[API /api/translate Error]', err);
      return res.status(500).json({
        error: err?.message || 'Faithful translation failed',
      });
    }
  });

  // Text-To-Speech Endpoint (Audio generation for translated text)
  app.post('/api/tts', async (req, res) => {
    try {
      const { text, lang } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text field is required' });
      }

      const { buffer, mimeType } = await generateSpeechBuffer(text, lang === 'ml' ? 'ml' : 'en');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err: any) {
      console.error('[API /api/tts Error]', err);
      return res.status(500).json({
        error: err?.message || 'TTS generation failed',
      });
    }
  });

  // Push-to-Talk Whisper Audio Transcription Endpoint
  app.post('/api/transcribe', async (req, res) => {
    try {
      const { audioBase64, language } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: 'audioBase64 data is required' });
      }

      const buffer = Buffer.from(audioBase64.replace(/^data:audio\/\w+;base64,/, ''), 'base64');
      const result = await transcribeAudioBuffer(buffer, 'audio.webm', language);
      return res.json(result);
    } catch (err: any) {
      console.error('[API /api/transcribe Error]', err);
      return res.status(500).json({
        error: err?.message || 'Audio transcription failed',
      });
    }
  });

  // Room Snapshot Endpoint & Existence Check (Backed by Firestore)
  app.get('/api/rooms/:roomId', async (req, res) => {
    try {
      const { roomId } = req.params;
      const normalized = (roomId || '').trim().toUpperCase();
      const exists = await roomManager.hasRoom(normalized);
      if (!exists) {
        return res.status(404).json({ exists: false, error: 'Room not found' });
      }
      await roomManager.getOrCreateRoom(normalized);
      const state = roomManager.getRoomState(normalized);
      return res.json({ exists: true, ...state });
    } catch (err: any) {
      console.error('[API /api/rooms/:roomId Error]', err);
      return res.status(500).json({ error: 'Failed to retrieve room' });
    }
  });

  // Room Messages Endpoint (Durable Firestore History)
  app.get('/api/rooms/:roomId/messages', async (req, res) => {
    try {
      const { roomId } = req.params;
      const normalized = (roomId || '').trim().toUpperCase();
      const exists = await roomManager.hasRoom(normalized);
      if (!exists) {
        return res.status(404).json({ error: 'Room not found' });
      }
      const room = await roomManager.getOrCreateRoom(normalized);
      return res.json({ roomId: room.id, messages: room.messages });
    } catch (err: any) {
      console.error('[API /api/rooms/:roomId/messages Error]', err);
      return res.status(500).json({ error: 'Failed to retrieve messages' });
    }
  });

  // Room Creation Endpoint (Guarantees room registered in Firestore before sharing)
  app.post('/api/rooms', async (req, res) => {
    try {
      const roomId = (req.body.roomId || 'GURU-' + Math.random().toString(36).substring(2, 8)).trim().toUpperCase();
      await roomManager.getOrCreateRoom(roomId);
      return res.json({ roomId, exists: true, success: true });
    } catch (err: any) {
      console.error('[API /api/rooms Error]', err);
      return res.status(500).json({ error: 'Failed to create room' });
    }
  });

  // SPA Fallback Route for all pages including /room/:roomId
  app.get(['/room/*', '/room', '/'], (_req, res, next) => {
    // Let API routes pass through
    if (_req.path.startsWith('/api') || _req.path.startsWith('/ws')) {
      return next();
    }
    next();
  });

  // ==========================================
  // VITE DEV SERVER MIDDLEWARE
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`[Guru Live Translator] Server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
