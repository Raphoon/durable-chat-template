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
	const [showModal, setShowModal] = useState(false);
	const [newRoomName, setNewRoomName] = useState("");
	const [newRoomCapacity, setNewRoomCapacity] = useState(4);
	const [creating, setCreating] = useState(false);
	const navigate = useNavigate();

	useEffect(() => {
		let socket: WebSocket | null = null;
		let reconnectTimer: number | null = null;
		let shouldReconnect = true;

		const connect = () => {
			const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
			socket = new WebSocket(`${protocol}//${window.location.host}/api/rooms/stream`);

			socket.addEventListener("message", (event) => {
				try {
					const message = JSON.parse(event.data as string) as {
						type?: string;
						rooms?: RoomInfo[];
					};
					if (message.type === "rooms_sync" && Array.isArray(message.rooms)) {
						setRooms(message.rooms);
					}
				} catch {
					// ignore malformed payload
				}
			});

			socket.addEventListener("close", () => {
				socket = null;
				if (!shouldReconnect) return;
				reconnectTimer = window.setTimeout(connect, 1500);
			});

			socket.addEventListener("error", () => {
				socket?.close();
			});
		};

		fetchRooms();
		connect();

		return () => {
			shouldReconnect = false;
			if (reconnectTimer !== null) {
				window.clearTimeout(reconnectTimer);
			}
			socket?.close();
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
		const capacity = newRoomCapacity;
		if (!name) return;
		setCreating(true);
		try {
			const res = await fetch("/api/rooms", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, capacity }),
			});
			if (res.ok) {
				const room: RoomInfo = await res.json();
				navigate(`/room/${room.id}`);
			}
		} finally {
			setCreating(false);
			setShowModal(false);
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

	function formatLastMessageAgo(lastMessageAt: number | null) {
		if (!lastMessageAt) return null;
		const diffMs = Math.max(0, Date.now() - lastMessageAt);
		const minutes = Math.floor(diffMs / 60000);
		if (minutes < 60) {
			return `${Math.max(1, minutes)}분 전 대화`;
		}
		const hours = Math.floor(diffMs / 3600000);
		if (hours < 24) {
			return `${hours}시간 전 대화`;
		}
		const days = Math.floor(diffMs / 86400000);
		return `${days}일 전 대화`;
	}

	return (
		<>
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
											<span className="room-item-count">
												{room.count > 0 && <span className="room-item-count-dot" />}
												<span style={{ color: room.count === 0 ? "#8b95a7" : undefined }}>
													{room.count}명 / {room.capacity}명
												</span>
												{formatLastMessageAgo(room.lastMessageAt) && (
													<>
														<span className="room-item-sep">·</span>
														<span className="room-item-last-message">{formatLastMessageAgo(room.lastMessageAt)}</span>
													</>
												)}
												{room.idleExpiresAt && (
													<>
														<span className="room-item-sep">·</span>
														{formatIdleExpiry(room.idleExpiresAt)}
													</>
												)}
											</span>
										</span>
									</div>
									<button
										className="btn btn--sm btn--join"
										onClick={() => navigate(`/room/${room.id}`)}
										disabled={room.count >= room.capacity}
									>
										{room.count >= room.capacity ? "정원 초과" : "입장"}
									</button>
								</div>
							))
						)}
					</div>

					<div className="section-divider" />

					<div className="create-room-footer">
						<button className="btn btn--sm btn--primary" onClick={() => { setNewRoomName(""); setNewRoomCapacity(4); setShowModal(true); }}>
							방 만들기
						</button>
					</div>
				</div>
			</div>
		</div>

		{showModal && (
			<div className="modal-overlay" onClick={() => setShowModal(false)}>
				<div className="modal" onClick={(e) => e.stopPropagation()}>
					<div className="modal-header">
						<h3 className="modal-title">새 채팅방 만들기</h3>
						<button type="button" className="modal-close" onClick={() => setShowModal(false)}>✕</button>
					</div>
					<form onSubmit={handleCreateRoom}>
						<div className="modal-field">
							<label className="modal-label">채팅방 제목</label>
							<input
								className="input"
								type="text"
								value={newRoomName}
								onChange={(e) => setNewRoomName(e.target.value)}
								placeholder="방 이름을 입력하세요"
								autoComplete="off"
								maxLength={30}
								autoFocus
							/>
						</div>
						<div className="modal-field">
							<label className="modal-label">최대 정원</label>
							<div className="capacity-stepper">
								<button
									type="button"
									className="capacity-btn"
									onClick={() => setNewRoomCapacity((v) => Math.max(1, v - 1))}
									disabled={newRoomCapacity <= 1}
								>−</button>
								<span className="capacity-value">{newRoomCapacity}명</span>
								<button
									type="button"
									className="capacity-btn"
									onClick={() => setNewRoomCapacity((v) => Math.min(500, v + 1))}
									disabled={newRoomCapacity >= 500}
								>+</button>
							</div>
						</div>
						<div className="modal-actions">
							<button type="submit" className="btn btn--primary btn--modal-submit" disabled={!newRoomName.trim() || creating}>
								{creating ? "생성 중…" : "만들기"}
							</button>
						</div>
					</form>
				</div>
			</div>
		)}
		</>
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
	const [roomCapacity, setRoomCapacity] = useState<number | null>(null);

	useEffect(() => {
		if (!roomId) return;
		localStorage.setItem(CURRENT_ROOM_KEY, roomId);
	}, [roomId]);

	useEffect(() => {
		fetch("/api/rooms")
			.then((r) => r.json())
			.then((rooms: RoomInfo[]) => {
				const found = rooms.find((r) => r.id === roomId);
				if (found) {
					setRoomName(found.name);
					setRoomCapacity(found.capacity);
				}
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
			...(roomCapacity !== null ? { capacity: String(roomCapacity) } : {}),
		},
		onMessage: (evt) => {
			const message = JSON.parse(evt.data as string) as Message;

			if (message.type === "room_full") {
				localStorage.removeItem(CURRENT_ROOM_KEY);
				navigate("/", { replace: true });
				return;
			}
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
		socket.send(JSON.stringify({ type: "leave" } satisfies Message));
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
								className={`participants-item ${participant.id === clientId ? "participants-item--me" : ""} ${!participant.online ? "participants-item--offline" : ""}`}
							>
								<span className={`participants-item-dot ${participant.id === clientId ? "participants-item-dot--me" : ""} ${!participant.online ? "participants-item-dot--offline" : ""}`} />
								{participant.nickname}
							</div>
						))}
					</div>
				</aside>

				<div className="chat-main">
					<div className="chat-messages">
						{messages.map((message, index) => {
							if (message.user === "시스템") {
								return (
									<div key={message.id} className="system-message">
										{message.content}
									</div>
								);
							}

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
