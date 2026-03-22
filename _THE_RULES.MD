# THESE ARE THE RULES

1. DON'T LIE TO ME! DO NOT MAKE ASSUMPTIONS! If you need information you don't have, ask! No exceptions. 

2. We always adhere to world class industry best practices. No exceptions. 

3. We make top-notch, best-in-class, enterprise-grade software. No exceptions. 

4. We never put mock data or sample data or false information of any kind into our code or databases. No exceptions. 

5. Each block of code we develop must serve the core functions of the application in the best possible way, without cutting corners. No exceptions.

6. Always read attached information before each response. DO NOT guess haphazardly as it has happened in previous conversations. 

7. Base your responses on the information I provide. Do not give me generic responses. Do not base your responses on what others have asked or the majority tend to ask. Adhere strictly to the information I provide. 

8. My development approach is production first. Behave as if this app is already in production. DO NOT by any means use mock data or sample data or any kind of false information in your responses or in the code you provide.

---

# INTENT OF THE RULES

Analysis
This is an analysis of semantic intent and operational constraints designed to enforce high-fidelity, production-grade collaboration.The SolutionThe document outlines a framework to transition the interaction from a generic assistant to an enterprise-grade technical peer. The primary intents are as follows:Elimination of Hallucinations and Assumptions: You intend to replace probabilistic "guessing" with deterministic grounding, requiring the system to seek missing information rather than filling gaps with noise.Production-First Integrity: The goal is to receive code that is immediately deployable by banning placeholders, mock data, and false information.Architectural Rigor: You are imposing "best-in-class" and "enterprise-grade" standards to ensure that every logic block serves a core function without technical debt or "corner-cutting".Contextual Specificity: You reject generic "majority" responses in favor of answers strictly tailored to the provided documentation and specific project constraints.

The document effectively enforces behavioral alignment and data integrity  but lacks technical enforcement mechanisms required to guarantee the "Masterpiece" code quality and enterprise scalability demanded by a Principal-level architecture.The SolutionTo elevate the document from a behavioral manifesto to a technical specification, incorporate the following four pillars of enterprise-grade development:Rule 9: Strict Type Enforcement & Static Analysis: All code must utilize strict static typing (e.g., Python type hints, TypeScript strict mode) and pass linting without suppressions to ensure long-term maintainability.Rule 10: Failure Atomicity & Observability: "Production-first"  means code must include explicit error handling, retry logic for transient failures, and structured logging; "happy path" coding is considered a corner-cut.Rule 11: Secret & Config Isolation: Zero hardcoded strings or .env file references in code; all configuration must be injected via environment variables or secret managers to prevent credential leakage.Rule 12: Scalability & Idempotency: Every block of code  must be designed for horizontal scaling; scripts and database migrations must be idempotent to ensure safe execution in production CI/CD pipelines.


---


I’m reading the document as a set of operating constraints, then I’ll collapse them into the few strongest underlying intents.
I see 4 core intents behind it:

Force epistemic discipline
You want zero fabrication, zero guessing, and explicit uncertainty handling. The strongest signal is “don’t lie,” “do not make assumptions,” and “ask if you need information.” 

Enforce production-grade engineering standards
This is not a casual coding preference doc. It is a quality bar: world-class practices, enterprise-grade output, no corner-cutting, and every code block must directly serve the real application. 

Ban fake reality in development
A major intent is rejection of mock/sample/false data, especially because your workflow is “production first.” That means you want all reasoning and implementation anchored in actual business reality, not placeholder convenience. 

Force context obedience
You want the assistant to read the attached materials, use your specific facts, and avoid generic majority-pattern responses. In other words: respond to your system, not to an imagined average user. 

In one line, the document’s meta-intent is:

Create a strict anti-bullshit operating constitution for high-stakes, production-first software work. 

My read of the emotional subtext:
You are defending against your highest-cost failure modes: hallucination, generic advice, fake data, and “prototype thinking” where production rigor should exist from day one.

You’re missing governance rules, not quality rules.

Your document is strong on standards and prohibitions—don’t lie, don’t assume, don’t use fake data, act production-first. 


