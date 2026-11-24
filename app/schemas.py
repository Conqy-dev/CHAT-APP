import re

from pydantic import BaseModel, Field, field_validator


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value):
        return value.strip().lower()


class RegisterRequest(LoginRequest):
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[a-z0-9_]+", value):
            raise ValueError("Username can only contain letters, numbers and underscores")
        return value


class MessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def strip_content(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Message cannot be empty")
        return value
