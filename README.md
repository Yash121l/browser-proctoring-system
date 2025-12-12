# Browser Proctoring System (Pluggable, TS)

Production-ready, pluggable browser proctoring system with a modular sensor architecture, Web Worker-based ML, WebSocket telemetry, S3 presigned uploads, and a hardened Node.js backend with JWT auth and PostgreSQL storage.

This repository contains both a frontend (React + TypeScript) SDK and a backend (Express + TypeScript) server. The SDK runs ML inside a Web Worker to keep the UI smooth, exposes a plugin-based sensor system, and sends heartbeats/violations via WebSocket. The backend authenticates via JWT, presigns S3 uploads, validates and stores events in PostgreSQL, and enforces security headers and rate limits.

Quick start (dev)
- Terminal A
  - cd frontend
  - npm install
  - npm run dev
  - Open http://localhost:5173
- Terminal B
  - cd backend
  - cp .env.example .env and fill values (JWT_SECRET, DATABASE_URL, S3_BUCKET)
  - npm install
  - npm run dev
  - Create DB table (see backend/src/db.ts comment)

Notes
- Frontend proxies API and WS to backend via Vite dev server.
- Demo app auto-logins via /auth/login and starts SDK.
- Evidence uploads require valid AWS creds and S3 bucket.
