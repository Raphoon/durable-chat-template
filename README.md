# Durable Chat

Cloudflare Durable Objects와 PartyKit을 활용한 실시간 채팅 앱입니다.

## 주요 기능

- **채팅방 목록**: 현재 활성화된 채팅방 목록을 확인하고 입장
- **채팅방 생성**: 이름을 지정해 새 채팅방 생성
- **닉네임 설정**: 직접 닉네임을 입력해 사용 (localStorage에 저장)
- **자동 만료**: 생성 후 1시간이 지난 채팅방은 자동으로 삭제
- **실시간 동기화**: WebSocket 기반으로 메시지가 즉시 모든 참여자에게 전달
- **메시지 영속성**: Durable Object 내장 SQLite에 메시지 저장, 재접속 시 이전 대화 복원

## 동작 방식

### 아키텍처

```
브라우저
  │
  ├─ GET /api/rooms   ─→ Worker ─→ RoomRegistry DO (싱글턴, SQLite)
  ├─ POST /api/rooms  ─→ Worker ─→ RoomRegistry DO
  └─ WS /parties/chat/:roomId ─→ Worker ─→ Chat DO (방별 인스턴스, SQLite)
```

### Durable Objects 구성

| 클래스 | 역할 | 인스턴스 수 |
|--------|------|------------|
| `Chat` | 채팅방 WebSocket 연결, 메시지 저장/브로드캐스트, 만료 알람 | 방마다 1개 |
| `RoomRegistry` | 활성 방 목록 관리 (생성/조회/삭제) | 전역 1개 (싱글턴) |

### 화면 흐름

1. **닉네임 입력**: 처음 방문 시 닉네임 입력 화면 표시 → 저장 후 방 목록으로 이동
2. **방 목록**: 활성 채팅방 목록 표시, 방 생성 및 입장 가능
3. **채팅**: WebSocket 연결 후 실시간 메시지 송수신

### 방 만료 처리

- 방 생성 후 **첫 접속 시점**부터 1시간 뒤 Durable Object 알람(`onAlarm`) 발생
- 알람 발생 시: 접속 중인 클라이언트에 `room_expired` 메시지 전송 → 클라이언트 자동으로 방 목록으로 이동
- RoomRegistry에서 해당 방 삭제, Chat DO의 모든 데이터 초기화
- 알람과 무관하게 RoomRegistry의 목록 조회 시 생성 후 1시간이 지난 방은 필터링되어 표시되지 않음

## 시작하기

### 의존성 설치

```bash
npm install
```

### 로컬 개발

```bash
npm run dev
```

`http://localhost:8787` 에서 확인

### 배포

```bash
npx wrangler deploy
```

### 타입 재생성 (wrangler.json 변경 후)

```bash
npm run cf-typegen
```

### Worker 로그 모니터링

```bash
npx wrangler tail
```

## 프로젝트 구조

```
src/
├── client/
│   └── index.tsx          # React SPA (NicknamePage, RoomListPage, ChatPage)
├── server/
│   ├── index.ts           # Chat DO + Worker fetch 핸들러
│   ├── room-registry.ts   # RoomRegistry DO
│   └── worker-configuration.d.ts
└── shared.ts              # 공유 타입 (ChatMessage, Message, RoomInfo)
public/
├── index.html
└── styles.css
wrangler.json              # Cloudflare Workers 설정
```

## 기술 스택

- **런타임**: Cloudflare Workers
- **실시간 통신**: [PartyKit](https://www.partykit.io/) (partyserver / partysocket)
- **스토리지**: Durable Objects SQLite Storage API
- **프론트엔드**: React 18, React Router 7
- **빌드**: esbuild
- **배포**: Wrangler
