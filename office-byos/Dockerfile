# Dockerfile — Office Status BYOS server, deployed via Cloud Run.
#
# This image intentionally does NOT set OUTLOOK_ICS_URL, PUSH_SECRET, or
# DISPLAY_TIMEZONE — those are secrets/config, not build-time constants, and
# don't belong baked into an image. Set them on the Cloud Run SERVICE, not
# here, e.g.:
#
#   gcloud run deploy office-status-byos \
#     --set-env-vars PUSH_SECRET=..., OUTLOOK_ICS_URL=https://outlook.office365.com/owa/calendar/.../reachcalendar.ics, DISPLAY_TIMEZONE=America/Chicago
#
# or via the Cloud Run console → your service → Edit & Deploy New Revision →
# Variables & Secrets. If OUTLOOK_ICS_URL is left unset, server.js now shows
# "Outlook: not configured" on the display instead of silently looking like
# an empty calendar — check Cloud Run logs at startup too, it logs a warning
# if this is missing.

FROM node:18-bookworm-slim

# Runtime libraries node-canvas needs (Cairo/Pango/JPEG/GIF/SVG), plus fonts:
# - fonts-noto-color-emoji:   monochrome/outline emoji glyphs — matches a B&W e-ink
#                       panel far better than a color emoji font would.
# - fonts-dejavu-core:  reliable, widely-available Latin text rendering.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    fonts-noto-color-emoji fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY assets ./assets

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
