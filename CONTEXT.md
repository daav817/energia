# Energia App Context

This file captures the current roadmap, scope, and delivery guardrails so development stays aligned across sessions.

## Vision

Build an integrated operations app for energy brokerage workflows:
- Manage and renew existing contracts/customers.
- Onboard new customers efficiently.
- Handle RFP and quote activity end-to-end.
- Coordinate follow-ups and deadlines via scheduling/calendar.

## Current Sprint

Use this section as the live execution plan. Update checkboxes and notes at the end of each work session.

### Sprint Goal
- Stand up the cross-module foundation for Dashboard + RFP/Quoting + Scheduler while keeping existing contract/customer workflows stable.

### In Scope (Now)
- [ ] Define Dashboard MVP widgets and navigation entry points.
- [ ] Finalize RFP/Quote MVP scope (entities, statuses, required actions).
- [ ] Define Scheduler/Calendar MVP (event model, contract/customer/contact links, views).
- [ ] Establish CI baseline (lint, typecheck, build; tests as they are added).
- [ ] Prepare GitHub readiness checklist (ignore rules, env template, branch protections).

### Active Work Items
- [ ] Draft dashboard information architecture and page sections.
- [ ] Create RFP/Quote implementation sequence (API + UI slices).
- [ ] Create Scheduler implementation sequence (API + UI slices).
- [ ] Identify first 5-10 high-value unit/integration tests.

### Risks / Open Decisions
- Deployment path priority: cloud+Supabase first vs local K8s-first.
- Calendar integration scope: internal calendar only vs external sync (Google Calendar).
- Quote comparison depth for MVP vs post-MVP (simple compare vs advanced analytics).

### Progress Notes
- Keep short dated entries here, newest first.
- YYYY-MM-DD: Added initial Current Sprint section for ongoing planning and tracking.

## Product Phases

### Phase 1: Dashboard Front Door
- Build a workflow-first dashboard that surfaces:
  - Expiring/renewal contracts
  - Active customers/suppliers/contacts
  - Communication activity (inbox/compose)
  - Quick links into RFP, quotes, contracts, and scheduling
- Optimize for two core paths:
  - Retain/renew existing business
  - Onboard new business

### Phase 2: RFP and Quoting
- Deliver an end-to-end RFP and quote flow:
  - Create/manage RFP requests
  - Capture supplier responses/quotes
  - Compare options and mark selections
  - Convert accepted quote outcomes into contracts/customers where applicable
- Ensure deep linking with existing directory/contracts data.

### Phase 3: Scheduler and Calendar
- Implement scheduler/calendar experience tied to:
  - Contract renewals and expirations
  - Follow-up tasks and reminders
  - RFP/quote deadlines
- Ensure entities are linked (contract/customer/contact context from calendar events).

### Phase 4: Cross-Module Integration and UX Cohesion
- Tighten navigation and shared actions between modules.
- Ensure consistent IDs and relationships across:
  - Customers
  - Suppliers
  - Contacts
  - Contracts
  - RFP/Quotes
  - Calendar events
- Add notification hooks where needed (email/in-app reminders).

### Phase 5: Quality, Hardening, and Release Readiness
- Complete test baseline (unit + integration, high-value happy paths first).
- Verify error handling, edge cases, and regression-prone workflows.
- Finalize production configuration and deployment path.

## Delivery and Platform Plan

### Source Control and Collaboration
- Push project to GitHub.
- Establish branch/PR workflow (protect main branch).
- Ensure `.gitignore` and secret hygiene are complete before first push.

### Containerization
- Maintain Docker-based local/prod parity.
- Use a production-safe image strategy:
  - Multi-stage build
  - Non-root runtime user
  - Healthcheck endpoint
  - Pinned runtime version

### Testing
- Add unit tests for key business logic.
- Add integration tests for API + data workflows.
- Validate critical user workflows (contracts, contacts, supplier matching, RFP/quotes once implemented).

### Deployment Options
- Option A: Cloud deployment + Supabase (Postgres) backend.
- Option B: Local LAN Kubernetes cluster deployment.
- Keep infrastructure choices modular to support either path.

## SDLC / DevOps Checklist (Do Not Skip)

### CI/CD
- Lint, typecheck, tests, and build in CI for every PR.
- Optional staging/preview environment for feature validation.
- Deployment automation with rollback strategy.

### Database and Migrations
- Standardize migration process (`prisma migrate` flow by environment).
- Backup before production migrations.
- Periodically run restore drill to verify backup integrity.

### Secrets and Configuration
- Keep secrets out of git and local scripts.
- Use environment-specific secret management.
- Maintain `.env.example` with non-secret placeholders/documentation.

### Observability
- Centralized logs and error tracking.
- Basic application health checks.
- Alerting for key failure paths.

### Security and Reliability
- Dependency vulnerability scanning.
- Access control review on app routes and integrations.
- Rate limiting where externally exposed.
- Document data retention and recovery expectations.

### Documentation and Operational Readiness
- Keep `README` current (setup, run, deploy, env vars).
- Add runbook for common operations (deploy, rollback, backup/restore).
- Track architecture decisions and trade-offs.

## Current Priority Focus (Near-Term)

1. Finalize dashboard scope and first implementation slice.
2. Define RFP/quote MVP flow and schema/UI milestones.
3. Define scheduler/calendar MVP integration points.
4. Add CI baseline + initial test suites.
5. Prepare repository for GitHub push and deployment decision.

## Change Log

- Initial context created to track phases, SDLC, and delivery plan.
