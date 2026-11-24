"""HTTP API tests: accounts, search, conversations, message history."""
import httpx


def test_health_and_homepage(base_url):
    assert httpx.get(base_url + "/health").json() == {"status": "healthy"}
    home = httpx.get(base_url + "/")
    assert home.status_code == 200 and "ConqChat" in home.text


def test_register_login_logout(base_url, new_user):
    alice = new_user()
    name = alice.user["username"]
    assert alice.get("/api/me").json()["username"] == name

    assert alice.post("/api/logout").status_code == 200
    assert alice.get("/api/me").status_code == 401

    wrong = alice.post("/api/login", json={"username": name, "password": "wrongpass"})
    assert wrong.status_code == 401 and wrong.json()["detail"] == "Invalid username or password"

    # usernames are case-insensitive and trimmed
    ok = alice.post("/api/login", json={"username": f"  {name.upper()} ", "password": "password1"})
    assert ok.status_code == 200 and alice.get("/api/me").status_code == 200


def test_registration_rules(base_url, new_user):
    alice = new_user()
    anon = httpx.Client(base_url=base_url)
    taken = anon.post("/api/register", json={"username": alice.user["username"], "password": "password1"})
    assert taken.status_code == 409
    assert anon.post("/api/register", json={"username": "bad name", "password": "password1"}).status_code == 422
    assert anon.post("/api/register", json={"username": "shortpw", "password": "short"}).status_code == 422


def test_requires_login(base_url):
    anon = httpx.Client(base_url=base_url)
    for path in ("/api/me", "/api/users?search=a", "/api/conversations"):
        assert anon.get(path).status_code == 401


def test_search_excludes_self_and_treats_underscore_literally(new_user):
    alice, bob = new_user(), new_user()
    found = alice.get("/api/users", params={"search": bob.user["username"]}).json()
    assert found == [bob.user]
    assert alice.get("/api/users", params={"search": alice.user["username"]}).json() == []
    # "_" must not act as a single-character wildcard: "use_..." must not match "user..."
    pattern = "use_" + bob.user["username"][4:]
    assert bob.user not in alice.get("/api/users", params={"search": pattern}).json()


def test_conversation_rules(new_user):
    alice, bob = new_user(), new_user()
    assert alice.post(f"/api/conversations/{alice.user['id']}").status_code == 400
    assert alice.post("/api/conversations/999999").status_code == 404

    first = alice.post(f"/api/conversations/{bob.user['id']}").json()
    again = bob.post(f"/api/conversations/{alice.user['id']}").json()
    assert first["id"] == again["id"]  # one conversation per pair, whoever starts it
    assert first["other_user"] == bob.user and again["other_user"] == alice.user


def test_message_history_paging_and_privacy(new_user):
    alice, bob, carol = new_user(), new_user(), new_user()
    cid = alice.post(f"/api/conversations/{bob.user['id']}").json()["id"]
    sent = [alice.post(f"/api/conversations/{cid}/messages", json={"content": f" msg {i} "}).json()
            for i in range(3)]
    assert sent[0]["content"] == "msg 0"  # whitespace trimmed

    history = bob.get(f"/api/conversations/{cid}/messages").json()
    assert [m["content"] for m in history] == ["msg 0", "msg 1", "msg 2"]  # oldest first
    page = bob.get(f"/api/conversations/{cid}/messages", params={"limit": 1, "before_id": sent[2]["id"]}).json()
    assert [m["content"] for m in page] == ["msg 1"]

    convos = bob.get("/api/conversations").json()
    assert convos[0]["id"] == cid and convos[0]["last_message"]["content"] == "msg 2"

    assert carol.get(f"/api/conversations/{cid}/messages").status_code == 403
    assert alice.post(f"/api/conversations/{cid}/messages", json={"content": "   "}).status_code == 422
