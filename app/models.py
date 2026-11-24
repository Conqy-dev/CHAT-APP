from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def created_at_column():
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = created_at_column()


class Conversation(Base):
    """A private chat between two users. The smaller id is always stored in user_one_id,
    so each pair of users can only ever have one conversation."""
    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint("user_one_id", "user_two_id", name="unique_private_conversation"),
        CheckConstraint("user_one_id < user_two_id", name="ordered_conversation_users"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_one_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    user_two_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = created_at_column()

    user_one = relationship("User", foreign_keys=[user_one_id])
    user_two = relationship("User", foreign_keys=[user_two_id])
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")

    def members(self):
        return (self.user_one_id, self.user_two_id)

    def other_user(self, my_id):
        return self.user_two if self.user_one_id == my_id else self.user_one


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_conversation_id_id", "conversation_id", "id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_column()
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    conversation = relationship("Conversation", back_populates="messages")
    sender = relationship("User")
