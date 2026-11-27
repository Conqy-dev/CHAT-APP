import logging

log = logging.getLogger("conqchat")


class ConnectionManager:
    """Keeps track of every open live connection, grouped by user id.

    A connection is anything with an async send_json(dict) method: a browser WebSocket
    or a raw TCP client. A user can have several at once (phone, laptop, terminal...)."""

    def __init__(self):
        self.active_connections: dict[int, set] = {}

    def add(self, user_id: int, connection):
        self.active_connections.setdefault(user_id, set()).add(connection)

    def disconnect(self, user_id: int, connection):
        sockets = self.active_connections.get(user_id)
        if sockets is None:
            return
        sockets.discard(connection)
        if not sockets:
            del self.active_connections[user_id]

    def online_count(self):
        return sum(len(c) for c in self.active_connections.values())

    async def send_to_users(self, user_ids, message: dict):
        """Push a JSON event to every open connection of the given users."""
        for user_id in set(user_ids):
            for connection in list(self.active_connections.get(user_id, ())):
                try:
                    await connection.send_json(message)
                except Exception as error:  # dead or stuck connection: drop it, keep serving the others
                    log.warning("Dropping connection of user %s: %s", user_id, error or type(error).__name__)
                    self.disconnect(user_id, connection)


manager = ConnectionManager()  # one shared instance for the whole app
