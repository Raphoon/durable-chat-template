import {
	type Connection,
	type ConnectionContext,
	Server,
	type WSMessage,
	routePartykitRequest,
} from "partyserver";

import type { ChatMessage, Message, Participant, RoomInfo } from "../shared";
import { RoomRegistry } from "./room-registry";

export { RoomRegistry };

const FALLBACK_NICKNAME = "익명";

type ConnectionState = {
	nickname: string;
	clientId: string;
	joinedAt: number;
};

export class Chat extends Server<Env> {
	static options = { hibernate: true };

	messages = [] as ChatMessage[];

	broadcastMessage(message: Message, exclude?: string[]) {
		this.broadcast(JSON.stringify(message), exclude);
	}

	getParticipants(): Participant[] {
		const dbRows = this.ctx.storage.sql
			.exec(`SELECT clientId, nickname, joinedAt FROM room_participants`)
			.toArray() as { clientId: string; nickname: string; joinedAt: number }[];

		const onlineClientIds = new Set<string>();
		for (const connection of this.getConnections<ConnectionState>()) {
			if (connection.state?.clientId) {
				onlineClientIds.add(connection.state.clientId);
			}
		}

		return dbRows
			.map((row) => ({
				id: row.clientId,
				nickname: row.nickname,
				joinedAt: Number(row.joinedAt),
				online: onlineClientIds.has(row.clientId),
			}))
			.sort((a, b) => {
				if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
				return a.nickname.localeCompare(b.nickname, "ko");
			});
	}

	broadcastParticipants() {
		this.broadcastMessage({
			type: "presence_sync",
			participants: this.getParticipants(),
		});
	}

	hasOtherConnectionWithClientId(clientId: string, excludeConnectionId: string) {
		for (const connection of this.getConnections<ConnectionState>()) {
			if (connection.id === excludeConnectionId) continue;
			if (connection.state?.clientId === clientId) {
				return true;
			}
		}
		return false;
	}

	getRoomId(): string | null {
		const rows = this.ctx.storage.sql
			.exec(`SELECT value FROM meta WHERE key = 'roomId'`)
			.toArray() as { value: string }[];
		return rows[0]?.value ?? null;
	}

