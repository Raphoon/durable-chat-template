import { createRoot } from "react-dom/client";
import { usePartySocket } from "partysocket/react";
import React, { useEffect, useState } from "react";
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	useParams,
	useNavigate,
} from "react-router";
import { nanoid } from "nanoid";

import { type ChatMessage, type Message, type RoomInfo } from "../shared";

const NICKNAME_KEY = "chat_nickname";

// ──────────────────────────────────────────────
// Home: Room list + nickname input + room creation
// ──────────────────────────────────────────────
function RoomListPage() {
	const [nickname, setNickname] = useState(
		() => localStorage.getItem(NICKNAME_KEY) ?? "",
	);
	const [rooms, setRooms] = useState<RoomInfo[]>([]);
	const [newRoomName, setNewRoomName] = useState("");
	const [creating, setCreating] = useState(false);
	const navigate = useNavigate();

	useEffect(() => {
		fetchRooms();
		const interval = setInterval(fetchRooms, 30_000);
		return () => clearInterval(interval);
	}, []);

	async function fetchRooms() {
		try {
			const res = await fetch("/api/rooms");
			if (res.ok) {
				const data: RoomInfo[] = await res.json();
				setRooms(data);
			}
		} catch {
			// silently ignore fetch errors
		}
	}

	function handleNicknameChange(value: string) {
		localStorage.setItem(NICKNAME_KEY, value);
		setNickname(value);
	}

	async function handleCreateRoom(e: React.FormEvent) {
		e.preventDefault();
		const name = newRoomName.trim();
		if (!name || !nickname.trim()) return;
		setCreating(true);
		try {
			const res = await fetch("/api/rooms", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name }),
			});
			if (res.ok) {
				const room: RoomInfo = await res.json();
				navigate(`/room/${room.id}`);
			}
		} finally {
			setCreating(false);
		}
	}

	const nicknameValid = nickname.trim().length > 0;

	return (
		<div className="container">
			<h4>Durable Chat</h4>

			{/* Nickname input */}
			<div className="row">
				<label htmlFor="nickname">
					<strong>닉네임</strong>
				</label>
				<input
					id="nickname"
					type="text"
					value={nickname}
					onChange={(e) => handleNicknameChange(e.target.value)}
					placeholder="닉네임을 입력하세요..."
					autoComplete="off"
					className="ten columns my-input-text"
					style={{ marginTop: "0.5rem" }}
				/>
			</div>

			{/* Active room list */}
			<div className="row" style={{ marginTop: "2rem" }}>
				<h5>활성 채팅방</h5>
				{rooms.length === 0 ? (
					<p>활성 채팅방이 없습니다. 아래에서 새 방을 만드세요.</p>
				) : (
					<ul style={{ listStyle: "none", padding: 0 }}>
						{rooms.map((room) => (
							<li
								key={room.id}
								style={{
									display: "flex",
									alignItems: "center",
									gap: "1rem",
									marginBottom: "0.5rem",
								}}
							>
								<button
									disabled={!nicknameValid}
									onClick={() => navigate(`/room/${room.id}`)}
								>
									{room.name}
								</button>
								<span style={{ fontSize: "0.85em", color: "#888" }}>
									만료:{" "}
									{new Date(room.expiresAt).toLocaleTimeString("ko-KR")}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>

			{/* Create new room */}
			<form
				className="row"
				onSubmit={handleCreateRoom}
				style={{ marginTop: "1rem" }}
			>
				<h5>새 채팅방 만들기</h5>
				<input
					type="text"
					value={newRoomName}
					onChange={(e) => setNewRoomName(e.target.value)}
					placeholder="방 이름을 입력하세요..."
					disabled={!nicknameValid}
					autoComplete="off"
					className="eight columns my-input-text"
				/>
				<button
					type="submit"
					disabled={!nicknameValid || !newRoomName.trim() || creating}
					className="two columns"
					style={{ marginLeft: "1rem" }}
				>
					{creating ? "생성 중..." : "방 만들기"}
				</button>
			</form>

			{!nicknameValid && (
				<p style={{ color: "#c0392b", marginTop: "0.5rem" }}>
					닉네임을 입력해야 방에 입장하거나 생성할 수 있습니다.
				</p>
			)}
		</div>
	);
}

// ──────────────────────────────────────────────
// Chat room page
// ──────────────────────────────────────────────
function ChatPage() {
	const { roomId } = useParams<{ roomId: string }>();
	const navigate = useNavigate();

	const [nickname] = useState(() => localStorage.getItem(NICKNAME_KEY) ?? "");
	const [messages, setMessages] = useState<ChatMessage[]>([]);

	// Redirect to home if nickname is not set
	useEffect(() => {
		if (!nickname.trim()) {
			navigate("/", { replace: true });
		}
	}, [nickname, navigate]);

	const socket = usePartySocket({
		party: "chat",
		room: roomId,
		onMessage: (evt) => {
			const message = JSON.parse(evt.data as string) as Message;

			if (message.type === "room_expired") {
				navigate("/", { replace: true });
				return;
			}

			if (message.type === "add") {
				setMessages((prev) => {
					const idx = prev.findIndex((m) => m.id === message.id);
					if (idx === -1) {
						return [...prev, message];
					}
					return prev.map((m, i) => (i === idx ? message : m));
				});
			} else if (message.type === "update") {
				setMessages((prev) =>
					prev.map((m) => (m.id === message.id ? message : m)),
				);
			} else if (message.type === "all") {
				setMessages(message.messages);
			}
		},
	});

	function handleSend(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const input = e.currentTarget.elements.namedItem(
			"content",
		) as HTMLInputElement;
		const chatMessage: ChatMessage = {
			id: nanoid(8),
			content: input.value,
			user: nickname,
			role: "user",
		};
		setMessages((prev) => [...prev, chatMessage]);
		socket.send(
			JSON.stringify({
				type: "add",
				...chatMessage,
			} satisfies Message),
		);
		input.value = "";
	}

	return (
		<div className="chat container">
			<div
				className="row"
				style={{
					display: "flex",
					alignItems: "center",
					gap: "1rem",
					marginBottom: "1rem",
				}}
			>
				<button onClick={() => navigate("/")}>← 방 목록</button>
				<span>
					<strong>{nickname}</strong> 으로 채팅 중
				</span>
			</div>

			{messages.map((message) => (
				<div key={message.id} className="row message">
					<div className="two columns user">{message.user}</div>
					<div className="ten columns">{message.content}</div>
				</div>
			))}

			<form className="row" onSubmit={handleSend}>
				<input
					type="text"
					name="content"
					className="ten columns my-input-text"
					placeholder={`${nickname}님, 메시지를 입력하세요...`}
					autoComplete="off"
				/>
				<button type="submit" className="send-message two columns">
					전송
				</button>
			</form>
		</div>
	);
}

// ──────────────────────────────────────────────
// App entry point
// ──────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById("root")!).render(
	<BrowserRouter>
		<Routes>
			<Route path="/" element={<RoomListPage />} />
			<Route path="/room/:roomId" element={<ChatPage />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	</BrowserRouter>,
);
