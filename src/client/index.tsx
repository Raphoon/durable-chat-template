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
} from "react-router";
import { nanoid } from "nanoid";

import { type ChatMessage, type Message, type RoomInfo } from "../shared";

const NICKNAME_KEY = "chat_nickname";

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
		return () => clearInterval(interval);
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

	function formatExpiry(expiresAt: number) {
		const diff = expiresAt - Date.now();
		if (diff <= 0) return "만료됨";
		const m = Math.floor(diff / 60000);
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}시간 ${m % 60}분 후 만료`;
		return `${m}분 후 만료`;
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
										<span className="room-item-meta">{formatExpiry(room.expiresAt)}</span>
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

	function handleSave(name: string) {
		setNickname(name);
	}

	function handleChangeNickname() {
		localStorage.removeItem(NICKNAME_KEY);
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
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [roomName, setRoomName] = useState<string>("");

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
		onMessage: (evt) => {
			const message = JSON.parse(evt.data as string) as Message;

			if (message.type === "room_expired") {
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
			}
		},
	});

	function handleSend(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const input = e.currentTarget.elements.namedItem("content") as HTMLInputElement;
		const text = input.value.trim();
		if (!text) return;
		const chatMessage: ChatMessage = {
			id: nanoid(8),
			content: text,
			user: nickname,
			role: "user",
		};
		setMessages((prev) => [...prev, chatMessage]);
		socket.send(JSON.stringify({ type: "add", ...chatMessage } satisfies Message));
		input.value = "";
	}

	return (
		<div className="chat-page">
			<header className="chat-header">
				<button className="chat-header-back" onClick={() => navigate("/")}>
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

			<div className="chat-messages">
				{messages.map((message) => {
					const isMine = message.user === nickname;
					return (
						<div
							key={message.id}
							className={`message-item ${isMine ? "message-item--mine" : "message-item--other"}`}
						>
							{!isMine && (
								<span className="message-sender">{message.user}</span>
							)}
							<div className={`message-bubble ${isMine ? "message-bubble--mine" : "message-bubble--other"}`}>
								{message.content}
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
	);
}

// ─── Entry point ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById("root")!).render(
	<BrowserRouter>
		<Routes>
			<Route path="/" element={<HomePage />} />
			<Route path="/room/:roomId" element={<ChatPage />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	</BrowserRouter>,
);
