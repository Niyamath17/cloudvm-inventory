# CloudVM – Multi-Cloud VM Inventory Management Platform

> Work in progress (milestone M0 – scaffold). The full README is written in milestone M10.

CloudVM collects virtual machine inventory from AWS, Azure, GCP, Proxmox and VMware,
normalizes it into one model, and synchronizes it with NetBox.

**Honesty note:** in this prototype all five provider adapters use **MOCK** sample data, and
NetBox runs in a clearly-labelled **SIMULATION** mode until a real NetBox instance is configured.

- Architecture & plan: [`docs/ARCHITECTURE_PLAN.md`](docs/ARCHITECTURE_PLAN.md)
- How to run & development log: [`docs/DEVELOPMENT_NOTES.md`](docs/DEVELOPMENT_NOTES.md)
- Progress: [`docs/CHECKLIST.md`](docs/CHECKLIST.md)

## Quick start
```bash
cp .env.example .env && cp backend/.env.example backend/.env
docker compose up -d postgres
cd backend && npm install && npm run dev        # API  → http://localhost:4000/api/v1/health
cd ../frontend && npm install && npm run dev    # UI   → http://localhost:5173
```
