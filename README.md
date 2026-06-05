<div align="center">

# 🌌 K O R A
### *The Ultimate Agentic AI Student Companion & Control Center*

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactnative.dev)
[![Expo](https://img.shields.io/badge/Expo-000020?style=for-the-badge&logo=expo&logoColor=white)](https://expo.dev)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-8E75C2?style=for-the-badge&logo=googlegemini&logoColor=white)](https://deepmind.google/technologies/gemini/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)

**Kora** is an agentic AI co-pilot designed for university life. Inspired by Apple's design clean lines and premium fintech interfaces (Revolut, N26), it manages schedules, automates class-attendance logs, tracks roommate transactions, indexes syllabus materials via RAG, and conducts mock oral exams.

[Key Modules](#-key-modules) • [Architecture](#-architecture) • [Security & Dotenv](#-security--dotenv) • [Quickstart](#-local-quickstart) • [Verification Status](#-verification-status)

---

</div>

## ✨ Key Modules

| Module | Description | Vibe & Tech Stack |
| :--- | :--- | :--- |
| 📅 **Timetable & Attendance** | Auto-logs classes via OCR, tracks subject attendance, calculates safe bunk thresholds, and schedules auto-allocated study blocks. | `Expo Router`, `SQLite` |
| 🤝 **Shared Roommate Ledger** | Split roommate bills manually or via OCR receipt scanning. Generates scannable dynamic UPI QR codes and handles settling. | `react-native-svg`, `FastAPI` |
| 🧠 **Study Deck & Viva Arena** | Flashcard spaced repetition (SM-2 forgetting curve), P2P live battle duels, and mock oral exams using Gemini voice synthesis. | `expo-av`, `Google Gemini API` |
| 🕸️ **Concept Map & Roadmaps** | Dynamic learning roadmaps generated from circulars and interactive visual concept maps rendered as SVGs. | `react-native-svg` |
| 🎙️ **Live Lecture Sync** | Streams class audio in real-time via WebSockets to generate live transcripts and auto-extract homework deadlines. | `expo-av`, `WebSockets` |
| 📊 **Weekly Report Cards** | Generates an AI-audited performance assessment summarizing study hours, budget health, and tips. | `FastAPI`, `Gemini Pro` |
| 🔗 **Google Integration Hub** | Connects Google Classroom, Drive, and Gmail to auto-sync calendar deadlines and backup study materials. | `Google OAuth 2.0` |

---

## 🏗️ Architecture

Kora is decoupled into a high-performance Python backend, a Baileys-based WhatsApp gateway, and a React Native cross-platform app:

```mermaid
graph TD
    subgraph Mobile Client (React Native + Expo)
        UI["📱 App Interface (app/index.tsx)"]
        AV["🎙️ Audio Stream (expo-av)"]
        Store["💾 AsyncStorage Session Cache"]
    end

    subgraph Backend Services (FastAPI + Uvicorn)
        API["⚙️ API Gateway (main.py)"]
        WS["⚡ WebSocket Server"]
        DB[("🗄️ SQLite (kora.db)")]
        Daemon["⏰ Proactive Daemon (watcher.py)"]
    end

    subgraph Core Integrations
        Gemini["🧠 Google Gemini AI API"]
        OAuth["🎓 Google OAuth / Classroom / Drive"]
        WA["💬 WhatsApp Bridge (Baileys Node.js)"]
    end

    UI -->|HTTP Requests| API
    AV -->|WS Binary Audio Chunks| WS
    WS -->|Real-time Transcription| Gemini
    API -->|Read / Write| DB
    Daemon -->|Poll / Smart Alerts| WA
    WA -->|Group circular hooks| API
    API -->|Files Sync / Notes Backup| OAuth
```

---

## 🔒 Security & Dotenv

In compliance with production security standards, Kora strictly separates keys and private student data from code:
*   **Dotenv**: All API keys, credentials, and redirect endpoints are loaded from `.env` files.
*   **Git Exclusion**: Root `.gitignore` ignores all local `.env` variables, the database file (`kora.db`), memory vault folder exports, and scanned WhatsApp session data (`auth_info_baileys/`).

To get started, reference `.env.example` at the root and create `apps/backend/.env` containing:
```env
GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_CLIENT_ID=your_oauth_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_oauth_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:8000/api/google/callback
```

---

## 🚀 Local Quickstart

### 1. Backend Service
```bash
cd apps/backend
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### 2. WhatsApp Gateway Bridge
```bash
cd apps/wa-bridge
npm install
node index.js
```
*Scan the generated QR code in your console using WhatsApp Linked Devices.*

### 3. Mobile Client (React Native + Expo)
Ensure your backend IP address is set in `apps/mobile/.env`.
```bash
cd apps/mobile
npm install
npx expo start
```
*Press `w` to run in web browser simulator, or open in Expo Go client on your physical phone.*

---

## 🛡️ Verification Status

All codebase quality checks pass successfully:

*   **TypeScript Compilation**: `npx tsc --noEmit` in `apps/mobile` returns `0 errors`.
*   **Linter Checks**: `npm run lint` in `apps/mobile` returns `0 errors` (complies with ESLint and React guidelines).
*   **Backend Syntax**: `python -m py_compile` returns `0 errors`.

---

<div align="center">
  <sub>Built with 💜 for students. MIT License.</sub>
</div>
