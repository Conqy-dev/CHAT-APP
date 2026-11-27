# Deploying ConqChat to Microsoft Azure

One Ubuntu virtual machine runs everything. A **Network Security Group (NSG)** is the cloud firewall in front of it.

| Port | Open to | Process on the VM | Purpose |
|---|---|---|---|
| 22/TCP | **Admin's IP only** | sshd | Administration |
| 80/TCP | Internet | nginx → uvicorn `127.0.0.1:8000` | Web app (HTTP + WebSocket) |
| 5000/TCP | Internet | ConqChat TCP server `0.0.0.0:5000` | Terminal clients (raw TCP, NDJSON) |
| 8000, 5432 | **not opened** | uvicorn, PostgreSQL | Reachable only from inside the VM |

## Why these Azure services

- **Azure Virtual Machine (Ubuntu 24.04, `Standard_B1s`)**: full control of the operating system, which the assignment needs. You can see listening sockets (`ss -tlnp`), capture packets (`tcpdump`), inject loss (`tc netem`) and open a raw TCP port. Platform services such as App Service accept only HTTP and can't expose raw TCP port 5000. B1s is the smallest general-purpose size (1 vCPU, 1 GiB RAM), which is enough for a class chat server.
- **Network Security Group**: a stateful firewall. Only the three ports above are allowed in, and SSH is limited to one IP address.
- **Standard static public IP**: the address doesn't change when the VM restarts, so the URL in the report stays valid.
- **PostgreSQL on the same VM** (not Azure Database for PostgreSQL): no extra cost, and the database port never leaves the machine.

## Before you start: eligibility and cost

1. **Check the subscription:** `az account show --query "{name:name, offer:id, state:state}"`. Free-trial and student subscriptions include 750 hours a month of B1s for 12 months. Pay-as-you-go subscriptions are billed.
2. **Estimated cost** (pay-as-you-go, UK South, at the time of writing; confirm with the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/)):

   | Resource | Approx. monthly | Approx. per day |
   |---|---|---|
   | B1s VM (running) | US$7.60 | US$0.25 |
   | Standard static public IPv4 | US$3.65 | US$0.12 |
   | 30 GB Standard SSD OS disk | US$2.40 | US$0.08 |
   | Outbound data (well under 100 GB) | US$0 | US$0 |
   | **Total** | **≈ US$13.65** | **≈ US$0.45** |

   Deallocating the VM (`stop`) removes the VM line. Deleting the resource group removes everything.
3. **Spending alert** (portal): **Cost Management + Billing → Budgets → + Add**. Scope: the subscription or `conqchat-rg`. Amount: **US$5**. Alert at **80% actual** and **100% forecasted**, sent to your email.

## Provision and deploy (one command)

From Git Bash on your PC, in the project folder:

```bash
az login                         # or: az login --use-device-code
bash deploy/azure.sh create      # ~5 minutes
```

This runs, in order:
1. `az group create`: resource group `conqchat-rg` in `uksouth` (change with `LOCATION=...`).
2. `az vm create`: Ubuntu 24.04 B1s, SSH key authentication (no password), Standard static IP, **no inbound rules**.
3. `az network nsg rule create` ×3: SSH from your current public IP only, then 80 and 5000 from the Internet.
4. SSH into the VM, `git clone` this repository, and run [`deploy/setup.sh`](../deploy/setup.sh). That script:
   - installs Python, nginx and PostgreSQL
   - creates the database user with a random password
   - writes `.env` with a random `SECRET_KEY` (`chmod 600`, never committed)
   - installs the **systemd** service and the nginx reverse proxy
5. Prints the web URL and the TCP client command.

## Connecting

```bash
bash deploy/azure.sh ip
# Web app:     http://<PUBLIC-IP>
# TCP client:  python client/chat_client.py --host <PUBLIC-IP> --port 5000
```

## Operating the deployment

| Task | Command |
|---|---|
| App status / logs | `sudo systemctl status conqchat`, `sudo journalctl -u conqchat -f`, `tail -f ~/chat-app/logs/server.log` |
| Restart / stop / start the app | `sudo systemctl restart conqchat` · `stop` · `start` |
| Deploy new code | `bash deploy/azure.sh update` (pull + re-run setup) |
| Change the TCP listening port | edit `TCP_PORT` in `~/chat-app/.env`, `sudo systemctl restart conqchat`, add an NSG rule for the new port |
| Your IP changed (SSH refused) | `bash deploy/azure.sh allow-me` |
| Pause billing for compute | `bash deploy/azure.sh stop` (and `start` later) |
| **Clean up everything** | `bash deploy/azure.sh delete` → deletes the resource group, VM, disk, IP and NSG |

## Security notes

- **Secrets:** the database password and `SECRET_KEY` are generated on the VM into `.env` (mode 600). `.env` is in `.gitignore`. Only `.env.example` (no real values) is in Git.
- **Least exposure:** the database (5432) and the app server (8000) listen on `127.0.0.1` and have no NSG rule. SSH accepts keys only, from one IP.
- **TLS:** **not used.** Traffic on ports 80 and 5000 is plaintext, so packet captures show the JSON, and test accounts must use throwaway passwords. HTTPS needs a domain name for a trusted certificate, and the raw TCP protocol would need `ssl.wrap_socket` plus a client trust store. Both are listed under limitations. With a domain, adding [Caddy](https://caddyserver.com/) or `certbot --nginx` would enable HTTPS on 443 without code changes.

## Running the TCP experiments on the VM

```bash
bash deploy/azure.sh ssh
cd chat-app && bash experiments/run_experiments.sh
exit
scp -r azureuser@<PUBLIC-IP>:chat-app/experiments/results experiments/   # copy captures to your PC for Wireshark
```

The experiments only impair the VM's **loopback** interface (`lo`), so no other network or user is affected.
