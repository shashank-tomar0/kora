# Contributing to Kora

We love feedback and contributions! Thank you for taking the time to improve Kora. Please read through these guidelines before submitting a pull request.

---

## 🗺️ Codebase Tour
Kora is split into a monorepo structure:
- **`apps/backend`**: FastAPI application handling SQLite database operations, Gemini AI agents, and integrations.
- **`apps/wa-bridge`**: Node.js WhatsApp client (Baileys) acting as the messaging channel.
- **`apps/mobile`**: React Native application powered by Expo.
- **`apps/frontend`**: Optional web portal frontend (if enabled).

---

## 🛠️ Contribution Workflow

### 1. Branch Naming Conventions
Always create a new branch from `main` before starting work. Use the following prefix convention:
* `feature/` — For new features (e.g., `feature/lecture-sync`)
* `bugfix/` — For bug fixes (e.g., `bugfix/token-mismatch`)
* `docs/` — For documentation updates (e.g., `docs/add-api-endpoints`)
* `refactor/` — For code structural changes (e.g., `refactor/optimize-auth`)

### 2. Coding Guidelines

#### Python (Backend)
* Follow **PEP 8** style guidelines.
* Use type hints where possible to keep the code self-documenting.
* Keep routes clean; move business or prompt engineering logic into agents, helper files, or models.

#### TypeScript & React Native (Mobile)
* Follow clean component architecture. Avoid bloated single-file code where practical, though the core layout defaults to `index.tsx` for easy styling orchestration.
* Ensure all code compiles without TypeScript errors by running `npx tsc --noEmit` before proposing changes.
* Use predefined theme constants and styling rules inside stylesheet variables to maintain visual consistency.

---

## 📬 Pull Request Checklist
Before creating a PR, please make sure you:
1. Checked that all tests and type checks pass cleanly (`npx tsc --noEmit` in mobile, syntax checks in backend).
2. Cleaned up print statements, debug logs, and unused imports.
3. Provided a concise summary of your changes in the PR description.
4. Linked the PR to any related GitHub issues.

---

## 💬 Code of Conduct
Please be polite, collaborative, and inclusive in all repository issues, pull requests, and chat channels. Let's make learning and student productivity better together!
