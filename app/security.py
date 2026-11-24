from pwdlib import PasswordHash

# Uses Argon2: a slow, salted hash, so stolen hashes are hard to crack
password_hasher = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hasher.verify(password, hashed_password)
