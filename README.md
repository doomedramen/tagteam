# TagTeam

TagTeam is a shared todo app I made for me and my partner. It is for people who struggle with task blindness and demand avoidance. Tasks can slip out of sight, and pressure to do them can make it harder to get started.

In a TagTeam group, everyone can see each other's tasks and send a supportive nudge. Each person manages their own tasks, so a team can help without taking over. The goal is to make everyday tasks easier to face together.

Tasks can repeat daily, weekly, monthly, or on a custom schedule. TagTeam keeps a history of what was done on time, late, or missed. It is an offline-first, mobile-first PWA.

> Status: accounts, groups, recurring tasks, task history, offline sync, and push notifications are implemented. Push needs VAPID configuration.

## Run it with Docker Compose

TagTeam is designed to sit behind [Cloudflare Zero Trust](https://developers.cloudflare.com/cloudflare-one/) (Access + Tunnel). The app port is not published; `cloudflared` reaches it over the Compose network.

1. In Cloudflare Zero Trust, create a **Tunnel** and copy its token. Add a public hostname (e.g. `tagteam.example.com`) pointing to `http://tagteam:3000`.
2. Protect that hostname with an **Access application** listing who may use it.
3. Create a folder with these two files and run `docker compose up -d`.

`docker-compose.yml`:

```yaml
services:
  tagteam:
    image: ghcr.io/doomedramen/tagteam:latest
    restart: unless-stopped
    environment:
      AUTH_SECRET: ${AUTH_SECRET:?Set AUTH_SECRET in .env}
      BASE_URL: ${BASE_URL:?Set BASE_URL in .env}
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}
      VAPID_SUBJECT: ${VAPID_SUBJECT:-}
    volumes:
      - tagteam-data:/data

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:?Set TUNNEL_TOKEN in .env}
    depends_on:
      - tagteam

volumes:
  tagteam-data:
```

`.env`:

```bash
# openssl rand -base64 32
AUTH_SECRET=
# The public URL people open (must match the tunnel hostname)
BASE_URL=https://tagteam.example.com
TUNNEL_TOKEN=
# Generate once with: pnpm --filter @tagteam/server exec web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=https://tagteam.example.com
```

### Try it locally without Cloudflare

```yaml
services:
  tagteam:
    image: ghcr.io/doomedramen/tagteam:latest
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      AUTH_SECRET: ${AUTH_SECRET:?Set AUTH_SECRET in .env}
      BASE_URL: http://localhost:3000
    volumes:
      - tagteam-data:/data

volumes:
  tagteam-data:
```

Passkeys need the browser to see the exact `BASE_URL` host, so use `http://localhost:3000`, not an IP address.

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AUTH_SECRET` | yes | — | Signs sessions. At least 32 characters. |
| `BASE_URL` | yes (image) | `http://localhost:3000` | Public URL. Sets trusted origin and passkey relying party. |
| `PORT` | no | `3000` | HTTP port inside the container. |
| `DATABASE_PATH` | no | `/data/tagteam.db` | SQLite file (keep it on the volume). |
| `MIGRATIONS_DIR` | no | `/app/drizzle` | Set by the image; leave as is. |
| `WEB_DIR` | no | `/app/web` | Built PWA directory; set by the image. |
| `RP_ID` | no | host of `BASE_URL` | Passkey relying-party id. |
| `RP_NAME` | no | `TagTeam` | Name shown in passkey prompts. |
| `VAPID_PUBLIC_KEY` | no | — | Enables web push when set with the private key and subject. |
| `VAPID_PRIVATE_KEY` | no | — | Keep this secret and stable so existing devices stay subscribed. |
| `VAPID_SUBJECT` | with VAPID keys | — | Contact URL (`https://…`) or email (`mailto:…`) sent to push services. |

Generate a VAPID key pair once with `pnpm --filter @tagteam/server exec web-push generate-vapid-keys`.
Set all three VAPID variables in `.env`; keep the private key backed up. Users enable push and
choose reminders, nudges, and quiet hours from **Me → Notifications**. Due reminders use each
task's timezone; quiet hours use the profile timezone. Untimed tasks remind at 09:00, and overdue
alerts arrive at 09:00 on the next period boundary. Tasks with a due time remind at that time and again
after one hour if still open. Nudges send immediately.

Reminders begin from the time a user opts in or adds a device. TagTeam does not backfill reminders
for due or overdue occurrences from before opt-in or device registration.

### Security notes

- Keep the app behind Cloudflare Access. Sign-in attempts are not rate limited by IP (the tunnel hides client IPs), so Access is what keeps strangers from guessing passwords. Passkeys are recommended.
- Don't publish port 3000 to the internet.
- Rate limits and sessions are per container; run a single replica.

## Backups

The database is one SQLite file on the `tagteam-data` volume. Take a consistent copy while the app is running:

```bash
BACKUP=backup-$(date +%F).db
docker compose exec tagteam node dist/backup.js /data/$BACKUP
docker compose cp tagteam:/data/$BACKUP .
```

Restore by stopping the app, replacing `/data/tagteam.db` with the backup, and starting it again.

## Updating

```bash
docker compose pull && docker compose up -d
```

Database migrations run automatically on start.

## Development

Requires Node 24+ and pnpm 10.

```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # set AUTH_SECRET and BASE_URL=http://localhost:5173
pnpm --filter @tagteam/server dev              # API on :3000
pnpm --filter @tagteam/web dev                 # app on http://localhost:5173 (proxies /api)
pnpm test && pnpm typecheck && pnpm lint
```

Build and run the image locally:

```bash
docker build -t tagteam:local .
```

Images are built by GitHub Actions and published to `ghcr.io/doomedramen/tagteam` on every push to `main` (`latest`, `sha-…`) and on `v*` tags (`X.Y.Z`, `X.Y`).
