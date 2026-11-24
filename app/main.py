from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import desc, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from .config import COOKIE_SECURE, SECRET_KEY
from .connection_manager import manager
from .database import Base, SessionLocal, engine, get_db
from .models import Conversation, Message, User
from .schemas import LoginRequest, MessageRequest, RegisterRequest
from .security import hash_password, verify_password

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
INDEX_FILE = STATIC_DIR / "index.html"
if not INDEX_FILE.is_file():
    raise RuntimeError(f"Could not find index.html. Expected location: {INDEX_FILE}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)  # create tables on startup if they don't exist
    yield


app = FastAPI(title="Private Chat API", version="1.1.1", lifespan=lifespan)

# Signed cookie that remembers who is logged in (valid for 14 days)
app.add_middleware(
    SessionMiddleware, secret_key=SECRET_KEY, session_cookie="private_chat_session",
    max_age=60 * 60 * 24 * 14, same_site="lax", https_only=COOKIE_SECURE,
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ---------- JSON helpers ----------

def user_json(user):
    return {"id": user.id, "username": user.username}


def message_json(message):
    return {
        "id": message.id,
        "conversation_id": message.conversation_id,
        "sender_id": message.sender_id,
        "content": message.content,
        "created_at": message.created_at.isoformat(),
        "read_at": message.read_at.isoformat() if message.read_at else None,
    }


# ---------- Auth & access helpers ----------

def current_user(request: Request, db: Session) -> User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(401, "You must be logged in")
    user = db.get(User, user_id)
    if not user:
        request.session.clear()
        raise HTTPException(401, "Your session is invalid")
    return user


def get_conversation(conversation_id: int, user_id: int, db: Session) -> Conversation:
    """Return the conversation, but only if this user is one of its two members."""
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(404, "Conversation not found")
    if user_id not in conversation.members():
        raise HTTPException(403, "You cannot access this conversation")
    return conversation


def log_in(request: Request, user: User, message: str):
    request.session.clear()
    request.session["user_id"] = user.id
    return {"message": message, "user": user_json(user)}


async def save_and_broadcast(db: Session, conversation: Conversation, sender_id: int, content: str):
    """Store a message, then push it live to both members of the conversation."""
    message = Message(conversation_id=conversation.id, sender_id=sender_id, content=content)
    db.add(message)
    db.commit()
    db.refresh(message)
    data = message_json(message)
    await manager.send_to_users(conversation.members(), {"type": "new_message", "message": data})
    return data


# ---------- Pages ----------

@app.get("/")
def home():
    return FileResponse(INDEX_FILE, media_type="text/html")


@app.get("/health")
def health():
    return {"status": "healthy"}


# ---------- Accounts ----------

@app.post("/api/register")
def register(data: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.username == data.username)):
        raise HTTPException(409, "Username is already taken")
    user = User(username=data.username, password_hash=hash_password(data.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # someone else took the name at the same moment
        db.rollback()
        raise HTTPException(409, "Username is already taken")
    return log_in(request, user, "Account created successfully")


@app.post("/api/login")
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == data.username))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")
    return log_in(request, user, "Login successful")


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"message": "Logged out successfully"}


@app.get("/api/me")
def me(request: Request, db: Session = Depends(get_db)):
    user = current_user(request, db)
    return {**user_json(user), "created_at": user.created_at.isoformat()}


@app.get("/api/users")
def search_users(request: Request, search: str = Query(min_length=1, max_length=24), db: Session = Depends(get_db)):
    me = current_user(request, db)
    search = search.strip().lower()
    if not search:
        return []
    users = db.scalars(
        select(User)
        .where(User.id != me.id, User.username.contains(search, autoescape=True))  # "_" is literal, not a wildcard
        .order_by(User.username).limit(20)
    )
    return [user_json(u) for u in users]


# ---------- Conversations ----------

@app.post("/api/conversations/{other_user_id}")
def create_conversation(other_user_id: int, request: Request, db: Session = Depends(get_db)):
    me = current_user(request, db)
    if other_user_id == me.id:
        raise HTTPException(400, "You cannot message yourself")
    other = db.get(User, other_user_id)
    if not other:
        raise HTTPException(404, "User not found")

    pair = dict(user_one_id=min(me.id, other.id), user_two_id=max(me.id, other.id))
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
            raise HTTPException(500, "Could not create conversation")
    return {"id": conversation.id, "other_user": user_json(other)}


@app.get("/api/conversations")
def list_conversations(request: Request, db: Session = Depends(get_db)):
    me = current_user(request, db)
    conversations = db.scalars(
        select(Conversation).where(or_(Conversation.user_one_id == me.id, Conversation.user_two_id == me.id))
    )
    results = []
    for c in conversations:
        last = db.scalar(select(Message).where(Message.conversation_id == c.id).order_by(desc(Message.id)).limit(1))
        results.append({
            "id": c.id,
            "other_user": user_json(c.other_user(me.id)),
            "last_message": last and {
                "content": last.content, "sender_id": last.sender_id, "created_at": last.created_at.isoformat(),
            },
            "created_at": c.created_at.isoformat(),
        })
    # Most recently active conversation first
    results.sort(key=lambda r: (r["last_message"] or r)["created_at"], reverse=True)
    return results


@app.get("/api/conversations/{conversation_id}/messages")
def get_messages(
    conversation_id: int, request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    before_id: int | None = Query(default=None, gt=0),  # for paging back through older messages
    db: Session = Depends(get_db),
):
    me = current_user(request, db)
    get_conversation(conversation_id, me.id, db)
    query = select(Message).where(Message.conversation_id == conversation_id)
    if before_id is not None:
        query = query.where(Message.id < before_id)
    newest_first = db.scalars(query.order_by(desc(Message.id)).limit(limit)).all()
    return [message_json(m) for m in reversed(newest_first)]


@app.post("/api/conversations/{conversation_id}/messages")
async def send_message(conversation_id: int, data: MessageRequest, request: Request, db: Session = Depends(get_db)):
    me = current_user(request, db)
    conversation = get_conversation(conversation_id, me.id, db)
    return await save_and_broadcast(db, conversation, me.id, data.content)


# ---------- Real-time WebSocket ----------

def event_error(data):
    """Return an error message if a client event is invalid, otherwise None."""
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


def same_origin(websocket: WebSocket):
    """Block other websites from opening a socket with our user's cookie (cross-site WebSocket hijacking)."""
    origin = websocket.headers.get("origin")
    return origin is None or urlparse(origin).netloc == websocket.headers.get("host")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    user_id = websocket.scope.get("session", {}).get("user_id")
    with SessionLocal() as db:
        user_exists = user_id and db.get(User, user_id)
    if not user_exists or not same_origin(websocket):
        await websocket.close(code=1008)  # 1008 = policy violation
        return

    await manager.connect(user_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            error = event_error(data)
            if not error:
                with SessionLocal() as db:  # fresh DB session for each message
                    try:
                        conversation = get_conversation(data["conversation_id"], user_id, db)
                        await save_and_broadcast(db, conversation, user_id, data["content"].strip())
                    except HTTPException as e:
                        error = e.detail
                    except Exception:
                        db.rollback()
                        error = "Message could not be saved"
            if error:
                await websocket.send_json({"type": "error", "message": error})
    except WebSocketDisconnect:
        pass
    except Exception as error:
        print(f"WebSocket error for user {user_id}: {error}")
    finally:
        manager.disconnect(user_id, websocket)
