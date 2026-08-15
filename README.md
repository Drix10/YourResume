# Your Resume

> Turn your GitHub into a polished, ATS-friendly resume. Powered by Gemini AI.

![React](https://img.shields.io/badge/React-19.2-blue?logo=react)
![Vite](https://img.shields.io/badge/Vite-6.2-purple?logo=vite)
![Gemini AI](https://img.shields.io/badge/Gemini-3.5%20Flash-green?logo=google)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)

---

## ✨ What it does

- Fetches your GitHub repos (public + private) and runs deep analysis
- Smart scoring based on commits, code size, complexity — not just stars
- Parses dependency files from any ecosystem (JS, Python, Go, Rust, Java, Ruby, C++)
- Auto-detects ML/Data Science projects from Jupyter notebooks
- Filters out archived and inactive repositories automatically
- Merges related repos (frontend/backend/mobile) into single project entries
- Generates ATS-optimized resume with proper keywords
- Edit inline, refine with AI commands, export to PDF

---

## 🚀 Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, enter your tokens, generate.

---

## 🔑 You'll Need

| Key                | Purpose           | Get it                                                                       |
| ------------------ | ----------------- | ---------------------------------------------------------------------------- |
| **GitHub Token**   | Access your repos | [Create Token](https://github.com/settings/tokens/new?scopes=repo,read:user) |
| **Gemini API Key** | AI generation     | [Get API Key](https://aistudio.google.com/app/apikey)                        |

Both entered in the UI. Nothing stored.

---

## 🧠 Smart Repo Scoring

The app doesn't just count stars. It analyzes what actually matters:

| Factor               | Points                               |
| -------------------- | ------------------------------------ |
| **Commits**          | Your actual work (5-500+ commits)    |
| **Code Size**        | Substantial projects score higher    |
| **Languages**        | Multi-language = full-stack          |
| **README**           | Good docs = professional             |
| **Tests/Build/Lint** | Quality indicators from package.json |
| **Dependencies**     | Real tech stack detection            |
| **Recency**          | Recent work weighted higher          |

Forks and org repos are filtered unless you have real commits in them.

---

## 🎯 Features

- **Multi-Language Support** — JS, Python, Go, Rust, Java, Ruby, C/C++, Jupyter notebooks
- **ML/DS Detection** — Auto-detects TensorFlow, PyTorch, pandas, scikit-learn projects
- **AI Refinement** — "Make it more executive" or "Add project X"
- **Drag & Drop** — Reorder sections and items
- **Print-Ready** — A4 format, clean margins, no awkward page breaks
- **LinkedIn Import** — Paste your profile for better experience/education extraction

---

## 🌐 Supported Ecosystems

| Language              | Dependency Files                                 |
| --------------------- | ------------------------------------------------ |
| JavaScript/TypeScript | `package.json`                                   |
| Python                | `requirements.txt`, `setup.py`, `pyproject.toml` |
| Go                    | `go.mod`                                         |
| Rust                  | `Cargo.toml`                                     |
| Java                  | `pom.xml`, `build.gradle`                        |
| Ruby                  | `Gemfile`                                        |
| C/C++                 | `CMakeLists.txt`                                 |
| ML/Data Science       | `.ipynb` notebooks                               |

---

## 📁 Structure

```
├── components/
│   ├── Hero.tsx          # Landing + token inputs
│   └── ResumeView.tsx    # Resume editor + AI refinement
├── services/
│   ├── githubService.ts  # GitHub API + smart scoring
│   └── genaiService.ts   # Gemini AI integration
├── App.tsx
├── types.ts
└── constants.ts
```

---

## 🔒 Security

- API keys entered at runtime, never stored
- Client-side only (keys visible in network requests)
- For production, consider a backend proxy

---

## 📄 License

MIT