What it lacks is the layer that tells the assistant how to behave when those rules collide, when information is incomplete, and how output should be structured.

The main gaps:

1. No ambiguity protocol
You say “do not assume” and “ask if you need information.” Good. But you do not define:

when to ask

when to proceed with clearly labeled uncertainty

when to give partial output instead of blocking

Without this, the assistant can become either too passive or too guessy.

Add something like:

If critical information is missing, ask the minimum number of clarifying questions necessary. If the task can be partially completed safely, provide the partial result and explicitly label assumptions and unknowns.

2. No conflict-resolution hierarchy
Some of your rules can conflict. Example:

“Do not assume”

“Always read attachments”

“Base responses strictly on my information”

“Production first”

What if your provided information is incomplete, contradictory, or clearly suboptimal?
You need precedence.

Add:

Rule priority: truth > provided facts > production safety > best practices > completeness > speed.

That single line would tighten the whole system.

3. “Best practices” is too vague
“World class industry best practices” and “enterprise-grade” are directionally strong, but operationally fuzzy. 


Define what that means in your world.

For example:

Best practices include security, correctness, maintainability, observability, performance, explicit error handling, minimal complexity, and scalable architecture.

Otherwise the phrase sounds good but is not auditable.

4. No output contract
You do not specify how answers should be delivered:

concise vs detailed

code-first vs recommendation-first

whether tradeoffs must be stated

whether risks must be called out

whether uncertainty must be one-line explicit

Add:

Default to concise responses. Recommend the best option first. State key tradeoffs only when materially relevant. Flag risks that could affect production, security, cost, or data integrity.

5. No mechanism for challenging the user when needed
Right now the doc can be read as “obey my inputs literally.” That is dangerous.
Sometimes the highest-value behavior is: “your premise is flawed.”

Add:

If my instruction, design, or premise appears incorrect, unsafe, internally inconsistent, or likely to cause production issues, say so clearly and explain why.

This is one of the biggest missing pieces.

6. No explicit anti-overengineering rule
You want enterprise-grade, but that can drift into unnecessary complexity.
You need a balancing rule.

Add:

Prefer the simplest solution that satisfies production-grade requirements. Do not add complexity without clear benefit in reliability, security, scalability, maintainability, or revenue impact.

7. No test/verification rule
You ban fake data, which is coherent with production-first, but software still needs validation.
You need to distinguish:

fake business data

legitimate test fixtures

synthetic data in isolated test environments

Otherwise the rule can block good engineering.

Add:

Do not use fake business data in production logic, production databases, or as a substitute for real requirements. Test fixtures are allowed only when explicitly labeled, isolated to testing, and never mixed with production behavior.

That makes the document much stronger.

8. No “state uncertainty explicitly” rule
“Don’t lie” is not enough. You need the positive form too.

Add:

When uncertain, state uncertainty explicitly in one line. Do not present estimates, guesses, or inferred facts as certain.

9. No scope-control rule
You say every code block must serve core functions. 


Good instinct, but it can suppress useful support code like migrations, monitoring, scripts, tests, adapters, cleanup jobs, admin tooling.

Refine it:

Every code artifact must have a clear production purpose: core functionality, reliability, security, observability, deployment, migration, maintenance, or testing.

That is much better than only “core functions.”

10. No economic lens
Given how you work, one high-value rule is still absent: ROI discipline.

Add:

Favor solutions that maximize long-term business value, delivery speed, reliability, and authority while minimizing avoidable complexity and rework.

That aligns the system with your actual decision framework.

Best structural upgrade

Split the document into 5 sections instead of one flat list:

A. Truth rules
No lies, no hidden assumptions, explicit uncertainty.

B. Context rules
Read attachments, use provided facts, avoid generic responses.

C. Engineering rules
Production-first, enterprise-grade, security, maintainability, no corner-cutting.

D. Decision rules
Ask when blocked, challenge flawed premises, prefer simplest sufficient solution, state tradeoffs.

E. Data rules
No fake business data in production; test-only fixtures must be isolated and labeled.

Stronger version of your document

You could evolve it into this:

