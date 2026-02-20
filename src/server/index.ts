import {
	type Connection,
	type ConnectionContext,
	Server,
	type WSMessage,
	routePartykitRequest,
} from "partyserver";

import type { ChatMessage, Message } from "../shared";
import { RoomRegistry } from "./room-registry";

export { RoomRegistry };

const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export class Chat extends Server<Env> {
	static options = { hibernate: true };

	messages = [] as ChatMessage[];

	broadcastMessage(message: Message, exclude?: string[]) {
		this.broadcast(JSON.stringify(message), exclude);
	}

	async onStart() {
		// create the messages table if it doesn't exist
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT)`,
		);

		// create the meta table for room metadata
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
		);

		// load the messages from the database
		this.messages = this.ctx.storage.sql
			.exec(`SELECT * FROM messages`)
			.toArray() as ChatMessage[];

		// Handle room expiry alarm scheduling
		const existingAlarm = await this.ctx.storage.getAlarm();
		if (existingAlarm === null) {
			const createdAtRows = this.ctx.storage.sql
				.exec(`SELECT value FROM meta WHERE key = 'createdAt'`)
				.toArray() as { value: string }[];

			if (createdAtRows.length > 0) {
				// Room previously existed — check if it already expired while alarm was gone
				const createdAt = Number(createdAtRows[0].value);
				const expiresAt = createdAt + EXPIRY_MS;
				if (Date.now() >= expiresAt) {
					// Already expired: clear all data immediately
					await this.ctx.storage.deleteAll();
					return;
				}
				// Not yet expired: restore the alarm
				await this.ctx.storage.setAlarm(expiresAt);
			}
			// New room: alarm will be set on first connect (we need the roomId)
		}
	}

	async onConnect(connection: Connection, ctx: ConnectionContext) {
		// On first ever connection, store the roomId and schedule expiry alarm
		const roomId = ctx.request.headers.get("x-partykit-room");
		if (roomId) {
			this.ctx.storage.sql.exec(
				`INSERT OR IGNORE INTO meta (key, value) VALUES ('roomId', ?)`,
				roomId,
			);

			// Schedule alarm if this is the first connection (no createdAt yet)
			const createdAtRows = this.ctx.storage.sql
				.exec(`SELECT value FROM meta WHERE key = 'createdAt'`)
				.toArray() as { value: string }[];

			if (createdAtRows.length === 0) {
				const createdAt = Date.now();
				this.ctx.storage.sql.exec(
					`INSERT OR IGNORE INTO meta (key, value) VALUES ('createdAt', ?)`,
					String(createdAt),
				);
				await this.ctx.storage.setAlarm(createdAt + EXPIRY_MS);
			}
		}

		connection.send(
			JSON.stringify({
				type: "all",
				messages: this.messages,
			} satisfies Message),
		);
	}

	saveMessage(message: ChatMessage) {
		const existingMessage = this.messages.find((m) => m.id === message.id);
		if (existingMessage) {
			this.messages = this.messages.map((m) => {
				if (m.id === message.id) {
					return message;
				}
				return m;
			});
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

	onMessage(connection: Connection, message: WSMessage) {
		this.broadcast(message);

		const parsed = JSON.parse(message as string) as Message;
		if (parsed.type === "add" || parsed.type === "update") {
			this.saveMessage(parsed);
		}
	}

	async onAlarm() {
		// Notify all connected clients that the room has expired
		this.broadcastMessage({ type: "room_expired" });

		// Notify RoomRegistry to remove this room
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
				// Best-effort: the room will fall off the list via the expiry filter anyway
			}
		}

		// Clear all stored data
		await this.ctx.storage.deleteAll();
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// Route /api/rooms/* to the RoomRegistry singleton DO
		if (url.pathname.startsWith("/api/rooms")) {
			const registryId = env.RoomRegistry.idFromName("global");
			const registryStub = env.RoomRegistry.get(registryId);
			// Strip /api prefix so the DO sees /rooms[/id]
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
