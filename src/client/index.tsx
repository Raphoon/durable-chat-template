import { createRoot } from "react-dom/client";
import { usePartySocket } from "partysocket/react";
import React, { useEffect, useRef, useState } from "react";
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	useParams,
	useNavigate,
	useLocation,
} from "react-router";
import { nanoid } from "nanoid";

import {
	type ChatMessage,
	type Message,
	type Participant,
	type RoomInfo,
} from "../shared";

const NICKNAME_KEY = "chat_nickname";
const CURRENT_ROOM_KEY = "chat_current_room";
const CLIENT_ID_KEY = "chat_client_id";
const messageTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
	hour: "2-digit",
	minute: "2-digit",
	hour12: true,
});

function getRoomIdFromPath(pathname: string): string | null {
	const match = pathname.match(/^\/room\/([^/]+)$/);
	return match?.[1] ?? null;
}

function getOrCreateClientId(): string {
	const existing = localStorage.getItem(CLIENT_ID_KEY)?.trim();
	if (existing) return existing;
	const next = nanoid(12);
	localStorage.setItem(CLIENT_ID_KEY, next);
	return next;
}

function formatMessageTime(createdAt: number): string {
	const timestamp = Number(createdAt);
	if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
	return messageTimeFormatter.format(timestamp);
}

function getMessageMinuteKey(createdAt: number): number {
	const timestamp = Number(createdAt);
	if (!Number.isFinite(timestamp) || timestamp <= 0) return -1;
	return Math.floor(timestamp / 60000);
}

// ─── Icons ────────────────────────────────────────────────────

function ChatIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</svg>
	);
}

function ArrowLeftIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<polyline points="15 18 9 12 15 6" />
		</svg>
	);
}

// ─── Nickname Page ─────────────────────────────────────────────

function NicknamePage({ onSave }: { onSave: (name: string) => void }) {
	const [value, setValue] = useState("");

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = value.trim();
		if (!trimmed) return;
		localStorage.setItem(NICKNAME_KEY, trimmed);
		onSave(trimmed);
	}

	return (
		<div className="page-center nickname-page">
			<div className="card card--narrow">
				<div className="app-icon">
					<ChatIcon />
				</div>
				<h1 className="card-title">채팅방에 오신 것을 환영합니다</h1>
				<p className="card-subtitle">시작하려면 닉네임을 입력해주세요</p>
				<form onSubmit={handleSubmit} className="form-group">
					<input
						className="input input--center"
						type="text"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						placeholder="닉네임을 입력하세요"
						autoFocus
						autoComplete="off"
						maxLength={20}
					/>
					<button
						type="submit"
						className="btn btn--primary"
						disabled={!value.trim()}
					>
						채팅 시작하기
					</button>
				</form>
			</div>
		</div>
	);
}

// ─── Room List Page ────────────────────────────────────────────

function RoomListPage({ nickname, onChangeNickname }: { nickname: string; onChangeNickname: () => void }) {
	const [rooms, setRooms] = useState<RoomInfo[]>([]);
	const [newRoomName, setNewRoomName] = useState("");
	const [creating, setCreating] = useState(false);
	const navigate = useNavigate();

	useEffect(() => {
		fetchRooms();
		const interval = setInterval(fetchRooms, 30_000);
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				fetchRooms();
			}
		};
		window.addEventListener("focus", fetchRooms);
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			clearInterval(interval);
			window.removeEventListener("focus", fetchRooms);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, []);

	async function fetchRooms() {
		try {
			const res = await fetch("/api/rooms");
			if (res.ok) setRooms(await res.json());
		} catch {
			// ignore
		}
	}

	async function handleCreateRoom(e: React.FormEvent) {
		e.preventDefault();
		const name = newRoomName.trim();
		if (!name) return;
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

	function formatIdleExpiry(idleExpiresAt: number | null) {
		if (!idleExpiresAt) return "";
		const diff = idleExpiresAt - Date.now();
		if (diff <= 0) return "곧 만료";
		const totalMinutes = Math.ceil(diff / 60000);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours > 0) {
			return `${hours}시간 ${minutes}분 후 만료`;
		}
		return `${totalMinutes}분 후 만료`;
	}

	return (
		<div className="page-full rooms-page">
			<div className="card card--wide">
				{/* Header */}
				<div className="rooms-header">
					<div className="rooms-header-left">
						<div className="rooms-header-icon">
							<ChatIcon />
						</div>
						<h2>채팅방 목록</h2>
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<span className="nickname-chip">
							<span className="nickname-chip-dot" />
							{nickname}
						</span>
						<button className="btn btn--ghost" onClick={onChangeNickname}>
							변경
						</button>
					</div>
				</div>

				<div className="rooms-body">
					{/* Room list */}
					<div className="room-list">
						{rooms.length === 0 ? (
							<div className="room-list-empty">아직 활성 채팅방이 없습니다</div>
						) : (
							rooms.map((room) => (
								<div key={room.id} className="room-item">
									<div className="room-item-info">
										<span className="room-item-name">{room.name}</span>
										<span className="room-item-meta">
											{room.count > 0 ? (
												<span className="room-item-count">
													<span className="room-item-count-dot" />
													{room.count}명 접속 중
												</span>
											) : (
												<span
													className="room-item-count"
													style={{ color: "#8b95a7" }}
												>
													참여자 없음 · {formatIdleExpiry(room.idleExpiresAt)}
												</span>
											)}
										</span>
									</div>
									<button
										className="btn btn--sm btn--join"
										onClick={() => navigate(`/room/${room.id}`)}
									>
										입장
									</button>
								</div>
							))
						)}
					</div>

					<div className="section-divider" />

					{/* Create room */}
					<div>
						<p className="create-room-title">새 채팅방 만들기</p>
						<form className="create-room-row" onSubmit={handleCreateRoom}>
							<input
								className="input"
								type="text"
								value={newRoomName}
								onChange={(e) => setNewRoomName(e.target.value)}
								placeholder="방 이름을 입력하세요"
								autoComplete="off"
								maxLength={30}
							/>
							<button
								type="submit"
								className="btn btn--sm btn--primary"
								disabled={!newRoomName.trim() || creating}
							>
								{creating ? "생성 중…" : "만들기"}
							</button>
						</form>
					</div>
				</div>
			</div>
		</div>
	);
}

