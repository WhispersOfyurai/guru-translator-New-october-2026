import type { WebSocket } from 'ws';
import type { ChatMessage, RoomState, UserRole } from '../src/types';
import {
  persistRoom,
  getStoredRoom,
  persistMessage,
  fetchStoredMessages,
} from './firestore-service.js';

interface Participant {
  ws: WebSocket;
  id: string;
  name: string;
  role: UserRole;
  joinedAt: number;
}

interface Room {
  id: string;
  createdAt: number;
  participants: Map<WebSocket, Participant>;
  messages: ChatMessage[];
  initializedFromFirestore: boolean;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  async hasRoom(roomId: string): Promise<boolean> {
    const normalized = roomId.trim().toUpperCase();
    if (this.rooms.has(normalized)) return true;
    const stored = await getStoredRoom(normalized);
    return stored !== null;
  }

  async getOrCreateRoom(roomId: string): Promise<Room> {
    const normalized = roomId.trim().toUpperCase();
    let room = this.rooms.get(normalized);

    if (!room) {
      // Check Firestore first
      const stored = await getStoredRoom(normalized);
      const now = Date.now();
      const createdAt = stored ? stored.createdAt : now;

      // If not stored in Firestore yet, persist it
      if (!stored) {
        await persistRoom(normalized);
      }

      // Pre-load messages from Firestore
      const storedMessages = await fetchStoredMessages(normalized);

      room = {
        id: normalized,
        createdAt,
        participants: new Map(),
        messages: storedMessages,
        initializedFromFirestore: true,
      };

      this.rooms.set(normalized, room);
    } else if (!room.initializedFromFirestore) {
      // Ensure messages are loaded
      const storedMessages = await fetchStoredMessages(normalized);
      if (storedMessages.length > 0) {
        // Merge without duplicates
        const map = new Map<string, ChatMessage>();
        for (const m of storedMessages) map.set(m.id, m);
        for (const m of room.messages) map.set(m.id, m);
        room.messages = Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
      }
      room.initializedFromFirestore = true;
    }

    return room;
  }

  async joinRoom(
    roomId: string,
    ws: WebSocket,
    participantInfo: { id: string; name: string; role: UserRole }
  ): Promise<RoomState> {
    const room = await this.getOrCreateRoom(roomId);

    // Remove any existing socket with the same participant ID (e.g. from an old reconnect)
    for (const [oldWs, p] of room.participants.entries()) {
      if (p.id === participantInfo.id && oldWs !== ws) {
        room.participants.delete(oldWs);
        try {
          if (oldWs.readyState === oldWs.OPEN) {
            oldWs.close();
          }
        } catch (_) {}
      }
    }

    room.participants.set(ws, {
      ws,
      id: participantInfo.id,
      name: participantInfo.name,
      role: participantInfo.role,
      joinedAt: Date.now(),
    });

    const state = this.getRoomState(roomId);
    this.broadcast(roomId, {
      type: 'ROOM_STATE_UPDATED',
      payload: state,
    });

    return state;
  }

  leaveRoom(roomId: string, ws: WebSocket) {
    const normalized = roomId.trim().toUpperCase();
    const room = this.rooms.get(normalized);
    if (!room) return;

    room.participants.delete(ws);
    const state = this.getRoomState(normalized);
    this.broadcast(normalized, {
      type: 'ROOM_STATE_UPDATED',
      payload: state,
    });
  }

  handleDisconnect(ws: WebSocket) {
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.participants.has(ws)) {
        room.participants.delete(ws);
        this.broadcast(roomId, {
          type: 'ROOM_STATE_UPDATED',
          payload: this.getRoomState(roomId),
        });
      }
    }
  }

  async addMessage(roomId: string, message: ChatMessage) {
    const room = await this.getOrCreateRoom(roomId);

    // Add to in-memory room
    const exists = room.messages.some((m) => m.id === message.id);
    if (!exists) {
      room.messages.push(message);
      if (room.messages.length > 500) {
        room.messages.shift();
      }
    }

    // Persist to Firestore asynchronously
    persistMessage(roomId, message).catch((err) => {
      console.error('[RoomManager] Failed to persist message to Firestore:', err);
    });

    // Broadcast to active clients
    this.broadcast(roomId, {
      type: 'NEW_MESSAGE',
      payload: message,
    });
  }

  getRoomState(roomId: string): RoomState {
    const normalized = roomId.trim().toUpperCase();
    const room = this.rooms.get(normalized);

    if (!room) {
      return {
        roomId: normalized,
        createdAt: Date.now(),
        participants: [],
        messages: [],
      };
    }

    const participantsList = Array.from(room.participants.values()).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      joinedAt: p.joinedAt,
    }));

    return {
      roomId: room.id,
      createdAt: room.createdAt,
      participants: participantsList,
      messages: room.messages,
    };
  }

  broadcast(roomId: string, data: any, excludeWs?: WebSocket) {
    const normalized = roomId.trim().toUpperCase();
    const room = this.rooms.get(normalized);
    if (!room) return;

    const payload = JSON.stringify(data);
    for (const [clientWs] of room.participants) {
      if (clientWs !== excludeWs && clientWs.readyState === clientWs.OPEN) {
        try {
          clientWs.send(payload);
        } catch (err) {
          console.error('[RoomManager] Broadcast send error:', err);
        }
      }
    }
  }
}

export const roomManager = new RoomManager();