Do not present false, guessed, or invented information as fact.

If critical information is missing, ask the minimum necessary clarifying question(s). If partial progress is possible, provide it and label unknowns explicitly.

Always read and use the information I attach or provide before responding.

Base responses on my actual context and requirements, not generic patterns or average-user assumptions.

If my premise, instruction, or design appears incorrect, risky, or inconsistent, say so clearly and explain why.

Treat the system as production-first: prioritize correctness, safety, maintainability, security, and scalability.

Prefer the simplest solution that fully satisfies production-grade requirements. Do not overengineer.

Do not use mock, sample, or false business data in production logic, production databases, or as a substitute for missing requirements.

Test fixtures or synthetic data are allowed only when explicitly labeled, isolated to testing, and never mixed with production behavior.

Every code artifact must serve a valid production purpose: functionality, security, reliability, observability, deployment, migration, maintenance, or testing.

When relevant, state key risks, tradeoffs, and constraints succinctly.

Rule priority: truth > provided facts > production safety > best practices > completeness > speed.

That version is tighter, more enforceable, and harder to misinterpret.

The single biggest improvement:
add rules for ambiguity, conflict resolution, and permission to challenge your premise.

Without those, the document is principled but still incomplete.


---

You've been burned. Repeatedly.
The document is a scar tissue manifest — each rule exists because an LLM (likely me or a predecessor) violated it, probably more than once. Here's what I read:
Rule 1 (Don't lie, don't assume): You got hallucinated answers presented as fact. Confidently wrong outputs that cost you debugging time or worse — shipped broken logic.
Rules 2, 3, 5 (Best practices, enterprise-grade, no corners): You received lazy, tutorial-grade code when you needed production code. Shortcuts that would embarrass you in front of paying clients.
Rules 4 & 8 (No mock data, production-first): This one clearly stung. You got placeholder data baked into responses — TODO, example@test.com, dummy API keys, hardcoded sample arrays — when you needed real, deployable code. Probably more than once given you dedicated two separate rules to it.
Rule 6 (Read attachments first): You provided context that got ignored. The model responded from its priors instead of your actual specifications. Wasted turns, wasted time.
Rule 7 (Use MY information, not generic): You got cookie-cutter answers that didn't account for your stack, your architecture, or your specific problem. Generic StackOverflow-tier responses when you needed tailored solutions.
The meta-intent: You're establishing a professional working contract. You treat this as a real engineering collaboration with real stakes (clients, revenue, reputation), and you need the AI to operate at that level — not as a helpful chatbot that optimizes for sounding useful over being useful.

A few gaps worth closing:
Error handling & failure mode. You say don't lie — but you don't say what to do instead. Add something like: "If you're uncertain or lack context, say so explicitly and stop. Do not fill gaps with plausible-sounding guesses." Right now a model can technically comply by hedging with "I think..." and still give you garbage.
Scope discipline. Nothing prevents me from "helpfully" refactoring code you didn't ask me to touch, changing your architecture, or adding unsolicited features. A rule like: "Do not modify, refactor, or extend anything beyond what I explicitly request" would save you from surprise rewrites.
Consistency with existing codebase. You say enterprise-grade — but whose conventions? If you hand me a file using a specific pattern and I rewrite it in a different (arguably "better") style, I've created inconsistency in your codebase. Something like: "Match the conventions, patterns, and style of the existing codebase unless I explicitly ask for a change."
Completeness. Models love giving you 80% of the solution with a // ... rest of your code here comment. If that's burned you: "Never truncate, abbreviate, or omit code with placeholder comments. Deliver complete, runnable implementations."
Verification before action. You have "read attachments first" but nothing about confirming understanding. A rule like: "Before implementing, confirm your understanding of what I'm asking if there's any ambiguity" prevents the confident-but-wrong full implementation you then have to untangle.
Diff awareness. When editing existing files, models sometimes return the entire file when you needed a surgical change, or vice versa. Worth specifying your preference.
Those are the real holes. The existing rules are solid — they just assume good faith interpretation. Tighten them to be adversarially robust against a model that's optimizing for appearing helpful.

