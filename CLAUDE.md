# Kite - Project Context

## Project Overview

**Kite** is a modern, lightweight Kubernetes dashboard that provides real-time observability, multi-cluster management, enterprise-grade user governance (OAuth, RBAC, audit logs), and AI agent integration in one workspace.

### Tech Stack

**Backend (Go):**
- Go 1.25.0
- Gin Web Framework
- GORM (ORM with SQLite/MySQL/PostgreSQL support)
- Kubernetes client-go v0.35.4
- Prometheus client for metrics
- Anthropic SDK & OpenAI SDK for AI integration
- JWT for authentication

**Frontend (React):**
- React 19.2.5
- TypeScript 5.9.3
- Vite 8.0.9 (build tool)
- Tailwind CSS 4.2.4
- Radix UI (component library)
- Monaco Editor (code editing with syntax highlighting)
- @tanstack/react-query (data fetching)
- i18next (internationalization: EN/ZH)
- xterm (web terminal)
- recharts (data visualization)

## Project Structure

```
.
├── pkg/                    # Backend main packages
│   ├── ai/                # AI agent integration (Anthropic, OpenAI)
│   ├── auth/              # Authentication (JWT, OAuth)
│   ├── cluster/           # Multi-cluster management
│   ├── handlers/          # HTTP request handlers
│   ├── kube/              # Kubernetes client wrapper
│   ├── middleware/        # Gin middleware (auth, RBAC, CORS, etc.)
│   ├── model/             # Data models (user, role, cluster, etc.)
│   ├── rbac/              # Role-based access control
│   ├── prometheus/        # Prometheus integration
│   └── utils/             # Utility functions
├── ui/                    # Frontend code
│   └── src/
│       ├── components/    # Reusable React components
│       ├── pages/         # Page components (Pod, Deployment, etc.)
│       ├── lib/           # Utility libraries (API clients, etc.)
│       ├── hooks/         # Custom React hooks
│       ├── contexts/      # React contexts (Auth, Cluster, Theme)
│       ├── i18n/          # Internationalization resources
│       └── types/         # TypeScript type definitions
├── internal/              # Internal Go packages
├── deploy/                # Kubernetes deployment manifests
├── charts/                # Helm charts
├── e2e/                   # End-to-end tests (Playwright)
└── docs/                  # Documentation (VitePress)
```

## Development Workflow

### Common Commands

**Install dependencies:**
```bash
make deps
# Frontend: cd ui && pnpm install
# Backend: go mod download
```

**Build:**
```bash
make build              # Build both frontend and backend
make frontend           # Build frontend only
make backend            # Build backend only
make cross-compile      # Cross-compile for multiple archs
```

**Development:**
```bash
make dev               # Run frontend and backend in dev mode
make run               # Run production build
```

**Code quality:**
```bash
make lint              # Run linters (golangci-lint, eslint)
make format            # Format code (go fmt, prettier)
make pre-commit        # Run format + lint
```

**Testing:**
```bash
make test              # Run all tests
cd ui && pnpm run test # Run frontend tests
```

**E2E testing:**
```bash
make e2e-test          # Run Playwright tests against kind cluster
make e2e-test-headed   # Run E2E tests in headed mode
```

**Cross-compilation:**
The Makefile supports cross-compiling for multiple architectures:
- Linux AMD64
- Linux ARM64
- macOS ARM64

## Key Features

1. **Multi-cluster Management** - Switch between multiple K8s clusters with independent Prometheus configs
2. **Resource Management** - Full K8s resource coverage with YAML editing (Monaco)
3. **Monitoring & Observability** - Real-time metrics, logs, and web terminal
4. **Security** - OAuth integration, RBAC, user management
5. **AI Integration** - Built-in AI assistant (Anthropic/OpenAI)
6. **Global Search** - Search across all resources
7. **Kube Proxy** - Direct pod/service access without port-forwarding

## Architecture Notes

**Backend:**
- Gin router defined in `routes.go`
- WebSocket connections for real-time updates (logs, terminal, metrics)
- GORM for database operations with multiple driver support
- Kubernetes client-go for K8s API interaction

**Frontend:**
- React Router for client-side routing
- TanStack Query for API state management and caching
- Radix UI for accessible, unstyled components
- Monaco Editor for YAML editing
- xterm for web-based terminal emulation

## Database

- Default: SQLite (file-based, easy development)
- Supported: MySQL, PostgreSQL (via GORM drivers)
- Configure via `DB_DSN` environment variable

## Auto-Compilation Rule

**After any code generation, automatically run compilation.**
- Use `make build` to build both frontend and backend
- This ensures changes are immediately verified

## Current Branch

You're on the `feat/search` feature branch. Main branch is `main`.
