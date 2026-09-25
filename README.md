# TagTeam

Shared habits and chores for small groups. Everyone in a group sees each other's tasks — daily, weekly, monthly or every N days/weeks/months — with a full history of what was done on time, late, or missed. Built as an offline-first, mobile-first PWA.

> Status: server, sync, sign-in, group setup, Today, and add-task flows are implemented. Remaining screens and PWA packaging are in progress.

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
| `RP_ID` | no | host of `BASE_URL` | Passkey relying-party id. |
| `RP_NAME` | no | `TagTeam` | Name shown in passkey prompts. |

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
cp apps/server/.env.example apps/server/.env   # then set AUTH_SECRET
pnpm --filter @tagteam/server dev              # http://localhost:3000
pnpm test && pnpm typecheck && pnpm lint
```

Build and run the image locally:

```bash
docker build -t tagteam:local .
```

Images are built by GitHub Actions and published to `ghcr.io/doomedramen/tagteam` on every push to `main` (`latest`, `sha-…`) and on `v*` tags (`X.Y.Z`, `X.Y`).
