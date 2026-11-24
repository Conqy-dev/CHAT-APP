from fastapi import WebSocket, WebSocketDisconnect


class ConnectionManager:
    """Keeps track of every open WebSocket, grouped by user id.
    A user can have several (e.g. a phone and a laptop logged in at once)."""

    def __init__(self):
        self.active_connections: dict[int, set[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()  # finishes the WebSocket handshake
        self.active_connections.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket):
        sockets = self.active_connections.get(user_id)
        if sockets is None:
            return
        sockets.discard(websocket)
        if not sockets:
            del self.active_connections[user_id]

    async def send_to_users(self, user_ids, message: dict):
        """Push a JSON event to every open connection of the given users."""
        for user_id in set(user_ids):
            for websocket in list(self.active_connections.get(user_id, ())):
                try:
                    await websocket.send_json(message)
                except (WebSocketDisconnect, RuntimeError):
                    self.disconnect(user_id, websocket)  # that connection is dead


manager = ConnectionManager()  # one shared instance for the whole app
