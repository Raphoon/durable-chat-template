export type ChatMessage = {
	id: string;
	content: string;
	user: string;
	role: "user" | "assistant";
	createdAt: number;
};

export type Participant = {
	id: string;
	nickname: string;
	joinedAt: number;
	online: boolean;
};

export type Message =
	| {
			type: "add";
			id: string;
			content: string;
			user: string;
			role: "user" | "assistant";
			createdAt: number;
	  }
	| {
			type: "update";
			id: string;
			content: string;
			user: string;
			role: "user" | "assistant";
			createdAt: number;
	  }
	| {
			type: "all";
			messages: ChatMessage[];
	  }
	| {
			type: "room_expired";
	  }
	| {
			type: "presence_sync";
			participants: Participant[];
	  }
	| {
			type: "leave";
	  }
	| {
			type: "room_full";
	  };

export type RoomInfo = {
	id: string;
	name: string;
	createdAt: number;
	count: number;
	capacity: number;
	idleExpiresAt: number | null;
	lastMessageAt: number | null;
};
