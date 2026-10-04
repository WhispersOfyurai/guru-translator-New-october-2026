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
  ChevronUp
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

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const joinedRef = useRef<boolean>(false);
  joinedRef.current = joined;
  const currentRoomRef = useRef<string>('');
  currentRoomRef.current = roomId;
  const heartbeatIntervalRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const reconnectAttemptsRef = useRef<number>(0);

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
    window.history.pushState({}, '', `/`);
  };

  // Send Text Message
  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const t1 = Date.now();
    const sourceLang = userRole === 'malayalam_speaker' ? 'ml' : userRole === 'english_speaker' ? 'en' : 'auto';
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
          senderName: userName || (userRole === 'malayalam_speaker' ? 'Malayalam Speaker' : 'English Speaker'),
          senderRole: userRole,
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

  // Push-to-Talk Voice Recording
  const startRecording = async () => {
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());

        if (audioBlob.size < 800) {
          setErrorMessage('Audio recording was too short. Please speak clearly.');
          return;
        }

        // Convert blob to base64 and send to transcription API
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          setIsTranslating(true);

          try {
            const preferredLang = userRole === 'malayalam_speaker' ? 'ml' : 'en';
            const transcribeRes = await fetch('/api/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64: base64Audio,
                language: preferredLang,
              }),
            });

            if (!transcribeRes.ok) {
              const errData = await transcribeRes.json();
              throw new Error(errData.error || 'Transcription failed');
            }

            const data = await transcribeRes.json();
            const transcribedText = data.text?.trim();

            if (transcribedText && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'SEND_MESSAGE',
                  payload: {
                    roomId,
                    senderId: userId,
                    senderName: userName || (userRole === 'malayalam_speaker' ? 'Malayalam Speaker' : 'English Speaker'),
                    senderRole: userRole,
                    text: transcribedText,
                    sourceLang: preferredLang,
                    messageType: 'voice',
                  },
                })
              );
            } else {
              setIsTranslating(false);
              setErrorMessage('No speech detected. Please speak closer to the microphone.');
            }
          } catch (err: any) {
            setIsTranslating(false);
            setErrorMessage(err.message || 'Voice translation failed');
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Microphone access denied:', err);
      setErrorMessage('Microphone access required. Please grant permission in your browser.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }
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
          {/* MODE 1: TEXT TRANSLATION */}
          {mode === 'text' && (
            <div className="space-y-2">
              {/* Quick spiritual terminology suggestions */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] text-slate-400 scrollbar-none">
                <span className="shrink-0 text-slate-500 font-medium">Quick terms:</span>
                {(userRole === 'malayalam_speaker'
                  ? ['ഗുരുദേവ്', 'സാധന', 'ഗുരുത്വം', 'ദീക്ഷ', 'ആത്മാവ്', 'മോക്ഷം']
                  : ['Gurudev', 'Sadhana', 'Guruthva', 'Diksha', 'Atma', 'Moksha']
                ).map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => setInputText((prev) => (prev ? `${prev} ${term}` : term))}
                    className="shrink-0 px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-amber-300/90 border border-slate-700/80 transition-all font-mono"
                  >
                    +{term}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    userRole === 'malayalam_speaker'
                      ? 'മലയാളത്തിൽ ടൈപ്പ് ചെയ്യുക (Type in Malayalam)...'
                      : 'Type faithful message in English...'
                  }
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm sm:text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || isTranslating}
                  className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold p-3 sm:px-5 sm:py-3 rounded-xl transition-all flex items-center gap-2 shadow-lg"
                >
                  <Send className="w-5 h-5" />
                  <span className="hidden sm:inline">Send</span>
                </button>
              </form>
            </div>
          )}

          {/* MODE 2: PUSH-TO-TALK VOICE */}
          {mode === 'voice' && (
            <div className="flex flex-col items-center justify-center py-2 space-y-3">
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    startRecording();
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    stopRecording();
                  }}
                  className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full flex flex-col items-center justify-center transition-all select-none shadow-2xl ${
                    isRecording
                      ? 'bg-rose-600 text-white scale-110 ring-8 ring-rose-500/30 animate-pulse'
                      : 'bg-amber-500 hover:bg-amber-600 text-slate-950 active:scale-95'
                  }`}
                >
                  {isRecording ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
                  <span className="text-[10px] font-bold uppercase tracking-wider mt-1">
                    {isRecording ? `${recordingDuration}s` : 'Hold to Speak'}
                  </span>
                </button>
              </div>
              <p className="text-xs text-slate-400 text-center">
                {isRecording
                  ? `Recording in ${userRole === 'malayalam_speaker' ? 'Malayalam' : 'English'}... Release to translate.`
                  : `Hold the button to speak in ${userRole === 'malayalam_speaker' ? 'Malayalam' : 'English'}, release to send.`}
              </p>
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
