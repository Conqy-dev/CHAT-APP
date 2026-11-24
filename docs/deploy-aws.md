# Deploying ConqChat to AWS EC2

One Ubuntu server runs everything: **nginx** (public, port 80) → **uvicorn/FastAPI** (private, `127.0.0.1:8000`) → **PostgreSQL** (private, `localhost:5432`). An AWS **Security Group** acts as the firewall in front of it.

## 1. Launch the server (AWS Console)

1. Open **EC2 → Instances → Launch instances**.
2. **Name:** `conqchat`
3. **AMI:** *Ubuntu Server 24.04 LTS* (64-bit x86)
4. **Instance type:** `t3.micro` (or `t2.micro`, whichever is marked *Free tier eligible*)
5. **Key pair:** *Create new key pair* → name `conqchat-key`, type RSA, format `.pem` → it downloads. Keep it safe.
6. **Network settings (firewall / inbound rules).** This box decides which ports the internet can reach. Don't click *Edit*; just set it up like this:

   ```
   Firewall (security groups)
     (•) Create security group          ← keep this selected
     ( ) Select existing security group

     [✓] Allow SSH traffic from   [ Anywhere  0.0.0.0/0 ▾ ]   ← tick, choose "Anywhere"
     [ ] Allow HTTPS traffic from the internet                 ← leave unticked
     [✓] Allow HTTP traffic from the internet                  ← TICK THIS (off by default!)
   ```

   - **SSH (port 22)** lets you open a terminal on the server. Choose **Anywhere**, because the browser terminal (*EC2 Instance Connect*) connects from Amazon's addresses, not yours. Login still needs your key, so this is safe enough for a class project.
   - **HTTP (port 80)** lets browsers open the chat app. **If you forget this box, the site will never load.**
   - **HTTPS (port 443)** isn't used, because the app has no certificate.
   - AWS shows a yellow warning about `0.0.0.0/0`. That's expected; continue.

   This creates two inbound rules:

   | Type | Protocol | Port | Source | Purpose |
   |---|---|---|---|---|
   | SSH | TCP | 22 | 0.0.0.0/0 | Admin terminal |
   | HTTP | TCP | 80 | 0.0.0.0/0 | Browsers reach nginx → the chat app |

   Ports 8000 (uvicorn) and 5432 (PostgreSQL) are **not** opened. They are only reachable from inside the server, which is the point.

   **Fixing rules after launch** (e.g. you forgot HTTP): **EC2 → Instances →** click `conqchat` **→ Security** tab **→** click the security group link (`sg-…`) **→ Edit inbound rules → Add rule →** Type `HTTP`, Source `Anywhere-IPv4` **→ Save rules**. This takes effect immediately; no restart is needed.
7. **Storage:** default 8 GB is enough → **Launch instance**.
8. *(Recommended)* **EC2 → Elastic IPs → Allocate → Associate** it with the instance, so the public address doesn't change when you stop/start the server.

## 2. Connect to the server

Easiest: select the instance → **Connect** → **EC2 Instance Connect** → **Connect** (opens a terminal in the browser).

Or from Windows PowerShell:
```powershell
ssh -i $HOME\Downloads\conqchat-key.pem ubuntu@<PUBLIC-IP>
```

## 3. Install and start the app

In the server terminal:
```bash
git clone https://github.com/<your-username>/<your-repo>.git chat-app
cd chat-app
bash deploy/setup.sh
```
The script installs Python, nginx and PostgreSQL, creates the database with a random password, writes `.env` with a random `SECRET_KEY`, starts the app as a systemd service, and finally prints the URL, e.g. `http://3.25.10.42`. Open it in your browser.

> If the repository is private, `git clone` asks for a username and a GitHub **personal access token** (not your password). Making the repo public avoids this.

## 4. Update after code changes

Push from your PC, then on the server:
```bash
cd ~/chat-app && git pull && bash deploy/setup.sh
```

## 5. Deployment evidence (screenshots)

- EC2 **Instances** page showing `conqchat` *Running* with its public IP
- The **Security Group inbound rules** (ports 22 and 80)
- The app at `http://<PUBLIC-IP>` in two browsers (e.g. Chrome + Incognito) with two users chatting
- Terminal output of these commands on the server:
  ```bash
  sudo systemctl status conqchat --no-pager   # the app service is running
  sudo ss -tlnp                               # LISTENING sockets: nginx :80, uvicorn 127.0.0.1:8000, postgres :5432
  sudo ss -tnp state established '( sport = :80 )'   # live TCP connections from browsers (open chats = WebSockets)
  ```

## Troubleshooting

| Problem | Check |
|---|---|
| Page doesn't load at all | Security group has HTTP port 80 open; you used `http://`, not `https://` |
| `502 Bad Gateway` | The app isn't running: `sudo journalctl -u conqchat -n 50` |
| Chat says *Reconnecting...* forever | `sudo tail /var/log/nginx/error.log`; make sure `deploy/nginx.conf` was installed |

## Costs

New AWS accounts get free-tier credits that cover a micro instance. AWS bills public IPv4 addresses by the hour (a few dollars a month). **Stop** the instance when you aren't using it, and **terminate** it and release the Elastic IP after grading.
