# syntax=docker/dockerfile:1

# ── Stage 1: Build WASM ───────────────────────────────────────────────────────
FROM rust:1-slim AS wasm-builder

WORKDIR /app

RUN rustup target add wasm32-unknown-unknown

# Copy manifests first so dependency layers are cached independently of src changes
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/

RUN cargo build -p metronome-web \
      --target wasm32-unknown-unknown \
      --profile release-wasm

# ── Stage 2: Build frontend ───────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY index.html vite.config.js ./
COPY src/ src/
COPY public/ public/

# Pull in the compiled WASM — no Rust toolchain needed here
COPY --from=wasm-builder \
     /app/target/wasm32-unknown-unknown/release-wasm/metronome_web.wasm \
     public/metronome_web.wasm

# Invoke vite directly; the WASM is already compiled so we skip build:wasm
RUN npx vite build

# ── Stage 3: Runtime (no Rust, no Node) ──────────────────────────────────────
FROM nginx:1-alpine AS runtime

# AudioWorklet requires cross-origin isolation — inject the required headers
RUN cat <<'EOF' > /etc/nginx/conf.d/default.conf
server {
    listen 8080;
    root /usr/share/nginx/html;
    index index.html;

    add_header Cross-Origin-Opener-Policy  "same-origin"   always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

COPY --from=frontend-builder /app/dist /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
