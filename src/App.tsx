import React, { useState, useEffect, useRef } from 'react';
import {
  Languages,
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  Radio,
  Users,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
  AlertCircle,
  HelpCircle,
  LogOut,
  Headphones,
  Settings2,
  Share2,
  Clock,
  ChevronDown,
  ChevronUp,
  Activity,
  CheckCircle2,
  Trash2,
  Edit3,
  Info,
  X,
  Square
} from 'lucide-react';
import type { ChatMessage, RoomState, UserRole, TranslationResult } from './types';

// Role definitions
const ROLE_CONFIGS: Record<UserRole, { label: string; lang: 'ml' | 'en'; badge: string }> = {
  malayalam_speaker: {
    label: 'Malayalam Speaker (മലയാളം)',
    lang: 'ml',
    badge: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800',
  },
  english_speaker: {
    label: 'English Speaker',
    lang: 'en',
    badge: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800',
  },
  observer: {
    label: 'Room Observer',
    lang: 'en',
    badge: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  },
};

// Local Storage Keys
const STORAGE_USER_ID = 'guru_user_id';
const STORAGE_USER_NAME = 'guru_user_name';
const STORAGE_USER_ROLE = 'guru_user_role';
const STORAGE_ROOM_ID = 'guru_current_room_id';
const STORAGE_JOINED = 'guru_joined';

