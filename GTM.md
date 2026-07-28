# 90-day GTM strategy for refd

Last updated: 28 July 2026, after the hosted workload controls, repository badges, onboarding and prompt-management improvements, BrightData notify/backstop flow, the `robots.txt` and build-generated sitemap, the read-only OAuth-protected remote MCP server, homepage Markdown negotiation and discovery headers, the DNSSEC-validated DNS-AID record, and the domain-verified official MCP Registry entry were deployed.

The strongest position for refd is not simply “the open-source option.” Other open-source AI visibility products already exist, including [Elmo](https://www.elmohq.com/) and [OpenSight](https://www.opensight.dev/).

refd’s defensible position is:

> Auditable AI search monitoring for businesses. See where your brand appears, who appears instead, and the raw answer behind every metric.

The proof points are unusually strong:

- Five real AI answer surfaces.
- Repeated samples to account for non-deterministic answers.
- Separate mention, citation, position, sentiment, and share-of-voice metrics.
- Every number links back to the raw answer.
- Hosted convenience or a fully MIT-licensed self-hosted stack.
- A compact, understandable Cloudflare architecture.

Open source should support the trust story. It should not be the only reason to choose the product.

## Research basis for this version

This strategy was refreshed on 26 July 2026 using:

- DataForSEO Labs Keyword Overview for exact-match Google demand in the United States, English.
- DataForSEO live Google SERPs for the priority commercial queries.
- DataForSEO ranked-keyword data for Otterly, Peec, Profound, Elmo, OpenSight, and refd.
- Current repository capabilities and public-site implementation.
- Current submission rules for the launch and listing platforms linked below.
- Current publishing and review requirements for the official MCP Registry, Anthropic Connectors Directory, OpenAI apps and Plugins Directory, and Smithery.

Treat search-volume and keyword-difficulty values as directional planning inputs, not forecasts. This is a young category with sharp month-to-month swings. DataForSEO says its keyword metrics are based on Google Ads data and updated monthly. Re-run the same exact keyword set on days 30, 60, and 90 rather than changing the set whenever a new phrase becomes fashionable. [DataForSEO Keyword Overview documentation](https://docs.dataforseo.com/v3/dataforseo_labs-google-keyword_overview-live/).

The present organic baseline is close to zero. DataForSEO currently detects one US ranking keyword for `refd.ai`: “ref ai,” at position 67. The phrase is ambiguous and was detected as another language, so it should not be treated as meaningful category traction.

## 1. Initial target market

For the first 90 days, target one narrow customer:

**Primary ICP:** marketing, content, and SEO leaders at B2B software companies with roughly 20–500 employees.

They should already:

- Invest in content or SEO.
- Compete in a category where buyers ask ChatGPT or Perplexity for recommendations.
- Track at least three competitors.
- Need evidence they can show to leadership.

Their job to be done is:

> “Show me whether AI assistants recommend us, which competitors are winning, which sources influence the answers, and whether our work is changing that.”

Use agencies as a secondary design-partner segment. Agencies can become a valuable multiplier, but refd currently lacks some agency-oriented features such as white-label exports, broader collaboration, and client-facing reports. Learn from agencies now without making them the primary launch promise.

Developers and self-hosters are a third audience. They can generate stars, contributions, and technical credibility, but most will not become hosted business customers.

## 2. Recommended positioning

### Homepage headline

> See how your brand performs in AI search, with every metric backed by the raw answer.

### Supporting copy

> Monitor mentions, citations, first-mention position, sentiment, and share of voice across ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews. Use the hosted app or self-host the complete MIT-licensed stack.

### Message by audience

| Audience | Lead with |
|---|---|
| Marketing and SEO | Know whether AI recommends your brand and why |
| Leadership | Track competitive AI visibility with verifiable evidence |
| Agencies | Give clients defensible, answer-level visibility data |
| Developers | One open-source Cloudflare Worker, with D1, R2, Queues, and React |
| Privacy-conscious teams | Self-host, keep the raw data, and audit the calculations |

Avoid claiming that refd is the “first” or “only” open-source product. Lead with measurement integrity.

## 3. Fix the offer before attracting a large audience

The hosted product should not offer unrestricted daily monitoring for free.

The initial hosted cap is now 25 active prompts and three enabled surfaces per workspace. With two samples and daily collection, a workspace at the ceiling can produce roughly 4,500 records per month. At Bright Data’s current $1.50 per 1,000 pay-as-you-go rate, that is approximately $6.75 per workspace before Cloudflare, onboarding, sentiment classification, support, retries, and failed-user acquisition costs. [Bright Data currently publishes the same $1.50/1K starting rate for its Web Scraper API](https://brightdata.com/pricing/web-scraper) and [SERP API](https://brightdata.com/pricing/serp).

Use this provisional offer:

- **Open source:** Free, self-hosted, bring your own Cloudflare and Bright Data accounts.
- **Hosted snapshot:** One brand, a limited prompt set, one initial report. No indefinite free daily monitoring.
- **Hosted monitoring:** Test approximately $79/month for one brand, with explicit prompt, surface, sample, and frequency limits.
- **Agency design partner:** Custom arrangement during the first 90 days.

Price against tracked workload rather than seats. Never advertise “unlimited prompts” on the hosted plan unless the economics genuinely support it.

The technical ceilings are cost and abuse safeguards, not the final packaging. Non-admin accounts are currently capped at five workspaces, while each workspace is capped at 25 active prompts and three enabled surfaces. Administrators may create unlimited workspaces and prompts and enable all available surfaces. Public pricing can offer lower plan-specific allowances later, but it must never promise more than the backend enforces.

The supporting hosted safeguards are also in place: recurring collection is limited to eligible `pilot` and `subscribed` workspaces, manual provider-spending actions require an email in `ADMIN_EMAILS`, and BrightData batch snapshots use authenticated completion notifications with a delayed backstop poll. These are now product constraints to validate in production, not engineering tasks in the GTM backlog.

## 4. Launch readiness work

The [public GitHub repository](https://github.com/emaitchess/refd) was created on 14 July 2026 and currently has 11 relevant topics, an MIT license, CI, MIT, Try refd.ai, and Cloudflare Workers badges, no tagged release, zero stars, and zero forks. Repository metadata and trust badges are in place; it now needs proof, release hygiene, and a clear evaluation path before promotion.

Before public launch:

- Publish a real `v0.1.0` release with a concise changelog.
- Put a product screenshot near the top of the README.
- Add a 60–90 second walkthrough.
- Add a public, no-signup sample report or read-only demo.
- Document actual infrastructure and provider costs.
- Add a roadmap and a few well-scoped “good first issue” items.
- Create a GitHub social preview image.
- Publish a legally adequate privacy policy, terms, support contact, and security page.
- Publish a crawlable MCP page with connection instructions, permissions, tool descriptions, and example workflows.

The public demo is particularly important. Hacker News recommends making Show HN projects easy to try without signup barriers. [Its guidelines also prohibit asking friends or users to upvote](https://news.ycombinator.com/showhn.html).

## 5. Where to list and launch refd

Focus on listings that have relevant audiences, indexed pages, or software-buyer intent. Do not submit to 100 generic AI directories.

MCP registries and client directories are a separate distribution surface with different technical and policy requirements. Section 16 owns that sequence.

| Platform | Priority | Recommended action |
|---|---:|---|
| GitHub | Essential | Publish the first release, screenshots, demo, roadmap, and contribution-ready issues |
| G2 | Essential | Request and claim a free profile in its current “AI Search Visibility Optimization Tools” category. [G2 says every company can maintain a free profile](https://sell.g2.com/create-a-profile). |
| AlternativeTo | High | Create an account now because new users must wait one week before submitting. List refd as an open-source, self-hosted alternative to relevant commercial tools. [Submission instructions](https://alternativeto.net/faq/#add-a-new-application). |
| Product Hunt | High | Launch only after there is a demo, pricing/offer clarity, testimonials, and polished media. Product Hunt recommends makers submit their own live product. [Submission guide](https://help.producthunt.com/en/articles/479557-how-to-post-a-product). |
| Hacker News | High | Use “Show HN: refd – Open-source monitoring for brand visibility in AI answers.” Link to the demo or repository, not a signup wall. |
| SaaSHub | Medium | Add refd under SEO tools, marketing analytics, and monitoring. [SaaSHub provides a free submission tool](https://www.saashub.com/submit). |
| OpenSourceAlternative.to | Medium | Submit to the free queue now. Its current expedited review is paid, while free review may take six months. [Submission page](https://opensourcealternative.to/submit). |
| OpenSourceFest | Medium | Submit as an AI, analytics, monitoring, and self-hosted project. It currently accepts community submissions. [Directory](https://opensourcefest.org/). |
| OpenSaaSDirectory | Medium | Submit the GitHub repository and hosted product as an open-source SaaS project. [Submission page](https://opensaas.directory/submit-project). |
| DEV Community | Medium | Publish the build story under `#showdev`, `#opensource`, and `#cloudflare`. The `#showdev` rules explicitly allow launches but ask posts not to be overly sales-oriented. [Show DEV guidelines](https://dev.to/t/showdev). |
| Indie Hackers | Medium | Post the founder story, early usage results, and a specific request for feedback |
| OSSSoftware.org | Low | Submit after the repository has a tagged release, screenshots, and clear self-hosting instructions. Its directory accepts projects for review. [Directory](https://osssoftware.org/). |
| Capterra/GetApp | Later | Submit after there is a clear hosted offer, trial, demo, or paid plan. Capterra requires a publicly available product with an appropriate CTA. [Listing criteria](https://www.capterra.com/legal/listing-guidelines/). |
| OpenAlternative | Conditional | Its current standard listing costs $97 and does not include a do-follow link. Defer until you can track whether it produces activated users. [Current packages](https://openalternative.co/submit/tolaria). |
| awesome-selfhosted | Do not submit yet | Its rules reject software tied to a specific cloud provider and require the first tagged release to be at least four months old. refd currently depends on Cloudflare. [Contribution criteria](https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/CONTRIBUTING.md). |

Rules and prices change, so recheck them immediately before submission.

Create one reusable submission kit before filling in any listing:

- 15-word, 50-word, and 150-word descriptions.
- A square logo, GitHub social preview, three product screenshots, and a 60–90 second demo.
- One sentence each for “who it is for,” “why open source,” and “why it is different.”
- Hosted, demo, documentation, GitHub, license, security, and self-hosting links.
- A standard founder bio and a short launch story.
- UTM-tagged destination links for every directory.

Track submission date, approval status, referral visits, registrations, completed onboardings, and activated workspaces. A listing that produces no activated workspace after 60 days gets no further paid promotion.

## 6. Reddit strategy

Do not cross-post the same announcement into ten communities. Use a different angle for each audience and disclose that you built the product.

Recommended communities:

- **r/selfhosted:** Use the current weekly New Project Megathread. Because refd is under three months old, standalone project posts will currently be removed. Include deployment requirements and truthfully disclose any AI involvement, as requested by the current [megathread rules](https://www.reddit.com/r/selfhosted/comments/1v4s7ok/new_project_megathread_week_of_23_jul_2026/).
- **r/CloudFlare:** Publish a technical breakdown of running the API, SPA, cron, queues, D1, and R2 in one Worker. Include real costs and tradeoffs.
- **r/SideProject:** Tell the origin story and request feedback on onboarding and positioning.
- **r/opensource:** Ask moderators first. Focus on the MIT license, governance, self-hosting, and contribution opportunities.
- **r/SaaS or r/ProductMarketing:** Share a case study or benchmark rather than an announcement.
- **r/SEO, r/bigseo, r/TechSEO:** Publish useful methodology or original data. Do not link-drop the product unless the rules and moderators allow it.

Reddit itself advises businesses to check each community’s self-promotion policy and participate as members rather than broadcasters. [Reddit’s moderator guidance](https://www.business.reddit.com/learning-hub/articles/how-to-work-with-moderators-on-reddit).

A good initial post:

> **Title:** I built an open-source monitor for brand mentions across ChatGPT, Perplexity, Gemini, and Google AI. I’d like feedback on the measurement method.
>
> AI answers change between runs, so I didn’t want to treat one response as a reliable ranking. refd repeats prompts, separates mentions from citations, records first-mention position, and keeps the raw answer behind every score.
>
> It is MIT licensed and can be hosted on Cloudflare, but it currently depends on Bright Data for collection. The hosted version is intended for business teams that do not want to operate the stack.
>
> I’m especially looking for feedback on:
> 1. Whether two samples are enough to communicate uncertainty.
> 2. Which metrics you would trust in a client or leadership report.
> 3. What would prevent you from self-hosting it.

That gives readers something substantive to discuss.

# Content and SEO strategy

## 7. Build docs and a blog, not a separate manuals section

Create two distinct systems:

- **`/docs/`**: setup, product operation, methodology, troubleshooting, privacy, and self-hosting.
- **`/blog/` or `/insights/`**: educational, commercial, comparative, and research content.

Do not create a separate “manuals” section. If you later have procedural business content, call it `/playbooks/` and reserve it for guides such as “How to build an AI search prompt set for a B2B SaaS company.”

Keep everything on `refd.ai` under subdirectories unless there is a strong operational reason to use a subdomain.

## 8. Current technical SEO gaps

The repository now has good homepage metadata, a `robots.txt` with a sitemap reference, a build-generated `sitemap.xml`, and useful `llms.txt` files, but:

- The public site is a client-rendered SPA.
- The same homepage title, description, and root canonical are returned by the app shell.
- The generated `sitemap.xml` currently lists only the homepage, because no other canonical public pages exist yet (it is built from `INDEXABLE_PUBLIC_PATHS` in `src/shared/public-pages.ts`).
- Most human-readable product documentation is either inside GitHub or behind authentication.
- The metric glossary is behind the dashboard.
- The `llms.txt` design-system link points to `DESIGN.md` at the repository root, while the file is under `docs/DESIGN.md`.

Before publishing many articles:

- Pre-render or statically generate all public documentation and content pages.
- Give every page a unique title, meta description, canonical, Open Graph image, and visible author/date.
- Return genuine 404 status codes for missing public pages.
- Mark authentication and dashboard routes `noindex`.
- Add each new public page to the generated sitemap as it ships, by extending `INDEXABLE_PUBLIC_PATHS`. The `robots.txt` and sitemap generator already exist.
- Submit the sitemap through Google Search Console.
- Add RSS for blog and changelog posts.
- Add internal breadcrumbs and related-content links.
- Add `Article`, `BreadcrumbList`, `Organization`, and `WebSite` structured data where truthful.
- Add `SoftwareApplication` structured data only after you have a public offer and real reviews. Google’s supported software markup currently requires an offer and a genuine review or aggregate rating. [Google’s specification](https://developers.google.com/search/docs/appearance/structured-data/software-app).

Google can render JavaScript, but it still recommends server-side rendering or pre-rendering because it is faster for users and crawlers, and other bots may not execute JavaScript. [Google’s JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

Keep `llms.txt`, but treat it as supplemental. It does not replace crawlable HTML, internal linking, canonicals, or a sitemap. [Google’s sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

## 9. DataForSEO keyword and SERP priorities

### Exact-query opportunity snapshot

The following figures are DataForSEO US English monthly estimates collected on 26 July 2026. KD is DataForSEO keyword difficulty on a 0–100 scale.

| Query | Volume | KD | Intent | Recommended owner |
|---|---:|---:|---|---|
| AI visibility tools | 1,600 | 19 | Commercial | `/compare/ai-visibility-tools` |
| AI search visibility tools | 1,000 | 59 | Commercial | Secondary target for the same comparison page |
| LLM visibility tools | 720 | 18 | Commercial | Secondary target for the same comparison page |
| AI overview tracker | 590 | 8 | Informational with product-shaped results | `/google-ai-overview-tracker` |
| AI search visibility | 480 | 47 | Informational/commercial | `/guides/ai-search-visibility` |
| AI search optimization tools | 320 | 19 | Commercial | Educational guide, not a refd product claim |
| LLM visibility | 320 | 25 | Informational | `/guides/llm-visibility` |
| AI brand monitoring | 210 | 32 | Commercial | Secondary homepage/product language |
| AI search monitoring | 170 | 13 | Commercial | Homepage primary query |
| AI search monitoring tools | 110 | 20 | Commercial | Secondary target for the comparison page |
| AI search analytics | 90 | 29 | Commercial | `/ai-search-analytics` after the first cluster is live |
| AI share of voice | 50 | Not returned | Informational | `/glossary/ai-share-of-voice` |

The opportunity is broader than the raw volume suggests. CPC estimates for the commercial terms range from roughly $20 to more than $100, indicating valuable business intent. At the same time, some yearly growth figures are distorted by a small starting base. Do not use percentage growth as a headline claim.

### What the current SERPs imply

DataForSEO live SERPs show:

- “AI visibility tools,” “LLM visibility tools,” and “AI search monitoring tools” are dominated by comparison listicles. One transparent, frequently updated comparison page should target this overlapping cluster. Do not create three near-duplicate posts.
- Reddit ranks first for both “AI search monitoring” and “AI search monitoring tools.” Helpful participation in relevant Reddit discussions is therefore both a community and search-discovery channel.
- “AI overview tracker” is dominated by focused product and feature landing pages. Build a genuine product page with a sample report and methodology, not a generic blog post.
- “AI search optimization tools” has mixed intent and includes content-production products. refd measures outcomes; it does not yet execute optimization. Cover the query educationally without describing refd as an optimization suite.
- AI Overviews appeared on all five priority SERPs checked. Each important page needs a concise definition, comparison table, first-hand evidence, and unambiguous entity language that can be summarized accurately.

The strongest current competitor footholds are also instructive:

- Otterly ranks first for “AI search tracking,” second for “AI search tracker,” eighth for “AI search visibility tool,” and ninth for “AI overview tracker.”
- Profound earns non-brand demand through category education, competitor review pages, and broad topic ownership.
- Peec leans on a long-form category guide, expert content, case studies, and an agency directory.
- Elmo publishes alternative and comparison pages, but its present US non-brand footprint is still limited.
- OpenSight had no US ranked keywords returned in this snapshot.

refd should not imitate the competitors’ volume. Win with evidence they rarely foreground: repeated samples, answer-level auditability, independent mention and citation measures, visible limitations, and reproducible methodology.

### Query-to-page rules

- The homepage owns “AI search monitoring.” Use the phrase naturally in the title, H1, introduction, product definition, and one internal anchor.
- `/compare/ai-visibility-tools` owns the commercial comparison cluster. Include refd, credible alternatives, a fixed evaluation rubric, test date, screenshots, pricing caveats, and who should not choose each tool.
- `/google-ai-overview-tracker` owns the feature query. Demonstrate `answerPresent=false`, citations, prompts, sampling, and how Google AI Overviews differ from Google AI Mode.
- `/guides/ai-search-visibility` defines the category and links to the methodology, glossary, comparison, and demo.
- `/guides/llm-visibility` explains the term without using it as the primary product category.
- `/glossary/ai-share-of-voice` expands the public glossary with the formula, denominator, example, failure modes, and links to the product methodology.

Do not create separate pages for trivial singular/plural or “monitoring/tracking” variants. Maintain one keyword-to-URL map and assign every target query to one canonical page before drafting.

## 10. Public pages to create first

### Product and trust pages

1. `/demo` – read-only sample workspace or report.
2. `/pricing` – hosted offer and self-hosted option.
3. `/methodology` – collection, sampling, scoring, provider, and limitations.
4. `/security` – data isolation, storage, auth, and self-hosting.
5. `/open-source` – license, architecture, contribution path, and hosted relationship.
6. `/changelog` – one page per meaningful release.
7. `/about` – creator, motivation, and product principles.
8. `/glossary` – make the existing metric glossary public.
9. `/privacy` – data collection, use, storage, sharing, retention, and contact details.
10. `/terms` – hosted-product and connector terms.
11. `/mcp` – public MCP endpoint, OAuth flow, permissions, tools, example workflows, and client setup.

### Documentation

1. `/docs/getting-started`
2. `/docs/hosted-quickstart`
3. `/docs/self-hosting`
4. `/docs/cloudflare-setup`
5. `/docs/bright-data-setup`
6. `/docs/workspaces-and-brands`
7. `/docs/competitors`
8. `/docs/building-a-prompt-set`
9. `/docs/answer-surfaces`
10. `/docs/metrics-and-sampling`
11. `/docs/runs-and-raw-answers`
12. `/docs/troubleshooting`
13. `/docs/data-and-privacy`
14. `/docs/provider-costs-and-limits`
15. `/docs/mcp`

Documentation is not merely support material. Good self-hosting and methodology pages can earn technical links while converting evaluators who need to understand the product before trusting it.

### Internal content operations documents

Create these private working documents before scaling production:

1. `keyword-map.md` – target query, intent, volume, KD, canonical URL, status, and last refresh date.
2. `editorial-calendar.md` – owner, brief date, draft date, review date, publish date, distribution date, and refresh date.
3. `content-brief-template.md` – audience problem, search intent, unique evidence, outline, internal links, CTA, sources, and claims requiring verification.
4. `style-and-claims.md` – refd terminology, prohibited claims, capitalization, competitor-comparison rules, citation standards, and the rule against pairing refd with “aeo.”
5. `comparison-methodology.md` – inclusion criteria, test environment, scoring rubric, pricing date, conflicts, and correction policy.
6. `research-methodology.md` – prompt selection, surfaces, dates, locations, sample count, aggregation, exclusions, limitations, and data-release policy.
7. `distribution-checklist.md` – LinkedIn, Reddit, DEV, email, video, partner outreach, and UTM conventions.
8. `content-scorecard.md` – impressions, clicks, average position, assisted registrations, activated workspaces, backlinks, and refresh decisions.

These can live under `docs/marketing/` in the private working tree. Public methodology and product documentation should still be rendered as crawlable pages on `refd.ai`.

## 11. Content pillars

### Pillar 1: AI search monitoring fundamentals

Target queries such as:

- AI search monitoring
- AI visibility monitoring
- What is AI visibility?
- How to track brand mentions in ChatGPT
- AI citation tracking
- AI share of voice

### Pillar 2: Measurement methodology

This is refd’s strongest content advantage:

- Why one AI answer is not a reliable measurement.
- Mentions versus citations.
- How repeated sampling changes AI visibility metrics.
- How first-mention position works.
- Why missing Google AI Overviews are valid observations.
- How to build a representative buyer-question set.

### Pillar 3: Surface-specific guides

Create substantial pages, not five near-duplicates:

- Tracking brand visibility in ChatGPT.
- Monitoring citations in Perplexity.
- Measuring Gemini brand mentions.
- Google AI Mode versus Google AI Overviews.
- Why results differ between AI answer surfaces.

### Pillar 4: Commercial evaluation

- Open-source versus hosted AI search monitoring.
- A transparent framework for comparing AI visibility tools.
- refd versus Profound.
- refd versus Otterly.
- refd versus Peec.
- refd versus Elmo.
- refd versus OpenSight.

Comparison pages must contain an update date, sources, screenshots, pricing caveats, and a consistent rubric. Publish two strong comparisons before creating more.

### Pillar 5: Original research

This is the best long-term acquisition channel.

Produce a quarterly or monthly benchmark such as:

> The State of AI Search Visibility for 25 B2B Developer Tools

Include:

- The exact prompts.
- Surfaces and locations used.
- Sampling dates.
- Number of samples.
- Definitions for every metric.
- Limitations.
- Downloadable aggregated data.
- Screenshots or raw-answer examples.
- A clear prohibition on exposing customer data without consent.

Original research aligns with Google’s recommendation to provide original reporting and analysis rather than mass-produced summaries. [Google’s people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).

## 12. First 12 SEO assets

Publish approximately one substantial asset per week. Conversion and trust pages come before the editorial backlog.

| Order | Type and URL | Working title or purpose | Primary job |
|---:|---|---|---|
| 1 | Homepage `/` | Open-source AI search monitoring with auditable answers | Own “AI search monitoring” and convert qualified visitors |
| 2 | Trust page `/methodology` | How refd collects, samples, and scores AI answers | Establish measurement credibility |
| 3 | Feature page `/google-ai-overview-tracker` | Google AI Overview tracking with answer and citation evidence | Capture the low-difficulty feature query |
| 4 | Comparison `/compare/ai-visibility-tools` | Best AI visibility and LLM monitoring tools, tested transparently | Capture the overlapping commercial tools cluster |
| 5 | Guide `/guides/what-is-ai-search-monitoring` | What Is AI Search Monitoring? Metrics, Methods, and Limitations | Define the category and link to the homepage |
| 6 | Guide `/guides/llm-visibility` | What Is LLM Visibility and How Should It Be Measured? | Capture informational demand without changing product positioning |
| 7 | Guide `/guides/ai-mentions-vs-citations` | AI Mentions and AI Citations Are Not the Same Metric | Demonstrate refd’s measurement model |
| 8 | Methodology `/methodology/repeated-sampling` | Why One AI Answer Is Not a Reliable Visibility Measurement | Make sampling the defensible differentiator |
| 9 | Guide `/guides/google-ai-mode-vs-ai-overviews` | Google AI Mode vs. Google AI Overviews | Explain two surfaces refd measures separately |
| 10 | Playbook `/playbooks/ai-search-prompt-set` | How to Build a Buyer-Question Prompt Set | Help users activate successfully |
| 11 | Glossary `/glossary/ai-share-of-voice` | AI Share of Voice: Formula, Example, and Limitations | Capture the metric query and earn internal links |
| 12 | Research `/research/b2b-ai-search-visibility-2026` | The State of AI Search Visibility for B2B Software | Earn links, conversations, and qualified demand |

Treat “How We Built an AI Search Monitor on One Cloudflare Worker” as a bonus technical distribution piece for DEV, r/CloudFlare, and the GitHub audience. It should not displace a buyer-focused page in the first 12.

Each asset should include:

- A real author and byline.
- First-hand examples from refd.
- A concise answer near the top.
- Methodology and limitations.
- Links to relevant docs.
- One relevant CTA.
- Sources for external claims.
- An update date only when the content actually changes.

Do not publish several AI-written posts per day. One evidence-rich article per week is considerably more valuable than 30 thin keyword pages.

## 13. Content distribution

Every substantial article should create several smaller assets:

- One founder-led LinkedIn post containing the main result.
- One chart or annotated screenshot.
- One short email to users and design partners.
- One relevant Reddit discussion, when community rules permit.
- One DEV article for technical pieces.
- One short video walkthrough.
- One outreach pitch to five relevant writers or newsletter curators.

For the original benchmark, pitch the data rather than the product to publications and newsletters such as [SEOFOMO](https://hub.seofomo.co/) and [Search Engine Roundtable](https://www.seroundtable.com/contact.php).

## Immediate next workstream

The cost-control and operator-safety implementation is complete. GTM work should now begin at measurement and evaluation:

1. **Instrument the activation funnel.** Record registration, onboarding completion, first-report completion, answer or citation inspection, and return after a fresh scheduled run. Add MCP authorization, first tool call, active client family, and post-run connector return. Include acquisition source and UTM values without recording sensitive prompt or answer content.

2. **Run a focused production smoke test.** Confirm that standard accounts hit the workspace, prompt, and surface limits; only entitled workspaces receive scheduled runs; non-admin manual actions return 403; and BrightData notify callbacks complete snapshots while the backstop remains available. Complete one production OAuth authorization and tool call from each priority client before marketplace review.

3. **Decide the first hosted package.** Keep the 25-prompt, three-surface, five-workspace values as hard safety ceilings while testing a smaller customer-facing allowance. Samples and collection frequency are still deployment-wide settings and should become explicit plan controls only before offering multiple paid tiers.

4. **Ship the public demo and first tagged release.** Publish a no-signup sample report and `v0.1.0`. These become the stable destinations for design-partner outreach, GitHub visitors, listings, and later public launches.

5. **Publish the crawlable evaluation foundation.** Start with pricing, methodology, security, privacy, terms, open-source, getting-started, and MCP pages, adding each canonical page to the already-generated sitemap as it ships (`robots.txt` and the sitemap generator are in place). Connect Search Console once those URLs are live. The authenticated Help page and repository markdown remain support material; they do not replace the public MCP and privacy URLs required by directories.

6. **Expand MCP distribution.** Maintain the published versioned `server.json`, verify downstream ingestion of the domain-verified official Registry entry, and then submit to Anthropic, OpenAI, and Smithery with a populated review workspace and the reusable listing kit from section 16.

# 90-day execution plan

| Week | Product and funnel | Content and SEO | Distribution and customer development | Exit gate |
|---:|---|---|---|---|
| 1 | Instrument activation events, UTMs, and the MCP authorization-to-first-tool-call funnel. Smoke-test entitlements, workload limits, operator-only actions, and the webhook/backstop path in production. | Create the keyword map, brief template, sitemap plan, and homepage query ownership. | Interview five target users. Build a list of 50 B2B software prospects. | Production safeguards are verified and both product and connector funnels can be measured. |
| 2 | Ship a no-signup sample report or demo. Prepare `v0.1.0`. Complete production MCP smoke tests from the priority clients. | Publish crawlable pricing, methodology, security, privacy, terms, open-source, getting-started, and MCP pages. | Interview five more users. Prepare the reusable product and MCP listing kits, including a populated review account. | A stranger or directory reviewer can understand, evaluate, and try refd without assistance. |
| 3 | Observe five onboarding sessions and fix the largest failure. Monitor the published Registry metadata and connector health. | Publish the Google AI Overview tracker page and “What is AI search monitoring?” guide. Submit the sitemap. | Verify downstream Registry ingestion and publish to Smithery. Send 10–15 personalized messages and offer five concise visibility snapshots. | At least five design partners have completed a first report, and the canonical MCP listing remains active. |
| 4 | Add the most-requested activation improvement. | Publish the transparent AI visibility tools comparison. Refresh the exact DataForSEO keyword set. | Submit the Anthropic connector, plus GitHub/release metadata, AlternativeTo, OpenSourceFest, OpenSaaSDirectory, and SaaSHub. | Ten design partners are active and directory traffic is attributed where the platform exposes a trackable path. |
| 5 | Review provider cost per activated workspace. Package the refd MCP app for OpenAI distribution without adding financial tools. | Publish the LLM visibility guide and public glossary foundation. | Submit the OpenAI app/plugin package. Post the technical build story on DEV and r/CloudFlare. Participate in relevant Reddit threads without link dropping. | At least three users return after a fresh run, and both priority client-directory submissions are in review. |
| 6 | Fix retention friction and create an in-product feedback path. | Publish mentions versus citations and the repeated-sampling methodology. | Post in the current r/selfhosted new-project thread. Ask successful users for specific, honest feedback. | Two usable testimonials and one case-study candidate exist. |
| 7 | Freeze the demo and launch build. | Strengthen internal links, metadata, structured data, and comparison evidence. | Launch Show HN. Stay present for questions and log objections verbatim. | Launch traffic is measured through activation, not visits alone. |
| 8 | Address the top launch objection. | Publish Google AI Mode versus AI Overviews and refresh pages using Search Console data if available. | Create G2 and remaining free software profiles. Continue 10 qualified outbound contacts per week. | At least one repeatable acquisition message is emerging. |
| 9 | Add only the smallest feature required by qualified prospects. | Publish the prompt-set playbook. Freeze the benchmark cohort, prompts, surfaces, and methodology. | Recruit two agency design partners and five benchmark distribution partners. | Benchmark collection can run without changing the methodology. |
| 10 | Validate hosted willingness to pay with explicit offers. | Publish the benchmark and downloadable methodology/data. | Pitch the finding, not the product, to targeted newsletters and writers. | At least five credible external pitches are sent and tracked. |
| 11 | Start charging founding customers if the offer is ready. | Publish the AI share-of-voice glossary and one customer story. | Launch on Product Hunt only if the demo, three testimonials, clear offer, and reliable onboarding exist. Otherwise postpone it. | Five paid or explicit founding-customer commitments are in reach. |
| 12 | Improve the highest-converting path only. | Publish a second case study and refresh the comparison page. | Run focused agency and B2B SaaS outreach using proof from the benchmark. | Twenty workspaces show four-week use or a clear path to it. |
| 13 | Review cohort retention, cost, and channel attribution. | Re-run DataForSEO, record ranking movement, and select the next cluster. | Stop low-quality listings and channels. Write the next 90-day plan. | One primary acquisition channel and one supporting channel are selected. |

Space Hacker News, Reddit, and Product Hunt launches apart. Each should incorporate what you learned from the previous one.

## 14. Additional tools and MCP access

No additional MCP is required to finalize this strategy. DataForSEO, the repository, and current web research are enough for the initial plan.

The most valuable connections for operating and correcting the strategy are:

| Priority | Connection | Why it matters | When to add |
|---:|---|---|---|
| 1 | Google Search Console, read-only | Real queries, impressions, page indexing, canonical problems, and page-level click-through rate | As soon as the public pages and sitemap exist |
| 2 | Product analytics such as PostHog or GA4, read-only access after instrumentation | Connects acquisition source to onboarding, first report, answer inspection, return use, and paid conversion | Week 1 |
| 3 | Cloudflare Web Analytics or request analytics | Validates traffic, geography, referrers, and public-page performance without replacing product events | Week 1–2 |
| 4 | CRM or working database such as HubSpot, Attio, Notion, or Google Sheets | Makes interviews, design partners, objections, follow-ups, and channel attribution queryable | When outreach exceeds roughly 25 active conversations |
| 5 | Stripe, read-only | Connects plan, revenue, failed payments, and churn to acquisition and usage cohorts | When the hosted plan starts charging |

DataForSEO already covers the near-term need for keyword, SERP, competitor, and backlink research. An Ahrefs or Semrush MCP would be useful only for cross-validation or proprietary datasets; it is not necessary now. A Reddit posting MCP is also unnecessary. Reddit should remain founder-led, community-specific, and manually reviewed rather than automated.

At day 30, DataForSEO backlink tools can be used to compare referring domains for Otterly, Peec, Profound, and the top-ranking editorial pages. That will produce a focused outreach list after refd has something genuinely linkable, preferably the methodology or benchmark.

## 15. Metrics and 90-day targets

Define an activated workspace as one that:

1. Completes onboarding.
2. Receives its first report.
3. Opens at least one underlying answer or citation.
4. Returns after another monitoring run.

Track:

- Visitor → account creation.
- Account → onboarding complete.
- Onboarding → first report.
- First report → second-week return.
- Weekly active business workspaces.
- Provider cost per active workspace.
- Hosted conversion.
- Signups and activations by source.
- GitHub stars, forks, issues, and contributors.
- Indexed public pages, non-brand ranking queries, and relevant referring domains.
- Organic impressions and clicks by content cluster.
- Content-assisted activation, not merely page views.
- MCP authorizations by client family.
- Authorization → first successful tool call, ideally within 24 hours.
- Connected workspaces that use MCP again after a subsequent completed run.
- Connector revocations, inactive grants, and the tool categories used, without recording tool arguments or returned workspace data.
- MCP landing-page referrals and directory deep-link attribution where a platform exposes a trackable path.

Reasonable 90-day operating targets:

- 30 customer interviews.
- 15 active design partners.
- 60 qualified completed onboardings.
- 20 workspaces still actively used after four weeks.
- 5 paid or explicit founding-customer commitments.
- 3 testimonials and 2 case studies.
- 100 GitHub stars.
- 3 external contributors or meaningful community PRs.
- 12 high-quality SEO assets, including one original research report.
- All core public pages indexed and free of canonical or crawl errors.
- The domain-verified refd server is published in the official MCP Registry.
- Anthropic and OpenAI directory submissions are completed with review-ready documentation and accounts.
- 10 relevant new referring domains.
- 10 non-brand queries in Google’s top 50 and 3 in the top 20.

Use these as internal funnel targets, not claimed industry benchmarks:

- At least 60% of qualified registrations complete onboarding.
- At least 80% of completed onboardings receive a first report.
- At least 50% of first-report users inspect an underlying answer or citation.
- At least 30% of activated workspaces return after a subsequent run.

The north-star metric should be **weekly returning workspaces with fresh completed runs**, not signups, page views, or automated runs that nobody reads.

The highest-priority next actions are: instrument the product and MCP funnels, smoke-test the merged production safeguards and live connector flow, create the public demo, publish the first release, add the crawlable evaluation, privacy, and MCP pages, verify downstream ingestion of the official Registry entry, recruit ten design partners, and only then start the broader public launch sequence.

## 16. refd as an MCP provider

Section 14 covers the MCP connections refd consumes to operate and correct this strategy. This section covers the opposite: refd now exposes its own production remote MCP server, so external AI assistants can read a workspace’s AI visibility data over a standard protocol.

Layer 1 of `docs/plan-agent-native.md` is shipped. The implementation in `docs/plan-mcp.md` provides:

- A public Streamable HTTP endpoint at `https://refd.ai/api/mcp`.
- OAuth 2.1 authorization-code flow with S256 PKCE and Dynamic Client Registration.
- One human-selected workspace per grant.
- One read-only `data:read` scope.
- Nine tools for workspace orientation, visibility, competitors, prompts, sources, changes, result lookup, answer evidence, and a full digest.
- A metric-glossary resource.
- Connected-app listing and revocation in Settings.
- Correct protected-resource and authorization-server discovery.

The production protected-resource endpoint returns its metadata, and an unauthenticated MCP request returns `401 Unauthorized` with the RFC 9728 discovery challenge expected by clients and marketplace scanners. The homepage serves Markdown when requested and advertises the protected-resource description through an RFC 8288 `Link` header, while `_mcp._agents.refd.ai` publishes a DNSSEC-signed DNS-AID ServiceMode record. These direct-discovery signals pass the agent-readiness scanner. The domain-verified `ai.refd/refd` version `0.1.0` entry is active in the official MCP Registry. The protocol and canonical listing surfaces are ready. Reviewed distribution is not: refd still has no public MCP landing page, public privacy policy, review account, or OpenAI plugin package.

### What is exposed, and why it is safe to publish

An agent authenticates through OAuth, the person authorizing it selects one workspace to grant, and the resulting token can only ever read that one workspace. The exposed tools return visibility, competitor, prompt, source, change, digest, and ownership-checked answer evidence. No tool mutates data or triggers a paid provider run. This read-only, single-workspace, human-authorized posture is what makes public listing safe: a listed server cannot be used to spend refd’s collection budget or to reach another customer’s data. Keep that posture as the precondition for the first public listings.

### Positioning

Lead with measurement integrity, exactly as section 2 prescribes. The MCP server is a complementary wedge, not a replacement homepage category:

> Connect your refd workspace to Claude, ChatGPT, and other MCP clients to analyze AI visibility, competitors, source gaps, and the answer evidence behind every metric.

The coherent narrative is that the product which measures a brand’s presence in AI answers is itself operable by AI assistants. Use that story in technical distribution and connector listings, but do not claim to be the first or only AI visibility product with an MCP server. Keep the public-copy rule against pairing refd with “aeo.”

### An honest caveat on acquisition

The current connector requires a person to have an account, complete onboarding, and authorize an existing workspace. A directory listing can generate awareness and registrations, but the agent cannot take a new prospect from discovery to a populated report by itself. In the first release, MCP distribution is primarily:

- Activation and retention for existing users.
- A lower-friction way to interrogate fresh workspace data.
- Technical credibility and an open-standard proof point.
- A top-of-funnel path whose conversion still finishes in the human product.

Do not forecast MCP registry impressions as autonomous acquisition. Layers 2–4 in `docs/plan-agent-native.md` are what later add setup, paid runs, and agent-assisted provisioning. Measure the current distribution surface now without pretending those later layers already exist.

### Preserve a directory-safe boundary

The listed `https://refd.ai/api/mcp` endpoint should remain read-only through the first directory-review cycle. Future non-financial setup tools can be evaluated as separately annotated write tools, but payment and asset-transfer tools must not be added to the listed catalog.

Anthropic’s current review criteria reject connectors that transfer money, cryptocurrency, or other financial assets. OpenAI’s current App Developer Terms prohibit apps from initiating, executing, or otherwise facilitating money or cryptocurrency transfers through its services, while permitting qualifying checkout to finish on an external site. The Stripe and x402 concepts in `docs/plan-agent-native.md` therefore need a separate distribution boundary:

- Keep the marketplace-listed `/api/mcp` endpoint focused on workspace data and, only after a new review, non-financial setup actions.
- Put autonomous payment and paid-run orchestration on a separate unlisted agent endpoint or API.
- For a listed OpenAI app, direct an eligible card checkout to refd’s own website rather than handling payment through a tool.
- Never expose x402 cryptocurrency transfer tools through the Anthropic- or OpenAI-listed catalog.

This separation protects directory eligibility without weakening the agent-native plan. The paid autonomous endpoint can still reuse the same tenancy, grant, entitlement, and audit primitives.

### Current listing readiness

| Requirement | Current state | Action |
|---|---|---|
| Public HTTPS Streamable HTTP endpoint | Ready | Keep `https://refd.ai/api/mcp` stable. |
| OAuth discovery and unauthenticated `401` challenge | Ready | Monitor it as a production synthetic check. |
| Homepage Markdown negotiation | Ready | Keep `text/markdown` and HTML representations cache-safe with `Vary: Accept`. |
| Homepage `Link` discovery | Ready | Keep the protected-resource service description and `llms.txt` links valid. |
| DNS-AID | Ready, experimental | Maintain the DNSSEC-signed `_mcp._agents.refd.ai` SVCB record and monitor the evolving draft. |
| Tool titles and read-only annotations | Ready | Preserve accurate `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` metadata. |
| End-to-end client validation | Partly ready | The full OAuth flow has been user-tested; record one final production connection and successful tool call from each priority client used in a submission. |
| Public MCP documentation | Missing | Publish `/mcp` or `/docs/mcp` as crawlable HTML. The authenticated `/help/mcp` page and GitHub markdown do not satisfy this alone. |
| Public privacy, terms, security, and support URLs | Missing | Publish them before reviewed-directory submission. Explain connector data collection, use, storage, sharing, retention, revocation, and contact details. |
| Populated review account | Missing | Create a dedicated, non-customer workspace with realistic prompts, completed runs, citations, competitors, and answer evidence. |
| Listing assets and test cases | Missing | Prepare the reusable kit below. |
| Official Registry `server.json` | Published | `ai.refd/refd` version `0.1.0` is active. Bump the immutable version for every later metadata change. |
| MCP funnel analytics | Missing | Instrument authorization, first tool call, client family, repeat use, and revocation before submissions go live. |

Do not submit an empty or thin review workspace. Reviewers need successful responses from every tool, including result lookup and answer evidence, without seeing customer data.

### Canonical publishing sequence

Steps 2–4 are complete for version `0.1.0`: `server.json` is validated, HTTP
domain ownership is proven through `/.well-known/mcp-registry-auth`, and
`ai.refd/refd` is active in the official Registry. Keep the sequence below for
future versions and downstream distribution.

1. **Publish the public foundation.** Ship `/mcp`, `/privacy`, `/terms`, `/security`, and a support contact. Add every canonical public page to `INDEXABLE_PUBLIC_PATHS` and the generated sitemap.
2. **Add `server.json`.** Use a semantic version and the domain-authenticated name `ai.refd/refd`, with:
   - title `refd`
   - a narrow, buyer-facing description
   - `streamable-http`
   - remote URL `https://refd.ai/api/mcp`
   - website, repository, and icon metadata where the current schema supports them
3. **Verify domain ownership.** Prefer the official Registry’s DNS or `/.well-known/mcp-registry-auth` flow over a GitHub-user namespace so the listing belongs to the product domain.
4. **Publish to the official MCP Registry.** Registry metadata is versioned and immutable per publication, so review every field before publishing and issue a new semantic version for later metadata changes. The Registry is in preview, so keep `server.json` in the repository and make republishing repeatable. [Remote-server publishing](https://modelcontextprotocol.io/registry/remote-servers), [authentication](https://modelcontextprotocol.io/registry/authentication), [versioning](https://modelcontextprotocol.io/registry/versioning).
5. **Verify downstream ingestion.** The official Registry is primarily a metadata source for aggregators. Check whether the major directories ingest the canonical entry before creating duplicate manual listings. [Registry aggregator guidance](https://modelcontextprotocol.io/registry/registry-aggregators).
6. **Submit to reviewed client directories.** Use the same review workspace, policy URLs, listing copy, and test cases, adapted to each platform’s form.

The public MCP page should provide:

- The production endpoint and one-click/manual connection instructions.
- Plain-language `data:read` permission and single-workspace boundary.
- The complete tool and resource catalog.
- Supported date ranges.
- How to revoke a connection.
- How answer evidence must be treated as untrusted third-party content.
- Four concrete workflows:
  1. “Compare our visibility with every tracked competitor over the last 30 days.”
  2. “Find the buyer questions where our brand has zero visibility.”
  3. “Show the source domains cited when competitors appear and we do not.”
  4. “Read the answer evidence behind the largest recent change.”
- Links to privacy, security, support, status if available, GitHub, and self-hosting documentation.

### Where to list

Recheck each platform’s rules immediately before submission, as in section 5. Marketplace policies, packaging, and review portals are changing quickly.

| Platform | Priority | Recommended action |
|---|---:|---|
| Official MCP Registry (`registry.modelcontextprotocol.io`) | Essential, published | `ai.refd/refd` version `0.1.0` is active. Monitor the entry and verify downstream marketplace ingestion before creating duplicate submissions. |
| Anthropic Connectors Directory | High | Submit the remote connector through a Team or Enterprise organization once public docs, policy URLs, listing assets, and the populated test account are ready. The current tools already have the required titles and read-only annotations. Exercise every tool through MCP Inspector and Claude before submitting. [Submission requirements](https://claude.com/docs/connectors/building/submission), [review checklist](https://claude.com/docs/connectors/building/review-criteria). |
| OpenAI apps and Plugins Directory | High | Package refd’s MCP app for the current public submission path. Because plugins are now the primary discovery surface across ChatGPT and Codex, pair the app with a narrow skill that teaches the four evidence-based workflows above. Keep financial tools out, provide a clear privacy policy, and supply accurate test instructions and directory metadata. [Apps and plugin discovery](https://help.openai.com/en/articles/11487775-apps-in-chatgpt), [App Developer Terms](https://openai.com/policies/developer-apps-terms/). |
| Smithery (`smithery.ai`) | Medium | Publish the existing public HTTPS URL after the canonical metadata and public policies are live. Its scanner supports OAuth discovery from a correct `401` response. Add `/.well-known/mcp/server-card.json` only if authenticated scanning cannot complete or if a stable static catalog improves the listing. [Publishing guide](https://smithery.ai/docs/build/publish). |
| PulseMCP, Glama, mcp.so, MCP Marketplace, and similar aggregators | Low | Check for ingestion from the official Registry first. Claim or enrich automatically created pages where useful; submit manually only when the directory has a relevant audience or measurable install path. Do not pay for generic placement before it produces activated workspaces. |
| Cloudflare ecosystem | Content channel, not a listing | No general third-party Cloudflare MCP marketplace submission path is currently verified. Use the one-Worker architecture for a technical case study, DEV article, Cloudflare community post, and potential Cloudflare customer story instead. Cloudflare’s published catalog currently describes its own managed servers. [Cloudflare MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/). |

### OpenAI packaging

Treat the OpenAI submission as a small product package, not merely a pasted endpoint:

- **App:** the OAuth-protected remote MCP server.
- **Skill:** concise workflow guidance for visibility overview, competitor benchmarking, prompt-loss analysis, source gaps, and evidence lookup.
- **No duplicated calculation logic:** the skill teaches sequencing and interpretation; all data still comes from refd tools.
- **No financial tools:** payment and x402 stay outside the listed package.
- **Directory metadata:** category, short and long descriptions, example prompts, support, privacy, terms, geographic availability, and test instructions.

Do not add interactive UI only to qualify for a listing. The read-only analytical workflow already has standalone value. Add an MCP App UI later only if a chart, comparison table, or evidence panel materially improves the in-chat task.

### Reusable MCP listing kit

Prepare this once and adapt it per platform:

- 15-word, 50-word, and 150-word descriptions.
- Square icon and monochrome-safe logo assets in the required sizes.
- One-line explanation of who it is for.
- One-line explanation of why the permission is read-only and workspace-scoped.
- Public MCP, privacy, terms, security, support, GitHub, and self-hosting URLs.
- A dedicated reviewer email and populated test account.
- The four representative workflows above, plus expected tool sequences and successful outcomes.
- A negative test showing that a token cannot read another workspace.
- A revocation test showing that disconnected access and refresh tokens stop working.
- Current server version, endpoint, scope, transport, and supported clients.
- A short change-management policy: tool/schema changes are tested against priority clients and directory snapshots are refreshed where required.

### Measurement

Use an MCP-specific funnel:

1. Public MCP page or directory listing viewed, where the platform exposes it.
2. OAuth authorization started.
3. Connection grant created.
4. First successful tool call.
5. A second tool call in a later session.
6. Tool use after a subsequent fresh monitoring run.

Record the OAuth client family from validated client metadata and aggregate tool names, timing, outcome, and connection lifecycle. Do not record tool arguments, prompt text, answer text, or returned workspace data for marketing analytics.

Do not promise attribution that the protocol cannot provide. A registry entry usually does not send its source through OAuth. Attribute a marketplace only when it offers a UTM-capable landing link, deep link, referral header, or distinct client identity. Otherwise report “Claude,” “ChatGPT,” “Smithery,” or “other MCP client,” not a fabricated registry source.

Apply the same 60-day rule as section 5: a listing that produces no first tool calls or activated workspaces gets no paid promotion. Directory acceptance itself is not success. The north-star metric in section 15 remains weekly returning workspaces with fresh completed runs; an MCP connection matters only when it helps drive that behaviour.

### Distribution content

Produce three reusable pieces without displacing the buyer-focused first twelve assets:

1. **Product guide:** “Connect your refd workspace to Claude or ChatGPT.”
2. **Workflow guide:** “Four AI visibility questions to ask your refd data.”
3. **Technical build story:** “How refd serves a React app, OAuth provider, and remote MCP server from one Cloudflare Worker.”

The product guide is the canonical destination for listings. The workflow guide demonstrates user value rather than protocol mechanics. The build story serves DEV, GitHub, r/CloudFlare, and Cloudflare customer-story outreach.

### What does not block listing

Do not delay the first listings for the entire agent-native roadmap:

- `/.well-known/agent` remains experimental and is not a substitute for the official Registry.
- An OpenAPI catalog is useful once refd exposes a broader agent-facing HTTP API, but MCP directories inspect the MCP tool schemas directly.
- DNS-AID is already published and validated, but remains a supplementary experimental signal rather than a substitute for the official Registry.
- Web Bot Auth, x402, A2A, autonomous provisioning, and MCP write tools are separate bets.
- A Smithery-specific static server card is optional while normal OAuth scanning works.

The immediate discovery stack is smaller: the already-shipped OAuth metadata, Markdown negotiation, homepage `Link` headers, DNS-AID record, and versioned official Registry entry, followed by public HTML and policies, reviewed client-directory packages, and measurable activation.
