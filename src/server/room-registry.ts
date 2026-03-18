import { nanoid } from "nanoid";
import type { RoomInfo } from "../shared";

export class RoomRegistry {
	private ctx: DurableObjectState;
	private sockets = new Set<WebSocket>();

	constructor(ctx: DurableObjectState, _env: Env) {
		this.ctx = ctx;
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS rooms (
				id        TEXT PRIMARY KEY,
				name      TEXT NOT NULL,
				createdAt INTEGER NOT NULL,
				count     INTEGER NOT NULL DEFAULT 0,
				idleSince INTEGER
			)
		`);

		const columns = this.ctx.storage.sql
			.exec(`PRAGMA table_info(rooms)`)
			.toArray() as { name: string }[];
		if (!columns.some((column) => column.name === "count")) {
			this.ctx.storage.sql.exec(
				`ALTER TABLE rooms ADD COLUMN count INTEGER NOT NULL DEFAULT 0`,
			);
		}
		if (!columns.some((column) => column.name === "idleSince")) {
			this.ctx.storage.sql.exec(`ALTER TABLE rooms ADD COLUMN idleSince INTEGER`);
		}
		if (!columns.some((column) => column.name === "lastMessageAt")) {
			this.ctx.storage.sql.exec(`ALTER TABLE rooms ADD COLUMN lastMessageAt INTEGER`);
		}
		if (!columns.some((column) => column.name === "capacity")) {
			this.ctx.storage.sql.exec(`ALTER TABLE rooms ADD COLUMN capacity INTEGER NOT NULL DEFAULT 10`);
		}
	}

	private getRooms(): RoomInfo[] {
		const rows = this.ctx.storage.sql
			.exec(
				`SELECT id, name, createdAt, count, capacity, lastMessageAt FROM rooms ORDER BY count DESC, lastMessageAt DESC, createdAt DESC`,
			)
			.toArray() as { id: string; name: string; createdAt: number; count: number; capacity: number; lastMessageAt: number | null }[];

		return rows.map((room) => ({
			id: room.id,
			name: room.name,
			createdAt: Number(room.createdAt),
			count: Number(room.count) || 0,
			capacity: Number(room.capacity) || 10,
			idleExpiresAt: null,
			lastMessageAt: room.lastMessageAt ? Number(room.lastMessageAt) : null,
		}));
	}

	private broadcastRooms() {
		if (this.sockets.size === 0) return;
		const payload = JSON.stringify({ type: "rooms_sync", rooms: this.getRooms() });
		for (const socket of this.sockets) {
			try {
				socket.send(payload);
			} catch {
				this.sockets.delete(socket);
			}
		}
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const parts = url.pathname.split("/").filter(Boolean);

		// GET /rooms/stream — subscribe room list changes via WebSocket
		if (
			request.method === "GET" &&
			parts[0] === "rooms" &&
			parts[1] === "stream"
		) {
			if (request.headers.get("Upgrade") !== "websocket") {
				return new Response("Expected Upgrade: websocket", { status: 426 });
			}

			const pair = new WebSocketPair();
			const client = pair[0];
			const server = pair[1];

			server.accept();
			this.sockets.add(server);
			server.addEventListener("close", () => this.sockets.delete(server));
			server.addEventListener("error", () => this.sockets.delete(server));

			try {
				server.send(JSON.stringify({ type: "rooms_sync", rooms: this.getRooms() }));
			} catch {
				this.sockets.delete(server);
			}

			return new Response(null, { status: 101, webSocket: client });
		}

		// GET /rooms — list active rooms
		if (request.method === "GET" && parts[0] === "rooms" && parts.length === 1) {
			return Response.json(this.getRooms());
		}

		// POST /rooms — create a new room
		if (request.method === "POST" && parts[0] === "rooms" && parts.length === 1) {
			const body = (await request.json()) as { name?: string; capacity?: number };
			const name = (body.name ?? "").trim();
			if (!name) {
				return new Response("Room name required", { status: 400 });
			}
			const capacity = Math.max(1, Math.min(500, Number(body.capacity) || 10));
			const id = nanoid(8);
			const createdAt = Date.now();
			this.ctx.storage.sql.exec(
				`INSERT INTO rooms (id, name, createdAt, count, capacity) VALUES (?, ?, ?, 0, ?)`,
				id,
				name,
				createdAt,
				capacity,
			);
			const room: RoomInfo = {
				id,
				name,
				createdAt,
				count: 0,
				capacity,
				idleExpiresAt: null,
				lastMessageAt: null,
			};
			this.broadcastRooms();
			return Response.json(room, { status: 201 });
		}

		// PUT /rooms/:id/presence — update live participant count
		if (
			request.method === "PUT" &&
			parts[0] === "rooms" &&
			parts[1] &&
			parts[2] === "presence"
		) {
			const id = parts[1];
			const body = (await request.json()) as { count?: number; lastMessageAt?: number | null };
			const count = Math.max(0, Number(body.count) || 0);
			if (body.lastMessageAt != null) {
				this.ctx.storage.sql.exec(
					`UPDATE rooms SET count = ?, lastMessageAt = ? WHERE id = ?`,
					count, body.lastMessageAt, id,
				);
			} else {
				this.ctx.storage.sql.exec(`UPDATE rooms SET count = ? WHERE id = ?`, count, id);
			}
			this.broadcastRooms();
			return new Response(null, { status: 204 });
		}

		// DELETE /rooms/:id — remove a room (called by Chat DO on alarm)
		if (request.method === "DELETE" && parts[0] === "rooms" && parts[1]) {
			const id = parts[1];
			this.ctx.storage.sql.exec(`DELETE FROM rooms WHERE id = ?`, id);
			this.broadcastRooms();
			return new Response(null, { status: 204 });
		}

		return new Response("Not Found", { status: 404 });
	}
}