// ─── Home (nickname gate) ──────────────────────────────────────

function HomePage() {
	const [nickname, setNickname] = useState(
		() => localStorage.getItem(NICKNAME_KEY) ?? "",
	);

	useEffect(() => {
		function handleStorage(event: StorageEvent) {
			if (event.key !== NICKNAME_KEY) return;
			setNickname(event.newValue ?? "");
		}
		window.addEventListener("storage", handleStorage);
		return () => window.removeEventListener("storage", handleStorage);
	}, []);

	function handleSave(name: string) {
		setNickname(name);
	}

	function handleChangeNickname() {
		localStorage.removeItem(NICKNAME_KEY);
		localStorage.removeItem(CURRENT_ROOM_KEY);
		setNickname("");
	}

	if (!nickname) {
		return <NicknamePage onSave={handleSave} />;
	}

	return <RoomListPage nickname={nickname} onChangeNickname={handleChangeNickname} />;
}

// ─── Chat Page ─────────────────────────────────────────────────

function ChatPage() {
	const { roomId } = useParams<{ roomId: string }>();
	const navigate = useNavigate();
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const [nickname] = useState(() => localStorage.getItem(NICKNAME_KEY) ?? "");
	const [clientId] = useState(() => getOrCreateClientId());
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [participants, setParticipants] = useState<Participant[]>([]);
	const [roomName, setRoomName] = useState<string>("");

	useEffect(() => {
		if (!roomId) return;
		localStorage.setItem(CURRENT_ROOM_KEY, roomId);
	}, [roomId]);

	useEffect(() => {
		fetch("/api/rooms")
			.then((r) => r.json())
			.then((rooms: RoomInfo[]) => {
				const found = rooms.find((r) => r.id === roomId);
				if (found) setRoomName(found.name);
			})
			.catch(() => {});
	}, [roomId]);

	useEffect(() => {
		if (!nickname.trim()) navigate("/", { replace: true });
	}, [nickname, navigate]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const socket = usePartySocket({
		party: "chat",
		room: roomId,
		query: {
			nickname,
			clientId,
		},
		onMessage: (evt) => {
			const message = JSON.parse(evt.data as string) as Message;

			if (message.type === "room_expired") {
				localStorage.removeItem(CURRENT_ROOM_KEY);
				navigate("/", { replace: true });
				return;
			}
			if (message.type === "add") {
				setMessages((prev) => {
					const idx = prev.findIndex((m) => m.id === message.id);
					if (idx === -1) return [...prev, message];
					return prev.map((m, i) => (i === idx ? message : m));
				});
			} else if (message.type === "update") {
				setMessages((prev) =>
					prev.map((m) => (m.id === message.id ? message : m)),
				);
			} else if (message.type === "all") {
				setMessages(message.messages);
			} else if (message.type === "presence_sync") {
				setParticipants(message.participants);
			}
		},
	});

	function handleSend(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const input = e.currentTarget.elements.namedItem("content") as HTMLInputElement;
		const text = input.value.trim();
		if (!text) return;
		const now = Date.now();
		const chatMessage: ChatMessage = {
			id: nanoid(8),
			content: text,
			user: nickname,
			role: "user",
			createdAt: now,
		};
		setMessages((prev) => [...prev, chatMessage]);
		socket.send(JSON.stringify({ type: "add", ...chatMessage } satisfies Message));
		input.value = "";
	}

	function handleBackToRooms() {
		localStorage.removeItem(CURRENT_ROOM_KEY);
		navigate("/");
	}

	return (
		<div className="chat-page">
			<header className="chat-header">
				<button className="chat-header-back" onClick={handleBackToRooms}>
					<ArrowLeftIcon />
					방 목록
				</button>
				<div className="chat-header-info">
					<div className="chat-header-room">{roomName || roomId}</div>
				</div>
				<span className="nickname-chip">
					<span className="nickname-chip-dot" />
					{nickname}
				</span>
			</header>

			<div className="chat-content">
				<aside className="participants-panel">
					<div className="participants-title">참여자 {participants.length}명</div>
					<div className="participants-list">
						{participants.map((participant) => (
							<div
								key={participant.id}
								className={`participants-item ${participant.id === clientId ? "participants-item--me" : ""}`}
							>
								<span className={`participants-item-dot ${participant.id === clientId ? "participants-item-dot--me" : ""}`} />
								{participant.nickname}
							</div>
						))}
					</div>
				</aside>

				<div className="chat-main">
					<div className="chat-messages">
						{messages.map((message, index) => {
							const isMine = message.user === nickname;
							const prev = messages[index - 1];
							const next = messages[index + 1];
							const shouldShowTime =
								!next ||
								next.user !== message.user ||
								getMessageMinuteKey(next.createdAt) !==
									getMessageMinuteKey(message.createdAt);
							const shouldShowSender =
								!isMine && (!prev || prev.user !== message.user);
							return (
								<div
									key={message.id}
									className={`message-item ${isMine ? "message-item--mine" : "message-item--other"}`}
								>
									{shouldShowSender && (
										<span className="message-sender">{message.user}</span>
									)}
									<div className="message-line">
										{isMine && shouldShowTime && (
											<span className="message-time">{formatMessageTime(message.createdAt)}</span>
										)}
										<div className={`message-bubble ${isMine ? "message-bubble--mine" : "message-bubble--other"}`}>
											{message.content}
										</div>
										{!isMine && shouldShowTime && (
											<span className="message-time">{formatMessageTime(message.createdAt)}</span>
										)}
									</div>
								</div>
							);
						})}
						<div ref={messagesEndRef} />
					</div>

					<div className="chat-input-area">
						<form className="chat-input-row" onSubmit={handleSend}>
							<input
								type="text"
								name="content"
								className="input"
								placeholder="메시지를 입력하세요…"
								autoComplete="off"
							/>
							<button type="submit" className="chat-send-btn">
								전송
							</button>
						</form>
					</div>
				</div>
			</div>
		</div>
	);
}

function CrossTabRoomSync() {
	const navigate = useNavigate();
	const location = useLocation();
	const previousRoomIdRef = useRef<string | null>(null);

	useEffect(() => {
		const roomId = getRoomIdFromPath(location.pathname);
		const storedRoomId = localStorage.getItem(CURRENT_ROOM_KEY);
		if (roomId) {
			if (storedRoomId !== roomId) {
				localStorage.setItem(CURRENT_ROOM_KEY, roomId);
			}
		} else if (storedRoomId) {
			if (previousRoomIdRef.current === storedRoomId) {
				localStorage.removeItem(CURRENT_ROOM_KEY);
			} else {
				navigate(`/room/${storedRoomId}`, { replace: true });
			}
		}

		previousRoomIdRef.current = roomId;
	}, [location.pathname, navigate]);

	useEffect(() => {
		function handleStorage(event: StorageEvent) {
			if (event.key !== CURRENT_ROOM_KEY) return;
			const nextRoomId = event.newValue?.trim() ?? "";
			const currentRoomId = getRoomIdFromPath(location.pathname);

			if (nextRoomId) {
				if (currentRoomId !== nextRoomId) {
					navigate(`/room/${nextRoomId}`, { replace: true });
				}
				return;
			}

			if (currentRoomId) {
				navigate("/", { replace: true });
			}
		}

		window.addEventListener("storage", handleStorage);
		return () => window.removeEventListener("storage", handleStorage);
	}, [location.pathname, navigate]);

	return null;
}

function App() {
	return (
		<>
			<CrossTabRoomSync />
			<Routes>
				<Route path="/" element={<HomePage />} />
				<Route path="/room/:roomId" element={<ChatPage />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</>
	);
}

// ─── Entry point ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById("root")!).render(
	<BrowserRouter>
		<App />
	</BrowserRouter>,
);