	async syncRoomPresence() {
		const roomId = this.getRoomId();
		if (!roomId) return;
		const count = this.getParticipants().filter((p) => p.online).length;

		try {
			const registryId = this.env.RoomRegistry.idFromName("global");
			const registryStub = this.env.RoomRegistry.get(registryId);
			await registryStub.fetch(
				new Request(`http://internal/rooms/${roomId}/presence`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ count }),
				}),
			);
		} catch {
			// Best-effort
		}
	}

	async onStart() {
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT, createdAt INTEGER NOT NULL)`,
		);

		const messageColumns = this.ctx.storage.sql
			.exec(`PRAGMA table_info(messages)`)
			.toArray() as { name: string }[];
		if (!messageColumns.some((column) => column.name === "createdAt")) {
			this.ctx.storage.sql.exec(
				`ALTER TABLE messages ADD COLUMN createdAt INTEGER NOT NULL DEFAULT 0`,
			);
		}
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
		);
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS room_participants (clientId TEXT PRIMARY KEY, nickname TEXT NOT NULL, joinedAt INTEGER NOT NULL)`,
		);
		this.messages = this.ctx.storage.sql
			.exec(`SELECT id, user, role, content, createdAt FROM messages`)
			.toArray()
			.map((row) => {
				const message = row as ChatMessage;
				const createdAt = Number(message.createdAt);
				return {
					...message,
					createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
				};
			});

		await this.syncRoomPresence();
	}

	async onConnect(connection: Connection, ctx: ConnectionContext) {
		const roomId = ctx.request.headers.get("x-partykit-room");
		const url = new URL(ctx.request.url);
		const clientId = url.searchParams.get("clientId")?.trim() || connection.id;
		const nickname = url.searchParams.get("nickname")?.trim() || FALLBACK_NICKNAME;
		const isFirstConnectionForClient = !this.hasOtherConnectionWithClientId(
			clientId,
			connection.id,
		);

		connection.setState({
			clientId,
			nickname,
			joinedAt: Date.now(),
		} satisfies ConnectionState);

		if (roomId) {
			this.ctx.storage.sql.exec(
				`INSERT OR IGNORE INTO meta (key, value) VALUES ('roomId', ?)`,
				roomId,
			);
		}

		// 기존 메시지 전송
		connection.send(
			JSON.stringify({ type: "all", messages: this.messages } satisfies Message),
		);

		// 신규 입장자에게 현재 참여자 목록 직접 전송
		connection.send(
			JSON.stringify({
				type: "presence_sync",
				participants: this.getParticipants(),
			} satisfies Message),
		);

		// 기존 참여자들에게도 업데이트 전송
		this.broadcastParticipants();

		if (isFirstConnectionForClient) {
			const alreadyInRoom = this.ctx.storage.sql
				.exec(`SELECT clientId FROM room_participants WHERE clientId = ?`, clientId)
				.toArray().length > 0;

			if (!alreadyInRoom) {
				this.ctx.storage.sql.exec(
					`INSERT INTO room_participants (clientId, nickname, joinedAt) VALUES (?, ?, ?)`,
					clientId, nickname, Date.now(),
				);
				const joinMessage: ChatMessage = {
					id: `join-${Date.now()}-${clientId}`,
					content: `${nickname}님이 입장하였습니다.`,
					user: "시스템",
					role: "assistant",
					createdAt: Date.now(),
				};
				this.broadcastMessage({ type: "add", ...joinMessage }, [connection.id]);
			}
		}

		await this.syncRoomPresence();
	}

	saveMessage(message: ChatMessage) {
		const existingMessage = this.messages.find((m) => m.id === message.id);
		if (existingMessage) {
			this.messages = this.messages.map((m) =>
				m.id === message.id ? message : m,
			);
		} else {
			this.messages.push(message);
		}
		this.ctx.storage.sql.exec(
			`INSERT INTO messages (id, user, role, content, createdAt) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET
			 	content = excluded.content,
			 	user = excluded.user,
			 	role = excluded.role,
			 	createdAt = excluded.createdAt`,
			message.id,
			message.user,
			message.role,
			message.content,
			message.createdAt,
		);
	}

	onRequest(_request: Request): Response {
		const count = this.getParticipants().filter((p) => p.online).length;
		return Response.json({ count });
	}

	onMessage(connection: Connection, message: WSMessage) {
		const parsed = JSON.parse(message as string) as Message;

		if (parsed.type === "leave") {
			const state = connection.state as ConnectionState | undefined;
			const clientId = state?.clientId;
			const nickname = state?.nickname ?? FALLBACK_NICKNAME;
			if (clientId) {
				this.ctx.storage.sql.exec(
					`DELETE FROM room_participants WHERE clientId = ?`,
					clientId,
				);
				const leaveMessage: ChatMessage = {
					id: `leave-${Date.now()}-${clientId}`,
					content: `${nickname}님이 퇴장하였습니다.`,
					user: "시스템",
					role: "assistant",
					createdAt: Date.now(),
				};
				this.saveMessage(leaveMessage);
				this.broadcastMessage({ type: "add", ...leaveMessage });
				this.broadcastParticipants();
			}
			return;
		}

		if (parsed.type === "add" || parsed.type === "update") {
			const normalizedCreatedAt = Number(parsed.createdAt);
			const normalized: ChatMessage = {
				id: parsed.id,
				content: parsed.content,
				user: parsed.user,
				role: parsed.role,
				createdAt:
					Number.isFinite(normalizedCreatedAt) && normalizedCreatedAt > 0
						? normalizedCreatedAt
						: Date.now(),
			};
			this.broadcastMessage({ type: parsed.type, ...normalized });
			this.saveMessage(normalized);
			return;
		}

		this.broadcast(message);
	}

	async onClose(connection: Connection) {
		// DB에서 삭제하지 않음 — 탭을 닫아도 방에서 나간 게 아님
		// online 여부만 변경되어 참여자 목록에 회색으로 표시됨
		this.broadcastParticipants();
		await this.syncRoomPresence();
	}

	async onAlarm() {}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// Route /api/rooms/* to the RoomRegistry singleton DO
		if (url.pathname.startsWith("/api/rooms")) {
			const registryId = env.RoomRegistry.idFromName("global");
			const registryStub = env.RoomRegistry.get(registryId);
			const registryUrl = new URL(request.url);
			registryUrl.pathname = url.pathname.replace("/api", "");

			return registryStub.fetch(new Request(registryUrl.toString(), request));
		}

		return (
			(await routePartykitRequest(request, { ...env })) ||
			env.ASSETS.fetch(request)
		);
	},
} satisfies ExportedHandler<Env>;
