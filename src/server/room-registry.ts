import { nanoid } from "nanoid";
import type { RoomInfo } from "../shared";

const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export class RoomRegistry {
	private ctx: DurableObjectState;

	constructor(ctx: DurableObjectState, _env: Env) {
		this.ctx = ctx;
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS rooms (
				id        TEXT PRIMARY KEY,
				name      TEXT NOT NULL,
				createdAt INTEGER NOT NULL
			)
		`);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const parts = url.pathname.split("/").filter(Boolean);

		// GET /rooms — list active (non-expired) rooms
		if (request.method === "GET" && parts[0] === "rooms") {
			const cutoff = Date.now() - EXPIRY_MS;
			const rows = this.ctx.storage.sql
				.exec(
					`SELECT id, name, createdAt FROM rooms WHERE createdAt > ? ORDER BY createdAt DESC`,
					cutoff,
				)
				.toArray() as { id: string; name: string; createdAt: number }[];

			const rooms: RoomInfo[] = rows.map((r) => ({
				...r,
				expiresAt: r.createdAt + EXPIRY_MS,
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
				`INSERT INTO rooms (id, name, createdAt) VALUES (?, ?, ?)`,
				id,
				name,
				createdAt,
			);
			const room: RoomInfo = { id, name, createdAt, expiresAt: createdAt + EXPIRY_MS };
			return Response.json(room, { status: 201 });
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
