# Link Shortener

Servicio propio para reemplazar Bitly usando un dominio de la casa.

## Objetivo

Tener un sistema simple para crear links cortos, redirigir rapido y medir clicks sin depender de un SaaS externo.

## Estado

Proyecto nuevo. Este repo arranca con la arquitectura y la memoria del proyecto documentadas desde el dia 1.

## Documentacion

- [Arquitectura](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Project memory](docs/memory.md)
- [Decision log](docs/decisions/0001-stack.md)

## Alcance inicial

- Redirects rapidos bajo un dominio propio.
- CRUD basico de links.
- Analytics simples de clicks.
- Control de acceso para administracion.

## Desarrollo local con Docker

1. Copiar `.env.example` a `.env`.
2. Ajustar `SHORTENER_DOMAIN` con el dominio que quieras usar.
3. Levantar todo con:

```bash
docker compose up --build
```

El contenedor del app corre `npm run migrate` antes de arrancar el server.

## Imagen publicada

El workflow de GitHub publica la imagen en GHCR:

```bash
ghcr.io/pablokbs/link-shortener:latest
```

## Endpoints iniciales

- `GET /healthz`
- `GET /admin/dashboard`
- `GET /api/links`
- `POST /api/links`
- `GET /api/links/:id`
- `PATCH /api/links/:id`
- `DELETE /api/links/:id`
- `GET /api/links/:id/stats`
- `GET /:slug`
