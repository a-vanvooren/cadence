# Acceptable Use

Cadence reproduces a person's typing behavior. That is genuinely useful — and it is also the kind of capability that can be misused. This document defines the line the project is built around. It is not legal advice; it is the product's intended scope.

## Built for

- **Your own behavior, your own accounts.** Profile yourself; use your profile where *you* are the legitimate user.
- **Accessibility.** Reducing the physical load of typing for people who need it.
- **Authorized testing & research.** Generating realistic keystroke streams against systems you own or have written permission to test (QA, behavioral-biometrics research, anti-abuse red-teaming under a rules-of-engagement agreement).

## Not built for

- **Impersonating another person.** Cloning someone else's typing to act as them is out of scope and, in most jurisdictions, illegal.
- **Defeating identity or integrity controls.** Bypassing keystroke-dynamics *authentication* you don't own, exam/interview **proctoring**, or **academic-integrity / AI-detection** checks.
- **Evading platform controls.** Circumventing bot/fraud detection or rate limits on services whose terms prohibit automation.

## Guardrails the product should ship with

1. **Consent-at-capture.** Calibration records only the signed-in user; the profile is stamped with the account identity that created it.
2. **No silent cross-identity use.** A profile is bound to its creator; using it is a first-person action, not a way to "become" someone else.
3. **Honest event provenance.** The product does not claim, and should not market itself as producing, input that is *undetectable* as automated. See the `isTrusted` discussion in [docs/phase-3-architecture.md](docs/phase-3-architecture.md) — content-script events are technically distinguishable from hardware, and that's by design of the web platform.
4. **Respect site signals.** Honor `Permissions-Policy`, robots/automation hints, and explicit "no automation" terms.

If your use case is on the wrong side of this line, this is the wrong tool.
