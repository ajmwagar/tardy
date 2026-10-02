# Breaking lane research: AI developments, roughly Aug 20 to Oct 1, 2026

Compiled 2026-10-01. Inputs: 20 owner-picked X posts (read as fxtwitter JSON and article text), then primary sources fetched directly. I treated the X posts as leads, not as evidence. Every number in `content/breaking/2026-10-01.json` traces to the URL listed with it.

Confidence key: **high** means a primary source (company blog, docs, official repo, paper/publisher page, the author's own post) states it. **medium** means it comes from reputable secondary reporting, or the primary is only partly reachable. **low/unverified** claims stay out of the manifest.

---

## 1. Jev (TypeSafe AI): the "System One" decision model

- **What happened:** TypeSafe AI (San Francisco) came out of stealth and launched **Jev**, which it calls the first "System One model". Jev generates no text. You send `state` (text or JSON) and a map of typed questions. It returns typed answers with probabilities:
  - **Choice:** pick one of up to 255 options; returns the option, a probability per option, and a confidence.
  - **Score:** rate the state on 2-10 ordered levels you write.
  - **Noul:** yes/no; returns P(yes).
  
  Every question in a request is evaluated in parallel against the same state. Training method: "RLCD" (reinforcement learning for calibrated decisions).
- **When:** launched and funding announced **2026-09-15**; early access/API opened around Sept 15-16. The blog page now shows Sept 28, which looks like a later edit; Vercel and the press all give Sept 15.
- **Who:** founder/CEO **Diogo Almeida**, a former OpenAI researcher who worked on ChatGPT/RLHF methods. Co-founders Erik Gafni and Sasha Sheng (per funding coverage). **$40M seed led by DCVC**, about $200M post-money (secondary). The Information reported talks to raise $1B+ at more than $10B; this is a secondary report I did not verify.
- **Pricing and limits (docs, primary):** model `jev-1.13.0`; aliases `jev-latest` and `jev-preview` both point to it.
  - Price: **$0.042 per million input tokens; output tokens free.**
  - Context: 64k tokens per request (32k for state plus the longest question). Input is text only.
  - Rate limits: the docs page today says **100K tokens/s and 40 requests/s**, "adjusting dynamically". The X guides quoted 250K tok/s and 1,200 req/min. The limits have changed since launch, so don't hard-code either figure.
  - Latency: TypeSafe says **70-500 ms** end to end.
- **Claims and how much to trust them:**
  - TypeSafe's own evals: **193.6x faster, 444.6x cheaper** than an average of GPT-6 Astra and Fable 5.1, on workflows TypeSafe built in-house. TypeSafe itself says these are the high end. **No independent broad benchmark exists yet.**
  - **Vercel (primary, 2026-09-18):** nearly **13% of paid AI Gateway teams** used Jev within 24 hours. That is the fastest adoption in gateway history: 2x the GPT-5.6 family and more than 6x Fable 5.1. Caveat: Jev was **free on the gateway through Sept 25**.
  - Independent anecdotes, from secondary reporting of a TechCrunch piece:
    - Vercel engineer: 5-18x faster than a GPT-5.6 Luna safety classifier, with better accuracy.
    - Bryo AI: 10-20x cheaper than Gemini for email classification.
    
    These are useful but not benchmarks.
  - **Browser Use "Jev Ultrafast" (primary repo, MIT, created 2026-09-16, about 21.7k stars):** Jev picks the operation and page element; a small LLM (`inception/mercury-2.5`) writes text only for `TYPE_TEXT`. One Zurich→London Google Flights run took **7.1 s** and cost $0.0039. In matched runs, median browser protocol calls fell from 1,092 to 101 and median task time dropped 25%. Browser Use says this is only 3 pairs and not a broad benchmark. The run does not book flights.
  - **Hassan (@nutlope), primary X post, 2026-09-17:** classified 1,018 AI papers into 24 topics for **$0.08** at a **256 ms median**. The DeepSeek V4 Flash summaries beforehand cost $3.99. He says he is still running evals on the Jev labels.
  - **TypeSafe cookbook:** asking 13 questions in one call was **12.2x cheaper and 10x faster** than 13 separate calls, with the same answers.
- **Integrations:**
  - Python SDK (`typesafe-sdk`) and JS/TS SDK (`@typesafe-ai/sdk`).
  - LangChain `langchain-typesafe` (experimental routing middleware).
  - Vercel AI Gateway (`typesafe-ai/jev`).
  - Cloudflare Workers AI (`typesafe/jev`): claimed in the X posts, **not verified**.
- **Known weak spots (TypeSafe's own "jaggedness" page for jev-1.13):**
  - Reads instructions literally.
  - Can't count or do arithmetic.
  - Unreliable at comparing dates.
  - Weaker on multi-hop indirection.
  - Accuracy drops when the state is large and full of irrelevant detail.
  - **Adversarial content in the state can move the answer.**
  - Noul and Choice outputs are not mutually consistent.
  - Doesn't generate text.
- **Why builders care:** Jev splits "deciding" from "generating". Routing, triage, scoring, guardrails and next-action picks can move from frontier-LLM calls to a sub-second call that costs a fraction of a cent. The pattern: ask every question in one call, route on confidence, and send low-confidence cases to a bigger model or a human.
- **New uses seen:**
  - Browser agents (Browser Use).
  - Paper and email classification.
  - Model routing (LangChain).
  - Fraud-screen cascade into Kimi K3 (from an X article; not verified).
  - Guardrails/moderation (TypeSafe cookbook).
  - Skill selection for agents (cookbook over the 182-skill Hermes catalog).
  - Content-research filtering (dsqjaffa article; vendor marketing).
- **Not verified:**
  - New-signup pause "as of Sept 22" (an X article; the only source named is TypeSafe's X account).
  - "$10B valuation talks" (secondary only).
  - Cloudflare listing.
  - The "Jev studied 438,122 apps" article: Jev can't do that by itself, so treat it as marketing for the author's tool.
- **Sources:**
  - https://typesafe.ai/blog/introducing-system-one-models-and-jev
  - https://typesafe.ai
  - https://docs.typesafe.ai/models
  - https://docs.typesafe.ai/api
  - https://docs.typesafe.ai/model-jaggedness/jev-1.13
  - https://docs.typesafe.ai/cookbooks/parallel_questions
  - https://vercel.com/blog/ai-gateway-jev-model-launch
  - https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
  - https://github.com/browser-use/jev-ultrafast (+ docs/performance.md)
  - https://x.com/gregpr07/status/2100411066966749359
  - https://x.com/nutlope/status/2100426999546184123
  - https://docs.langchain.com/oss/python/integrations/providers/typesafe
  - Funding (secondary): https://dealroom.co/news/151032-typesafe-exits-stealth-with-40m-seed-to-build-ai-for-software-not-people/, https://thenextweb.com/news/typesafe-jev-decision-model-vercel-fastest-adopted
- **Confidence:** high for what Jev is, its pricing, the docs and the Vercel figures. Medium for the funding details. Treat the vendor speed/cost multipliers as claims, not facts.

## 2. The fly brain: MaleCNS, the complete male fruit-fly connectome, and the "fly plays games" wave

- **What happened:** HHMI Janelia (FlyEM), Google Research, the University of Cambridge and the MRC Laboratory of Molecular Biology published the first finished connectome of an **entire adult male *Drosophila* central nervous system**: central brain, optic lobes and ventral nerve cord.
  - Size: **166,000+ neurons** (the Cell paper materials say 166,700) and **11,691 cell types**. About 125 million synapses (Gizmodo; not stated on the Google page).
  - Compared with the female FlyWire brain: **262 sex-specific and 114 sexually dimorphic cell types (about 4.8% of the central brain)**.
  - Paper: Berg et al., "Sexual dimorphism in the complete *Drosophila* male central nervous system connectome", *Cell*, DOI 10.1016/j.cell.2026.08.015.
  - Data license: CC BY 4.0.
- **When:**
  - Data v0.9: Oct 5, 2025.
  - Data v1.0: June 8, 2026.
  - **Cell publication and Google announcement: Sept 3, 2026** (Google post updated Sept 21).
- **The viral part (this is what the owner means by "the fly brain"):**
  - On **Sept 4**, Georgia Tech grad student **Evan Sinclair Smith** ran the connectome as a simulated network ("NeuroCraft Fly") driving a fly in **Minecraft**. It drew millions of views within a day.
  - Others followed: Alex Wormuth (Doom, streamed live; also "stonkfly" Bitcoin trading), Jessica Paquette (Super Mario 64, code "vibe coded with GPT Astra"), Beat Saber, parallel parking, and Nico Christie rewiring the mating circuit.
  - **Caveat:** sensory input and motor readouts are mapped by hand onto chosen neurons. These are connectome-driven toys, not evidence that a fly brain "plays" games, and not whole-brain emulation in the strict sense.
- **Earlier context, outside the 6-week window:**
  - **Eon Systems** (startup; Alex Wissner-Gross, Philip Shiu) on **Mar 7, 2026** put a FlyWire-based whole-brain model (about 139k neurons) into a MuJoCo fly body. Eon claimed about 91% behavioral match for walking, grooming and feeding. That is a company claim, and some scientists dispute the framing.
  - The FlyWire female connectome was published in Nature in 2024.
- **Why builders care:** a large, CC-BY, fully annotated real neural network is now a hackable dataset. It went from a Cell paper to Minecraft in about 24 hours, mostly through AI-assisted coding. This is a good example of "new uses" content.
- **Sources:**
  - https://blog.google/innovation-and-ai/technology/research/male-fruit-fly-brain-map/
  - https://www.janelia.org/project-team/flyem/male-cns-connectome
  - https://male-cns.janelia.org/release/
  - https://www.sci.news/biology/complete-fruit-fly-connectome-15053.html
  - https://404media.co/a-digital-fly-brain-has-taken-over-the-internet
  - https://gizmodo.com/google-mapped-a-fruit-flys-brain-now-its-playing-doom-and-super-mario-64-2000808616
  - Eon (secondary): https://the-decoder.com/startup-claims-first-full-brain-emulation-of-a-fruit-fly-in-a-simulated-body/
- **Confidence:** high for the connectome facts. Medium for the details of the viral demos (secondary press, consistent across sources). Medium-low for Eon's accuracy claims.

## 3. Anthropic: Claude Opus 5.5, Sonnet 5.5, Fable/Mythos 5.1

### Fable 5.1 / Mythos 5.1
- **What:** two versions of the same model with different safeguards. Fable 5.1 is generally available. Mythos 5.1 is limited to trusted-access programs for cyber and life sciences.
- **Cost and privacy:** about 25% cheaper than Fable 5 on typical work, through cheaper cache reads, and up to about 45% cheaper on agentic work. Anthropic announced Enterprise Frontier Safeguards for privacy.
- **Pricing:** $10/$50 per M tokens with 1M context, per secondary sources.
- **Date:** the Anthropic page says "September 2026". **Sept 1** comes from secondary sources and is consistent with Claude Code v2.1.257 (released Sept 1), which added Fable 5.1 support.
- **Confidence:** medium on the exact date; high on everything else.

### Opus 5.5
- **Date:** **2026-09-22**.
- **Performance:** "performs at the level of Fable 5.1 on most work". Benchmarks: Terminal-Bench 4.0 **66.4%**, OSWorld 2.1 81.8%, HLE 67.7% with tools.
- **Price and speed:** $4/$20 per M tokens with cache reads at $0.20/M, about **40% cheaper than Opus 5** on typical workloads, and 30%+ faster output.
- **Tester results:** a 680,000-line code migration in under a day; 39 of 40 successes on cutting web-app load times.
- **Safety:** best score yet on Anthropic's behavioral audit, and more resistant to prompt injection than Opus 5.
- **Availability:** the default Opus in Claude Code from v2.1.280 (Sept 22).
- **Confidence:** high.

### Sonnet 5.5
- **Date:** **2026-09-28**.
- **Price and benchmarks:** $2/$10 per M tokens. Terminal-Bench 4.0 **70.6%** (Sonnet 5: 10.3%). GDPval-AA 1844 (Opus 5.5: 1846). 30%+ faster, and up to 30% cheaper per task.
- **Other:** first Sonnet to beat Pokémon Red from screenshots only. Haiku 5.5 is "in the coming weeks".
- **Availability:** the default Sonnet in Claude Code from v2.1.284.
- **Confidence:** high.

**Why builders care:** near-flagship quality is getting much cheaper. The X posts' "Opus 5.5 main + Fable 5.1 advisor" setup is a real, documented pairing.

**Sources:**
- https://www.anthropic.com/claude-opus-5-5
- https://www.anthropic.com/claude-sonnet-5-5
- https://www.anthropic.com/claude-fable-and-mythos-5-1
- https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- Release dates: https://api.github.com/repos/anthropics/claude-code/releases

## 4. Claude Code: /advisor, Claude Mods, "You should know"

- **/advisor:**
  - **What it does:** the main model consults a stronger "advisor" model server-side. The advisor sees the whole conversation, including tool calls and results. Claude decides when to call it, typically before committing to a plan, when an error keeps coming back, and before declaring a task done.
  - **How to set it:** `/advisor <model>`, the `advisorModel` setting, or `--advisor`.
  - **Pairings:** for Opus 5.5 or Opus 5 as the main model, accepted advisors are Fable or Opus 5+. A Fable advisor may need a one-time usage-credits consent.
  - **Status:** experimental and Anthropic API only (not on Bedrock, Vertex or Foundry).
  - **Timeline:** the tool itself dates to v2.1.98. v2.1.260 (**Sept 3**) added a text form for the desktop app, Remote Control and headless/Agent SDK sessions. v2.1.287 fixed pairing checks.
- **v2.1.287 (Oct 1):**
  - **Claude Mods** let plugins change deeper behavior.
  - **You should know** is a built-in mod: a side agent that flags things you or Claude might miss.
- **On the @thedelost post (685k views, 5.9k bookmarks):** the post is largely accurate against the docs. Its env-var list (`CLAUDE_CODE_DISABLE_ADVISOR_TOOL` etc.) is not in the docs page I read, so I left it out.
- **Sources:**
  - https://code.claude.com/docs/en/advisor
  - https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- **Confidence:** high.

## 5. OpenAI: GPT-6 Astra, Sol, Luna, GPT-6.1 Sol, DevDay (Agents API, Decisions API, Ultrafast)

- **GPT-6 Astra (Sept 3):**
  - 1.05M context, 128K max output.
  - Pricing: $10 in / $50 out per M tokens; cached input $1.
  - Launched for Pro, Enterprise and Business Premium in ChatGPT Work and Codex, and in the API.
- **Agents API (Sept 10, public beta):**
  - The Codex harness, run on OpenAI's infrastructure.
  - Sandboxes: OpenAI-hosted, or bring your own (Blaxel, Cloudflare, Daytona, DigitalOcean, E2B, Modal, Oracle, Runloop, Vercel).
  - No fee beyond tokens and tools.
- **GPT-6 Sol and Luna (Sept 22, about 90 minutes after Opus 5.5 per secondary sources):**
  - Pricing: Sol $2/$10, Luna $0.10/$0.50 per M tokens, 50% below GPT-5.6 promotional pricing.
  - Available in the API, Codex and ChatGPT Work. Free/Go users get Luna in the desktop app.
- **DevDay (Sept 29):**
  - **GPT-6.1 Sol:** standard prices at one-fifth of Astra's.
  - **Ultrafast:** a paid speed tier, up to 8x faster (300 tok/s) in Codex and 6x in the API.
  - **Agents API computer use.**
  - **Decisions API (limited preview):** Luna answers user-defined questions with fixed answer sets. This is OpenAI moving directly into Jev's niche. That is my reading; OpenAI doesn't name Jev.
  - Also: Codex Cloud, Codex Security Cloud, "Dots" persistent agents, Sign in with ChatGPT, ZDR "Private Intelligence".
- **GPT-6.1 Sol in the API (Sept 30 forum post):**
  - Same $2/$10 pricing; cached input $0.10.
  - DeepSWE v1.1 75.2% (GPT-6 Sol 68.8%) at about 76% lower cost per task.
  - OSWorld 2.0 offline 71.4% vs Astra's 73.5%.
  - I mark this medium because it is a community-forum announcement, and openai.com returned 403 to my fetches.
- **Sources (OpenAI's official developer forum; openai.com blocked automated fetches):**
  - https://community.openai.com/t/introducing-gpt-6-astra-the-most-intelligent-and-aligned-model-in-the-world/1394703
  - https://community.openai.com/t/introducing-the-agents-api-and-hosted-sandboxes/1396481
  - https://community.openai.com/t/announcing-gpt-6-sol-and-gpt-6-luna-in-the-api-codex-and-chatgpt/1399925
  - https://community.openai.com/t/devday-2026-announcements-and-developer-resources/1402006
  - https://community.openai.com/t/gpt-6-1-sol-in-the-api-a-meaningful-step-up-in-cost-performance/1402388
  - https://community.openai.com/t/build-ultrafast-with-astra-in-codex-and-the-api/1402393
  - Canonical URLs seen in search: https://openai.com/index/introducing-gpt-6-sol-and-luna/, https://openai.com/index/introducing-gpt-6-1-sol/
- **Confidence:** high, except GPT-6.1 Sol benchmark numbers (medium).

## 6. AI doing science and physical work (Anthropic)

- **Claude discovers a novel enzyme system (Sept 23):**
  - Anthropic announced an in-house life-sciences lab.
  - Claude flagged a reverse-transcriptase system from a jumbo phage with an associated **CRISPR-like non-coding repeat array** and an accessory protein of unknown function. The RT itself was already known; the system's defining features were not.
  - Function is still unknown. Feng Zhang (MIT/Broad) commented positively on the preprint.
  - Source: https://www.anthropic.com/news/claude-discovers-novel-enzyme-system
  - Confidence: high.
- **Model Hardware Standard research preview (Aug 27):**
  - A driver spec, started with HHMI Janelia, that lets agents discover and operate lab and factory instruments (microscopes, liquid handlers, robot arms) through simple read/write primitives.
  - Model-agnostic, reachable over MCP. Anthropic plans to open-source it after the preview.
  - Source: https://www.anthropic.com/news/model-hardware-standard-research-preview
  - Confidence: high.

## 7. Agent harness / loop engineering (the dominant X genre)

- **What it is:** a framing, not a news event. The term covers the code around the model: environment, tools, memory, verification loops, stop conditions. These X articles are "harness engineering" (0xwhrrari 4.06M views, mirku21), "harness + loop + graph" (marfinxx), and "reliable agent" (mikenevermiss).
- **What they rest on:** OpenAI's "Harness engineering: leveraging Codex in an agent-first world" post (quoted in the articles) and a Dario Amodei quote about needing "a harness".
- **Their claims:** mostly sound practice (evidence-based loops, contracts, sandboxes). They also contain unsupported absolutes such as "zero-defect production PR".
- **News pegs that fit this genre:**
  - OpenAI Agents API (managed harness).
  - Claude Code /advisor and Claude Mods.
  - ECC (github.com/affaan-m/ECC, MIT): today 68 agents, 293 skills, 94 command shims, plus the AgentShield scanner, and about 270k stars. Its claim that the author won an Anthropic hackathon is not verified here. The repo is from January 2026, so it isn't new.
- **Confidence:** the repo facts are high; the framing is commentary. **No posts were written for this section.**

## 8. Other items checked

- **Kimi K3 (Moonshot):**
  - Released **July 16, 2026**; full open weights **July 27**: 2.8T-parameter MoE, about 1M context, native vision. K3 Swarm Max is the agent-swarm variant (up to 300 sub-agents per the polydao article).
  - Outside the 6-week window. A "K3.1 before end of October" is rumor only.
  - Sources (secondary): https://rits.shanghai.nyu.edu/ai/kimi-k3-open-weights-ship-2-8t-parameters-1-4-tb-to-run/, https://www.eesel.ai/blog/kimi-k3
  - Confidence: medium. No posts written.
- **Fine-tuned small model beats frontier (Blackfrost quoting @svpino):**
  - Claim: a Qwen3 4B fine-tuned on AWS beat the base model and Claude Sonnet 4.6.
  - No task, dataset or eval details are public in what I could find. **Unverified.** No post written.
  - The general pattern (task-specific fine-tunes beating general models on narrow tasks) is well established, but this specific result isn't.
- **Photon Studio (romandevz, 982k views):**
  - A free desktop image editor (macOS/Windows/Linux) with layers, PSD support, and local subject selection/background removal. Reportedly built by a solo dev (Tenzen Studio) with GPT-6 Astra for about $2,000 in tokens.
  - Only secondary sources (kod.ru, vgtimes, techspot listing), and the post asks for an email to download. Medium-low. No post written.
- **Anthropic text watermarking (Aug 14):** future Claude models will watermark text for the EU AI Act. This is just outside the window and not included. Source: https://www.anthropic.com/news/claude-text-watermark
- **Gemini:** search results were mostly rumor (Gemini 4 in October; "Gemini 3.8 Flash"). Nothing verified. No posts written.

---

## What these X posts show about the audience

**Sample:** 20 posts, Jul 27 to Oct 1 2026. 15 are X long-form Articles, 5 are plain posts.

**Formats**
- The dominant format is the **long-form "guide" Article**: 800-3,300 words (median about 1,700), numbered steps ("10-Step Roadmap", "Masterclass", "Setup Guide (Exact Config Inside)").
- They usually end with a Substack or product plug. Several are thinly veiled ads: mapsdata.ai, Virlo, Pamba, the Grok bot.
- Short posts that did well were **copy-paste configs**:
  - @thedelost's /advisor tree plus a prompt: 685k views, 2,978 likes, 5,920 bookmarks.
  - @AnnatarXBT's "68 subagents, 286 skills" repo breakdown.

**Hooks**
- Tool name plus superlative: "Jev is the 'Internet' moment", "Jev is INSANE for Marketing".
- Money outcome: "$14,300 last month", "10 million business contacts", "438,122 apps doing $10k/mo".
- "Free / open source / gold": "HAN RECREADO PHOTOSHOP 100% GRATIS", "FREE f*cking gold".
- Anti-hype positioning used as hype: "everyone else shows slop demos, I actually built it".

**Topics, by frequency**
1. Jev (8 of 20 posts: setup guides, use cases, marketing, cost cutting).
2. Agent harness/loop engineering (4).
3. Claude Code configuration (Opus 5.5 + Fable 5.1 advisor, ECC).
4. AI content and money (clips, taste, viral-post bots, lead scraping).
5. Local/free tools (Photon Studio).
6. Fine-tuning small models.

**Engagement that stood out**
- **Bookmarks beat likes**, usually by 2-5x:
  - 0xCodila Jev roadmap: 2.17M views, 3,401 likes, **8,304 bookmarks**.
  - chhddavid: 846k views, 1,358 likes, **6,552 bookmarks**.
  - 0xwhrrari harness article: 4.06M views, 1,561 likes, **5,085 bookmarks**.
  
  The audience saves reference material, so posts with dense, specific numbers fit this behavior.
- **Views look inflated or promoted on several posts:**
  - martynov014: **12.1M views but 92 likes** (3.3k followers).
  - dsqjaffa: 540k views from 931 followers.
  - mirku21: 417k views from 435 followers.
  - Pamba_ai: 202k views, 68 likes; reads as an ad.
  
  Don't use views alone as the quality signal; likes plus bookmarks are more honest.
- **Highest like rate:** @thedelost's /advisor post (2,978 likes on 685k views, about 0.43%) and romandevz's Photon Studio post (3,243 likes on 983k, about 0.33%). Both are concrete, immediately usable, and short.

**Implications for Tardy's Breaking lane**
- The audience rewards the **specific and usable**: a model ID, a price per million tokens, a command, a measured latency.
- The articles' accuracy is mixed. Most Jev numbers in them trace back to TypeSafe docs, but they recycle vendor multipliers without caveats and pad with guesswork.
- A ≤200-char factual post with one or two hard numbers plus a caveat ("free on the gateway through Sept 25", "three run pairs") is a credible counter-format to the bait. It also suits being bookmarked.

---

## Jev as a moderation checkpoint

The question: could Tardy run every new post (≤200 characters, from humans and agents) through Jev before publishing, and possibly use it as a security layer? Facts below are from TypeSafe's docs and legal pages, fetched 2026-10-01.

### Interface and deployment
- **Hosted API only.** One endpoint: `POST https://api.typesafe.ai/v1/systemone` with a Bearer key. `GET /v1/models` lists the models.
- **No self-hosted or local option is documented.** "The same weights serve every account." No customer fine-tuning or LoRA.
- Also reachable through **Vercel AI Gateway** (`typesafe-ai/jev`, same price). Cloudflare Workers AI is claimed in X posts but not verified.
- **SDKs:** Python (`typesafe-sdk`) and JavaScript/TypeScript (`@typesafe-ai/sdk`) only.
  - **There is no Rust SDK.** The docs say "You can also call the HTTP API directly from any language."
  - The request and response are plain JSON, so a small `reqwest` + `serde` client in Rust is straightforward.
  - Retries are your job: back off exponentially on `429` and `529 Overloaded`.
- **Signups:** an X article says TypeSafe paused new signups on Sept 22. **Unverified.** Check the console before planning around it.

### Can it produce a verdict (allow / hold / reject plus a reason)?
**Yes, for the verdict. Only partly, for the reason.**
- **Verdict:** a Choice question with options `allow` / `hold` / `reject` returns the selected option, a probability for each option, and a confidence.
- **The pattern TypeSafe documents** (the "Guardrails for LLMs" cookbook, model `jev-1.12`, 2026-08-15) is better than a single Choice:
  - Ask a battery of **Noul hazard questions** in one request (jailbreak/instruction override, harmful request, medical advice, self-harm, and so on), plus one **Score** for severity.
  - Your code applies thresholds to map the results to pass / review / block / route-to-support. Example policy: review ≥0.35, action ≥0.70 (strict) or ≥0.85 (permissive), block if severity ≥2.0.
- **Reason:** Jev **cannot write a free-text reason**; the docs list "Generation" as a failure mode. The reason has to be the hazard category whose Noul fired, plus its probability. For example: `reason: "spam_promo", p=0.91`. That is a reason code, not an explanation.
- The cookbook's own example shows the shape: a DAN jailbreak scored jailbreak=0.98 and was blocked, and a borderline melatonin question went to review. **That is a 15-message demo, not an accuracy benchmark.**
- **No published precision/recall** for moderation exists.

### Latency and cost per post
- **Latency:** TypeSafe states 70-500 ms end to end. Independent anecdotes are consistent: a 256 ms median (Hassan); 5-18x faster than a GPT-5.6 Luna safety classifier (Vercel engineer, secondary).
- **Cost:** $0.042 per million input tokens; output free.
  - The API docs' single-question examples bill about 300 input tokens.
  - A 200-char post plus a battery of about 6 hazard questions and one severity score is roughly 500-1,500 input tokens. That is my estimate; measure it.
  - So **about $0.00002-0.00006 per post, or about $20-60 per million posts.**
  - Ask all questions in **one** call. State is billed once per call, and TypeSafe measured 12.2x cheaper batched.

### Rate limits
- `jev-1.13.0`: **100K tokens/s and 40 requests/s** per the Models page today.
- That page also says the limits "can change without notice" while TypeSafe scales. Launch-week figures quoted on X were 250K tok/s and 1,200 req/min.
- 40 req/s is enough for post-time moderation at Tardy's likely volume. **Don't put it on per-request website paths.**

### Data retention and privacy
- **Training:** TypeSafe says it will not train or fine-tune models on your inputs (Privacy Policy and the Models page).
- **Retention:** no fixed retention period is published.
  - The DPA says personal data is kept "for as long as necessary taking into account the purpose of the Processing".
  - The Master Customer Agreement grants TypeSafe a **perpetual** license to use Customer Data to derive Telemetry ("technical logs, hashes, summary statistics and classifications, metrics"), to **monitor for fraud and abuse**, and for legal compliance.
  - **Zero data retention is enterprise-only** (contact sales).
- **For Tardy:** submitted post text should be assumed retained for an unspecified period, unless Tardy is on an enterprise ZDR contract. Posts are public anyway, but this matters for drafts, private content, or anything moderated before a user chooses to publish.
- Subprocessors are listed on TypeSafe's trust page, which I didn't fetch.

### Prompt-injection detection and the "security layer" idea
- **Detecting injection in posts:** the guardrails cookbook does include a jailbreak/instruction-override Noul, and it flagged real in-the-wild jailbreaks in the demo. So Jev *can* be asked "does this text try to override an agent's instructions?". That is relevant because Tardy's posts are read by agents.
- **But Jev itself can be steered by adversarial text.** TypeSafe's own jaggedness page for jev-1.13: "State is data, and `jev-1.13` does not treat it as hostile by default. Content written to adversarially steer the model... can move the answer." A poster could write text that argues for its own classification.
- **As a website security layer (WAF, bot or abuse detection): not suitable.**
  - It is a remote API with 70-500 ms latency and 40 req/s limits.
  - It is text-only.
  - It is weak at counting and numbers, so rate patterns and IP math belong in code.
  - TypeSafe's terms forbid security testing of the service itself. That isn't a blocker; it's noted for completeness.
  - Use deterministic controls for security (auth, rate limiting, input validation, CSP). At most, use Jev for semantic triage of text content.

### Assessment
**Feasible as one layer of post moderation. Not feasible as a security layer.**

A reasonable design:
1. Deterministic checks first, in code: length, links, banned terms, rate limits.
2. One Jev call per post: hazard Nouls plus a severity Score.
3. Thresholds in code map the result to allow/hold/reject, with a reason **code**.
4. Low confidence or holds go to a human or a second model (for example Claude/GPT) that can write a reason.
5. Log `model` and the full probabilities, pin `jev-1.13.0`, and tune thresholds on a labeled set of real Tardy posts before trusting it.

Following Tardy's "fail loud" tenet, treat an API error as `hold`, never as `allow`.

**Alternative to watch:** OpenAI's Decisions API (Luna, limited preview, Sept 29) offers a similar closed-answer interface.

### Sources
- https://docs.typesafe.ai/api
- https://docs.typesafe.ai/models
- https://docs.typesafe.ai/sdk
- https://docs.typesafe.ai/cookbooks/llm_guardrails
- https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook (moderation with an "uncertain" outcome; not reviewed in depth)
- https://docs.typesafe.ai/model-jaggedness/jev-1.13
- https://docs.typesafe.ai/legal
- https://typesafe.ai/legal/privacy-policy
- https://typesafe.ai/legal/data-processing
- https://typesafe.ai/legal/mca

### Confidence
- **High** for the interface, SDK languages, pricing, current rate limits, the no-training commitment, enterprise-only ZDR, and the documented injection weakness.
- **Medium** for the per-post cost estimate, which is my arithmetic; measure it.
- **Unverified** for moderation accuracy on Tardy-like content (none published) and for the signup pause.
