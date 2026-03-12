export type ChatMessage = {
	id: string;
	content: string;
	user: string;
	role: "user" | "assistant";
};

export type Participant = {
	id: string;
	nickname: string;
	joinedAt: number;
};

export type Message =
	| {
			type: "add";
			id: string;
			content: string;
			user: string;
			role: "user" | "assistant";
	  }
	| {
			type: "update";
			id: string;
			content: string;
			user: string;
			role: "user" | "assistant";
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
	  };

export type RoomInfo = {
	id: string;
	name: string;
	createdAt: number;
	count: number;
	idleExpiresAt: number | null;
};
