from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from . import services as chat
from .config import COOKIE_SECURE, SECRET_KEY, TCP_HOST, TCP_PORT, setup_logging
from .connection_manager import manager
from .database import Base, SessionLocal, engine, get_db
from .models import User
from .schemas import LoginRequest, MessageRequest, RegisterRequest
from .services import ChatError
from .tcp_server import start_tcp_server, stop_tcp_server

log = setup_logging()

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
INDEX_FILE = STATIC_DIR / "index.html"
if not INDEX_FILE.is_file():
    raise RuntimeError(f"Could not find index.html. Expected location: {INDEX_FILE}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)  # create tables on startup if they don't exist
    tcp_server = await start_tcp_server(TCP_HOST, TCP_PORT)  # raw TCP chat runs alongside the web app
    yield
    await stop_tcp_server(tcp_server)


app = FastAPI(title="Private Chat API", version="2.0.0", lifespan=lifespan)

# Signed cookie that remembers who is logged in (valid for 14 days)
app.add_middleware(
    SessionMiddleware, secret_key=SECRET_KEY, session_cookie="private_chat_session",
    max_age=60 * 60 * 24 * 14, same_site="lax", https_only=COOKIE_SECURE,
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.exception_handler(ChatError)
async def chat_error_handler(request: Request, error: ChatError):
    return JSONResponse({"detail": error.message}, status_code=error.status)


def current_user(request: Request, db: Session) -> User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise ChatError(401, "You must be logged in")
    user = db.get(User, user_id)
    if not user:
        request.session.clear()
        raise ChatError(401, "Your session is invalid")
    return user


def log_in(request: Request, user: User, message: str):
    request.session.clear()
    request.session["user_id"] = user.id
    return {"message": message, "user": chat.user_json(user)}


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
    return log_in(request, chat.register_user(db, data.username, data.password), "Account created successfully")


@app.post("/api/login")
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    return log_in(request, chat.authenticate(db, data.username, data.password), "Login successful")


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"message": "Logged out successfully"}


@app.get("/api/me")
def me(request: Request, db: Session = Depends(get_db)):
    user = current_user(request, db)
    return {**chat.user_json(user), "created_at": user.created_at.isoformat()}


@app.get("/api/users")
def search_users(request: Request, search: str = Query(min_length=1, max_length=24), db: Session = Depends(get_db)):
    return chat.search_users(db, current_user(request, db).id, search)


# ---------- Conversations ----------

@app.post("/api/conversations/{other_user_id}")
def create_conversation(other_user_id: int, request: Request, db: Session = Depends(get_db)):
    return chat.open_conversation(db, current_user(request, db).id, other_user_id)


@app.get("/api/conversations")
def list_conversations(request: Request, db: Session = Depends(get_db)):
    return chat.list_conversations(db, current_user(request, db).id)


@app.get("/api/conversations/{conversation_id}/messages")
def get_messages(
    conversation_id: int, request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    before_id: int | None = Query(default=None, gt=0),  # for paging back through older messages
    db: Session = Depends(get_db),
):
    return chat.get_messages(db, conversation_id, current_user(request, db).id, limit, before_id)


@app.post("/api/conversations/{conversation_id}/messages")
async def send_message(conversation_id: int, data: MessageRequest, request: Request, db: Session = Depends(get_db)):
    return await chat.send_message(db, current_user(request, db).id, conversation_id, data.content)


# ---------- Real-time WebSocket (browser clients; runs over one TCP connection per tab) ----------

def same_origin(websocket: WebSocket):
    """Block other websites from opening a socket with our user's cookie (cross-site WebSocket hijacking)."""
    origin = websocket.headers.get("origin")
    return origin is None or urlparse(origin).netloc == websocket.headers.get("host")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    user_id = websocket.scope.get("session", {}).get("user_id")
    with SessionLocal() as db:
        user = user_id and db.get(User, user_id)
        username = user.username if user else None
    if not user or not same_origin(websocket):
        await websocket.close(code=1008)  # 1008 = policy violation
        return

    peer = f"{websocket.client.host}:{websocket.client.port}" if websocket.client else "?"
    await websocket.accept()  # finishes the WebSocket handshake (HTTP 101 Switching Protocols)
    manager.add(user_id, websocket)
    log.info("WebSocket connect %s user=%s", peer, username)
    reason = "client closed"
    try:
        while True:
            data = await websocket.receive_json()
            error = chat.event_error(data)
            if not error:
                with SessionLocal() as db:  # fresh DB session for each message
                    try:
                        await chat.send_message(db, user_id, data["conversation_id"], data["content"].strip())
                    except ChatError as e:
                        error = e.message
                    except Exception:
                        db.rollback()
                        log.exception("Could not save WebSocket message from user %s", username)
                        error = "Message could not be saved"
            if error:
                await websocket.send_json({"type": "error", "message": error})
    except WebSocketDisconnect:
        pass
    except Exception as error:
        reason = f"error: {error}"
        log.warning("WebSocket error for user %s: %s", username, error)
    finally:
        manager.disconnect(user_id, websocket)
        log.info("WebSocket disconnect %s user=%s reason=%s", peer, username, reason)
