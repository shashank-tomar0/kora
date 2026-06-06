# 🌌 K O R A
### **The Agentic AI Student Life OS & Academic Companion**

---

<div align="center">

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactnative.dev)
[![Expo](https://img.shields.io/badge/Expo-000020?style=for-the-badge&logo=expo&logoColor=white)](https://expo.dev)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-8E75C2?style=for-the-badge&logo=googlegemini&logoColor=white)](https://deepmind.google/technologies/gemini/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)
[![WebSockets](https://img.shields.io/badge/WebSockets-000000?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io)

**Kora** is an open-source, fully agentic student co-pilot designed to manage the chaos of college life. It features a premium high-contrast neobrutalist UI, offline-first local fallbacks, dynamic shared roommate ledgers, real-time speech synthesis, and an LLM-driven Second Brain.

[Key Features](#-core-capabilities) • [Architectural Marvel](#-system-architecture) • [Engineering Highlights](#-engineering-highlights-for-recruiters) • [Quickstart](#-local-quickstart) • [Code Health](#-production-code-health)

</div>

---

## 🚀 Core Capabilities

### 📅 Attendance Heatmap & Predictions
* **Attendance Ledger**: Live logs class sessions, calculates strict bunk limits, and estimates required lectures to stay above the 75% cutoff.
* **Contribution Heatmap**: Renders a GitHub-style 20x5 activity grid representing lecture logs over the semester, providing visual feedback on attendance density.

### 💳 Shared Roommate Ledger & UPI Settler
* **OCR Bill Splitter**: Scans physical canteen and store receipts via FastAPI/Gemini to extract itemized costs.
* **Instant Payments**: Integrates deep-linking to physical payment processors via universal `upi://pay?pa={vpa}&am={amount}` schemas with instant simulated confirmations inside the simulator sandbox.

### 🧠 Whiteboard Scan to Second Brain RAG
* **Multi-Target Ingestion**: Automatically detects whiteboard scans and prompts users to convert images either into active-recall flashcards or directly index them as markdown nodes in the Second Brain.
* **Semantic Retrieval**: The backend indexes slide summaries into a SQLite-backed hierarchical memory vault, allowing semantic searches via chat commands.

### 🎙️ Continuous active Voice Bridge
* **Talk Freely (Hands-Free)**: Toggleable voice bridge that enables continuous voice calls without needing to tap to speak.
* **Ref Synchronization**: Employs React Native reference patterns to bind callbacks without stale closures, automatically restarting audio capture 1.2 seconds after Kora's voice output ends.

### 🏆 Gamified Student Standing
* **XP Leveling**: Tracks daily student quests (e.g., studying before 6 AM, settling roommate debts) to award XP. Includes a neobrutalist leveling progress bar.
* **Badges Grid**: Awards achievement badges (**Early Bird**, **Second Brain**, **Debt Free**, **Attendance Master**) based on automated database event watchers.

---

## 🏗️ System Architecture

Kora is built using a decoupled architecture consisting of a high-performance Python backend, a Baileys-based WhatsApp gateway, and a React Native cross-platform app:

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

## 🛠️ Engineering Highlights (For Recruiters)

Kora was designed not just as a features-first app, but to solve real-world engineering constraints:

### ⚡ Solving Stale React Closures in Event Listeners
When executing continuous voice bridges inside React Native, Speech Synthesis callbacks (`onDone`, `onError`) initially captured stale state closures, failing to recognize when users toggled speech mode. 
* **The Fix**: Abstracted state logic into an active `useRef` synchronization hook. This ensures callbacks always read the absolute latest toggle status without triggering costly component re-renders.

### 📴 Offline-First Mock Fallbacks
To support zero-network environments (like deep university basements with poor reception), Kora features a dual-layer client responder.
* **The Fix**: Fetch calls intercept network errors or API timeouts to fallback to local SQLite queries and pseudo-randomized mockup data generators (e.g., seed-based hash generators for the Attendance heatmap grid).

### 📈 Gemini Multimodal JSON Parsing
The receipt OCR and whiteboard scanning services require structured data returned from the LLM. Standard prompts often leak markdown blocks or formatting.
* **The Fix**: Implemented a custom validation wrapper inside `main.py` that strips markdown code fence boundaries (e.g. ````json ... ````) and runs recursive fallback regex validations before passing the JSON payload to python schema validators.

---

## 🔒 Security & Exclusions

Kora implements industry-standard security boundaries:
* **Dotenv isolation**: API tokens and client secrets are kept out of memory and injected at launch via `.env` files.
* **Secure Exclusions**: `.gitignore` strictly protects sensitive session records, including `kora.db`, WhatsApp session secrets (`auth_info_baileys/`), and memory vault exports.

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

## 📊 Production Code Health

Kora is maintained under strict linting and compilation guidelines:

*   **TypeScript Compilation**: `npx tsc --noEmit` in `apps/mobile` returns `0 errors` (type-safe).
*   **Linter Checks**: `npm run lint` in `apps/mobile` returns `0 errors` (complies with ESLint and React guidelines).
*   **Backend Syntax**: `python -m py_compile` returns `0 errors`.

---

<div align="center">
  <sub>Built with 💜 for students. MIT License.</sub>
</div>
