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

// 참여자가 0명이 된 뒤 방이 만료될 때까지의 대기 시간 (30분)
const IDLE_EXPIRY_MS = 30 * 60 * 1000;
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
		const uniqueByClientId = new Map<string, Participant>();
		for (const connection of this.getConnections<ConnectionState>()) {
			const clientId = connection.state?.clientId ?? connection.id;
			const candidate: Participant = {
				id: clientId,
				nickname: connection.state?.nickname ?? FALLBACK_NICKNAME,
				joinedAt: connection.state?.joinedAt ?? 0,
			};
			const existing = uniqueByClientId.get(clientId);
			if (!existing || candidate.joinedAt < existing.joinedAt) {
				uniqueByClientId.set(clientId, candidate);
			}
		}
		return [...uniqueByClientId.values()].sort((a, b) => {
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

	getRoomId(): string | null {
		const rows = this.ctx.storage.sql
			.exec(`SELECT value FROM meta WHERE key = 'roomId'`)
			.toArray() as { value: string }[];
		return rows[0]?.value ?? null;
	}

	getIdleSince(): number | null {
		const rows = this.ctx.storage.sql
			.exec(`SELECT value FROM meta WHERE key = 'idleSince'`)
			.toArray() as { value: string }[];
		if (rows.length === 0) return null;
		const idleSince = Number(rows[0].value);
		return Number.isFinite(idleSince) ? idleSince : null;
	}

	async syncRoomPresence() {
		const roomId = this.getRoomId();
		if (!roomId) return;
		const count = this.getParticipants().length;
		const idleSince = count === 0 ? this.getIdleSince() : null;

		try {
			const registryId = this.env.RoomRegistry.idFromName("global");
			const registryStub = this.env.RoomRegistry.get(registryId);
			await registryStub.fetch(
				new Request(`http://internal/rooms/${roomId}/presence`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ count, idleSince }),
				}),
			);
		} catch {
			// Best-effort
		}
	}

	async onStart() {
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT)`,
		);
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
		);
		this.messages = this.ctx.storage.sql
			.exec(`SELECT * FROM messages`)
			.toArray() as ChatMessage[];

		// idle 카운트다운이 진행 중이었다면 만료 여부 확인 후 알람 복원
		const idleSinceRows = this.ctx.storage.sql
			.exec(`SELECT value FROM meta WHERE key = 'idleSince'`)
			.toArray() as { value: string }[];

		if (idleSinceRows.length > 0) {
			const idleSince = Number(idleSinceRows[0].value);
			const expiresAt = idleSince + IDLE_EXPIRY_MS;
			if (Date.now() >= expiresAt) {
				await this.expireRoom();
				return;
			}
			const existingAlarm = await this.ctx.storage.getAlarm();
			if (existingAlarm === null) {
				await this.ctx.storage.setAlarm(expiresAt);
			}
		}

		await this.syncRoomPresence();
	}

	async expireRoom() {
		this.broadcastMessage({ type: "room_expired" });

		const roomIdRows = this.ctx.storage.sql
			.exec(`SELECT value FROM meta WHERE key = 'roomId'`)
			.toArray() as { value: string }[];
		const roomId = roomIdRows[0]?.value;

		if (roomId) {
			try {
				const registryId = this.env.RoomRegistry.idFromName("global");
				const registryStub = this.env.RoomRegistry.get(registryId);
				await registryStub.fetch(
					new Request(`http://internal/rooms/${roomId}`, { method: "DELETE" }),
				);
			} catch {
				// Best-effort
			}
		}

		await this.ctx.storage.deleteAll();
	}

	async onConnect(connection: Connection, ctx: ConnectionContext) {
		const roomId = ctx.request.headers.get("x-partykit-room");
		const url = new URL(ctx.request.url);
		const clientId = url.searchParams.get("clientId")?.trim() || connection.id;
		const nickname = url.searchParams.get("nickname")?.trim() || FALLBACK_NICKNAME;

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

		// 참여자가 들어오면 idle 카운트다운 취소
		const idleRows = this.ctx.storage.sql
			.exec(`SELECT value FROM meta WHERE key = 'idleSince'`)
			.toArray();
		if (idleRows.length > 0) {
			this.ctx.storage.sql.exec(`DELETE FROM meta WHERE key = 'idleSince'`);
			await this.ctx.storage.deleteAlarm();
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
			`INSERT INTO messages (id, user, role, content) VALUES (?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET content = excluded.content`,
			message.id,
			message.user,
			message.role,
			message.content,
		);
	}

	onRequest(_request: Request): Response {
		const count = this.getParticipants().length;
		return Response.json({ count });
	}

	onMessage(connection: Connection, message: WSMessage) {
		this.broadcast(message);
		const parsed = JSON.parse(message as string) as Message;
		if (parsed.type === "add" || parsed.type === "update") {
			this.saveMessage(parsed);
		}
	}

	async onClose(_connection: Connection) {
		// 퇴장 후 남은 참여자 목록을 나머지에게 전송
		this.broadcastParticipants();

		// 참여자가 0명이 되면 30분 idle 카운트다운 시작
		if (this.getParticipants().length === 0) {
			const now = Date.now();
			this.ctx.storage.sql.exec(
				`INSERT INTO meta (key, value) VALUES ('idleSince', ?)
				 ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
				String(now),
			);
			await this.ctx.storage.setAlarm(now + IDLE_EXPIRY_MS);
		}

		await this.syncRoomPresence();
	}

	async onAlarm() {
		// 알람 울리기 전에 누군가 재입장했으면 취소
		if (this.getParticipants().length > 0) {
			this.ctx.storage.sql.exec(`DELETE FROM meta WHERE key = 'idleSince'`);
			await this.ctx.storage.deleteAlarm();
			return;
		}
		await this.expireRoom();
	}
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