// Message reconciliation helper: merges incoming messages with current without duplicates or deletions
const mergeMessages = (current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] => {
  if (!incoming || incoming.length === 0) return current;
  const map = new Map<string, ChatMessage>();
  for (const m of current) {
    if (m && m.id) map.set(m.id, m);
  }
  for (const m of incoming) {
    if (m && m.id) {
      const existing = map.get(m.id);
      map.set(m.id, { ...existing, ...m });
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
};

export default function App() {
  // Navigation / Room State
  const [roomId, setRoomId] = useState<string>('');
  const [joined, setJoined] = useState<boolean>(false);

  // Persistent User Role & Name
  const [userRole, setUserRoleState] = useState<UserRole>(() => {
    const saved = localStorage.getItem(STORAGE_USER_ROLE) as UserRole;
    return saved === 'malayalam_speaker' || saved === 'english_speaker' || saved === 'observer'
      ? saved
      : 'malayalam_speaker';
  });
  const setUserRole = (role: UserRole) => {
    setUserRoleState(role);
    const newLang = role === 'english_speaker' ? 'en' : 'ml';
    setDictationLang(newLang);
    dictationLangRef.current = newLang;
    recordingLangRef.current = newLang;
    setTextDictationLang(newLang);
    textDictationLangRef.current = newLang;
    try {
      localStorage.setItem(STORAGE_USER_ROLE, role);
    } catch (_) {}
  };

  const [userName, setUserNameState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_USER_NAME) || '';
  });
  const setUserName = (name: string) => {
    setUserNameState(name);
    try {
      localStorage.setItem(STORAGE_USER_NAME, name);
    } catch (_) {}
  };

  const [userId] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_USER_ID);
    if (saved && saved.trim()) return saved;
    const generated = 'user_' + Math.random().toString(36).substring(2, 9);
    try {
      localStorage.setItem(STORAGE_USER_ID, generated);
    } catch (_) {}
    return generated;
  });

  // Chat & Communication State
  const [mode, setMode] = useState<'text' | 'voice' | 'live'>('text');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<RoomState['participants']>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [serverStatus, setServerStatus] = useState<{ openaiConfigured: boolean; model: string } | null>(null);

  // Audio / Speech State
  const [autoPlay, setAutoPlay] = useState<boolean>(true);
  const [showTransliteration, setShowTransliteration] = useState<boolean>(true);
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSpiritualTermsGuide, setShowSpiritualTermsGuide] = useState<boolean>(false);
  const [roomNotFound, setRoomNotFound] = useState<boolean>(false);
  const [isCheckingRoom, setIsCheckingRoom] = useState<boolean>(false);
  const [expandedTimingIds, setExpandedTimingIds] = useState<Record<string, boolean>>({});

  const toggleTiming = (id: string) => {
    setExpandedTimingIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Live Simultaneous Interpreter State
  const [isLiveActive, setIsLiveActive] = useState<boolean>(false);

  // Review-Before-Translation Dictation State
  const [draftTranscript, setDraftTranscript] = useState<string>('');
  const [isDraftActive, setIsDraftActive] = useState<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [dictationLang, setDictationLang] = useState<'ml' | 'en'>(() => (userRole === 'english_speaker' ? 'en' : 'ml'));
  const [draftSourceLang, setDraftSourceLang] = useState<'ml' | 'en'>('ml');
  const [micAudioLevel, setMicAudioLevel] = useState<number>(0);
  const [transcriptionMetrics, setTranscriptionMetrics] = useState<{
    recordingDurationSec: number;
    stopToUploadMs: number;
    uploadAndServerMs: number;
    geminiProcessingMs: number;
    totalLatencyMs: number;
    modelUsed: string;
  } | null>(null);

  // Microphone Diagnostic State (Android Google Meet test)
  const [showMicDiagnostic, setShowMicDiagnostic] = useState<boolean>(false);
  const [micPermissionStatus, setMicPermissionStatus] = useState<'prompt' | 'granted' | 'denied' | 'checking'>('prompt');
  const [diagnosticAudioLevel, setDiagnosticAudioLevel] = useState<number>(0);
  const [isTestingMic, setIsTestingMic] = useState<boolean>(false);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);

  // Text Mode Dictation State
  const [textDictationLang, setTextDictationLang] = useState<'ml' | 'en'>(() => (userRole === 'english_speaker' ? 'en' : 'ml'));
  const [recordingTarget, setRecordingTarget] = useState<'text' | 'voice' | null>(null);
  const [isStartingRecording, setIsStartingRecording] = useState<boolean>(false);

  // Language Synchronous Refs (guarantees accurate language on first recording without closure staleness)
  const dictationLangRef = useRef<'ml' | 'en'>(userRole === 'english_speaker' ? 'en' : 'ml');
  dictationLangRef.current = dictationLang;
  const textDictationLangRef = useRef<'ml' | 'en'>(userRole === 'english_speaker' ? 'en' : 'ml');
  textDictationLangRef.current = textDictationLang;
  const recordingLangRef = useRef<'ml' | 'en'>(userRole === 'english_speaker' ? 'en' : 'ml');

  const handleSetDictationLang = (lang: 'ml' | 'en') => {
    setDictationLang(lang);
    dictationLangRef.current = lang;
    recordingLangRef.current = lang;
    console.log(`[Language Select] Push-to-Talk dictation language set to: ${lang}`);
  };

  const handleSetTextDictationLang = (lang: 'ml' | 'en') => {
    setTextDictationLang(lang);
    textDictationLangRef.current = lang;
    recordingLangRef.current = lang;
    console.log(`[Language Select] Text Mode dictation language set to: ${lang}`);
  };

  // Refs
  const recordingTargetRef = useRef<'text' | 'voice' | null>(null);
  const isCancelledRef = useRef<boolean>(false);
  const isStartingRecordingRef = useRef<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);
  const stopRequestedRef = useRef<boolean>(false);
  const recordedMimeTypeRef = useRef<string>('audio/webm');
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cursorPositionRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const recordingStartTimeRef = useRef<number | null>(null);
  const stopPressedTimeRef = useRef<number | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const joinedRef = useRef<boolean>(false);
  joinedRef.current = joined;
  const currentRoomRef = useRef<string>('');
  currentRoomRef.current = roomId;
  const heartbeatIntervalRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const diagnosticStreamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const liveAudioMeterFrameRef = useRef<number | null>(null);

  // Helper to extract clean room ID from URL
  const extractRoomIdFromUrl = (): string | null => {
    // 1. Check path: /room/ABC123 or /ABC123
    const path = window.location.pathname;
    const match = path.match(/^\/room\/([A-Za-z0-9_-]+)/i);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
    // 2. Check query param: ?room=ABC123
    const urlParams = new URLSearchParams(window.location.search);
    const queryRoom = urlParams.get('room');
    if (queryRoom && queryRoom.trim().length >= 2) {
      return queryRoom.trim().toUpperCase();
    }
    return null;
  };

  // Fetch messages directly from Firestore/API to reconcile history
  const fetchRoomHistory = async (targetRoomId: string) => {
    if (!targetRoomId) return;
    try {
      const res = await fetch(`/api/rooms/${targetRoomId}/messages`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages && Array.isArray(data.messages)) {
          setMessages((prev) => mergeMessages(prev, data.messages));
        }
      }
    } catch (err) {
      console.warn('[History] Could not reconcile history from API:', err);
    }
  };

  // Read Room ID on initial load and handle direct navigation or session restoration
  useEffect(() => {
    const detectedRoom = extractRoomIdFromUrl();
    const savedJoined = localStorage.getItem(STORAGE_JOINED) === 'true';
    const savedRoom = (localStorage.getItem(STORAGE_ROOM_ID) || '').toUpperCase();
    const savedName = localStorage.getItem(STORAGE_USER_NAME) || '';
    const savedRole = (localStorage.getItem(STORAGE_USER_ROLE) as UserRole) || userRole;

    if (detectedRoom) {
      setRoomId(detectedRoom);
      setIsCheckingRoom(true);

      // Verify whether the room exists in Firestore
      fetch(`/api/rooms/${detectedRoom}`)
        .then(async (res) => {
          if (res.status === 404) {
            // If the user had an active session in this room, re-register and restore it
            if (savedJoined && savedRoom === detectedRoom) {
              await fetch('/api/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId: detectedRoom }),
              });
              setRoomNotFound(false);
              setJoined(true);
              connectWebSocket(detectedRoom, savedRole, savedName);
              fetchRoomHistory(detectedRoom);
            } else {
              setRoomNotFound(true);
            }
          } else if (res.ok) {
            const data = await res.json();
            setRoomNotFound(false);
            if (data.messages && Array.isArray(data.messages)) {
              setMessages((prev) => mergeMessages(prev, data.messages));
            }

            // AUTO-RESTORE SESSION: If user was joined in this room, reconnect without asking to re-join!
            if (savedJoined && savedRoom === detectedRoom) {
              setJoined(true);
              connectWebSocket(detectedRoom, savedRole, savedName);
            }
          }
        })
        .catch((err) => {
          console.warn('[RoomCheck] Check error:', err);
          if (savedJoined && savedRoom === detectedRoom) {
            setJoined(true);
            connectWebSocket(detectedRoom, savedRole, savedName);
          }
        })
        .finally(() => {
          setIsCheckingRoom(false);
        });
    } else {
      // Default generated room code for new host
      const generated = 'GURU-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      setRoomId(generated);
      setRoomNotFound(false);
    }

    // Fetch server status
    fetch('/api/status')
      .then((res) => res.json())
      .then((data) => setServerStatus(data))
      .catch((err) => console.error('Failed to get status', err));

    // Handle browser back/forward buttons
    const handlePopState = () => {
      const room = extractRoomIdFromUrl();
      if (room) {
        setRoomId(room);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Mobile Screen-Lock & Lifecycle Event Handlers (visibilitychange & online/offline)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && joinedRef.current && currentRoomRef.current) {
        console.log('[Lifecycle] App resumed. Checking connection and reconciling messages...');
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          reconnectSocket();
        }
        fetchRoomHistory(currentRoomRef.current);
      }
    };

    const handleOnline = () => {
      console.log('[Lifecycle] Network restored. Reconnecting...');
      if (joinedRef.current && currentRoomRef.current) {
        reconnectSocket();
        fetchRoomHistory(currentRoomRef.current);
      }
    };

    const handleOffline = () => {
      console.log('[Lifecycle] Network lost.');
      setConnectionStatus('disconnected');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTranslating]);

  // Ping/Pong Heartbeat Managers
  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'PING' }));
        } catch (_) {}
      }
    }, 20000); // 20s heartbeat
  };

  const stopHeartbeat = () => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  };

  // Reconnection with Exponential Backoff
  const reconnectSocket = () => {
    if (!joinedRef.current || !currentRoomRef.current) return;
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

    setConnectionStatus('connecting');
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttemptsRef.current), 8000);
    reconnectAttemptsRef.current++;

    reconnectTimeoutRef.current = setTimeout(() => {
      if (joinedRef.current && wsRef.current?.readyState !== WebSocket.OPEN) {
        connectWebSocket(currentRoomRef.current, userRole, userName);
      }
    }, delay);
  };

  // WebSocket Connection Lifecycle
  const connectWebSocket = (targetRoomId: string, role: UserRole, name: string) => {
    setConnectionStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    // Close any previous connection
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (_) {}
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
      setRoomNotFound(false);
      reconnectAttemptsRef.current = 0;
      startHeartbeat();

      // Join Room
      ws.send(
        JSON.stringify({
          type: 'JOIN_ROOM',
          payload: {
            roomId: targetRoomId,
            participant: {
              id: userId,
              name: name || (role === 'malayalam_speaker' ? 'Malayalam User' : 'English User'),
              role,
            },
          },
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'PONG') {
          // Heartbeat received
          return;
        }

        if (msg.type === 'ROOM_STATE_INIT' || msg.type === 'ROOM_STATE_UPDATED') {
          const state: RoomState = msg.payload;
          setParticipants(state.participants || []);

          // CRITICAL: Merge messages rather than blindly replacing with empty array!
          if (state.messages && state.messages.length > 0) {
            setMessages((prev) => mergeMessages(prev, state.messages));
          }
        } else if (msg.type === 'NEW_MESSAGE') {
          const newMsg: ChatMessage = msg.payload;
          const receiveTime = Date.now();
          const isSender = newMsg.senderId === userId;

          if (newMsg.timings) {
            if (isSender) {
              newMsg.timings.t10_renderedOnScreen = receiveTime;
            } else {
              newMsg.timings.t11_reachedSecondDevice = receiveTime;
            }

            const t1 = newMsg.timings.t1_userPressSend;
            const t2 = newMsg.timings.t2_requestLeavesBrowser;
            const t3 = newMsg.timings.t3_serverReceivesRequest;
            const t4 = newMsg.timings.t4_aiRequestStarts;
            const t5 = newMsg.timings.t5_aiResponseReceived;
            const t6 = newMsg.timings.t6_parsedComplete;
            const t7 = newMsg.timings.t7_dbWriteStarts;
            const t8 = newMsg.timings.t8_dbWriteCompletes;
            const t9 = newMsg.timings.t9_responseLeavesServer;

            console.group(`⏱️ [PIPELINE TIMING BREAKDOWN: Message ${newMsg.id}]`);
            console.log(`1. User presses Send:               0 ms (t1: ${t1})`);
            console.log(`2. Request leaves browser:          +${Math.max(0, t2 - t1)} ms`);
            console.log(`3. Server receives request:         +${Math.max(0, t3 - t2)} ms (Network to server)`);
            console.log(`4. AI/Gemini request starts:        +${Math.max(0, t4 - t3)} ms (Server prep)`);
            console.log(`5. AI/Gemini response received:     +${Math.max(0, t5 - t4)} ms (AI processing duration)`);
            if (newMsg.timings.aiDetails) {
              console.log(`   * AI Request Count:              ${newMsg.timings.aiDetails.aiRequestCount}`);
              console.log(`   * AI Execution Mode:             ${newMsg.timings.aiDetails.aiExecutionMode}`);
              console.log(`   * Translation & Translit Mode:   ${newMsg.timings.aiDetails.translationAndTransliterationMode}`);
              if (newMsg.timings.aiDetails.attemptedOpenAI) {
                console.log(`   * OpenAI Attempt Duration:       ${newMsg.timings.aiDetails.openAIDurationMs} ms`);
                console.log(`   * OpenAI Result:                 FAILED (${newMsg.timings.aiDetails.openAIError})`);
              }
              if (newMsg.timings.aiDetails.geminiModelUsed) {
                console.log(`   * Gemini Model Used:             ${newMsg.timings.aiDetails.geminiModelUsed}`);
                console.log(`   * Gemini Duration:               ${newMsg.timings.aiDetails.geminiDurationMs} ms`);
              }
            }
            console.log(`6. Translation & translit parsed:   +${Math.max(0, t6 - t5)} ms`);
            console.log(`7. Firebase/Firestore write starts: +${Math.max(0, t7 - t6)} ms`);
            console.log(`8. Firebase/Firestore write done:   +${Math.max(0, t8 - t7)} ms (${newMsg.timings.storageType || 'Durable Google Cloud Firestore'})`);
            console.log(`9. Response leaves server:          +${Math.max(0, t9 - t8)} ms`);
            if (isSender) {
              console.log(`10. Message rendered on screen:     +${Math.max(0, receiveTime - t9)} ms (Total roundtrip: ${receiveTime - t1} ms)`);
            } else {
              console.log(`11. Realtime reaches 2nd device:    +${Math.max(0, receiveTime - t9)} ms (Total from send: ${receiveTime - t1} ms)`);
            }
            console.groupEnd();
          }

          // Use mergeMessages to append safely
          setMessages((prev) => mergeMessages(prev, [newMsg]));
          setIsTranslating(false);

          // Auto-play audio if message is not from self, or if requested
          if (autoPlay && newMsg.senderId !== userId) {
            playMessageAudio(newMsg);
          }
        } else if (msg.type === 'TRANSLATION_ERROR') {
          setIsTranslating(false);
          setErrorMessage(msg.payload.error || 'Translation failed');
        }
      } catch (err) {
        console.error('WebSocket receive error:', err);
      }
    };

    ws.onerror = () => {
      stopHeartbeat();
      setConnectionStatus('connecting');
    };

    ws.onclose = () => {
      stopHeartbeat();
      setConnectionStatus('connecting');

      // Auto-reconnect if participant is joined in room
      if (joinedRef.current) {
        reconnectSocket();
      }
    };
  };

  const handleJoin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!roomId.trim()) return;

    const normalizedRoom = roomId.trim().toUpperCase();
    const finalName = userName.trim() || (userRole === 'malayalam_speaker' ? 'Malayalam Speaker' : 'English Speaker');

    // Save session in localStorage so it survives refresh & mobile lock
    try {
      localStorage.setItem(STORAGE_USER_ID, userId);
      localStorage.setItem(STORAGE_USER_NAME, finalName);
      localStorage.setItem(STORAGE_USER_ROLE, userRole);
      localStorage.setItem(STORAGE_ROOM_ID, normalizedRoom);
      localStorage.setItem(STORAGE_JOINED, 'true');
    } catch (_) {}

    // Register room on server to ensure it exists in Firestore
    try {
      await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: normalizedRoom }),
      });
    } catch (err) {
      console.warn('Room registration check skipped', err);
    }

    setJoined(true);
    setRoomNotFound(false);

    // Update URL to /room/ROOMID format
    window.history.pushState({}, '', `/room/${normalizedRoom}`);
    connectWebSocket(normalizedRoom, userRole, finalName);
    fetchRoomHistory(normalizedRoom);
  };

  const handleCreateNewRoom = () => {
    const generated = 'GURU-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    setRoomId(generated);
    setRoomNotFound(false);
    window.history.pushState({}, '', `/room/${generated}`);
  };

  const handleLeave = () => {
    stopHeartbeat();
    stopMicDiagnostic();
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (_) {}
    }

    // Clear session so user isn't auto-rejoined
    try {
      localStorage.removeItem(STORAGE_JOINED);
      localStorage.removeItem(STORAGE_ROOM_ID);
    } catch (_) {}

    setJoined(false);
    setConnectionStatus('disconnected');
    setMessages([]);
    setDraftTranscript('');
    setIsDraftActive(false);
    window.history.pushState({}, '', `/`);
  };

  // Send Text Message
  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const t1 = Date.now();
    const hasMalayalamScript = /[\u0D00-\u0D7F]/.test(inputText);
    const sourceLang = hasMalayalamScript ? 'ml' : userRole === 'malayalam_speaker' ? 'ml' : 'en';
    setIsTranslating(true);
    setErrorMessage(null);

    const t2 = Date.now();
    console.log(`[STAGE 1 & 2: User Pressed Send & Request Leaving Browser] t1=${t1}, t2=${t2} (+${t2 - t1}ms)`);

    wsRef.current.send(
      JSON.stringify({
        type: 'SEND_MESSAGE',
        payload: {
          roomId,
          senderId: userId,
          senderName: userName || (sourceLang === 'ml' ? 'Malayalam Speaker' : 'English Speaker'),
          senderRole: sourceLang === 'ml' ? 'malayalam_speaker' : 'english_speaker',
          text: inputText.trim(),
          sourceLang,
          messageType: 'text',
          clientTimings: {
            t1_userPressSend: t1,
            t2_requestLeavesBrowser: t2,
          },
        },
      })
    );

    setInputText('');
  };

  // =========================================================================
  // REVIEW-BEFORE-TRANSLATION DICTATION PIPELINE
  // =========================================================================

  // Audio MIME type detector
  const getSupportedAudioMimeType = (): string => {
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
      return 'audio/webm';
    }
    const candidateTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/aac',
    ];
    for (const type of candidateTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  };

  // Start microphone recording with live audio level analysis
  const startRecording = async (targetOrEvent?: 'text' | 'voice' | React.SyntheticEvent) => {
    // Prevent overlapping startup calls
    if (isStartingRecordingRef.current || isRecordingRef.current) {
      console.warn('[Microphone] Recording already starting or active. Ignoring duplicate invocation.');
      return;
    }

    const target: 'text' | 'voice' = targetOrEvent === 'text' ? 'text' : 'voice';
    const activeLang = target === 'text' ? textDictationLangRef.current : dictationLangRef.current;
    recordingLangRef.current = activeLang;
    console.log(`[Microphone] startRecording initiated: target=${target}, activeLang=${activeLang}`);

    setErrorMessage(null);
    isCancelledRef.current = false;
    stopRequestedRef.current = false;
    isStartingRecordingRef.current = true;
    setIsStartingRecording(true);
    setRecordingTarget(target);
    recordingTargetRef.current = target;

    if (target === 'voice') {
      setDraftTranscript('');
      setIsDraftActive(false);
      setTranscriptionMetrics(null);
    } else if (target === 'text') {
      if (textInputRef.current) {
        cursorPositionRef.current = textInputRef.current.selectionStart;
      }
    }

    // Clean up any previously dangling stream or audio context
    if (recordingStreamRef.current) {
      try {
        recordingStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch (_) {}
      recordingStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close().catch(() => {});
      } catch (_) {}
      audioContextRef.current = null;
    }

    try {
      // 1. Request microphone permission and stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // If user released or clicked stop while mic was initializing, exit cleanly
      if (stopRequestedRef.current || isCancelledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        isStartingRecordingRef.current = false;
        setIsStartingRecording(false);
        setRecordingTarget(null);
        recordingTargetRef.current = null;
        stopRequestedRef.current = false;
        return;
      }

      recordingStreamRef.current = stream;
      audioChunksRef.current = [];
      recordingStartTimeRef.current = Date.now();
      stopPressedTimeRef.current = null;

      // 2. Set up audio level meter with safety
      try {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtxClass) {
          const audioCtx = new AudioCtxClass();
          audioContextRef.current = audioCtx;
          if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
          }
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyserRef.current = analyser;
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);

          const dataArr = new Uint8Array(analyser.frequencyBinCount);
          const updateRecordingMeter = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArr);
            let sum = 0;
            for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
            const avg = sum / dataArr.length;
            const level = Math.min(100, Math.round((avg / 128) * 100));
            setMicAudioLevel(level);
            liveAudioMeterFrameRef.current = requestAnimationFrame(updateRecordingMeter);
          };
          updateRecordingMeter();
        }
      } catch (audioErr) {
        console.warn('AudioContext level monitor unavailable:', audioErr);
      }

      // 3. Create MediaRecorder with supported mimeType
      const mimeType = getSupportedAudioMimeType();
      const options: MediaRecorderOptions = {};
      if (mimeType) {
        options.mimeType = mimeType;
      }
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      const actualMimeType = mediaRecorder.mimeType || mimeType || 'audio/webm';
      recordedMimeTypeRef.current = actualMimeType;

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        isRecordingRef.current = false;
        setIsRecording(false);

        // If recording was explicitly cancelled, discard and exit immediately
        if (isCancelledRef.current) {
          isCancelledRef.current = false;
          setRecordingTarget(null);
          recordingTargetRef.current = null;
          setIsTranscribing(false);
          setMicAudioLevel(0);
          if (recordingStreamRef.current) {
            recordingStreamRef.current.getTracks().forEach((track) => track.stop());
            recordingStreamRef.current = null;
          }
          return;
        }

        const currentTarget = recordingTargetRef.current || 'voice';
        const tUploadStart = Date.now();
        const tStopPressed = stopPressedTimeRef.current || tUploadStart;
        const stopToUploadMs = Math.max(0, tUploadStart - tStopPressed);
        const tRecordStart = recordingStartTimeRef.current || tStopPressed;
        const recordingDurationSec = Number((Math.max(0, tStopPressed - tRecordStart) / 1000).toFixed(1));

        // Stop audio level monitor
        if (liveAudioMeterFrameRef.current) {
          cancelAnimationFrame(liveAudioMeterFrameRef.current);
          liveAudioMeterFrameRef.current = null;
        }
        setMicAudioLevel(0);

        if (recordingStreamRef.current) {
          recordingStreamRef.current.getTracks().forEach((track) => track.stop());
          recordingStreamRef.current = null;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: recordedMimeTypeRef.current });

        // Validate that audio chunks exist and blob contains usable audio
        if (!audioBlob || audioBlob.size < 200 || audioChunksRef.current.length === 0) {
          console.warn(`[Microphone] Audio blob too small or empty (${audioBlob?.size || 0} bytes, ${audioChunksRef.current.length} chunks)`);
          setIsTranscribing(false);
          setRecordingTarget(null);
          recordingTargetRef.current = null;
          setErrorMessage('Audio recording was too short or silent. Please hold mic closer and speak clearly.');
          return;
        }

        try {
          const speechInputLang =
            recordingLangRef.current ||
            (currentTarget === 'text' ? textDictationLangRef.current : dictationLangRef.current);
          console.log(
            `[Microphone] onstop uploading: target=${currentTarget}, speechInputLang=${speechInputLang}, blobSize=${audioBlob.size}, mime=${recordedMimeTypeRef.current}`
          );
          // Direct binary stream upload: cuts client base64 overhead and reduces payload by ~33%
          const transcribeRes = await fetch(`/api/transcribe?language=${speechInputLang}`, {
            method: 'POST',
            headers: {
              'Content-Type': audioBlob.type || recordedMimeTypeRef.current || 'audio/webm',
              'x-language': speechInputLang,
            },
            body: audioBlob,
          });

          const tResponseReceived = Date.now();
          const uploadAndServerMs = tResponseReceived - tUploadStart;

          if (!transcribeRes.ok) {
            const errData = await transcribeRes.json().catch(() => ({}));
            throw new Error(errData.error || `Audio transcription failed (HTTP ${transcribeRes.status})`);
          }

          const data = await transcribeRes.json();
          const transcribedText = (data.text || '').trim();
          const totalLatencyMs = Date.now() - tStopPressed;

          setIsTranscribing(false);
          setRecordingTarget(null);
          recordingTargetRef.current = null;

          if (transcribedText) {
            if (currentTarget === 'text') {
              // Insert dictated speech into Text Mode input without overwriting existing text
              setInputText((prev) => {
                if (!prev.trim()) return transcribedText;
                const pos = cursorPositionRef.current;
                if (pos !== null && pos >= 0 && pos <= prev.length) {
                  const before = prev.slice(0, pos).trimEnd();
                  const after = prev.slice(pos).trimStart();
                  return [before, transcribedText, after].filter(Boolean).join(' ');
                }
                return `${prev.trim()} ${transcribedText}`;
              });
              setErrorMessage(null);
              // Focus text input for convenient user editing
              setTimeout(() => {
                textInputRef.current?.focus();
              }, 60);
            } else {
              // Push-to-Talk voice mode: populate draft transcript for user review and correction
              setTranscriptionMetrics({
                recordingDurationSec,
                stopToUploadMs,
                uploadAndServerMs,
                geminiProcessingMs: data.timings?.geminiDurationMs || data.geminiDurationMs || uploadAndServerMs,
                totalLatencyMs,
                modelUsed: data.modelUsed || data.timings?.modelUsed || 'gemini-3.5-transcribe',
              });
              setDraftTranscript(transcribedText);
              setIsDraftActive(true);
              setDraftSourceLang(speechInputLang);
              setErrorMessage(null);
              // Focus the draft textarea for direct keyboard editing
              setTimeout(() => {
                if (draftTextareaRef.current) {
                  draftTextareaRef.current.focus();
                  const len = draftTextareaRef.current.value.length;
                  draftTextareaRef.current.setSelectionRange(len, len);
                }
              }, 80);
            }
          } else {
            setErrorMessage(
              `No speech detected in ${speechInputLang === 'ml' ? 'Malayalam' : 'English'}. Please hold mic closer and speak clearly.`
            );
          }
        } catch (err: any) {
          setIsTranscribing(false);
          setRecordingTarget(null);
          recordingTargetRef.current = null;
          setErrorMessage(err.message || 'Voice transcription failed');
        }
      };

      // 4. Start recording with a 250ms timeslice to ensure continuous chunk gathering
      mediaRecorder.start(250);
      isRecordingRef.current = true;
      setIsRecording(true);
      isStartingRecordingRef.current = false;
      setIsStartingRecording(false);
      setRecordingDuration(0);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      isStartingRecordingRef.current = false;
      setIsStartingRecording(false);
      isRecordingRef.current = false;
      setIsRecording(false);
      setRecordingTarget(null);
      recordingTargetRef.current = null;
      console.error('Microphone access denied:', err);
      const isAndroidConflict =
        err?.name === 'TrackStartError' ||
        err?.name === 'NotReadableError' ||
        err?.message?.includes('concurrent') ||
        err?.message?.includes('in use');
      setErrorMessage(
        isAndroidConflict
          ? 'Microphone is currently held in exclusive communication mode by the Google Meet app on this phone. Note: Android OS may block simultaneous microphone capture while a call is active in another app. (You do not need to mute/unmute Google Meet; if your phone blocks simultaneous access, use Text Mode or place a second device nearby).'
          : err?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Tap the lock/tune icon in the Chrome URL bar, select Permissions, and allow Microphone access.'
          : err?.name === 'AbortError'
          ? 'Audio recording was interrupted. Please tap Start Recording again.'
          : 'Microphone access could not be established. Please check browser permissions.'
      );
    }
  };

  const stopRecording = () => {
    // If user clicked stop while getUserMedia was still awaiting permission/hardware:
    if (isStartingRecordingRef.current) {
      stopRequestedRef.current = true;
      setIsStartingRecording(false);
      return;
    }

    if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
      stopPressedTimeRef.current = Date.now();
      setIsTranscribing(true);
      try {
        // Request any pending data to flush into ondataavailable before stopping
        if (mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.requestData();
        }
      } catch (_) {}
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.warn('MediaRecorder stop error:', e);
      }
      isRecordingRef.current = false;
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }
  };

  const cancelRecording = () => {
    isCancelledRef.current = true;
    stopRequestedRef.current = true;
    isStartingRecordingRef.current = false;
    setIsStartingRecording(false);
    isRecordingRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        // ignore
      }
    }
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close().catch(() => {});
      } catch (_) {}
      audioContextRef.current = null;
    }
    if (liveAudioMeterFrameRef.current) {
      cancelAnimationFrame(liveAudioMeterFrameRef.current);
      liveAudioMeterFrameRef.current = null;
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    setIsRecording(false);
    setRecordingTarget(null);
    recordingTargetRef.current = null;
    setIsTranscribing(false);
    setMicAudioLevel(0);
  };

  // Submit approved, corrected transcript through the faithful translation pipeline
  const handleApproveAndTranslate = () => {
    const textToTranslate = draftTranscript.trim();
    if (!textToTranslate || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const t1 = Date.now();
    const sourceLang = draftSourceLang;
    setIsTranslating(true);
    setErrorMessage(null);

    const t2 = Date.now();
    wsRef.current.send(
      JSON.stringify({
        type: 'SEND_MESSAGE',
        payload: {
          roomId,
          senderId: userId,
          senderName: userName || (sourceLang === 'ml' ? 'Malayalam Speaker' : 'English Speaker'),
          senderRole: sourceLang === 'ml' ? 'malayalam_speaker' : 'english_speaker',
          text: textToTranslate,
          sourceLang,
          messageType: 'voice',
          clientTimings: {
            t1_userPressSend: t1,
            t2_requestLeavesBrowser: t2,
          },
        },
      })
    );

    // Clear draft transcript once dispatched
    setDraftTranscript('');
    setIsDraftActive(false);
    setTranscriptionMetrics(null);
  };

  const handleDiscardDraft = () => {
    setDraftTranscript('');
    setIsDraftActive(false);
    setTranscriptionMetrics(null);
    setErrorMessage(null);
  };

  // Helper to insert sacred spiritual terms into the draft transcript at cursor position
  const handleInsertDraftTerm = (term: string) => {
    if (!draftTextareaRef.current) {
      setDraftTranscript((prev) => (prev ? `${prev} ${term}` : term));
      return;
    }
    const textarea = draftTextareaRef.current;
    const start = textarea.selectionStart ?? draftTranscript.length;
    const end = textarea.selectionEnd ?? draftTranscript.length;
    const before = draftTranscript.slice(0, start).trimEnd();
    const after = draftTranscript.slice(end).trimStart();
    const newText = [before, term, after].filter(Boolean).join(' ');
    setDraftTranscript(newText);
    setTimeout(() => {
      textarea.focus();
      const newCursor = before ? before.length + 1 + term.length : term.length;
      textarea.setSelectionRange(newCursor, newCursor);
    }, 40);
  };

  // =========================================================================
  // MICROPHONE & GOOGLE MEET ACOUSTIC DIAGNOSTIC
  // =========================================================================

  const runMicDiagnostic = async () => {
    setDiagnosticError(null);
    setIsTestingMic(true);

    try {
      // 1. Check browser permission query if supported
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          setMicPermissionStatus(status.state as any);
          status.onchange = () => setMicPermissionStatus(status.state as any);
        } catch (_) {}
      }

      // 2. Request microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      diagnosticStreamRef.current = stream;
      setMicPermissionStatus('granted');

      // 3. Connect Web Audio Analyser
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkAudioLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const level = Math.min(100, Math.round((avg / 128) * 100));
        setDiagnosticAudioLevel(level);
        animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
      };
      checkAudioLevel();
    } catch (err: any) {
      console.error('Microphone diagnostic error:', err);
      setMicPermissionStatus('denied');
      setDiagnosticError(
        err?.name === 'NotAllowedError'
          ? 'Microphone permission denied by Android/Browser. Please tap the lock icon in the Chrome URL bar and allow Microphone.'
          : err?.name === 'TrackStartError'
          ? 'Microphone hardware is locked by Google Meet (Call in progress). Android restricts concurrent microphone access while Meet holds the communication channel.'
          : err?.message || 'Failed to access microphone'
      );
      setIsTestingMic(false);
    }
  };

  const stopMicDiagnostic = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (diagnosticStreamRef.current) {
      diagnosticStreamRef.current.getTracks().forEach((t) => t.stop());
      diagnosticStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsTestingMic(false);
    setDiagnosticAudioLevel(0);
  };

  // Play Message Audio via Server TTS or Web Speech Synthesis
  const playMessageAudio = async (msg: ChatMessage) => {
    const textToSpeak = msg.translatedText;
    const targetLang = msg.targetLanguage;

    setCurrentlyPlayingId(msg.id);

    try {
      // 1. Try server-side OpenAI TTS first
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToSpeak,
          lang: targetLang,
        }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioPlayerRef.current = audio;
        audio.onended = () => setCurrentlyPlayingId(null);
        audio.onerror = () => setCurrentlyPlayingId(null);
        await audio.play();
        return;
      }
    } catch (err) {
      console.warn('Server TTS unavailable, using browser speech synthesis fallback');
    }

    // 2. Client-side SpeechSynthesis fallback
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.lang = targetLang === 'ml' ? 'ml-IN' : 'en-US';
      utterance.rate = 0.95;
      utterance.onend = () => setCurrentlyPlayingId(null);
      utterance.onerror = () => setCurrentlyPlayingId(null);
      window.speechSynthesis.speak(utterance);
    } else {
      setCurrentlyPlayingId(null);
    }
  };

  const stopAudio = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setCurrentlyPlayingId(null);
  };

  const copyRoomLink = () => {
    // Generate clean /room/ROOMID shareable URL
    const cleanRoomId = roomId.trim().toUpperCase();
    const fullUrl = `${window.location.origin}/room/${cleanRoomId}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // =========================================================================
  // VIEW: JOIN ROOM SCREEN
  // =========================================================================
  if (!joined) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-between p-4 sm:p-6 font-sans">
        <header className="max-w-md mx-auto w-full pt-8 pb-4 text-center">
          <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold tracking-wide uppercase mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            Faithful Real-Time Translation
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-2">
            LIVE TRANSLATOR
          </h1>
          <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
            Private two-person <span className="text-amber-400 font-medium">Malayalam ↔ English</span> live interpretation room with Roman transliteration and spiritual terminology preservation.
          </p>
        </header>

        <main className="max-w-md mx-auto w-full bg-slate-800/90 border border-slate-700 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          {/* Friendly Room Not Found Banner */}
          {roomNotFound && (
            <div className="mb-5 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1.5">
                  <div className="font-bold text-amber-300 text-sm">Room {roomId} not found</div>
                  <p className="text-slate-300">
                    This room may have closed or the link was mistyped. You can create this room now or start a new one.
                  </p>
                  <button
                    type="button"
                    onClick={handleCreateNewRoom}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 text-xs transition-all shadow"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Create New Room Instead
                  </button>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Room Code / Link ID
                </label>
                <button
                  type="button"
                  onClick={handleCreateNewRoom}
                  className="text-xs text-amber-400 hover:text-amber-300 underline font-medium flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  Generate New Code
                </button>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => {
                    setRoomId(e.target.value.toUpperCase());
                    setRoomNotFound(false);
                  }}
                  placeholder="e.g. ABC123"
                  required
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3.5 text-lg font-mono tracking-widest text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                Shareable link: <span className="text-slate-400 font-mono">/room/{roomId || 'ABC123'}</span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                Your Role in This Room
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setUserRole('malayalam_speaker')}
                  className={`flex flex-col items-start p-3.5 rounded-xl border text-left transition-all ${
                    userRole === 'malayalam_speaker'
                      ? 'bg-amber-500/15 border-amber-500 ring-2 ring-amber-500/40'
                      : 'bg-slate-900/60 border-slate-700/80 hover:border-slate-600'
                  }`}
                >
                  <span className="text-xs font-bold text-amber-400">PERSON A</span>
                  <span className="text-sm font-semibold text-white mt-0.5">Malayalam Speaker</span>
                  <span className="text-xs text-slate-400 mt-1 font-serif">മലയാളം സംസാരിക്കുന്നയാൾ</span>
                </button>

                <button
                  type="button"
                  onClick={() => setUserRole('english_speaker')}
                  className={`flex flex-col items-start p-3.5 rounded-xl border text-left transition-all ${
                    userRole === 'english_speaker'
                      ? 'bg-emerald-500/15 border-emerald-500 ring-2 ring-emerald-500/40'
                      : 'bg-slate-900/60 border-slate-700/80 hover:border-slate-600'
                  }`}
                >
                  <span className="text-xs font-bold text-emerald-400">PERSON B</span>
                  <span className="text-sm font-semibold text-white mt-0.5">English Speaker</span>
                  <span className="text-xs text-slate-400 mt-1">Natural English</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                Your Display Name (Optional)
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder={userRole === 'malayalam_speaker' ? 'e.g. Swamiji / Devotee' : 'e.g. John / Seeker'}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold py-3.5 px-6 rounded-xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <Radio className="w-5 h-5 text-slate-950" />
              Enter Live Translation Room
            </button>
          </form>

          {/* Engine Status indicator */}
          <div className="mt-6 pt-4 border-t border-slate-700/60 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${serverStatus?.openaiConfigured ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              AI Engine: {serverStatus?.model || 'OpenAI / Interpreter Engine'}
            </span>
            <button
              type="button"
              onClick={() => setShowSpiritualTermsGuide(!showSpiritualTermsGuide)}
              className="text-amber-400 hover:underline flex items-center gap-1"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Faithful Rule Guide
            </button>
          </div>
        </main>

        {showSpiritualTermsGuide && (
          <div className="max-w-md mx-auto w-full mt-4 p-4 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-slate-300 space-y-2">
            <div className="font-semibold text-amber-300">Faithful Interpreter Principles:</div>
            <ul className="list-disc pl-4 space-y-1 text-slate-400">
              <li>The AI never answers questions or creates conversation; it translates only.</li>
              <li>Spiritual terms like <em>Gurudev, Guruthva, sadhana, diksha, atma, Paramatma, moksha, guru seva</em> are strictly preserved.</li>
              <li>Every Malayalam phrase produces an authentic Roman transliteration.</li>
            </ul>
          </div>
        )}

        <footer className="text-center py-4 text-xs text-slate-500">
          Live Translator • Private Malayalam ↔ English Live Room
        </footer>
      </div>
    );
  }

  // =========================================================================
  // VIEW: MAIN ACTIVE TRANSLATION ROOM
  // =========================================================================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="bg-slate-900/90 border-b border-slate-800 px-4 py-3 sticky top-0 z-30 backdrop-blur-md">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
          {/* Brand & Room Info */}
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-black text-base sm:text-lg tracking-tight text-white flex items-center gap-1.5">
                  <Languages className="w-5 h-5 text-amber-400" />
                  LIVE TRANSLATOR
                </h1>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-slate-800 text-amber-300 border border-slate-700">
                  {roomId}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs mt-0.5">
                <span className="flex items-center gap-1">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      connectionStatus === 'connected'
                        ? 'bg-emerald-400 animate-pulse'
                        : connectionStatus === 'connecting'
                        ? 'bg-amber-400 animate-ping'
                        : 'bg-rose-500'
                    }`}
                  />
                  <span className="text-slate-400 capitalize">{connectionStatus}</span>
                </span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400 flex items-center gap-1">
                  <Users className="w-3 h-3 text-slate-400" />
                  {participants.length} present
                </span>
              </div>
            </div>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2">
            {/* Transliteration Toggle */}
            <button
              onClick={() => setShowTransliteration(!showTransliteration)}
              title={showTransliteration ? 'Roman Transliteration ON' : 'Roman Transliteration OFF'}
              className={`p-2 rounded-lg border transition-all text-xs flex items-center gap-1.5 ${
                showTransliteration
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              <Languages className="w-4 h-4" />
              <span className="hidden lg:inline font-medium">Translit</span>
            </button>

            {/* Auto Play Toggle */}
            <button
              onClick={() => setAutoPlay(!autoPlay)}
              title={autoPlay ? 'Auto-play speech enabled' : 'Auto-play speech muted'}
              className={`p-2 rounded-lg border transition-all text-xs flex items-center gap-1.5 ${
                autoPlay
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              {autoPlay ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span className="hidden md:inline font-medium">Auto-Play</span>
            </button>

            {/* Share / Copy Room Link */}
            <button
              onClick={copyRoomLink}
              title="Copy Room Link to send to Person B"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-all text-xs flex items-center gap-1.5"
            >
              {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
              <span className="hidden sm:inline font-medium">{copiedLink ? 'Copied Link' : 'Share Room'}</span>
            </button>

            {/* Exit Room */}
            <button
              onClick={handleLeave}
              title="Leave Room"
              className="p-2 rounded-lg bg-slate-800 hover:bg-rose-950/40 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-400 transition-all"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mode Selector Tabs (TEXT | VOICE | LIVE) */}
        <div className="max-w-4xl mx-auto mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between">
          <div className="inline-flex p-1 rounded-xl bg-slate-900 border border-slate-800">
            <button
              onClick={() => setMode('text')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                mode === 'text'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              TEXT MODE
            </button>
            <button
              onClick={() => setMode('voice')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                mode === 'voice'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              PUSH-TO-TALK
            </button>
            <button
              onClick={() => setMode('live')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide flex items-center gap-1 transition-all ${
                mode === 'live'
                  ? 'bg-red-500 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              LIVE INTERPRETER
            </button>
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <span className="text-slate-500">Your Role:</span>
            <span
              className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${ROLE_CONFIGS[userRole].badge}`}
            >
              {userRole === 'malayalam_speaker' ? 'Malayalam (മലയാളം)' : 'English'}
            </span>
          </div>
        </div>
      </header>

      {/* Error / Alert banner */}
      {errorMessage && (
        <div className="max-w-4xl mx-auto w-full px-4 pt-3">
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 hover:text-white font-bold ml-2"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Main Conversation Stream */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-4 overflow-y-auto space-y-4">
        {messages.length === 0 ? (
          <div className="h-64 sm:h-80 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-800 rounded-2xl my-6">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3">
              <Languages className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-white text-base sm:text-lg mb-1">
              Room {roomId} is active
            </h3>
            <p className="text-slate-400 text-xs sm:text-sm max-w-md mb-4">
              Send a message in {userRole === 'malayalam_speaker' ? 'Malayalam' : 'English'}. The AI will faithfully interpret with full Roman transliteration and audio speech.
            </p>
            <button
              onClick={copyRoomLink}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-400 text-xs font-semibold flex items-center gap-2"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy Room Link to Invite Person B
            </button>
          </div>
        ) : (
          messages.map((msg) => {
            const isSelf = msg.senderId === userId;
            const isMalayalamInput = msg.sourceLanguage === 'ml';

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'} space-y-1`}
              >
                {/* Speaker Header */}
                <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
                  <span className="font-semibold text-slate-300">{msg.senderName}</span>
                  <span className={`px-1.5 py-0.2 rounded text-[10px] border ${ROLE_CONFIGS[msg.senderRole].badge}`}>
                    {msg.senderRole === 'malayalam_speaker' ? 'മലയാളം' : 'English'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Interpretation Message Card */}
                <div
                  className={`max-w-[90%] sm:max-w-[80%] rounded-2xl p-4 shadow-lg border transition-all ${
                    isSelf
                      ? 'bg-slate-900 border-amber-500/40 text-slate-100 rounded-tr-none'
                      : 'bg-slate-900/90 border-slate-700 text-slate-100 rounded-tl-none'
                  }`}
                >
                  {/* Original Input Section */}
                  <div className="pb-2.5 mb-2.5 border-b border-slate-800">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1 flex items-center justify-between">
                      <span>Original ({isMalayalamInput ? 'Malayalam' : 'English'})</span>
                      {msg.messageType === 'voice' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Voice Transcript
                        </span>
                      )}
                    </div>
                    <p className={`text-base leading-relaxed text-slate-200 ${isMalayalamInput ? 'font-serif' : 'font-sans'}`}>
                      {msg.originalText}
                    </p>
                  </div>

                  {/* Roman Transliteration Section (Crucial for Malayalam text) */}
                  {showTransliteration && msg.transliteration && (
                    <div className="pb-2.5 mb-2.5 border-b border-slate-800/80">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/90 mb-0.5">
                        Transliteration (Roman Script)
                      </div>
                      <p className="text-sm font-mono text-amber-200/90 leading-relaxed italic bg-amber-950/20 p-2 rounded-lg border border-amber-900/30">
                        {msg.transliteration}
                      </p>
                    </div>
                  )}

                  {/* Faithful Translation Section */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 mb-1 flex items-center justify-between">
                      <span>Faithful Translation ({msg.targetLanguage === 'ml' ? 'Malayalam' : 'English'})</span>
                      {currentlyPlayingId === msg.id ? (
                        <button
                          onClick={stopAudio}
                          className="flex items-center gap-1 text-[11px] text-amber-400 font-semibold hover:underline"
                        >
                          <VolumeX className="w-3.5 h-3.5" /> Stop Audio
                        </button>
                      ) : (
                        <button
                          onClick={() => playMessageAudio(msg)}
                          className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold hover:underline"
                        >
                          <Volume2 className="w-3.5 h-3.5" /> Listen
                        </button>
                      )}
                    </div>
                    <p className={`text-base font-medium text-emerald-100 leading-relaxed ${msg.targetLanguage === 'ml' ? 'font-serif' : 'font-sans'}`}>
                      {msg.translatedText}
                    </p>
                  </div>

                  {/* 11-Stage Pipeline Timing Diagnostics */}
                  {msg.timings && (
                    <div className="mt-3 pt-2.5 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => toggleTiming(msg.id)}
                        className="w-full flex items-center justify-between text-[11px] text-slate-400 hover:text-amber-400 py-1 transition-colors group"
                      >
                        <span className="flex items-center gap-1.5 font-medium">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          <span>Pipeline Latency:</span>
                          <span className="text-amber-300 font-mono font-bold">
                            {(
                              (msg.timings.t10_renderedOnScreen || msg.timings.t11_reachedSecondDevice || msg.timings.t9_responseLeavesServer) -
                              msg.timings.t1_userPressSend
                            ).toLocaleString()}{' '}
                            ms
                          </span>
                        </span>
                        <span className="text-[10px] text-slate-500 group-hover:text-amber-300 flex items-center gap-0.5">
                          {expandedTimingIds[msg.id] ? (
                            <>
                              Hide 11 Stages <ChevronUp className="w-3 h-3" />
                            </>
                          ) : (
                            <>
                              View 11 Stages <ChevronDown className="w-3 h-3" />
                            </>
                          )}
                        </span>
                      </button>

                      {expandedTimingIds[msg.id] && (
                        <div className="mt-2 p-3 bg-slate-950/80 border border-slate-800 rounded-xl font-mono text-[11px] space-y-1.5 text-slate-300 shadow-inner">
                          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-amber-400 pb-1 border-b border-slate-800">
                            <span>11-Stage Timing Diagnostics</span>
                            <span className="text-slate-400 font-normal">
                              Mode: {msg.timings.aiDetails?.aiExecutionMode || '1 request'}
                            </span>
                          </div>

                          <div className="flex justify-between py-0.5">
                            <span className="text-slate-400">1. User presses Send</span>
                            <span className="text-slate-300">0 ms (T0)</span>
                          </div>

                          <div className="flex justify-between py-0.5">
                            <span className="text-slate-400">2. Request leaves browser</span>
                            <span className="text-slate-300">
                              +{Math.max(0, msg.timings.t2_requestLeavesBrowser - msg.timings.t1_userPressSend)} ms
                            </span>
                          </div>

                          <div className="flex justify-between py-0.5">
                            <span className="text-slate-400">3. Server receives request (network transit)</span>
                            <span className="text-slate-300">
                              +{Math.max(0, msg.timings.t3_serverReceivesRequest - msg.timings.t2_requestLeavesBrowser)} ms
                            </span>
                          </div>

                          <div className="flex justify-between py-0.5">
                            <span className="text-slate-400">4. AI request starts (server setup)</span>
                            <span className="text-slate-300">
                              +{Math.max(0, msg.timings.t4_aiRequestStarts - msg.timings.t3_serverReceivesRequest)} ms
                            </span>
                          </div>

                          <div className="flex justify-between py-0.5 text-amber-300 font-semibold bg-amber-950/20 px-1.5 rounded border border-amber-900/30">
                            <span>5. AI response received (AI latency)</span>
                            <span>
                              +{Math.max(0, msg.timings.t5_aiResponseReceived - msg.timings.t4_aiRequestStarts)} ms
                            </span>
                          </div>

                          {/* AI Request Details */}
                          {msg.timings.aiDetails && (
                            <div className="my-1.5 p-2 rounded-lg bg-slate-900 border border-slate-800/80 text-[10px] space-y-1">
                              <div className="text-slate-400">
                                • Strategy:{' '}
                                <strong className="text-amber-300">
                                  {msg.timings.aiDetails.aiExecutionMode}
                                </strong>{' '}
                                ({msg.timings.aiDetails.aiRequestCount} total AI attempt{msg.timings.aiDetails.aiRequestCount > 1 ? 's' : ''})
                              </div>
                              <div className="text-slate-400">
                                • Translation + Transliteration:{' '}
                                <span className="text-slate-200">Generated together in 1 single prompt</span>
                              </div>
                              {msg.timings.aiDetails.attemptedOpenAI && (
                                <div className="text-rose-400">
                                  • OpenAI Attempt: Failed after{' '}
                                  <strong>{msg.timings.aiDetails.openAIDurationMs} ms</strong>{' '}
                                  ({msg.timings.aiDetails.openAIError?.slice(0, 48)}...)
                                </div>
                              )}
                              {msg.timings.aiDetails.geminiModelUsed && (
                                <div className="text-emerald-400">
                                  • Gemini Fallback ({msg.timings.aiDetails.geminiModelUsed}): Succeeded in{' '}
                                  <strong>{msg.timings.aiDetails.geminiDurationMs} ms</strong>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="flex justify-between py-0.5">
                            <span className="text-slate-400">6. Translation & transliteration parsed</span>
                            <span className="text-slate-300">
                              +{Math.max(0, msg.timings.t6_parsedComplete - msg.timings.t5_aiResponseReceived)} ms
                            </span>
                          </div>

                          <div className="flex justify-between py-0.5">
                            <span className="text-slate-400">7. Firebase/Firestore write starts</span>
                            <span className="text-slate-300">
                              +{Math.max(0, msg.timings.t7_dbWriteStarts - msg.timings.t6_parsedComplete)} ms
                            </span>
                          </div>

                          <div className="flex justify-between py-0.5">
                            <span className="text-slate-400">8. Firebase/Firestore write completes</span>
                            <span className="text-slate-300">
                              +{Math.max(0, msg.timings.t8_dbWriteCompletes - msg.timings.t7_dbWriteStarts)} ms{' '}
                              <span className="text-slate-500">({msg.timings.storageType || 'In-Memory Partition'})</span>
                            </span>
                          </div>

                          <div className="flex justify-between py-0.5">
                            <span className="text-slate-400">9. Response returned to browser</span>
                            <span className="text-slate-300">
                              +{Math.max(0, msg.timings.t9_responseLeavesServer - msg.timings.t8_dbWriteCompletes)} ms
                            </span>
                          </div>

                          {msg.timings.t10_renderedOnScreen && (
                            <div className="flex justify-between py-0.5 text-emerald-300 font-semibold">
                              <span>10. Message rendered on screen</span>
                              <span>
                                +{Math.max(0, msg.timings.t10_renderedOnScreen - msg.timings.t9_responseLeavesServer)} ms{' '}
                                (Total: {msg.timings.t10_renderedOnScreen - msg.timings.t1_userPressSend} ms)
                              </span>
                            </div>
                          )}

                          {msg.timings.t11_reachedSecondDevice && (
                            <div className="flex justify-between py-0.5 text-cyan-300 font-semibold">
                              <span>11. Realtime reached 2nd device</span>
                              <span>
                                +{Math.max(0, msg.timings.t11_reachedSecondDevice - msg.timings.t9_responseLeavesServer)} ms{' '}
                                (Total: {msg.timings.t11_reachedSecondDevice - msg.timings.t1_userPressSend} ms)
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Translation in progress skeleton */}
        {isTranslating && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-800 max-w-sm animate-pulse">
            <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
            <span className="text-xs text-amber-300 font-medium">
              Faithfully interpreting and generating transliteration...
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Bottom Control Dock */}
      <footer className="bg-slate-900 border-t border-slate-800 p-3 sm:p-4 sticky bottom-0 z-20">
        <div className="max-w-4xl mx-auto">
          {/* MODE 1: TEXT TRANSLATION WITH INLINE DICTATION */}
          {mode === 'text' && (
            <div className="space-y-2">
              {/* Header Bar: Speech Language Toggle & Quick Spiritual Terms */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-0.5">
                {/* Dictation Language Selector Pill */}
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] shrink-0">
                  <Languages className="w-3.5 h-3.5 text-amber-400 ml-1 shrink-0" />
                  <span className="text-slate-400 text-[11px] px-1 hidden sm:inline font-medium">Dictate:</span>
                  <button
                    type="button"
                    onClick={() => handleSetTextDictationLang('ml')}
                    disabled={isRecording || isTranscribing}
                    className={`px-2 py-0.5 rounded-lg transition-all text-[11px] font-semibold cursor-pointer ${
                      textDictationLang === 'ml'
                        ? 'bg-amber-500 text-slate-950 font-bold shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Dictate in Malayalam (transcribes verbatim into Malayalam script)"
                  >
                    മലയാളം (ML)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetTextDictationLang('en')}
                    disabled={isRecording || isTranscribing}
                    className={`px-2 py-0.5 rounded-lg transition-all text-[11px] font-semibold cursor-pointer ${
                      textDictationLang === 'en'
                        ? 'bg-amber-500 text-slate-950 font-bold shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Dictate in English (transcribes verbatim into English text)"
                  >
                    English (EN)
                  </button>
                </div>

                {/* Quick spiritual terminology suggestions */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-[11px] text-slate-400 scrollbar-none">
                  <span className="shrink-0 text-slate-500 font-medium hidden md:inline">Terms:</span>
                  {(textDictationLang === 'ml' || userRole === 'malayalam_speaker'
                    ? ['ഗുരുദേവ്', 'സാധന', 'ഗുരുത്വം', 'ദീക്ഷ', 'ആത്മാവ്', 'മോക്ഷം']
                    : ['Gurudev', 'Sadhana', 'Guruthva', 'Diksha', 'Atma', 'Moksha']
                  ).map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() =>
                        setInputText((prev) => (prev ? `${prev} ${term}` : term))
                      }
                      className="shrink-0 px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-amber-300/90 border border-slate-700/80 transition-all font-mono cursor-pointer"
                    >
                      +{term}
                    </button>
                  ))}
                </div>
              </div>

              {/* ACTIVE TEXT MODE RECORDING STATE */}
              {isRecording && recordingTarget === 'text' ? (
                <div className="flex items-center gap-2 bg-slate-950 border-2 border-red-500/70 rounded-xl p-2.5 shadow-xl animate-in fade-in duration-150">
                  {/* Pulsing red dot & duration */}
                  <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-red-400 shrink-0 pl-1">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                    <span>
                      Dictating {textDictationLang === 'ml' ? 'Malayalam' : 'English'} ({recordingDuration}s)
                    </span>
                  </div>

                  {/* Audio level meter */}
                  <div className="flex-1 hidden xs:flex items-center h-2 bg-slate-800 rounded-full overflow-hidden mx-2">
                    <div
                      className={`h-full transition-all duration-75 ${
                        micAudioLevel > 35
                          ? 'bg-emerald-400'
                          : micAudioLevel > 15
                          ? 'bg-amber-400'
                          : 'bg-slate-600'
                      }`}
                      style={{ width: `${Math.max(8, micAudioLevel)}%` }}
                    />
                  </div>

                  {/* Recording Actions: Cancel vs Done */}
                  <div className="flex items-center gap-1.5 ml-auto shrink-0">
                    <button
                      type="button"
                      onClick={cancelRecording}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1 border border-slate-700 transition-all cursor-pointer"
                      title="Cancel dictation (preserves previously typed text)"
                    >
                      <X className="w-3.5 h-3.5 text-slate-400" />
                      <span className="hidden sm:inline">Cancel</span>
                    </button>

                    <button
                      type="button"
                      onClick={stopRecording}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow transition-all active:scale-95 cursor-pointer"
                      title="Done speaking: stop and insert verbatim transcript"
                    >
                      <Check className="w-4 h-4 text-slate-950" />
                      <span>Done</span>
                    </button>
                  </div>
                </div>
              ) : isTranscribing && recordingTarget === 'text' ? (
                /* TRANSCRIBING STATE FOR TEXT MODE */
                <div className="flex items-center justify-between gap-2 bg-slate-950 border border-amber-500/50 rounded-xl px-4 py-3 text-xs sm:text-sm text-amber-300 shadow">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                    <span>
                      Transcribing {textDictationLang === 'ml' ? 'Malayalam speech into Malayalam script' : 'English speech into English text'}...
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">Verbatim • Not sent yet</span>
                </div>
              ) : (
                /* NORMAL TEXT INPUT COMPOSER WITH DICTATION MICROPHONE */
                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                  <div className="relative flex-1 flex items-center">
                    <input
                      ref={textInputRef}
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onSelect={(e) => {
                        cursorPositionRef.current = (e.target as HTMLInputElement).selectionStart;
                      }}
                      placeholder={
                        textDictationLang === 'ml'
                          ? 'മലയാളത്തിൽ ടൈപ്പ് ചെയ്യുക അല്ലെങ്കിൽ മൈക്രോഫോൺ ടാപ്പുചെയ്യുക...'
                          : 'Type or tap mic to dictate in English...'
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-4 pr-11 py-3 text-sm sm:text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
                    />

                    {/* Microphone Dictation Button inside the input */}
                    <div className="absolute right-2 flex items-center">
                      <button
                        type="button"
                        onClick={() => startRecording('text')}
                        disabled={isRecording || isTranslating || isStartingRecording}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800/80 transition-all active:scale-95 cursor-pointer disabled:opacity-40"
                        title={
                          isStartingRecording && recordingTarget === 'text'
                            ? 'Starting microphone...'
                            : `Dictate in ${textDictationLang === 'ml' ? 'Malayalam (മലയാളം)' : 'English'}`
                        }
                        aria-label="Dictate message"
                      >
                        {isStartingRecording && recordingTarget === 'text' ? (
                          <RefreshCw className="w-5 h-5 text-amber-400 animate-spin" />
                        ) : (
                          <Mic className="w-5 h-5 text-amber-400" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!inputText.trim() || isTranslating}
                    className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold p-3 sm:px-5 sm:py-3 rounded-xl transition-all flex items-center gap-2 shadow-lg shrink-0 cursor-pointer active:scale-95"
                    title="Send message"
                  >
                    <Send className="w-5 h-5" />
                    <span className="hidden sm:inline">Send</span>
                  </button>
                </form>
              )}
            </div>
          )}

          {/* MODE 2: REVIEW-BEFORE-TRANSLATION DICTATION & VOICE */}
          {mode === 'voice' && (
            <div className="flex flex-col space-y-4 py-2">
              {/* Recording Controls Card */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col items-center text-center space-y-4">
                
                {/* 1. SPEECH-INPUT LANGUAGE SELECTOR */}
                <div className="w-full max-w-md bg-slate-950/90 border border-slate-700/80 rounded-xl p-3 flex flex-col space-y-2 text-left">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                      <Languages className="w-3.5 h-3.5 text-amber-400" />
                      Speech-Input Language:
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Destination: <span className="text-amber-300 font-bold">{dictationLang === 'ml' ? 'English' : 'Malayalam'}</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSetDictationLang('ml')}
                      disabled={isRecording || isTranscribing}
                      className={`p-2.5 rounded-lg text-left transition-all flex flex-col ${
                        dictationLang === 'ml'
                          ? 'bg-amber-500/20 border-2 border-amber-500 text-amber-200 shadow-md ring-2 ring-amber-500/20'
                          : 'bg-slate-900 border border-slate-700/80 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs sm:text-sm text-white">മലയാളം (Malayalam)</span>
                        {dictationLang === 'ml' && <Check className="w-4 h-4 text-amber-400" />}
                      </div>
                      <span className="text-[10px] text-slate-400 mt-0.5">Produces Malayalam Script</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetDictationLang('en')}
                      disabled={isRecording || isTranscribing}
                      className={`p-2.5 rounded-lg text-left transition-all flex flex-col ${
                        dictationLang === 'en'
                          ? 'bg-amber-500/20 border-2 border-amber-500 text-amber-200 shadow-md ring-2 ring-amber-500/20'
                          : 'bg-slate-900 border border-slate-700/80 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs sm:text-sm text-white">English</span>
                        {dictationLang === 'en' && <Check className="w-4 h-4 text-amber-400" />}
                      </div>
                      <span className="text-[10px] text-slate-400 mt-0.5">Produces English Text</span>
                    </button>
                  </div>
                </div>

                {/* Primary Recording Buttons */}
                <div className="flex flex-wrap items-center justify-center gap-3 w-full">
                  {!isRecording ? (
                    <button
                      type="button"
                      onClick={() => startRecording('voice')}
                      disabled={isTranscribing || isStartingRecording}
                      className="px-6 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold text-sm sm:text-base flex items-center gap-2.5 shadow-xl transition-all active:scale-95 cursor-pointer"
                    >
                      {isStartingRecording && recordingTarget === 'voice' ? (
                        <>
                          <RefreshCw className="w-5 h-5 text-slate-950 animate-spin" />
                          Starting Microphone...
                        </>
                      ) : (
                        <>
                          <Mic className="w-5 h-5 text-slate-950" />
                          Start Recording ({dictationLang === 'ml' ? 'Malayalam' : 'English'})
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="px-6 py-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm sm:text-base flex items-center gap-2.5 shadow-xl ring-4 ring-rose-500/30 animate-pulse transition-all active:scale-95 cursor-pointer"
                    >
                      <MicOff className="w-5 h-5" />
                      Stop Recording ({recordingDuration}s)
                    </button>
                  )}

                  {/* Push-to-Hold Alternative */}
                  {!isRecording && (
                    <button
                      type="button"
                      onMouseDown={() => startRecording('voice')}
                      onMouseUp={stopRecording}
                      onTouchStart={(e) => {
                        e.preventDefault();
                        startRecording('voice');
                      }}
                      onTouchEnd={(e) => {
                        e.preventDefault();
                        stopRecording();
                      }}
                      disabled={isTranscribing || isStartingRecording}
                      className="px-4 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-slate-300 font-semibold text-xs sm:text-sm flex items-center gap-2 transition-all select-none"
                      title="Hold to record, release to transcribe"
                    >
                      <Radio className="w-4 h-4 text-amber-400" />
                      Hold-to-Record
                    </button>
                  )}
                </div>

                {/* Live Acoustic Audio Level Meter during Recording */}
                {isRecording && (
                  <div className="w-full max-w-md bg-slate-950/80 border border-slate-700/80 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                        Microphone Acoustic Sound Level:
                      </span>
                      <span className={`font-mono font-bold ${micAudioLevel > 10 ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {micAudioLevel}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-100 ${
                          micAudioLevel > 40
                            ? 'bg-emerald-500'
                            : micAudioLevel > 15
                            ? 'bg-amber-500'
                            : 'bg-slate-600'
                        }`}
                        style={{ width: `${micAudioLevel}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {micAudioLevel > 8
                        ? `Sound detected through phone microphone (Listening for ${dictationLang === 'ml' ? 'Malayalam' : 'English'}).`
                        : 'Low audio level. If Gurudev is speaking via phone loudspeaker, hold mic closer or raise speaker volume.'}
                    </p>
                  </div>
                )}

                {/* Transcribing State */}
                {isTranscribing && (
                  <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs sm:text-sm font-medium">
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                    Transcribing {dictationLang === 'ml' ? 'Malayalam speech into Malayalam script' : 'English speech into English text'} with Gemini...
                  </div>
                )}

                <p className="text-xs text-slate-400 max-w-lg">
                  Captures voice acoustically through your phone’s microphone while Google Meet is active. The verbatim transcript appears in the review box below for your correction before anything is translated or sent.
                </p>
              </div>

              {/* REVIEW-BEFORE-TRANSLATION DRAFT CARD */}
              {isDraftActive && (
                <div className="bg-slate-900 border-2 border-amber-500/60 rounded-2xl p-4 sm:p-5 shadow-2xl space-y-3 animate-in fade-in duration-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                    <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                      <Edit3 className="w-4 h-4 text-amber-400" />
                      <span>Review & Correct Transcript Before Translating</span>
                    </div>
                    <span className="text-[11px] font-semibold uppercase px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {draftSourceLang === 'ml' ? 'Malayalam Script' : 'English Text'} • Not Sent Yet
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    {draftSourceLang === 'ml' ? (
                      <>
                        Verify Gurudev’s Malayalam words and correct any spelling, punctuation, or sacred spiritual terms using your device keyboard. Nothing is sent or translated until you tap Approve.
                      </>
                    ) : (
                      <>
                        Verify the English transcript and make any corrections directly below using your device keyboard. When approved, it will be translated faithfully into natural Malayalam script with Roman transliteration.
                      </>
                    )}
                  </p>

                  {/* Quick sacred spiritual terminology insertion chips */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] text-slate-400 scrollbar-none">
                    <span className="shrink-0 text-slate-500 font-medium">Quick terms:</span>
                    {(draftSourceLang === 'ml'
                      ? ['ഗുരുദേവ്', 'സാധന', 'ഗുരുത്വം', 'ദീക്ഷ', 'ആത്മാവ്', 'മോക്ഷം', 'സത്സംഗം']
                      : ['Gurudev', 'Sadhana', 'Guruthva', 'Diksha', 'Atma', 'Moksha', 'Satsang']
                    ).map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => handleInsertDraftTerm(term)}
                        className="shrink-0 px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700/80 transition-all font-mono text-xs cursor-pointer active:scale-95"
                        title={`Insert ${term} into draft`}
                      >
                        +{term}
                      </button>
                    ))}
                  </div>

                  {/* Fully Editable Text Area */}
                  <div className="relative">
                    <textarea
                      ref={draftTextareaRef}
                      value={draftTranscript}
                      onChange={(e) => setDraftTranscript(e.target.value)}
                      rows={4}
                      dir="auto"
                      autoComplete="off"
                      autoCorrect="on"
                      spellCheck={true}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 sm:p-4 text-base sm:text-lg text-white font-sans focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 leading-relaxed resize-y selection:bg-amber-500/30"
                      placeholder={
                        draftSourceLang === 'ml'
                          ? 'Edit Malayalam transcript here (മലയാളത്തിൽ തിരുത്തുക)...'
                          : 'Edit English transcript here...'
                      }
                    />
                    <div className="flex items-center justify-between mt-1 px-1 text-[11px] text-slate-500">
                      <span>
                        {draftTranscript.trim() ? (
                          <span className="text-emerald-400/90 font-medium">
                            ✓ Ready for translation ({draftTranscript.trim().split(/\s+/).filter(Boolean).length} words • {draftTranscript.length} chars)
                          </span>
                        ) : (
                          <span className="text-amber-400/90">
                            Type or paste your text above, or record again
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-slate-400">
                        Language: {draftSourceLang === 'ml' ? 'Malayalam' : 'English'}
                      </span>
                    </div>
                  </div>

                  {/* Transcription Timing & Latency Metrics */}
                  {transcriptionMetrics && (
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          Voice Pipeline Timing Breakdown
                        </span>
                        <span className="text-[11px] font-mono text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
                          Total Latency: {transcriptionMetrics.totalLatencyMs} ms
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                        <div className="bg-slate-900/90 rounded-lg p-2 border border-slate-800/80">
                          <div className="text-slate-400">1. Speech Duration</div>
                          <div className="font-semibold text-white mt-0.5">{transcriptionMetrics.recordingDurationSec}s</div>
                          <div className="text-[9px] text-slate-400">User speaking time</div>
                        </div>
                        <div className="bg-slate-900/90 rounded-lg p-2 border border-slate-800/80">
                          <div className="text-slate-400">2. Stop → Upload</div>
                          <div className="font-semibold text-white mt-0.5">{transcriptionMetrics.stopToUploadMs} ms</div>
                          <div className="text-[9px] text-slate-400">Client prep & network dispatch</div>
                        </div>
                        <div className="bg-slate-900/90 rounded-lg p-2 border border-slate-800/80">
                          <div className="text-slate-400">3. Gemini Processing</div>
                          <div className="font-semibold text-amber-300 mt-0.5">{transcriptionMetrics.geminiProcessingMs} ms</div>
                          <div className="text-[9px] text-slate-400">{transcriptionMetrics.modelUsed}</div>
                        </div>
                        <div className="bg-slate-900/90 rounded-lg p-2 border border-slate-800/80">
                          <div className="text-slate-400">4. Processing Latency</div>
                          <div className="font-semibold text-emerald-400 mt-0.5">{transcriptionMetrics.totalLatencyMs} ms</div>
                          <div className="text-[9px] text-slate-400">Stop click to editable text</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Draft Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <button
                      type="button"
                      onClick={handleDiscardDraft}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-all border border-slate-700 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                      Discard Transcript
                    </button>

                    <button
                      type="button"
                      onClick={handleApproveAndTranslate}
                      disabled={!draftTranscript.trim() || isTranslating}
                      className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-bold text-sm flex items-center gap-2 shadow-lg transition-all active:scale-95 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4 text-slate-950" />
                      Approve & Translate to {draftSourceLang === 'ml' ? 'English' : 'Malayalam'}
                    </button>
                  </div>
                </div>
              )}

              {/* MICROPHONE & GOOGLE MEET ACOUSTIC DIAGNOSTIC CARD */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowMicDiagnostic(!showMicDiagnostic)}
                  className="w-full px-4 py-3 flex items-center justify-between text-left text-xs font-semibold text-slate-300 hover:bg-slate-800/60 transition-all"
                >
                  <span className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-amber-400" />
                    Microphone & Google Meet Acoustic Diagnostic
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">
                      {isTestingMic ? 'Live Test Active' : 'Check Android Mic Access'}
                    </span>
                    {showMicDiagnostic ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                {showMicDiagnostic && (
                  <div className="p-4 border-t border-slate-800/80 bg-slate-950/60 space-y-3.5 text-xs">
                    <p className="text-slate-300 leading-relaxed">
                      This diagnostic tests whether Android Chrome can open the microphone while Google Meet is active and measures real-time acoustic input from your phone’s loudspeaker.
                    </p>

                    {/* Diagnostic Actions & Status */}
                    <div className="flex flex-wrap items-center gap-3">
                      {!isTestingMic ? (
                        <button
                          type="button"
                          onClick={runMicDiagnostic}
                          className="px-3.5 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow"
                        >
                          <Activity className="w-3.5 h-3.5" />
                          Start Microphone Test
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={stopMicDiagnostic}
                          className="px-3.5 py-2 rounded-lg bg-rose-600 text-white font-bold text-xs flex items-center gap-1.5 shadow"
                        >
                          <MicOff className="w-3.5 h-3.5" />
                          Stop Microphone Test
                        </button>
                      )}

                      <span className="text-slate-400">
                        Permission: <span className="text-white font-mono font-semibold capitalize">{micPermissionStatus}</span>
                      </span>
                    </div>

                    {/* Live Audio Level Progress Bar */}
                    {isTestingMic && (
                      <div className="space-y-1.5 bg-slate-900 border border-slate-800 rounded-lg p-3">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-300 font-medium">Acoustic Sound Level Gauge:</span>
                          <span className={`font-mono font-bold ${diagnosticAudioLevel > 10 ? 'text-emerald-400' : 'text-slate-400'}`}>
                            {diagnosticAudioLevel}% RMS
                          </span>
                        </div>
                        <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-75 ${
                              diagnosticAudioLevel > 40
                                ? 'bg-emerald-500'
                                : diagnosticAudioLevel > 15
                                ? 'bg-amber-500'
                                : 'bg-slate-600'
                            }`}
                            style={{ width: `${diagnosticAudioLevel}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {diagnosticAudioLevel > 12
                            ? '✅ Sound waves detected by microphone!'
                            : diagnosticAudioLevel > 0
                            ? '⚠️ Low audio level. Bring microphone closer to speaker.'
                            : '❌ 0% RMS. If Gurudev is speaking and the meter stays at 0%, Android AEC is filtering phone loudspeaker audio.'}
                        </p>
                      </div>
                    )}

                    {diagnosticError && (
                      <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold">Microphone Error</div>
                          <div>{diagnosticError}</div>
                        </div>
                      </div>
                    )}

                    {/* Technical Guidance Box */}
                    <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400 space-y-2">
                      <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-amber-400" />
                        Google Meet App & Android Compatibility Notes:
                      </div>
                      <ul className="list-disc list-inside space-y-1.5 text-slate-400">
                        <li>
                          <strong className="text-slate-300">No Muting Required in Meet:</strong> You do NOT need to mute or unmute yourself in the Google Meet app as part of this workflow.
                        </li>
                        <li>
                          <strong className="text-slate-300">Android Simultaneous Mic Access:</strong> Android puts active calls into <code className="text-amber-300 font-mono">VOICE_COMMUNICATION</code> mode. Some Android devices support concurrent recording in Chrome, while other device vendors restrict the microphone to one app at a time. The gauge above immediately tests whether your specific Android phone allows concurrent access.
                        </li>
                        <li>
                          <strong className="text-slate-300">Loudspeaker Acoustic Cancellation (AEC):</strong> Phone hardware actively filters out sound emitted by its own internal loudspeaker to prevent feedback in Meet. If the gauge remains near 0% while Gurudev speaks, hold the phone near an external speaker or use a secondary device.
                        </li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* MODE 3: REALTIME SIMULTANEOUS LIVE INTERPRETER */}
          {mode === 'live' && (
            <div className="flex flex-col items-center justify-center py-3 bg-slate-950/70 border border-red-900/30 rounded-2xl p-4 text-center">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-3 h-3 rounded-full ${isLiveActive ? 'bg-red-500 animate-ping' : 'bg-slate-600'}`} />
                <span className="text-sm font-bold text-white tracking-wide">
                  REALTIME SIMULTANEOUS VOICE INTERPRETER
                </span>
              </div>
              <p className="text-xs text-slate-400 max-w-lg mb-4">
                Hands-free continuous interpretation. When Person A speaks Malayalam, Person B automatically hears English. When Person B speaks English, Person A hears Malayalam.
              </p>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsLiveActive(!isLiveActive)}
                  className={`px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg transition-all ${
                    isLiveActive
                      ? 'bg-rose-600 hover:bg-rose-700 text-white ring-4 ring-rose-500/20'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  }`}
                >
                  <Radio className={`w-4 h-4 ${isLiveActive ? 'animate-pulse' : ''}`} />
                  {isLiveActive ? 'Live Interpreter Active (Click to Pause)' : 'Start Hands-Free Session'}
                </button>

                {isLiveActive && (
                  <button
                    onClick={() => setIsLiveActive(false)}
                    className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700"
                    title="Stop Session"
                  >
                    <VolumeX className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
