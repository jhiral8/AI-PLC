---
id: ART-1
type: artifact
kind: business-case
stage: business-case
title: "Passwordless login"
status: draft
derived_from: []
---
# Passwordless login

## Decision requested
Fund two sprints to offer passkeys and email magic links on mobile.

## Problem
Mobile customers leave at the password step: 22% of mobile sessions that reach login never sign in [INS-1].

## Opportunity
Password resets are 30% of support tickets, so removing passwords cuts support load as well as drop-off [INS-2].

## Proposed solution
Passkeys first, with an email magic link as the fallback. Passwords stay for existing users who want them.

## Costs

| Item | One-off | Recurring | Basis |
|---|---|---|---|
| Build | 2 sprints | | Team estimate |
| Email sending | | Small | Current provider rates |

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Customers on old devices without passkeys | Medium | Medium | Magic link fallback |
