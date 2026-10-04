import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ChatMessage } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read Firebase configuration
const configPath = path.resolve(__dirname, '../firebase-applet-config.json');
let firebaseConfig: any = null;

try {
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (err) {
  console.warn('[Firestore Service] Could not read firebase-applet-config.json:', err);
}

const app = getApps().length > 0 ? getApp() : (firebaseConfig ? initializeApp(firebaseConfig) : null);
export const firestoreDb = app && firebaseConfig?.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : null;

export interface StoredRoom {
  roomId: string;
  createdAt: number;
  updatedAt: number;
}

export async function getStoredRoom(roomId: string): Promise<StoredRoom | null> {
  if (!firestoreDb) return null;
  const normalized = roomId.trim().toUpperCase();
  try {
    const roomRef = doc(firestoreDb, 'rooms', normalized);
    const snap = await getDoc(roomRef);
    if (snap.exists()) {
      return snap.data() as StoredRoom;
    }
    return null;
  } catch (err) {
    console.error(`[Firestore] Error getting room ${normalized}:`, err);
    return null;
  }
}

export async function persistRoom(roomId: string): Promise<StoredRoom> {
  const normalized = roomId.trim().toUpperCase();
  const now = Date.now();
  if (!firestoreDb) {
    return { roomId: normalized, createdAt: now, updatedAt: now };
  }

  try {
    const roomRef = doc(firestoreDb, 'rooms', normalized);
    const existing = await getDoc(roomRef);
    if (existing.exists()) {
      const data = existing.data() as StoredRoom;
      await setDoc(roomRef, { ...data, updatedAt: now }, { merge: true });
      return { ...data, updatedAt: now };
    } else {
      const newRoom: StoredRoom = {
        roomId: normalized,
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(roomRef, newRoom);
      return newRoom;
    }
  } catch (err) {
    console.error(`[Firestore] Error persisting room ${normalized}:`, err);
    return { roomId: normalized, createdAt: now, updatedAt: now };
  }
}

export async function persistMessage(roomId: string, message: ChatMessage): Promise<void> {
  if (!firestoreDb) return;
  const normalized = roomId.trim().toUpperCase();
  const messageId = message.id;

  try {
    const msgRef = doc(firestoreDb, 'rooms', normalized, 'messages', messageId);
    await setDoc(msgRef, {
      messageId,
      roomId: normalized,
      senderId: message.senderId,
      senderName: message.senderName || '',
      senderRole: message.senderRole,
      sourceLanguage: message.sourceLanguage,
      originalText: message.originalText,
      transliteration: message.transliteration || '',
      translatedText: message.translatedText,
      targetLanguage: message.targetLanguage,
      messageType: message.messageType || 'text',
      createdAt: message.createdAt || Date.now(),
    });

    // Also update parent room updatedAt timestamp
    const roomRef = doc(firestoreDb, 'rooms', normalized);
    await setDoc(roomRef, { updatedAt: Date.now() }, { merge: true });
  } catch (err) {
    console.error(`[Firestore] Error writing message ${messageId} to room ${normalized}:`, err);
  }
}

export async function fetchStoredMessages(roomId: string, maxLimit = 500): Promise<ChatMessage[]> {
  if (!firestoreDb) return [];
  const normalized = roomId.trim().toUpperCase();

  try {
    const msgsColl = collection(firestoreDb, 'rooms', normalized, 'messages');
    const q = query(msgsColl, orderBy('createdAt', 'asc'), limit(maxLimit));
    const snapshot = await getDocs(q);

    const messages: ChatMessage[] = [];
    snapshot.forEach((docSnap) => {
      const d = docSnap.data();
      messages.push({
        id: d.messageId || docSnap.id,
        roomId: d.roomId || normalized,
        senderId: d.senderId,
        senderName: d.senderName,
        senderRole: d.senderRole,
        sourceLanguage: d.sourceLanguage,
        targetLanguage: d.targetLanguage,
        originalText: d.originalText,
        translatedText: d.translatedText,
        transliteration: d.transliteration || undefined,
        messageType: d.messageType || 'text',
        createdAt: d.createdAt,
      });
    });

    return messages;
  } catch (err) {
    console.error(`[Firestore] Error fetching messages for room ${normalized}:`, err);
    return [];
  }
}
