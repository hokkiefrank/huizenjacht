# Huizenjacht

A self-hosted web app for two (or more) people who are looking to **buy a house in the Netherlands** together. You collect houses on a shared board, rate them and comment on them, and Claude learns what you like: it writes a preference profile, rates every new listing that comes in, searches estate agents' websites for houses you would otherwise miss, and explains why a house does or doesn't fit.

The interface is in Dutch. The app's name is configurable (`APP_NAME`), so your fork can be called whatever you like.

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Before you start](#before-you-start)
- [Local development](#local-development)
- [Production setup](#production-setup), step by step: server, DNS, secrets, Claude, first start, automatic deploys, backups, email alerts
- [Using the app](#using-the-app)
- [Security](#security)
- [Operations](#operations)
- [Configuration reference](#configuration-reference)
- [Project structure](#project-structure)
- [Customising](#customising)
- [Third-party sites and terms](#third-party-sites-and-terms)

**Use:** you may use and adapt this code for your own, personal house hunt. Commercial use is not allowed.

## What it does

- **Shared board.** Paste a Funda link (or share it from the Funda app on Android) and the house is added with its details, photos and floor plans. Each of you rates it 👍 / 🤷 / 👎, writes plus and minus points, and tracks its status (interesting, viewing planned, viewed, made an offer, dropped).
- **Floor plans.** Funda's Floorplanner plans are redrawn as clean SVGs with room names and sizes. Claude describes the layout of each house, and you can comment per floor.
- **Preference profile.** Claude turns your own wishes ("Wat zoek jij?"), ratings and comments into a shared profile: must-haves, nice-to-haves, dealbreakers, budget, search area, and where you disagree. You can strike out points that are wrong, and Claude proposes changes based on the houses you reject.
- **Suggestions.** Every morning Claude searches for houses that fit the profile, and rates every house that arrives through your saved searches on Funda, Pararius and Huislijn. It also reads the listing pages of local estate agents (makelaars) that it finds itself. Each suggestion gets a score from 1 to 10, a reason, doubts, estimated travel times, and a ✅/❌/❔ per must-have.
- **Map.** Draw where you want to live and where you definitely don't. Houses up to 2 km outside your areas still count, so you don't miss a gem just over the border.
- **Bookmarklet.** Some sites block servers. With the "Stuur naar …" bookmark you send the page you are looking at straight to the app.
- **Installable** as an app on your phone (PWA).

## How it works

```
                        ┌──────────────── your server (Docker Compose) ─────────────────┐
 browser ── HTTPS ──▶   │ caddy ──▶ app (Next.js) ──▶ db (Postgres)                     │
                        │   :80/:443      │  ▲              ▲   ▲                         │
                        │                 ▼  │              │   │                         │
                        │              funda (pyfunda)      │   │                         │
                        │                                   │   │                         │
                        │  agent (worker + Claude Code) ────┘   │                         │
                        │    · daily search, ratings, layouts   │                         │
                        │    · reads makelaar websites          │                         │
 alert mails ── SMTP ─▶ │  mail (receive-only) ─────────────────┘                         │
                        │   :25                                                           │
                        └─────────────────────────────────────────────────────────────────┘
```

| Container | What it does | Talks to |
|---|---|---|
| `caddy` | Reverse proxy with automatic HTTPS (Let's Encrypt) | `app` |
| `app` | The website: Next.js 16 (App Router, server actions), runs the database migrations on start, and calls the Claude API for the profile | `db`, `funda`, Claude API |
| `db` | Postgres 18; not published outside Docker | – |
| `funda` | Small Python service around [pyfunda](https://github.com/0xMH/pyfunda) that fetches one listing at a time; only reachable from the other containers | funda.nl |
| `agent` | A Node worker that polls the database for jobs and runs **Claude Code** headless on your Claude subscription, with only the tools each job needs | `db`, `funda`, the web |
| `mail` | Receive-only SMTP server for one address. It stores forwarded search-alert mails for the agent. Optional | `db` |

The agent's jobs (`agent/worker.mjs`):

| Lane | When | Claude's tools |
|---|---|---|
| **suggestions** | Daily after 07:00 (Europe/Amsterdam) and on "Nu zoeken" | WebSearch, WebFetch |
| ↳ makelaar crawl | Part of the daily run: our own server fetches each estate agent's listings page (honest User-Agent, robots.txt respected, 1.5 s between requests, unchanged pages skipped). Claude reads the changed pages | none |
| ↳ profile proposals | Part of the daily run, once 3+ new rejections with a reason have come in | none |
| **rate** | A few minutes after new houses arrive (alerts, makelaars) | none |
| **inbox** | Every poll: reads alert mails. Funda listings are fetched through the `funda` service, Pararius/Huislijn houses are read from the mail itself | none |
| **details** | Houses with too little information: Claude looks for the advertisement elsewhere, otherwise one of you is asked to open it | WebSearch, WebFetch |
| **layout** | Once per house with floor plans: describes the layout from PNGs the worker renders | Read (only those images) |

Claude Code runs with `--restricted` and an explicit tool list, so it has no shell, no file access beyond its work folder, and no database access. It only gets `PATH`, `HOME` and the subscription token as environment. Everything it returns is checked against a JSON schema before the worker stores it.

## Before you start

You need:

- **A server** with Docker: a small VPS is plenty (2 vCPU, 4 GB RAM, 40 GB disk; e.g. Hetzner's smallest shared-vCPU type). The steps below use Hetzner Cloud and Ubuntu 24.04, but any VPS works.
- **A domain name** whose DNS you control.
- **A GitHub account** for your fork and the automatic deploys.
- **A Claude Pro or Max subscription** for the agent (Claude Code). The daily search and ratings use the subscription's usage, not API credits.
- **An Anthropic API key** ([console.anthropic.com](https://console.anthropic.com)) for the preference profile. One profile update costs a few cents with a small board, growing with the number of houses and comments. The cost is shown on the profile page. Set a monthly spend limit in the console.
- *Optional:* a **Gmail** account to forward search-alert mails from Funda, Pararius and Huislijn.

On your laptop: `git`, Node.js 24, the [GitHub CLI](https://cli.github.com/) (`gh`), [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`) and, for Hetzner, the [`hcloud` CLI](https://github.com/hetznercloud/cli).

## Local development

```sh
# Postgres 18 (macOS example)
brew install postgresql@18 && brew services start postgresql@18
createdb huizen

git clone git@github.com:<you>/<your-fork>.git && cd <your-fork>
cp .env.example .env.local      # DATABASE_URL and APP_URL; ANTHROPIC_API_KEY is optional
npm ci
npm run dev                     # http://localhost:3000; migrations run automatically on start
npm run invite -- "Alex" alex@example.com   # prints a link where Alex chooses a password
```

A login can be an email address or a plain username (`npm run invite -- "Sam" sam`). The app never sends email: you hand out the invite link yourself. It is valid for 7 days, and running the command again makes a new one.

Running the agent locally is optional. It needs a logged-in `claude` on your machine:

```sh
cd agent && npm ci
mkdir -p /tmp/agent-work
DATABASE_URL=postgres://localhost/huizen AGENT_WORKDIR=/tmp/agent-work node worker.mjs
```

Funda lookups need the Python service (`cd funda-service && pip install -r requirements.txt && python server.py`, then `FUNDA_SERVICE_URL=http://localhost:8000`). The easiest way to run everything together is `docker compose up --build` with a `.env` file like the production one.

**Database changes:** edit `src/db/schema.ts`, run `npm run db:generate -- --name <what-changed>`, and commit the new file in `drizzle/`. The app applies pending migrations when it starts (`src/instrumentation.ts`).

**Type check:** `npm run typecheck`.

## Production setup

All commands assume you replace:

| Placeholder | Example |
|---|---|
| `<you>/<your-fork>` | your GitHub repository |
| `<server-ip>` | the IPv4 address of your server |
| `huizen.example.com` | your domain |

### 1. Fork the repository

Fork it on GitHub. A fork of a public repository is public, which is fine: your secrets and data never go into the repository. If you'd rather have a private copy, use **Use this template** or GitHub's *Import repository* instead. In a fork, open the **Actions** tab and enable workflows: GitHub turns them off in forks.

### 2. Create the server

`deploy/cloud-init.yaml` sets up a fresh Ubuntu 24.04 server on first boot:

- a `deploy` user that logs in with your SSH key only
- root login and passwords switched off for SSH
- `fail2ban` against brute-force attempts
- automatic security updates (`unattended-upgrades`)
- Docker
- `/opt/huizen` for the app

First put **your own public key** in it (replace the `ssh-ed25519 AAAA...` line):

```sh
cat ~/.ssh/id_ed25519.pub        # no key yet? ssh-keygen -t ed25519
```

**Hetzner Cloud** (after `hcloud context create <project>` with an API token from the Hetzner console):

```sh
hcloud ssh-key create --name laptop --public-key-from-file ~/.ssh/id_ed25519.pub

# Firewall: SSH, HTTP(S), and SMTP only if you want email alerts (step 10)
hcloud firewall create --name huizen-fw
for p in 22 80 443 25; do
  hcloud firewall add-rule huizen-fw --direction in --protocol tcp --port $p --source-ips 0.0.0.0/0 --source-ips ::/0
done
hcloud firewall add-rule huizen-fw --direction in --protocol udp --port 443 --source-ips 0.0.0.0/0 --source-ips ::/0   # HTTP/3
hcloud firewall add-rule huizen-fw --direction in --protocol icmp --source-ips 0.0.0.0/0 --source-ips ::/0

hcloud server create --name huizen --type cx23 --image ubuntu-24.04 --location nbg1 \
  --ssh-key laptop --firewall huizen-fw --user-data-from-file deploy/cloud-init.yaml
hcloud server enable-backup huizen     # daily snapshots of the whole server, 7 kept (small extra cost)
```

**Another provider:** create an Ubuntu 24.04 server with `deploy/cloud-init.yaml` as "user data", and only allow inbound TCP 22, 80 and 443 (plus 25 for email alerts) in the provider's firewall. Without a provider firewall, use `ufw` (`ufw allow 22,80,443,25/tcp && ufw enable`). Note that ports published by Docker bypass `ufw`; this setup only publishes 80, 443 and 25.

Wait for the first boot to finish, then check that the hardening is in place:

```sh
ssh deploy@<server-ip> 'cloud-init status --wait'
ssh deploy@<server-ip> 'sudo sshd -T | grep -E "permitrootlogin|passwordauthentication"; systemctl is-active fail2ban docker; docker compose version'
# Expect: permitrootlogin no, passwordauthentication no, active, active, a version number
```

### 3. Domain and DNS

At your DNS provider, create:

| Type | Name | Value |
|---|---|---|
| `A` | `huizen.example.com` | `<server-ip>` |
| `AAAA` | `huizen.example.com` | the server's IPv6 address (optional) |
| `A` or `CNAME` | `www.huizen.example.com` | same server (optional, redirects to the main address) |
| `MX` | `huizen.example.com` | `10 huizen.example.com` (only for email alerts, step 10) |

Caddy requests the HTTPS certificate by itself once DNS points to the server.

### 4. Put the code on the server

The server pulls your fork from GitHub. For a **public** fork, a plain `git clone https://github.com/<you>/<your-fork>.git .` is enough. For a **private** fork, give the server its own read-only deploy key:

```sh
ssh deploy@<server-ip>
ssh-keygen -t ed25519 -N "" -C "server deploy key" -f ~/.ssh/github_deploy
printf "Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n" > ~/.ssh/config
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
cat ~/.ssh/github_deploy.pub
exit
```

Add that public key to your fork under **Settings → Deploy keys**, *without* write access. With the GitHub CLI, from your laptop:

```sh
ssh deploy@<server-ip> 'cat ~/.ssh/github_deploy.pub' > server_deploy.pub
gh repo deploy-key add server_deploy.pub -R <you>/<your-fork> --title "server (read-only)" && rm server_deploy.pub
```

Then clone:

```sh
ssh deploy@<server-ip> 'cd /opt/huizen && git clone git@github.com:<you>/<your-fork>.git .'
```

### 5. Secrets: `/opt/huizen/.env`

All configuration and secrets live in one file on the server that is never committed. `deploy/production.env.example` lists every variable with an explanation.

```sh
ssh deploy@<server-ip>
cd /opt/huizen
cp deploy/production.env.example .env
chmod 600 .env
openssl rand -hex 32          # use this as POSTGRES_PASSWORD
nano .env
```

Fill in at least these:
- `POSTGRES_PASSWORD`
- `SITE_ADDRESS` and `APP_URL`
- `REDIRECT_ADDRESSES`: it must not be empty; use your `www.` name if you have nothing else
- `APP_NAME` / `APP_TITLE`

The two Claude secrets follow in the next step. Each container only gets the variables it needs (see `docker-compose.yml`).

Type secrets into the file on the server yourself. Don't paste them into chats, issues or commit messages.

### 6. Claude

**The agent (subscription).** On your laptop, with the account that has Claude Pro or Max:

```sh
claude setup-token
```

This opens a browser to log in and prints a long-lived token. Put it in `/opt/huizen/.env` as `CLAUDE_CODE_OAUTH_TOKEN=`. The agent container deliberately gets **no** `ANTHROPIC_API_KEY`: an API key takes precedence over the subscription and would be billed per token instead. The Claude Code version in the container is pinned in `agent/Dockerfile`; raise it there to update.

**The profile (API).** Create a key at [console.anthropic.com](https://console.anthropic.com) → API keys, put it in `.env` as `ANTHROPIC_API_KEY=`, and set a spend limit. Only the `app` container receives it.

### 7. First start and accounts

```sh
ssh deploy@<server-ip>
cd /opt/huizen
docker compose up -d --build              # first build takes a few minutes
docker compose ps                          # all services "Up", db "healthy"
docker compose logs -f app agent           # Ctrl-C to stop following

# One account per person; prints a link to choose a password (valid 7 days)
docker compose exec app node scripts/invite.mjs "Alex" alex@example.com
docker compose exec app node scripts/invite.mjs "Sam" sam@example.com
```

Open `https://huizen.example.com` and log in. If you are going to forward alert mails (step 10), use the **Gmail address that forwards them** as each person's login. The app then knows whose alert a house came from.

### 8. Automatic deploys with GitHub Actions

`.github/workflows/deploy.yml` deploys every push to `main`: it connects over SSH, resets the server's checkout to `origin/main`, rebuilds and restarts the containers, and cleans up old images and build cache. It needs an SSH key of its own and three repository secrets. From your laptop, in your fork's folder:

```sh
ssh-keygen -t ed25519 -N "" -C "github-actions deploy" -f ./actions_deploy
ssh deploy@<server-ip> 'cat >> ~/.ssh/authorized_keys' < actions_deploy.pub

gh secret set DEPLOY_SSH_KEY < actions_deploy
gh secret set DEPLOY_HOST --body "<server-ip>"
# Pins the server's host key, so the workflow can't be tricked into deploying to another machine
ssh-keyscan -t ed25519 <server-ip> 2>/dev/null | ssh-keygen -lf - | awk '{print $2}' | gh secret set DEPLOY_HOST_FINGERPRINT

rm actions_deploy actions_deploy.pub        # the private key now only exists as a GitHub secret
```

Push a commit (or run the workflow from the Actions tab) and check that it goes green and actually deploys. Until `DEPLOY_HOST` is set, the workflow skips the deploy, so a fresh fork doesn't fail on every push. Anyone who can push to `main` can run code on your server, so enable 2FA on GitHub and consider branch protection.

### 9. Database backups

Two layers:
- **Server snapshots:** Hetzner's backups (step 2) restore the whole disk.
- **Database dumps:** `deploy/backup.sh` writes a nightly `pg_dump` to `/opt/huizen/backups` and keeps the last 14. Install it as a cron job:

```sh
ssh deploy@<server-ip> '(crontab -l 2>/dev/null; echo "30 3 * * * /opt/huizen/deploy/backup.sh >> /opt/huizen/backups.log 2>&1") | crontab - && /opt/huizen/deploy/backup.sh && ls -l /opt/huizen/backups'
```

Copy a dump off the server now and then, for example: `scp deploy@<server-ip>:/opt/huizen/backups/huizen-$(date +%F).sql.gz .`

**Restore** into an empty database:

```sh
cd /opt/huizen
docker compose stop app agent mail
docker compose exec -T db psql -U huizen -d postgres -c "drop database huizen" -c "create database huizen owner huizen"
gunzip -c backups/huizen-YYYY-MM-DD.sql.gz | docker compose exec -T db psql -U huizen -d huizen
docker compose start app agent mail
```

### 10. Search alerts by email (optional)

Funda, Pararius and Huislijn email you new houses from your saved searches. The app can receive those mails and rate every house in them.

1. **Port 25 and MX.** Open TCP 25 in the firewall (step 2), point an MX record to your server (step 3), and set `MAIL_ADDRESS` in `.env`, for example `alerts@huizen.example.com`. Then run `docker compose up -d mail`. The `mail` container only accepts mail for that one address and never sends mail.
2. **Saved searches.** Create a saved search with email alerts on each site. Pararius and Huislijn allow only one town per alert, so make one alert per town. Keep them broad: Claude's rating is the filter.
3. **Gmail forwarding.** In Gmail → Settings → *Forwarding and POP/IMAP* → *Add a forwarding address*, enter `MAIL_ADDRESS`. Gmail sends a confirmation code to it, which ends up in the database. Read it with:
   ```sh
   docker compose exec db psql -U huizen -d huizen -c "select subject, left(text, 400) from inbound_emails where kind = 'gmail' order by id desc limit 1"
   ```
4. **Filters.** Create one Gmail filter per site, `from:(funda.nl)`, `from:(pararius.nl)` and `from:(huislijn.nl)`, each with *Forward it to* `MAIL_ADDRESS`. You keep your own copy of every mail.
5. **Paste your Funda search link** in the app (Suggesties → *Waar zoeken?* → Funda-zoekopdracht). The makelaar crawl takes its price, size and type limits from it, loosely.

Alert mails are deleted from the database after 30 days.

## Using the app

A good order for the first days:

1. **Profiel → Wat zoek jij?** Each of you writes in your own words what you are looking for.
2. **+ Huis.** Add a few houses you like and don't like, rate them, and write plus and minus points.
3. **Profiel → Profiel maken.** Claude writes the shared profile (uses the API key). Update it when you've added more; it's skipped when nothing changed.
4. **Suggesties → Waar zoeken?** Set travel limits (e.g. "Werk Alex", max 45 min by public transport), your Funda search link, and any extra instructions for Claude.
5. **Kaart.** Draw your search areas and the areas you don't want.
6. **Suggesties.** The search runs every morning, or press *Nu zoeken*. Put good houses *Op het bord*. Reject the rest with a reason (there are quick-reason buttons), because the reasons feed the next search and the profile proposals.
7. **Stuur naar …** (link on the suggestions page). Install the bookmarklet for sites that block the server. Android: install the app from Chrome's menu → *Add to home screen*; it then appears in the Funda app's share sheet. iPhone: Safari → Share → *Add to Home Screen*, and paste Funda links via *+ Huis*.

How the score you see is made: Claude scores each house against the profile. The app lowers it only for things that are certain:
- outside your map areas: at most 5
- in a "don't want" area: at most 3
- a ❌ on a must-have that the listing states explicitly: at most 5, or at most 4 for two or more

Unknowns never count against a house. The card says when and why a score was lowered.

## Security

What this setup does:

- **Server:**
  - SSH with keys only
  - no root login
  - `fail2ban`
  - automatic security updates
  - a firewall that only lets in 22, 80, 443 (and 25 for alerts)
- **Network:**
  - only `caddy` (80/443) and `mail` (25) publish ports
  - Postgres, the Funda service and the app itself are only reachable inside Docker's network
  - HTTPS is automatic, and HTTP redirects to it
- **Secrets:**
  - everything is in `/opt/huizen/.env` (mode 600), never in git or the Docker images (see `.gitignore` and `.dockerignore`)
  - each container gets only the variables it needs
  - the GitHub Actions key exists only as a repository secret
  - the server's GitHub key is read-only
- **Accounts:**
  - no public sign-up: accounts exist only through `scripts/invite.mjs`
  - passwords are hashed with bcrypt
  - invite links and session tokens are random and stored only as SHA-256 hashes
  - invites expire after 7 days, sessions after 90
  - the session cookie is `httpOnly`, `secure` and `SameSite=Lax`
- **Public endpoints:**
  - only `/login`, `/uitnodiging/<token>` and `POST /api/pagina` work without a login
  - `/api/pagina` is the bookmarklet's endpoint: it parks a page for 24 hours (rate-limited) until a logged-in user confirms it
- **Claude:**
  - Claude Code runs with a fixed tool list and without shell, files or database access
  - web pages Claude reads are untrusted input, so the most a malicious page can influence is the JSON that comes back, which is validated before it's stored
  - Pararius alert links, which log you in to the recipient's Pararius account, are never sent to Claude, and only the recipient sees them
- **Crawling:** an honest User-Agent with a link to your app, robots.txt, and a slow request rate.

Keep in mind:
- The `deploy` user has passwordless `sudo` and Docker access. Your SSH key and the Actions key are effectively root on the server, so guard both.
- Port 22 is open to the internet because GitHub Actions connects from changing addresses. If you deploy by hand instead, restrict 22 to your own IP.

## Operations

```sh
ssh deploy@<server-ip>
cd /opt/huizen
docker compose ps                                   # status
docker compose logs -f --tail 100 agent             # what Claude is doing
docker compose exec db psql -U huizen -d huizen     # database shell
docker compose exec app node scripts/invite.mjs "Name" login   # new or forgotten password
df -h / && docker system df                         # disk use
```

- **Updating:** push to `main`, or on the server run `git pull && docker compose up -d --build`. Migrations run when the app starts.
- **Restarting:** after a restart the agent marks runs that were interrupted as failed. The next daily run or *Nu zoeken* starts fresh.
- **Disk:** the deploy workflow prunes old images and caps the build cache at 3 GB. The database stays small (megabytes).

## Configuration reference

| Variable | Where | Required | Meaning |
|---|---|---|---|
| `POSTGRES_PASSWORD` | server `.env` | yes | Database password; also used to build `DATABASE_URL` for each container |
| `SITE_ADDRESS` | server `.env` | yes | Domain Caddy serves and gets a certificate for, e.g. `huizen.example.com` |
| `APP_URL` | server `.env`, `.env.local` | yes | Full public URL, used in invite links, the bookmarklet and the crawler's User-Agent |
| `REDIRECT_ADDRESSES` | server `.env` | yes, non-empty | Extra addresses redirected to `APP_URL` (comma-separated, e.g. `www.huizen.example.com`) |
| `APP_NAME` | server `.env`, `.env.local` | no | Short name: navigation bar, home screen, "Stuur naar …". Default `Huizenjacht` |
| `APP_TITLE` | server `.env`, `.env.local` | no | Full name for the browser tab and installed app. Default `APP_NAME` |
| `CLAUDE_CODE_OAUTH_TOKEN` | server `.env` | for suggestions | From `claude setup-token`; only the `agent` container gets it |
| `ANTHROPIC_API_KEY` | server `.env`, `.env.local` | for the profile | Claude API key; only the `app` container gets it |
| `MAIL_ADDRESS` | server `.env` | no | Address that receives forwarded search alerts; without it, don't start `mail` |
| `DATABASE_URL` | `.env.local` | local only | In production `docker-compose.yml` builds it from `POSTGRES_PASSWORD` |
| `FUNDA_SERVICE_URL` | – | no | Set by `docker-compose.yml`; locally `http://localhost:8000` if you run the service |
| `AGENT_WORKDIR` | – | no | Claude Code's working folder; `/work` in the container |

Tunables in code: `DAILY_HOUR`, `MAX_SUGGESTIONS`, `RATE_BATCH` and `TRAVEL_MARGIN` at the top of `agent/worker.mjs`, `MANUAL_RUNS_PER_DAY` in `src/app/actions.ts`, `NEAR_METERS` and the score caps in `src/lib/zones.ts`.

## Project structure

```
src/app/            pages (Dutch routes: /huis, /nieuw, /suggesties, /kaart, /profiel, /ontvang…) and server actions
src/components/     UI components
src/db/schema.ts    database schema (Drizzle); migrations in drizzle/
src/lib/            profile (Claude API), Funda import, floor plans, zones and scoring, auth
agent/              the worker that runs Claude Code: searches, ratings, makelaar crawl, alerts, layouts
mail/               receive-only SMTP server for alert mails
funda-service/      Python wrapper around pyfunda
deploy/             cloud-init, Caddyfile, production .env example, backup script
scripts/invite.mjs  create an account / reset a password
.github/workflows/  deploy on push to main
```

## Customising

- **Name and colours:**
  - name: `APP_NAME` / `APP_TITLE`
  - colours: the tokens at the top of `src/app/globals.css`, plus the icon colour in `src/app/icons/[size]/route.tsx`, `public/favicon.svg` and the theme colour in `src/app/layout.tsx` and `src/app/manifest.ts`
- **Language:** the UI and Claude's prompts are Dutch, because the housing sites, listings and makelaars are Dutch. The prompts are in `agent/worker.mjs` and `src/lib/profile.ts`.
- **Model:** the profile uses the model in `src/lib/profile.ts`. The agent uses the default model of the Claude Code version pinned in `agent/Dockerfile`.
- **Time zone and schedule:** `DAILY_HOUR` and the `Europe/Amsterdam` time zone in `agent/worker.mjs`.

## Third-party sites and terms

This is a personal tool. Check the terms yourself before you run it:

- **Funda.** `funda-service` uses [pyfunda](https://github.com/0xMH/pyfunda), an unofficial client of Funda's app API. That is against Funda's terms of use. The app keeps it to about one request per house you add or that arrives by alert. Its search does not work (Funda requires a login for search), which is why new Funda houses come in through alert mails. Floor plans are read from Floorplanner's public project files.
- **Pararius, Huislijn, Jaap.** They block automated visitors, and the app does not try to get around that. Their houses come in through your own alert mails, and the bookmarklet sends pages you open yourself.
- **Makelaars.** Their listings pages are fetched at most once a day, with robots.txt respected and an honest User-Agent that links to your app. Switch a makelaar off in the app if they object.
- **PDOK.** Addresses are geocoded with PDOK's free [Locatieserver](https://www.pdok.nl), and the map uses PDOK's base map (© Kadaster).
- **Claude.** The agent uses your own Claude subscription through `claude setup-token`, for your own household. Check Anthropic's terms for your plan.
