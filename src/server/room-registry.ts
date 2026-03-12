import { nanoid } from "nanoid";
import type { RoomInfo } from "../shared";

const IDLE_EXPIRY_MS = 30 * 60 * 1000;

export class RoomRegistry {
	private ctx: DurableObjectState;

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
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const parts = url.pathname.split("/").filter(Boolean);

		// GET /rooms — list active rooms
		if (request.method === "GET" && parts[0] === "rooms") {
			const rows = this.ctx.storage.sql
				.exec(
					`SELECT id, name, createdAt, count, idleSince FROM rooms ORDER BY createdAt DESC`,
				)
				.toArray() as (RoomInfo & { idleSince?: number | null })[];

			const rooms: RoomInfo[] = rows.map((room) => ({
				id: room.id,
				name: room.name,
				createdAt: room.createdAt,
				count: Number(room.count) || 0,
				idleExpiresAt:
					room.idleSince == null ? null : Number(room.idleSince) + IDLE_EXPIRY_MS,
			}));
			return Response.json(rooms);
		}

		// POST /rooms — create a new room
		if (request.method === "POST" && parts[0] === "rooms") {
			const body = (await request.json()) as { name?: string };
			const name = (body.name ?? "").trim();
			if (!name) {
				return new Response("Room name required", { status: 400 });
			}
			const id = nanoid(8);
			const createdAt = Date.now();
			this.ctx.storage.sql.exec(
				`INSERT INTO rooms (id, name, createdAt, count, idleSince) VALUES (?, ?, ?, 0, NULL)`,
				id,
				name,
				createdAt,
			);
			const room: RoomInfo = {
				id,
				name,
				createdAt,
				count: 0,
				idleExpiresAt: null,
			};
			return Response.json(room, { status: 201 });
		}

		// PUT /rooms/:id/presence — update live participant count and idle state
		if (
			request.method === "PUT" &&
			parts[0] === "rooms" &&
			parts[1] &&
			parts[2] === "presence"
		) {
			const id = parts[1];
			const body = (await request.json()) as {
				count?: number;
				idleSince?: number | null;
			};
			const count = Math.max(0, Number(body.count) || 0);
			const idleSince = body.idleSince == null ? null : Number(body.idleSince);
			this.ctx.storage.sql.exec(
				`UPDATE rooms SET count = ?, idleSince = ? WHERE id = ?`,
				count,
				idleSince,
				id,
			);
			return new Response(null, { status: 204 });
		}

		// DELETE /rooms/:id — remove a room (called by Chat DO on alarm)
		if (request.method === "DELETE" && parts[0] === "rooms" && parts[1]) {
			const id = parts[1];
			this.ctx.storage.sql.exec(`DELETE FROM rooms WHERE id = ?`, id);
			return new Response(null, { status: 204 });
		}

		return new Response("Not Found", { status: 404 });
	}
}
