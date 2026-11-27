"""Chat logic shared by all three entry points: the HTTP API, the WebSocket endpoint and the raw TCP server."""
from sqlalchemy import desc, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .connection_manager import manager
from .models import Conversation, Message, User
from .security import hash_password, verify_password


class ChatError(Exception):
    """An expected failure: a user-facing message plus an HTTP-style status code."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


# ---------- JSON shapes ----------

def user_json(user):
    return {"id": user.id, "username": user.username}


def message_json(message):
    return {
        "id": message.id,
        "conversation_id": message.conversation_id,
        "sender_id": message.sender_id,
        "sender_username": message.sender.username,
        "content": message.content,
        "created_at": message.created_at.isoformat(),
        "read_at": message.read_at.isoformat() if message.read_at else None,
    }


# ---------- Accounts ----------

def register_user(db: Session, username: str, password: str) -> User:
    if db.scalar(select(User).where(User.username == username)):
        raise ChatError(409, "Username is already taken")
    user = User(username=username, password_hash=hash_password(password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # someone else took the name at the same moment
        db.rollback()
        raise ChatError(409, "Username is already taken")
    return user


def authenticate(db: Session, username: str, password: str) -> User:
    user = db.scalar(select(User).where(User.username == username))
    if not user or not verify_password(password, user.password_hash):
        raise ChatError(401, "Invalid username or password")
    return user


def find_user(db: Session, username: str) -> User:
    user = db.scalar(select(User).where(User.username == username.strip().lower()))
    if not user:
        raise ChatError(404, "User not found")
    return user


def search_users(db: Session, my_id: int, search: str):
    search = search.strip().lower()
    if not search:
        return []
    users = db.scalars(
        select(User)
        .where(User.id != my_id, User.username.contains(search, autoescape=True))  # "_" is literal, not a wildcard
        .order_by(User.username).limit(20)
    )
    return [user_json(u) for u in users]


# ---------- Conversations ----------

def open_conversation(db: Session, my_id: int, other_user_id: int):
    """Return the private conversation between two users, creating it the first time."""
    if other_user_id == my_id:
        raise ChatError(400, "You cannot message yourself")
    other = db.get(User, other_user_id)
    if not other:
        raise ChatError(404, "User not found")

    pair = dict(user_one_id=min(my_id, other.id), user_two_id=max(my_id, other.id))
    find = select(Conversation).filter_by(**pair)
    conversation = db.scalar(find)
    if not conversation:
        db.add(Conversation(**pair))
        try:
            db.commit()
        except IntegrityError:  # the other user created it at the same moment
            db.rollback()
        conversation = db.scalar(find)
        if not conversation:
            raise ChatError(500, "Could not create conversation")
    return {"id": conversation.id, "other_user": user_json(other)}


def list_conversations(db: Session, my_id: int):
    conversations = db.scalars(
        select(Conversation).where(or_(Conversation.user_one_id == my_id, Conversation.user_two_id == my_id))
    )
    results = []
    for c in conversations:
        last = db.scalar(select(Message).where(Message.conversation_id == c.id).order_by(desc(Message.id)).limit(1))
        results.append({
            "id": c.id,
            "other_user": user_json(c.other_user(my_id)),
            "last_message": last and {
                "content": last.content, "sender_id": last.sender_id, "created_at": last.created_at.isoformat(),
            },
            "created_at": c.created_at.isoformat(),
        })
    # Most recently active conversation first
    results.sort(key=lambda r: (r["last_message"] or r)["created_at"], reverse=True)
    return results


def get_conversation(db: Session, conversation_id: int, user_id: int) -> Conversation:
    """Return the conversation, but only if this user is one of its two members."""
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise ChatError(404, "Conversation not found")
    if user_id not in conversation.members():
        raise ChatError(403, "You cannot access this conversation")
    return conversation


def get_messages(db: Session, conversation_id: int, user_id: int, limit=50, before_id=None):
    get_conversation(db, conversation_id, user_id)
    query = select(Message).where(Message.conversation_id == conversation_id)
    if before_id is not None:
        query = query.where(Message.id < before_id)  # paging back through older messages
    newest_first = db.scalars(query.order_by(desc(Message.id)).limit(limit)).all()
    return [message_json(m) for m in reversed(newest_first)]


# ---------- Sending ----------

def event_error(data):
    """Validate a send_message event (WebSocket or TCP). Return an error message, or None if valid."""
    if not isinstance(data, dict):
        return "Invalid message format"
    if data.get("type") != "send_message":
        return "Unknown WebSocket event"
    conversation_id, content = data.get("conversation_id"), data.get("content")
    if not isinstance(conversation_id, int) or isinstance(conversation_id, bool):
        return "Invalid conversation ID"
    if not isinstance(content, str):
        return "Message must be text"
    if not 1 <= len(content.strip()) <= 4000:
        return "Messages must contain 1–4000 characters"
    return None


async def send_message(db: Session, sender_id: int, conversation_id: int, content: str):
    """Store a message, then push it live to every open connection (browser or TCP) of both members."""
    conversation = get_conversation(db, conversation_id, sender_id)
    message = Message(conversation_id=conversation.id, sender_id=sender_id, content=content)
    db.add(message)
    db.commit()
    db.refresh(message)
    data = message_json(message)
    await manager.send_to_users(conversation.members(), {"type": "new_message", "message": data})
    return data
