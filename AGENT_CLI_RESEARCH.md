# Designing tools that agents and humans can use reliably

## Evidence-backed recommendations for an asset-processing CLI

**Research date:** October 19, 2026.

**Bottom line:** Build a well-specified, inspectable processing API with a thin, noninteractive CLI, not a conversational wrapper around an opaque processor. Give agents compact but sufficient observations, operations that accomplish meaningful work, deterministic validation, recoverable errors, and reliable ways to discover capabilities and verify results. Preserve human usability through readable presentation, previews, and control over consequential actions. The strongest evidence supports these interaction properties; it does **not** establish that CLI beats MCP universally, that JSON should be replaced by TOON, or that greater autonomy is inherently better.

The recommended starting architecture is **one processing core and contract, with human-readable CLI output and an explicit machine-readable mode**. Add an SDK or MCP adapter when an actual integration needs one. This architecture is an engineering synthesis of the evidence below, not an architecture proven superior in a controlled trial.

### Which conclusions are strong enough to design around?

| Decision                                                                   | Strength and kind of support                                                                                                                    | Recommendation                                                                                                                                    |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit types, units, defaults, prerequisites, effects, and compatibility | Established contract practice; corroborated by human API studies and agent evaluations [S1, S13, S16, S21, S22, S33, S34]                       | Make this the baseline. Valid syntax alone does not establish correct semantics or authorization.                                                 |
| Visible outcomes, validation, and safe recovery                            | Direct ACI ablations, stateful benchmarks, and mature API semantics [S1, S4, S5, S17, S18, S38]                                                 | Verify committed artifacts and report partial or unknown outcomes explicitly.                                                                     |
| Enforced permissions and conservative mutation defaults                    | Foundational protection principles, protocol guidance, and documented attacks [S7, S15, S23, S39]                                               | Enforce boundaries outside model-generated instructions. Treat approval UX and actual authority as different mechanisms.                          |
| Concise results with sufficient context and expansion                      | Task-specific ACI evidence, newer tool-output experiments, indirect context research, and human documentation trade-offs [S1, S3, S35, S44]     | Prefer a useful summary plus detail access. Do not minimize output regardless of what the next action needs.                                      |
| Workflow-sized operations and deterministic composition                    | Multiple agent studies support composition, with counterexamples for simple extraction [S1, S2, S44, S47]                                       | Provide batches/manifests for repeated work. Test exact operation boundaries; neither maximum granularity nor one giant tool is a proven optimum. |
| Worked examples and task-oriented discovery                                | Human experiments and field evidence; newer agent documentation ablations; provider guidance remains conditional [S12, S13, S32, S33, S34, S45] | Supply correct, executable examples where they remove ambiguity. Measure which examples belong in the agent's initial context.                    |
| Names, descriptions, and discovery                                         | Controlled naming/wording interventions and a large retrieval benchmark [S42, S43, S46]                                                         | Use factual descriptions and recognizable names. Test discovery separately; selection frequency is not usefulness.                                |
| Canonical JSON and a thin CLI over a shared core                           | Strong interoperability rationale, but no retrieved matched experiment establishes this architecture as the winner [S14, S16, S22, S37, S40]    | Use as a simple starting design, not as a scientific conclusion about model preferences.                                                          |
| TOON, CLI over MCP, exact response limits, fixed tool-count limits         | Insufficient general comparative evidence [S6, S24, S29]                                                                                        | Keep these as local experiments, not requirements justified by consensus.                                                                         |

The strongest agreement is about **clear contracts, feedback, controlled effects, and evaluation**, not a particular serialization or transport. Agreement here means convergence across several kinds of evidence. It does not mean a meta-analysis found a common effect size, that the cited studies are independent replications, or that all designers endorse the same defaults.

For agents, "works well" is measured through correct completion, recovery, latency, and cost. Human comfort, comprehension, and confidence require human evaluation; agent success rates do not establish them. [S8, S41]

## 1. Scope, method, and evidence quality

### What this investigation addresses

The target is an interface used by an LLM agent, a human operating directly, or a human supervising an agent. Asset and image processing are the intended application, but most research reviewed concerns software engineering, general tool use, retrieval, and human-AI interaction.

The investigation distinguishes five things that are often conflated:

1. **Capability semantics:** what an operation does, its prerequisites, effects, and guarantees.
2. **Discovery and documentation:** how a caller learns which operations exist and how to use them.
3. **Action representation:** shell arguments, typed function calls, or executable code.
4. **Observation representation:** the results, errors, summaries, and artifacts returned to the agent.
5. **Transport and integration:** local subprocess, HTTP, SDK, or MCP.

A study finding that executable Python actions outperform a particular JSON action protocol does not establish that JSON result data is bad. A wrapper outperforming an MCP server does not isolate transport if the wrapper also changes operations, summaries, documentation, and output.

### Method

This is a **targeted critical evidence review**, not a systematic review or meta-analysis. Sources were selected for direct relevance to interface design, traceability to original authors or standards bodies, experimental detail, and accessible primary artifacts. The investigation read papers and publication records, official specifications, first-party engineering reports, and public GitHub benchmark configuration and grading code. GitHub CLI search and repository-tree inspection were used to locate AXI's evaluation artifacts.

The general web-search tool was unavailable during this session. Research therefore used direct primary-source retrieval and citation-following rather than a comprehensive search-index sweep. No private code, personal work data, or application repositories were needed. Published experiments were inspected, not rerun.

The second pass deliberately added older human API-usability experiments, newer human-documentation evidence, six reviewed 2025-2026 agent-interface papers, foundational protection and interoperability sources, and research on evaluation failure. It sought negative results and limits as well as corroboration, including cases where concise descriptions, renamed parameters, or generated code performed worse. Publisher metadata and primary papers were checked where accessible. Unavailable full texts were not used to infer uninspected results.

### How to interpret the labels

| Evidence label                    | Meaning                                                                            | What it does not establish                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Peer-reviewed experiment**      | A published study with a specified task, model, and evaluation setup               | That its effect size transfers to current models or asset pipelines              |
| **Peer-reviewed human study**     | An experiment, survey, or qualitative study of people using APIs or AI systems     | That its human results transfer directly to LLM agents                           |
| **Research preprint / benchmark** | Primary scholarly work, with publication status not independently established here | The same review status as a verified conference or journal publication           |
| **Foundational design paper**     | A published technical argument grounded in system-design experience                | A controlled effect estimate for a modern agent interface                        |
| **First-party empirical report**  | Measurements reported by a tool builder or model provider                          | Independent replication, complete experimental disclosure, or a universal result |
| **Specification / API guidance**  | An authoritative contract or established engineering recommendation                | Experimental proof of an agent-performance improvement                           |
| **Design inference**              | A recommendation derived from the preceding evidence and application constraints   | A direct research finding                                                        |

**Confidence throughout this report concerns the recommendation's support and transferability, not a numerical probability.** “High” does not mean every implementation choice has been experimentally isolated.

## 2. The most decision-relevant scholarly evidence

### 2.1 SWE-agent: interface design can change success without changing model weights

**Source:** Yang et al., _SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering_, NeurIPS 2024. The official proceedings verify the venue; the paper supplies the experiments. [S1]

This is an especially relevant early study because it experiments with the interface between an agent and a computer, rather than only training a better model. Its ACI combines search, a file viewer, an editor, validation feedback, and context management.

On the 300-task SWE-bench Lite set, the reported GPT-4 Turbo results include:

| Configuration                          | Resolved tasks | Interpretation                                                          |
| -------------------------------------- | -------------: | ----------------------------------------------------------------------- |
| Shell-only agent with demonstration    |          11.0% | Baseline using ordinary shell interaction                               |
| SWE-agent ACI                          |          18.0% | A 7.0 percentage-point improvement over that shell baseline             |
| ACI editor without linting             |          15.0% | Validation/guardrail removal reduced performance                        |
| No custom edit action                  |          10.3% | Requiring lower-level editing operations reduced performance            |
| Iterative, one-result-at-a-time search |          12.0% | A familiar human interaction pattern worked poorly for these agents     |
| Summarized search                      |          18.0% | Compact overview supported better navigation                            |
| Viewer with 30 lines                   |          14.3% | Too little context also hurt                                            |
| Viewer with 100 lines                  |          18.0% | Best of these reported viewer variants                                  |
| Viewer with full file                  |          12.7% | More output was not necessarily better                                  |
| Full observation history               |          15.0% | Retaining all observations underperformed the selected history strategy |

**Citation precision:** These values come from Tables 1 and 3 and Section 5.1. The paper also reports a 7.33% shell baseline **without** demonstration. Its introduction's approximately 10.7-point improvement corresponds to comparison with that weaker variant. The more conservative 18% versus 11% comparison is preferable when discussing the interface bundle. [S1]

**What to take from it:**

- Expose meaningful operations instead of making agents reconstruct them from cumbersome primitives.
- Return the effect of an operation immediately when practical.
- Validate before committing an invalid change.
- Summarize large search spaces and support targeted follow-up.
- Optimize for **sufficient context**, not minimum tokens at any cost.

**Limits:** This is coding with older model snapshots, not image processing. The full ACI comparison bundles several changes. The ablations provide more specific evidence, but their exact sizes and chosen thresholds are not universal design constants. Do not turn “100 lines worked here” into “100 rows is optimal everywhere.”

### 2.2 CodeAct: composition can be more important than the surface syntax of a single call

**Source:** Wang et al., _Executable Code Actions Elicit Better LLM Agents_, ICML 2024, PMLR 235:50208-50232. [S2]

The paper studies executable Python actions versus text/JSON action formats across 17 LLMs. It includes atomic API-Bank calls and M3ToolEval, a set of 82 human-curated tasks requiring composition across tools.

For more complex tasks, the paper reports **up to 20 percentage points higher success and up to 30% fewer actions** relative to its baselines. These are best-case improvements across studied configurations, not average promises for a new system. The atomic-call experiment removes the control/data-flow advantage and finds code generally comparable or better for many models. [S2, Sections 2.2-2.3]

**Why it matters:** A model should not need to deliberate once per image to apply the same deterministic transformation to 1,000 images. A batch manifest, a small SDK, or a processing plan can move loops, joins, filtering, and intermediate data handling out of the model context.

**What it does not prove:**

- It does not compare JSON versus TOON as **tool-result serialization**.
- It does not prove an unrestricted Python interpreter is the right public interface.
- It does not establish that every task benefits from an added code-execution layer.

**Design inference:** Supply constrained composition first: batches, manifests, named presets, and predictable per-item results. An SDK is useful when callers need richer control flow. If arbitrary code execution is added, sandboxing and permissions are separate requirements.

**Later corroboration and counterevidence:** Ding et al.'s ACL 2025 _ToolCoder_ independently reimplements CodeAct as a comparator. With GPT-4o-mini, CodeAct has higher reported scores than ReAct on several task/metric combinations, but lower API-Bank LV2 correctness, 54.07% versus 56.30%. This is a conceptual replication in different systems and benchmark settings, not a same-budget isolation of action syntax. It strengthens the case for testing code-based composition, not for requiring it everywhere. Newer output-processing experiments also find different results for extraction versus aggregation; see Section 2.11. [S47, Table 1; S44]

### 2.3 Lost in the Middle: available context is not the same as usable context

**Source:** Liu et al., _Lost in the Middle: How Language Models Use Long Contexts_, TACL 12:157-173, 2024, DOI `10.1162/tacl_a_00638`. [S3]

The authors manipulate relevant information's position in multi-document question answering and key-value retrieval. Performance can degrade when the relevant information is in the middle of a long context, including for models designed for long contexts.

**Implication:** Returning an entire asset catalog and expecting the agent to find the two relevant items is not an adequate interface simply because it fits in the context window. Prefer filtering, projection, meaningful summaries, and detail retrieval.

**Limits:** This is not a tool-use or CLI experiment, and model capabilities have changed since the study. It supports caution about information placement and irrelevant context, not a universal response-token threshold.

### 2.4 ToolSandbox: state dependencies and recovery need to be part of evaluation

**Source:** Lu et al., _ToolSandbox: A Stateful, Conversational, Interactive Evaluation Benchmark for LLM Tool Use Capabilities_, Findings of NAACL 2025, pp. 1160-1183. The second pass verified the publication in ACL Anthology; the detailed text inspected was arXiv `2408.04682`, version 2, alongside Apple's implementation. [S4]

ToolSandbox models mutable world state, implicit dependencies between tools, user conversations, and intermediate milestones. It uses **milestones and minefields**, allowing evaluation of both required progress and forbidden behavior. State dependency, canonicalization, and insufficient information remain challenging categories in its evaluation.

**Implications for processing tools:**

- Make prerequisites visible: decoder unavailable, destination read-only, job still running, plan stale.
- Test sequences, not only individual argument schemas.
- Check forbidden side effects, not only whether the requested output exists.
- Test ambiguous input and recoverable failures.

**Limits:** The simulated domains and user simulator are not representative of every production workflow. This is stronger support for evaluation design than causal evidence for a particular CLI design.

**Source-reading caution:** The ToolSandbox paper's characterization of other benchmarks reflects its authors' framing and benchmark versions. This report relies on each benchmark's own description for its evaluator, rather than adopting cross-paper comparisons uncritically.

### 2.5 Tau-bench: one successful run is not reliability

**Source:** Yao et al., _Tau-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains_, arXiv `2406.12045`, inspected version 1. Treated as a primary research preprint here. [S5]

Tau-bench evaluates agents interacting with domain APIs, policies, and simulated users. It compares the final database state against a goal state and introduces **pass^k** to measure consistency across repeated trials.

The paper's introduction reports approximately 61% pass^1 on retail and 35% on airline for its GPT-4o function-calling setup; retail pass^8 is approximately 25%. Its abstract summarizes performance differently. The reliable takeaway is the large loss of **consistent success across repeats**, not a timeless “agents succeed less than half the time” headline. [S5, Section 1]

**Important distinction:**

- **pass@k:** success in at least one of k attempts, often an optimistic capability measure.
- **pass^k:** success in all k trials, a measure of consistency.

**Implication:** Evaluate whether the interface repeatedly leads to correct artifacts and safe state changes, not whether a polished demonstration can succeed once.

**Limits:** These are historical model results in customer-service domains. Final-state verification also needs supplementary checks for forbidden intermediate actions, leakage, or writes later undone.

### 2.6 InjecAgent: tool results are an attack surface

**Source:** Zhan et al., _InjecAgent: Benchmarking Indirect Prompt Injections in Tool-Integrated Large Language Model Agents_, Findings of ACL 2024. The publication page reports 1,054 test cases, 17 user tools, 62 attacker tools, and evaluation of 30 LLM agents. [S7]

The benchmark demonstrates that malicious instructions embedded in external tool content can redirect agents. Its abstract reports a 24% attack success rate against one ReAct-prompted GPT-4 setup.

**Implication:** Filenames, EXIF comments, SVG text, error messages from dependencies, and downloaded manifests must be treated as data, not instructions or authorization. An agent-facing interface should not convert such content into privileged “next steps.”

**Limits:** The reported attack rate is configuration-specific. Structured JSON and escaping improve data handling but are not a complete defense against prompt injection. Real protection requires boundaries around tools and permissions.

### 2.7 Human-AI interaction: human usability is more than pretty terminal output

**Source:** Amershi et al., _Guidelines for Human-AI Interaction_, CHI 2019, DOI `10.1145/3290605.3300233`. The primary paper describes iterative development of 18 guidelines, including a study with **49 practitioners evaluating 20 AI-infused products**. [S8, pp. 1, 3-7]

Relevant guidelines include making capabilities and limitations clear, displaying contextually relevant information, supporting dismissal and correction, scoping behavior under uncertainty, explaining behavior, and providing global controls.

**Implications:**

- Show what will change before irreversible work.
- Offer easy cancellation and correction.
- Preserve the original inputs unless replacement was explicitly authorized.
- Provide an auditable summary of what happened and why a preset was selected.
- Make automation limits configurable by the human owner.

**Limits:** This was practitioner-based heuristic evaluation and refinement of guidelines, not a randomized trial proving a specific CLI design improves satisfaction or agent accuracy. It supports the human-supervision requirements, not a claim that humans and agents prefer identical interfaces.

ISO 9241-11:2018 supplies an established human-usability framework, not a recipe for a particular interface. Its public abstract treats usability as an outcome of use; NIST's official glossary reproduces its definition in terms of specified users, goals, effectiveness, efficiency, satisfaction, and context. For this project, evaluate a human using the CLI directly and a human supervising an agent as separate contexts. Do not apply human satisfaction measures to an LLM or treat agent accuracy as their substitute. The full ISO standard was not inspected; this use is limited to the public abstract and reproduced definition. [S41]

### 2.8 Counterevidence: “agent-first” does not require a large custom agent interface

Two primary sources caution against overgeneralizing SWE-agent:

- **Agentless** uses a prescribed localization, repair, and validation pipeline instead of an LLM choosing every action. Its inspected paper version reports strong results on SWE-bench Lite with a simpler setup. This is research-preprint evidence for considering deterministic workflows, not a controlled comparison isolating interface effects. Its historical leaderboard claim should not be treated as current. [S9]
- The **SWE-agent authors' current repository** directs users toward **mini-SWE-agent**. The mini project's documentation describes a bash-only agent, independent subprocess actions, and a linear history. This is first-party implementation evidence that simpler scaffolds can work well with later models; it is not a matched replication disproving the 2024 ACI findings. [S1b, S10]

**Practical conclusion:** Favor good contracts and simple execution. Add bespoke orchestration or specialized tools only when observed failures justify them. A stable asset CLI can be valuable precisely because a general shell-capable agent can already use it.

### 2.9 Human API-usability research supports semantics and findability before presentation novelty

Human API research gives the report a basis beyond agent benchmarks. Four studies are especially useful, with different strengths and limits.

**Method placement affects discovery.** Stylos and Myers' FSE 2008 experiment involved ten Java programmers performing three tasks using alternative API designs. Participants were randomly assigned to conditions for each task, with task order balanced. When the class programmers started from exposed the needed related operation, the authors reported 2.4-11.2-fold speedups in object-combination time across the three tasks; each comparison was reported as significant at `p < 0.05`. These are subtask times, not whole-task productivity multipliers. The small, demographically narrow sample and deliberately selected Java tasks limit generalization. [S32, Sections 4-6]

**Design implication:** Put operations and their prerequisites where callers reasonably look for them. A processing tool's `transform --help` should reveal how to inspect supported formats, supply inputs, and choose output policies. Do not require callers to guess an unrelated command name to discover an essential step. Applying the Java result to CLI discovery is an inference, not a tested CLI effect.

**Content failures matter more than cosmetic improvements.** Uddin and Robillard's _How API Documentation Fails_ reports two surveys of 323 IBM software professionals: 69 exploratory respondents and 254 validation respondents. The authors identified ten documentation problems and found ambiguity, incompleteness, and incorrectness most in need of attention. The surveys covered actual experiences but were self-reported, had nonresponse risk, and sampled one organization. They do not experimentally prove a particular documentation layout. [S33]

**Design implication:** Spend documentation effort first on missing semantics, ambiguous parameters, stale examples, and contradictions. A beautifully formatted schema is still inadequate if callers cannot tell whether dimensions are before or after EXIF orientation.

**Examples help when they supply missing operational information.** Sohan et al.'s VL/HCC 2017 study randomly assigned 26 experienced developers to original WordPress REST API documentation or an enhanced version containing three usage examples. The groups were unequal by design, with 16 and 10 participants. Participants attempted five scored tasks after a practice task. The authors reported better success, fewer trial calls, and higher satisfaction with examples. Reported tests gave `p = 0.0003` for success, `0.017` for trial calls, and `0.003` for satisfaction. The time comparison was `p = 0.051`, so the report does not treat it as conventionally significant at 0.05. [S34, Sections III-V]

The important limitation is also the practical lesson: examples clarified types, data formats, headers, and prerequisite calls that the original documentation did not sufficiently explain. This is not an isolated comparison against an equally complete, equally clear specification without examples. The authors explicitly identify that alternative comparison as future work. The study supports concrete operational examples, not a claim that adding examples always improves an already complete interface or improves every LLM.

**Different information needs favor different presentations.** Nassif and Robillard's peer-reviewed 2025 study observed 13 computer science students using documents that offered both interactive code-associated explanations and traditional text containing the same information. All participants received the same condition; this was not a randomized experiment assigning people to separate formats. Their qualitative findings favored the interactive format for short factual queries and traditional text for open-ended queries requiring synthesis. Participants could use the supplied documents, official API reference, and IDE information, but not unrestricted web search. They had limited time to learn the new format and sometimes found its replacement of familiar browser search behavior disruptive. [S35]

**Design implication:** Preserve a concise reference and a fuller explanation, with normal search and navigation intact. Progressive disclosure should reduce irrelevant reading without hiding the relationships needed to understand a workflow. This human study does not directly validate an agent's tool-discovery strategy.

These studies provide converging reasons to improve information quality and navigation. They test different interventions, involve overlapping research communities, and are not independent replications of one universal API-usability law.

### 2.10 Evaluate simple baselines under comparable budgets

**Source:** Kapoor et al., _AI Agents That Matter_, inspected arXiv v1, submitted July 2024. Treated as a research preprint here. [S36]

The authors re-evaluated coding-agent approaches alongside simple retry, temperature-increase, and model-escalation baselines on 164 modified HumanEval problems, running each approach five times. Their results show that accuracy-only rankings can conceal large cost differences and that simple baselines can rival more elaborate architectures in this setting. They also surveyed 17 agent benchmarks and identified inappropriate or missing holdouts and reproducibility problems. [S36, Sections 2, 5-6 and appendices]

**Implication:** Compare a proposed agent-first wrapper with an ordinary shell agent using good help, a deterministic script using the same processing core, and a simple batch interface. Give competing designs comparable budgets, permissions, and information. Report success together with cost and latency; allow an accuracy-cost trade-off to remain a trade-off.

**Limits:** HumanEval is a small-program benchmark, and the paper explicitly leaves open whether more complex reasoning helps on harder tasks. A retry that passed a coding test is also not permission to retry a non-idempotent asset operation. The transferable result is the need for strong baselines and fair evaluation, not that complex agents are generally useless.

### 2.11 Newer agent experiments narrow the recommendations

Five further peer-reviewed 2025-2026 studies directly test naming, descriptions, discovery, and output processing. Together with _ToolCoder_, they add evidence beyond the earlier coding papers and vendor reports. They still do not compare an asset CLI with MCP under matched conditions.

| Study                                                                                                       | Tested setup                                                                                                                               | Decision-relevant finding                                                                                                                                                                     | Important limit                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Faghih et al., EMNLP 2025, _Tool Preferences in Agentic LLMs are Unreliable_ [S42]                          | Functionally equivalent duplicate tools, edited descriptions, counterbalanced order; experiments across 17 models                          | Wording and position can shift which tool is used without improving its functionality. Selection frequency is not evidence of usefulness.                                                     | Correct-usage rates are not mutually exclusive choice shares; a model can invoke both tools. This is not a comparison of genuinely different processing capabilities.                                      |
| Lee et al., ACL 2026, _Don't Adapt Small Language Models for Tools; Adapt Tool Schemas to the Models_ [S43] | Controlled tool/parameter renaming with descriptions unchanged; four small models, several benchmarks and ablations                        | Names can affect correctness. Llama3.2-3B's MetaTool "Reliability" accuracy improves 43.6% to 60.6%; other model/task combinations regress.                                                   | End-to-end gains are smaller; most evidence concerns small English-schema models. A human naming study has three annotators, not hundreds of independent users.                                            |
| Kate et al., EACL 2026, _How Good Are LLMs at Processing Tool Outputs?_ [S44]                               | 1,298 questions from 50 templates over six REST endpoints; 15 models; direct answers versus generated Python, schema and response variants | Code has better overall accuracy for 13/15 models, but direct answers perform better on extraction for 10/15. Response schemas help code generation for 15/15, but direct answering for 7/15. | Output-processing benchmark, not whole-agent CLI use or JSON versus other encodings. Few templates, metric-dependent formatting effects, and acknowledged false positives from LLM judging limit transfer. |
| Fang et al., Findings of ACL 2025, _PLAY2PROMPT_ [S45]                                                      | Execution-based optimization of descriptions and examples; executable BFCL and StableToolBench evaluations with component ablations        | Documentation and examples can complement one another. The tested concise EasyTool baseline reduces GPT-4o's mean StableToolBench solvable pass rate from 62.8% to 60.5% in this setup.       | Not a pure length intervention. Tools, examples, content, and optimization change together; StableToolBench includes simulated/cached API behavior and LLM judging.                                        |
| Shi et al., Findings of ACL 2025, _Retrieval Models Aren't Tool-Savvy_ [S46]                                | ToolRet aggregates 34 datasets, 7,615 retrieval tasks and 43,215 tools; downstream agents also tested                                      | Discovery can bottleneck execution. On one ToolBench-G1 comparison, replacing oracle tools with retrieved tools reduces GPT-3.5's reported success from 62.0% to 50.6%.                       | Required-tool labels may miss valid alternatives across merged corpora. Target-aware generated instructions are an assisted condition, not information automatically available in deployment.              |

Three conclusions deserve emphasis.

**First, keep descriptions informative, not promotional.** The preference study changes usage through assertive language and claims of endorsement or popularity, even though the alternatives are equivalent. That is evidence of susceptibility, not a recommendation to market the tool to the agent. Measure verified outcomes and unnecessary calls alongside invocation frequency. Counterbalance tool order when testing descriptions. [S42]

**Second, preserve relevant structure and values.** The output-processing study finds that full example responses can outperform the tested condensed/no-response alternatives for code generation. A schema may say "string" without revealing that a price contains a currency prefix. Its impressive projection result uses an oracle that already knows which fields the answer-generating code needs; it is an upper bound, not a demonstrated deployable summarizer. For assets, expose useful projection/filtering and explicit units, but test that summaries retain the facts and relationships needed for the task. [S44]

**Third, treat naming and discovery as separate testable mechanisms.** The schema study supports evaluating recognizable names and parameter labels, but not repeatedly breaking public API names to optimize one model. Preserve canonical names and compatibility; consider an adapter or alias only if measured benefits justify it. The retrieval study supports testing discovery completeness independently of correct invocation once the right tools are already known. Neither study establishes a universal tool-count threshold or naming style. [S43, S46]

These findings change the report's confidence: there is newer direct evidence for names, documentation, and result handling, but stronger reasons to reject "shorter is always better," "code always wins," and "agents choose the best tool." Section 11 records the publication metadata, methods, and important limitations. No experiments were rerun.

## 3. Additional first-party evidence: useful, but not equivalent to peer review

### 3.1 Anthropic: design tools around workflows and evaluate the whole interaction

Anthropic's _Writing effective tools for agents_ recommends distinct, meaningful tools, thoughtful namespacing, high-signal observations, filtering and pagination, actionable errors, and precise descriptions. It reports improvements on held-out internal evaluations after optimizing tools. [S11]

This corroborates the SWE-agent principles in a different operational setting, but much of the internal data and evaluation machinery is not public. Treat it as experienced, empirically informed practitioner guidance.

Two especially valuable points:

1. **Return information the agent can act on.** A compact result that omits the identifier required for the next operation can be less efficient overall.
2. **There is no universal best result format.** The article explicitly recommends testing representations against the intended task and agent.

Anthropic's _Advanced tool use_ reports:

| Change                    | Reported result                                                                           | Evidence limit                                             |
| ------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| On-demand tool search     | Internal MCP accuracy improved from 49% to 74% for Opus 4 and 79.5% to 88.1% for Opus 4.5 | Vendor-specific models, evaluation, and tool collection    |
| Programmatic tool calling | Average token usage on complex research tasks fell from 43,588 to 27,297, about 37%       | Not an asset CLI benchmark; implementation and task matter |
| Tool-use examples         | Complex-parameter accuracy rose from 72% to 90%                                           | Internal study; not a universal effect of adding examples  |

These are the provider's reported figures, not independently replicated measurements. [S12]

**Inference:** Use on-demand discovery for a large catalog, not automatically for a small CLI. Keep loops and bulk intermediate results outside model context. Add examples where schemas leave real ambiguity.

### 3.2 OpenAI: schemas help, but semantics still need documentation

OpenAI's function-calling guidance recommends precise names and descriptions, enums and structures that prevent invalid states, combining operations that are always sequential, offloading known arguments to code, and limiting initially exposed functions. It also explicitly calls its “fewer than 20 functions” recommendation a **soft suggestion**. [S13]

The guidance notes that examples may hurt performance for some reasoning models. This qualifies Anthropic's favorable internal example results: **examples are an intervention to evaluate, not a free improvement**.

**Inference:** Provide a small set of informative examples for genuinely ambiguous operations. Do not turn every schema into a long tutorial. Validate the actual runtime request even when a model provider enforces an argument schema: structural validity is not authorization, semantic correctness, or proof that the files are unchanged.

### 3.3 BFCL: models are sensitive to representation, but different representations serve different roles

The Berkeley team's V4 format-sensitivity report tests **39 models, 26 prompt variations, and 200 selected single-turn examples**. It varies generated call format, function-documentation format, extra tags, prompt formatting, and wording. For generated calls, Python and JSON generally perform better than XML variants, with substantial model-specific failures. [S6, Sections 2-5]

This is a primary benchmark report, not evidence that TOON or JSON wins as CLI result output. The report also contains inconsistent prose/caption ordering for function-documentation formats; no exact ranking among documentation formats is inferred here.

BFCL V3 separately introduces multi-turn/state-based evaluation, including missing parameters, missing functions, and long-context cases. Its eight hundred augmented cases plus two hundred base cases are useful inspiration for interface testing, rather than a requirement to copy the benchmark's task distribution. [S31]

**Inference:** Test the exact model-interface combination you plan to support. Separate experiments for input schema, generated calls, and returned observations.

## 4. AXI: what its evidence supports, and what it does not

### 4.1 What AXI recommends

AXI proposes ten principles: token-efficient output, small default schemas, explicit truncation, precomputed aggregates, definitive empty states, structured errors and exit codes, ambient context, content-first entry behavior, contextual next steps, and consistent help. The inspected source recommends TOON output, a JSON internal representation, field projection, noninteractive behavior, and rejection of unknown flags. [S24, S25]

Several of these are closely aligned with research and established CLI practice: meaningful actions, concise feedback, clear errors, bounded observations, and discoverable follow-up.

### 4.2 What the published benchmark actually contains

The AXI README reports:

| Benchmark | Published setup                                                   | AXI result                                        | Relevant comparator                                                    |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| Browser   | 14 tasks x 7 conditions x 5 repeats = 490 runs; Claude Sonnet 4.6 | 100% success; $0.074 mean task cost; 21.5 seconds | Chrome DevTools MCP: 99%; $0.101; 26.0 seconds in README               |
| GitHub    | 17 tasks x 5 conditions x 5 repeats = 425 runs; Claude Sonnet 4.6 | 100%; $0.050; 15.7 seconds                        | `gh`: 86%; $0.054; 17.4 seconds; GitHub MCP: 87%; $0.148; 34.2 seconds |

The landing page rounds one cost differently; the table above follows the README. All figures are author-reported and were not rerun. [S24]

**The 915 total runs are not 915 independent AXI successes.** They include comparator conditions. AXI itself has 70 browser runs and 85 GitHub runs in the published design.

The public source was inspected at commit:

`6244245644eadb03cbe30ef11caae9a64c5c1e05`

The inspected artifacts show:

- GitHub tasks are **read-only**, against one repository, including retrieval, chained lookups, aggregate-count questions, and two expected-error cases. [S26]
- GitHub conditions differ in access method **and** instructions, available wrappers, operation behavior, and summaries. The AXI condition explicitly advertises precomputed counts and check summaries. [S26b]
- Both benchmark graders invoke an **LLM judge** over task instructions and trajectory text, with grading hints. This is not independent verification of generated artifacts or filesystem changes. [S27, S28]
- Browser tasks cover public-page navigation, extraction, comparisons, and one 404/recovery sequence. They do not establish production image-processing safety or quality. [S28b]
- The browser trajectory formatter strips image content before judging and bounds textual tool output. These results therefore do not validate image-quality assessment. [S28]

These details make the benchmark more useful than an unsupported manifesto: there are inspectable tasks and grading code. They also define its limits.

### 4.3 Assessment

**Supported conclusion:** AXI demonstrates a promising, inspectable package of design decisions that performs efficiently on its selected tasks with its selected model.

**Unsupported conclusions:**

- TOON caused the entire improvement.
- CLI transport is intrinsically superior to MCP.
- All ten principles are independently validated.
- 100% observed success guarantees production reliability.
- The results generalize to destructive operations, image quality, long-running jobs, other models, or unfamiliar processing workflows.

The ten principles were not individually isolated in the reported head-to-head comparisons. Differences in available operations, summaries, tool discovery, prompts, and output can all affect results. Repeated runs also share tasks; task diversity remains 14 browser tasks and 17 GitHub tasks, not 915 unique workflows.

### 4.4 Which principles to adopt, adapt, or test

| AXI principle                              | Recommendation for this tool                                             | Reason                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Token-efficient output                     | **Adopt the objective; test the encoding**                               | Total successful-workflow cost matters more than response brevity alone                   |
| Minimal schemas                            | **Adopt with action-completeness**                                       | Keep stable IDs, paths, warnings, and continuation information when needed                |
| Truncation                                 | **Adopt explicit pagination/detail access; constrain truncation**        | Never silently truncate a machine identifier or decisive error                            |
| Aggregates                                 | **Adopt when accurate and inexpensive**                                  | Clearly distinguish page counts, totals, estimates, and incomplete scans                  |
| Empty states                               | **Adopt**                                                                | Empty success must differ from failure or unfinished work                                 |
| Structured errors, noninteractive commands | **Adopt**                                                                | Strong convergence with CLI and API guidance                                              |
| Ambient context                            | **Opt-in, not the default architecture**                                 | It can leak data, add recurring tokens, become stale, and couple to harnesses             |
| Content-first no-argument behavior         | **Test; usually prefer concise help for an unscoped processing command** | A no-argument scan can be expensive or reveal unintended local files                      |
| Contextual next steps                      | **Adopt selectively**                                                    | Structured hints should not become mandatory boilerplate or untrusted executable commands |
| Consistent help                            | **Adopt**                                                                | Low risk and compatible with both human and agent use                                     |

The no-argument behavior is a real design disagreement: CLIG recommends concise help when required arguments are missing, while AXI prefers live content. Neither has supplied controlled evidence establishing the right default for a processing CLI. [S14, S25]

### 4.5 TOON deserves an experiment, not a mandate

The TOON project's benchmark page distinguishes retrieval accuracy from token efficiency and flat data from mixed/nested data. Its reported aggregate table lists:

- TOON: 2,474 tokens, 72.2% retrieval accuracy.
- Pretty JSON: 4,308 tokens, 71.4% accuracy.
- Compact JSON: 2,892 tokens, 69.0% accuracy. [S29]

From those published token counts, TOON uses about **42.6% fewer tokens than pretty JSON but only 14.5% fewer than compact JSON**. These percentages are arithmetic on the published aggregate, not an independent benchmark.

The same page shows compact JSON using fewer tokens than TOON for its nested e-commerce dataset. TOON's advantage is therefore shape-dependent. Its retrieval questions also are not full, state-changing agent workflows.

**Recommendation:** Keep canonical JSON and a published schema. Consider TOON as an optional presentation format after comparing it with compact JSON and a schema-complete compact table on your own data. Include parser interoperability, escaping, missing values, Unicode, irregular/nested records, and end-to-end agent correctness in the comparison. Do not adopt the page's confidence-interval-overlap heuristic as a substitute for a paired statistical analysis.

## 5. Recommended interface principles, with evidence and confidence

### 5.1 Optimize for verified task completion, not tokens per response

**Confidence: high for the objective; medium for any particular compression tactic.**

Use a priority order:

1. Correct output and no forbidden side effects.
2. Reliable recovery, cancellation, and state visibility.
3. Predictable latency and resource use.
4. Low total model/context cost.
5. Convenient presentation.

A useful measured quantity is:

**cost per verified successful task = total cost across all attempts / number of verified successful tasks.**

Include failures in the numerator. Report the success rate beside this metric; the ratio alone can hide unacceptable behavior. If there are no verified successes, the ratio is undefined.

This follows the task-level evaluations in SWE-agent and CodeAct, the consistency concerns in tau-bench, and the cost-controlled comparisons in _AI Agents That Matter_. It is a recommended decision criterion, not a formula endorsed by all those papers. [S1, S2, S5, S36]

### 5.2 Make operations meaningful, but do not hide policy decisions inside them

**Confidence: medium for transfer to this application; exact operation boundaries require testing.**

Offer operations such as inspect, validate, transform, compare, and batch processing rather than exposing every low-level decoder step. Let deterministic code calculate dimensions, resolve a manifest, and aggregate output statistics.

However, a convenience operation should not silently decide to overwrite originals, upload data, strip provenance, or accept visual degradation. Composition is beneficial only when its side effects remain explicit.

Use simple primitives plus a few high-value composite operations. Avoid both an enormous low-level endpoint catalog and a single opaque `do_everything(prompt)` operation. [S1, S2, S11, S13]

### 5.3 Publish a complete contract that is available locally

**Confidence: high as interoperability engineering; medium for a direct agent-performance gain.**

For each operation document:

- Purpose, and situations where it should not be used.
- Required and optional parameters, accepted units, ranges, enums, defaults, and ordering.
- Input selection and path-resolution rules.
- Side effects, network access, overwrite behavior, and authorization requirements.
- Synchronous versus asynchronous completion.
- Output schema, partial-success semantics, and durable artifact locations.
- Errors, retry rules, cancellation behavior, and recovery paths.

Provide concise per-command help plus machine-readable capability/schema discovery. OpenAPI describes HTTP APIs; use it if there is an HTTP surface, not as a requirement to create a server. JSON Schema can describe CLI manifests and results. MCP can expose input/output schemas when that integration is needed. [S13, S15, S16, S22]

Add small, executable examples that clarify units, formats, prerequisites, and effects. Test the examples against the current implementation. Examples should supplement explicit semantics, not be the only place to learn an undocumented rule. Human experiments and newer agent ablations support tested examples and descriptions; the quantity and placement in an agent prompt remain model-dependent. Do not optimize descriptions to a minimum word count at the expense of necessary information. [S12, S13, S33, S34, S45]

Use recognizable operation and parameter names, with units or roles made explicit where ambiguous. A controlled naming study supports treating names as a functional part of the interface, but its model-dependent gains do not justify abandoning stable public names. Describe actual capabilities and limits rather than claiming popularity, endorsement, or superiority; such wording can bias selection without making a tool better. [S42, S43]

Generate help, schema exports, and adapters from shared definitions where practical. That is a maintenance recommendation to reduce drift, not an empirical claim.

Version behavior as well as syntax. Renaming a field, changing default pagination, changing resize rounding, or silently replacing a codec preset can break existing consumers even when the result remains valid JSON. Google's compatibility guidance explicitly distinguishes source, wire, and semantic compatibility. Preserve a documented contract across compatible releases and make incompatible behavior opt-in or versioned. [S21]

### 5.4 Treat paths and configuration as explicit inputs

**Confidence: high for predictability; medium for exact syntax.**

Support file-based or stdin manifests for complex requests. Avoid making agents embed long JSON, expressions, or user text in shell strings. Resolve relative paths against a declared workspace or manifest directory, and return resolved paths.

Do not assume current-directory or environment changes persist between agent tool calls. Mini-SWE-agent deliberately executes independent subprocesses; Anthropic also reports eliminating relative-path errors by requiring absolute paths in one SWE-bench tool design. Neither implies that every human-facing CLI must reject relative paths. [S10, S30]

Display effective configuration and its source: defaults, project settings, environment, and flags. Reject unknown parameters before beginning expensive or mutating work. The latter is also an explicit AXI requirement. [S25]

Keep familiar command-line conventions where they reduce ambiguity. POSIX Issue 8 specifies `--` as the end-of-options delimiter, including for later operands that begin with `-`; GNU guidance supports descriptive long options and standard `--help`/`--version`. Document stdin handling and option precedence. POSIX's literal guidelines also contain historical short-option and utility-name restrictions, so adopting long flags is not a claim of complete conformance. These are interoperability conventions, not demonstrated LLM-performance gains. [S37, S40]

### 5.5 Default to concise observations, with reliable expansion

**Confidence: high; exact field count and page size require measurement.**

Return enough to choose the next action:

- Stable reference and human-recognizable name/path.
- Status and the properties relevant to the request.
- Warnings that could change the decision.
- Completeness/continuation information.

Support projection and filters in the tool instead of asking the agent to read a large dump and filter it mentally. Expose detailed metadata on demand. Keep bulk pixel data and full logs in artifacts rather than text output.

Never invent a total count. If a scan is incomplete, say so. If a count is approximate, label it. If a page contains zero items but a continuation cursor exists, it is not necessarily a definitive “no matches” result.

This combines direct ACI findings with context research, newer JSON-processing experiments, and first-party guidance. For simple extraction, adding generated code can make performance worse; for filtering and aggregation, deterministic processing can reduce model error. Offer the needed operation directly rather than making either full text ingestion or arbitrary Python mandatory. [S1, S3, S11, S25, S44]

### 5.6 Errors should explain recovery and mutation state

**Confidence: high.**

A useful error should include a stable code, a readable explanation, the offending field or item, whether work started, whether outputs were committed, and what recovery is safe.

Distinguish at least:

- Invalid request.
- Unsupported capability.
- Permission denied.
- Input changed or plan stale.
- Output conflict.
- Resource limit exceeded.
- Retryable infrastructure failure.
- Partial batch failure.
- Unknown execution outcome after interruption.

“Retryable” should mean safe under a stated mechanism, not “try the whole operation again and hope.” RFC 9457 provides a standard problem format for HTTP; borrow its distinction between machine identity and human explanation for CLI errors without claiming the CLI is an HTTP implementation. [S17, S18]

**Do not silently fix consequential inputs.** If a format cannot preserve alpha, reject the incompatible request or require an explicit background/alpha policy. A success-shaped fallback can be worse than a visible error.

### 5.7 Noninteractive must not mean unconstrained

**Confidence: high as a safety and automation requirement.**

Every operation must be completable without an interactive prompt, but sensitive operations can require explicit approval parameters, a reviewed plan, or host-managed authorization. Missing authorization should fail promptly.

Do not infer that an agent invocation is authorized simply because it is noninteractive. Do not use `--yes` as an undocumented bypass for every risk. Prefer operation-specific permissions and explicit write scopes.

MCP's inspected specification recommends user visibility and control over invocations and treats tool annotations as untrusted unless the server is trusted. Metadata such as “read-only” is not enforcement. [S15]

These requirements have older foundations than agent tooling. Saltzer and Schroeder's 1975 protection paper argues for fail-safe defaults, least privilege, complete mediation, economy of mechanism, and psychologically understandable controls. Applied here, the processor should enforce authorized destinations, network/delegate restrictions, and resource limits at execution, not merely accept an agent's claim that it validated a request. A prior preview must not become permanent authority after inputs or permissions change. This is an application of protection principles, not experimental proof of a particular approval workflow. [S39]

### 5.8 Separate validation, execution, and verification

**Confidence: high for the separation; medium for requiring a persisted plan in every workflow.**

For simple new-file transformations, a single explicit transform command may suffice. For large or destructive batches:

1. Validate input and preview the intended changes.
2. Execute the approved operation.
3. Verify the actual outputs against stated requirements.

A dry run is not a guarantee of later success. Inputs, permissions, free disk space, and external dependencies can change. An immutable plan can record input hashes, operation parameters, output paths, and tool versions; execution should reject stale preconditions rather than silently regenerating a different plan.

Google AIP-163 explicitly says validate-only requests must perform the checks applicable to real requests. HTTP's `If-Match` preconditions provide an established example of refusing a change when the inspected representation has changed. The CLI equivalent is a design inference: verify input identity/version and destination conditions when executing. A saved hash alone does not prevent a check/use race; apply appropriate locking, snapshots, or atomic filesystem operations where the guarantee requires them. The stronger persisted-plan design is a recommendation beyond AIP-163, and an HTTP precondition is not automatically a filesystem transaction. [S20, S38, Section 13.1.1]

### 5.9 Make long-running work observable and resumable where justified

**Confidence: high for explicit state; medium for how much job infrastructure is necessary.**

For small local work, synchronous execution is simpler. If work routinely outlasts agent tool timeouts, return a durable job identifier with status, progress, results, cancellation, and bounded waiting.

Google's long-running-operation guidance describes returning an operation handle and separately representing failures to start versus failures during execution. It gives ten seconds as a rule of thumb, not a universal CLI cutoff. [S19]

Document whether cancelling stops the caller's wait, requests job cancellation, or guarantees no further output commits. These are different guarantees. A detached process is not automatically a durable job system.

### 5.10 Make retries safe through explicit identity and preconditions

**Confidence: high.**

For desired-state operations, an already-satisfied state can be a successful no-op. For operations that create jobs or outputs, use request identity and durable deduplication when retry ambiguity is possible. Google AIP-155 explicitly connects request IDs with idempotency. [S18]

RFC 9110 defines idempotence in terms of the intended effect of repeated identical requests, not identical responses or exactly-once execution. It cautions against automatic retries of non-idempotent requests unless their semantics are known to permit them or the caller knows the original was not applied. Borrow that distinction for CLI jobs; do not translate HTTP method names into guarantees the local implementation does not provide. An idempotent operation can still be destructive, and deduplication supplies neither authorization nor rollback. [S38, Sections 9.2.1-9.2.2]

Specify:

- Scope and retention period of request IDs.
- Behavior when an ID is reused with different input.
- How to retrieve an earlier result.
- Which failures are safe to retry.
- What can be known after a crash.

Do not conflate deterministic encoding with retry safety: an image encoder can be nondeterministic while the request is still deduplicated. Conversely, a deterministic transformation can still create duplicate jobs.

For local small synchronous commands, a well-defined conflict policy and content checks may be sufficient. Do not build a distributed ledger before the workflow needs one.

### 5.11 Verify facts with software; reserve judgment for the actual judgment task

**Confidence: high for measurable properties; task-dependent for perceptual quality.**

Use code to verify decodability, dimensions, file size, alpha policy, metadata policy, selected frame/page, destination confinement, and requested format. Do not ask the LLM to infer these facts from a thumbnail or prose summary.

For visual requirements, preserve access to before/after previews. Define what “acceptable” means: exact preservation, bounded metric degradation, human review, or model-assisted judgment. A pixel metric is not proof of aesthetic equivalence, and a valid output file is not proof that the intended image was produced.

This is an application-specific inference from state-based evaluation and the need for verifiable outcomes, not a direct result from the cited coding/tool-use papers. [S4, S5, S31]

## 6. A practical CLI/API shape

The following is a **proposed contract sketch**, not an implemented tool or a research-prescribed command vocabulary. Use it to evaluate design options.

### 6.1 Minimal useful surface

| Capability | Example surface                                                        | Behavior                                                             |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Discover   | `asset capabilities --format json`                                     | Installed codecs, constraints, schema versions, supported operations |
| Learn      | `asset transform --help`                                               | Concise purpose, arguments, examples, side effects                   |
| Inspect    | `asset inspect --input-file inputs.json --format json`                 | Bounded metadata and input diagnostics                               |
| Validate   | `asset validate --request-file request.json --format json`             | Check a requested transformation without committing outputs          |
| Execute    | `asset transform --request-file request.json --format json --no-input` | Produce new outputs with explicit conflict policy                    |
| Verify     | `asset verify --result-file result.json --format json`                 | Check persisted outputs against declared requirements                |

Add `plan`/`apply` and `job status`/`job cancel` only if batch size, risk, or duration justifies them. Do not force a five-step ceremony on a simple conversion.

**Suggested defaults:** new output paths; no implicit uploads; no overwrites; deterministic input ordering; explicit empty and partial results; machine mode available without a TTY.

### 6.2 Example request manifest

```json
{
    "schema_version": "1",
    "workspace": "/work/assets",
    "inputs": ["source/banner.png"],
    "operation": {
        "name": "resize",
        "max_width_px": 1024,
        "max_height_px": 1024,
        "fit": "contain",
        "allow_upscale": false
    },
    "output": {
        "directory": "derived",
        "format": "webp",
        "encoding": {
            "mode": "lossless"
        },
        "alpha": "preserve",
        "color_profile": "preserve",
        "metadata": "strip",
        "on_conflict": "error"
    }
}
```

The proposed semantics deliberately name units and policies instead of relying on ambiguous words such as “optimize.” “Lossless” here describes encoding of the transformed pixels, **not** preservation of the original dimensions or pixels after resizing. Validate whether the selected encoder can satisfy all policies; do not silently approximate them.

Declare exactly how paths resolve and whether `inputs` is a literal list or supports patterns. Treat orientation, animation, multipage inputs, metadata stripping, and profile handling as explicit policies in the full contract. In this sketch, the color-profile policy is separate from generic metadata stripping; a production contract must define that precedence rather than leave it implicit. The example intentionally does not attempt to specify the entire production schema.

### 6.3 Example bounded result

```json
{
    "schema_version": "1",
    "status": "succeeded",
    "summary": {
        "selected": 1,
        "succeeded": 1,
        "failed": 0,
        "bytes_before": 840000,
        "bytes_after": 210000
    },
    "items": [
        {
            "input": "/work/assets/source/banner.png",
            "output": "/work/assets/derived/banner.webp",
            "status": "succeeded",
            "width_px": 1024,
            "height_px": 512
        }
    ],
    "warnings": [],
    "complete": true,
    "next_cursor": null,
    "result_file": "/work/assets/runs/run-0042/result.json"
}
```

For large batches, inline a bounded item subset and retain the complete per-item record in a result artifact. Document whether `complete` describes result enumeration, scan completion, or job completion; do not overload one boolean for all three in a real schema.

Provenance belongs in the durable result: effective parameters, processor and codec versions, input identities/hashes, and output checks. The inline summary need not repeat the full provenance.

### 6.4 Example actionable error

```json
{
    "schema_version": "1",
    "status": "failed",
    "error": {
        "code": "OUTPUT_CONFLICT",
        "message": "The destination already contains banner.webp.",
        "field": "output.on_conflict",
        "retryable": false,
        "mutation_state": "not_started",
        "recovery": {
            "action": "choose_another_output_directory"
        }
    }
}
```

`retryable: false` means blindly repeating the same request will not fix this problem. A changed destination is a new request, not a retry.

For a network interruption after submission, `mutation_state` may instead be `unknown`, with an operation/request identifier to query. Never report `not_started` merely because the client did not receive a success response.

### 6.5 Output streams and process status: make one explicit decision

CLIG recommends data on stdout, messages/errors on stderr, and nonzero exit status for failure. AXI instead places structured errors on stdout alongside other structured results. Both approaches can work; **“agents do not read stderr” is not a universal property of agent harnesses**. [S14, S25]

For this tool, a defensible explicit design is:

| Mode                             | stdout                                                     | stderr                                          | Exit status                             |
| -------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- | --------------------------------------- |
| Human                            | Readable result                                            | Errors, warnings, progress                      | Zero only for successful completion     |
| Machine JSON                     | One documented result envelope, including operation errors | Diagnostics/progress, no required machine facts | Nonzero for failure or partial failure  |
| Streaming machine mode, if added | Typed JSONL records with a documented terminal record      | Diagnostics                                     | Nonzero for unsuccessful terminal state |

The machine-mode choice is a deliberate deviation from a strict errors-on-stderr convention so callers have one parseable result channel. Do not duplicate required errors across channels and make callers guess which to parse. Test the actual agent harness to ensure it preserves stdout from nonzero-exit commands.

Process launch failures, abrupt termination, and broken pipes may prevent any complete envelope. Callers must handle a missing or malformed result as an execution failure/unknown outcome, not success.

For a future asynchronous submit command, exit zero means the request was accepted and the returned status is `submitted`, **not** that processing succeeded. Final job results have their own status. Reserve/document exit values for invalid usage, partial batch failure, and other distinctions; there is no universal research-backed numeric exit-code taxonomy.

Keep raw binary output in a separate explicit mode, because an image byte stream cannot also be a JSON envelope. Disable prompts, pagers, animation, and color in machine mode regardless of TTY detection.

### 6.6 CLI, SDK, HTTP, and MCP should share semantics

| Surface     | Strong fit                                                    | Main caution                                                         |
| ----------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| Local CLI   | Filesystem pipelines, shell-capable agents, humans, CI        | Quoting, subprocess lifecycle, environment assumptions               |
| Typed SDK   | Loops, conditional composition, bulk processing               | Dependency/version burden and code-execution permissions             |
| HTTP API    | Shared remote compute and durable jobs                        | Authentication, retries, network uncertainty, service operations     |
| MCP adapter | Agent applications that discover and invoke tools through MCP | Host differences, schema support, permissions, tool/context overhead |

No retrieved study establishes a universal winner. A thin MCP adapter can invoke the same operation contract as the CLI; it does not need to reproduce a human terminal view or expose every command as a separate tool.

The inspected MCP 2025-06-18 specification supports structured results, output schemas, resource links, images, and explicit tool-execution errors. That provides a better integration basis than scraping terminal text. It does not supply transactionality, authorization policy, or semantic correctness automatically. Pin and test the protocol version supported by the target host. [S15]

## 7. Processing-specific requirements that follow from the general principles

This section is **engineering application**, not a claim that agent-interface studies tested image pipelines.

### Preserve control over image semantics

Document policies for:

- EXIF orientation and whether dimensions are measured before or after orientation.
- Color spaces and profiles, including what happens if a profile cannot be preserved.
- Alpha/transparency and formats that cannot encode it.
- Animation and multipage assets: preserve, flatten, reject, or select an explicit frame/page.
- Metadata: strip, preserve, or selective preservation.
- Resize rounding, fit/crop behavior, enlargement, and aspect ratio.
- Lossy quality, lossless encoding, and any byte-budget search.
- Naming collisions, extension handling, output placement, and replacement.

The CLI should reject an incompatible policy combination before writing where it can detect it. Avoid terms such as “quality=80” without naming the codec-specific meaning and its limits.

### Keep “safe completion” separate from “looks good”

Examples of deterministic checks:

- Every requested input has a terminal result.
- Every output decodes using the intended format.
- Dimension and byte limits actually hold.
- Alpha, frame count, and profile policies are satisfied.
- Inputs remain unchanged when non-destructive operation was requested.
- All writes are confined to authorized destinations.
- Temporary/partial outputs are not mistaken for committed results.

For perceptual judgments, offer contact sheets, before/after previews, or image resources. Use human or multimodal evaluation only for requirements that actually need it. Keep those judgments distinct from measured invariants.

### Enforce resource and execution boundaries

ImageMagick's official security policy documentation recommends resource constraints, restricted coders/delegates, and sandboxing for untrusted environments. This is concrete processing-domain evidence that a “simple convert” operation can have a much larger operational surface. [S23]

Apply appropriate limits to decoded pixel counts, frame counts, memory, CPU time, disk use, concurrency, output count, and external delegate execution. A user-supplied SVG, URL, or indirect input can imply more than reading a local raster file. Do not enable network or delegate access merely because an agent-generated manifest requests it.

Prompt-injection defenses and codec defenses are complementary: a harmless-looking metadata instruction can redirect an agent, while a malicious file can attack the processor without any LLM involvement. [S7, S23]

## 8. Evaluation plan: decide with local evidence

The strongest research-backed process recommendation is to evaluate the **whole agent-tool interaction** on realistic tasks and inspect the failure traces. Include simple baselines and compare accuracy under comparable budgets. [S1, S4, S5, S11, S36]

### 8.1 Establish hard invariants before ergonomic comparisons

Use deterministic tests for:

- Invalid flags and schema fields rejected before work starts.
- No prompt, pager, or TTY dependence in machine mode.
- Valid output framing on success, empty results, error, and partial failure.
- Stable path resolution, including spaces, quotes, Unicode, and leading-dash filenames.
- No unauthorized overwrite, write escape, upload, or delegate execution.
- Correct cancellation/interruption and stale-plan handling.
- Safe repeated requests within the documented retry guarantee.
- Compatibility of supported request/result versions.

These tests establish the processing contract. Agent tests then measure whether the interface lets agents use it effectively.

### 8.2 Build a task set that includes discovery and failure

Start with a pilot covering the distinct task categories below and repeated runs. Use the observed variance and the smallest improvement worth adopting to size a later comparison; this review does not establish a universal sufficient task count. Repeats estimate consistency on known tasks, while diverse held-out scenarios test generalization.

Include:

| Task category           | Example                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Basic transformation    | Create a constrained-size derivative without replacing the source                       |
| Discovery               | Find whether the installed build supports the required codec or policy                  |
| Selection               | Process only oversized images in a mixed directory                                      |
| Composition             | Inspect a manifest, filter by properties, apply one batch operation, summarize          |
| Constraint satisfaction | Meet a byte budget while preserving stated format/alpha requirements                    |
| Ambiguity               | Unsupported policy combination; missing output destination; unspecified frame selection |
| Empty results           | No matching files, with successful and complete enumeration                             |
| Partial failure         | One corrupt input among otherwise valid inputs                                          |
| Recovery                | Retry after a transient failure without duplicate work                                  |
| Stale state             | Input modified after validation/planning                                                |
| Long-running work       | Agent call times out while the job continues                                            |
| Adversarial data        | Metadata or filename contains tool-like instructions                                    |
| Human handoff           | User previews changes, declines a subset, and resumes safely                            |

Keep human supervision policies fixed across interface variants so a convenience flag does not “win” by bypassing safeguards.

Separate development and held-out workloads by meaningful task families where possible, not just by substituting filenames in an otherwise identical template. Include an unfamiliar codec, input distribution, or failure combination to test the intended generality. Give the agent realistic input fixtures, but keep hidden expected answers and verifier internals outside its accessible workspace and permissions. [S36]

### 8.3 Compare one mechanism at a time

Useful experiments:

| Question                            | Controlled comparison                                                             | Hold constant                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Which output encoding works best?   | Compact JSON vs TOON vs compact labeled/table view                                | Same facts, IDs, warnings, completeness, operations, and model                             |
| How much detail should be returned? | Summary plus expandable details vs verbose output                                 | Serialization and tool behavior                                                            |
| Does batching help?                 | Per-item invocation vs manifest batch                                             | Same processing semantics and correctness requirements                                     |
| Are examples useful?                | Minimal precise schema/help vs schema/help plus targeted examples                 | Same operations and model settings                                                         |
| Does discovery help?                | Full catalog vs compact index plus schema lookup; oracle-tools diagnostic         | Same capabilities and access policy                                                        |
| Do names/descriptions help?         | Equivalent operations with candidate names or descriptions; counterbalanced order | Same functionality, schemas except the intended treatment, and model settings              |
| Which integration is efficient?     | CLI vs MCP adapter over the same core                                             | Same information content, operation set, permissions, and documentation as far as feasible |

A transport comparison cannot be perfectly identical if host behavior differs. Record those differences and describe the result as a comparison of deployed integration packages, not transport in isolation.

Keep an ordinary shell agent using clear help and a simple deterministic batch script as baselines. A richer interface should justify its extra development and operating costs against these alternatives. Report both a fixed-budget comparison and the success/cost trade-off when additional attempts are allowed. Do not compare one format's single attempt with another's best of several attempts. [S36]

Separate discovery completeness, invocation correctness, result interpretation, and final task success. A tool can be discoverable but misused, correctly called but misread, or frequently selected because of wording without improving outcomes. Include simple field extraction as well as filtering/aggregation, because evidence does not support one processing strategy winning both. [S42, S44, S46]

### 8.4 Measure the right outcomes

**Primary:**

- Verified completion of all requested output constraints.
- Forbidden side effects and policy violations, separately counted.
- Consistency over repeated runs.
- Correct handling of uncertainty and partial failure.

**Secondary:**

- Model input/output and cached-token usage, where observable.
- Total and per-success cost, including failed attempts.
- End-to-end latency, including p50/p95 where the sample supports them.
- Number of agent turns and calls.
- Invalid invocations, retries, redundant discovery, and manual interventions.
- Processing CPU/GPU time and I/O when wrapper changes affect backend work.

For recurring workloads, report setup/discovery costs separately from steady-state task costs, and distinguish cold starts from warm caches. Record token categories and dated prices so costs can be recalculated. Otherwise, an interface can appear cheaper because its setup was omitted or a comparator missed a cache, not because agents used it more effectively. The separation follows the fixed/variable-cost concern in _AI Agents That Matter_; the cache comparison is an application-specific evaluation recommendation. [S36]

**Human usability:**

- Time to understand a preview.
- Ability to predict which files will change.
- Correction/cancellation success.
- Time to complete representative direct-CLI tasks.
- Brief perceived-effort and trust-calibration feedback.

Do not use agent performance as a proxy for human satisfaction. Recruit people representative of the intended users and distinguish direct CLI use from supervising an agent. HCI principles and the usability framework inform the test questions, but direct human evaluation is still needed. [S8, S41]

### 8.5 Evaluation hygiene

- Pin model identifiers, tool versions, prompts, permissions, fixtures, and processor dependencies.
- Randomize or counterbalance condition order when feasible.
- Reset mutable state between trials.
- Keep development tasks separate from held-out tasks.
- Repeat the same task across conditions so comparisons are paired.
- Compute uncertainty at the **task** level; repeated runs of the same task are not new independent task types.
- Predefine the primary metric, smallest useful effect, stopping rule, and important task subgroups. Use paired comparisons and task-clustered uncertainty estimates when runs share the same task; avoid treating every repeated call as independent evidence.
- Report failures, not just averages for successful runs.
- Inspect actual files and state rather than accepting the agent's success claim.
- Use LLM judges as supplementary evaluators for explanations or perceptual tasks, with human review of ambiguous judgments.
- Treat zero observed safety failures as limited evidence, not proof of zero risk.

Avoid declaring a format winner because two aggregate accuracy percentages differ slightly. Use paired outcomes and adequate task diversity; the TOON and AXI examples show why headline numbers need their evaluation context.

The statistical choices above are proposed evaluation practice, not procedures validated by every cited benchmark. A small pilot can identify failures and estimate variance; it cannot establish rare-event safety. Report raw failures and exposure counts, and keep deterministic boundary tests separate from stochastic agent-success estimates.

## 9. Prioritized decisions

### Implement first

1. **One shared operation contract and processing core.** Keep transformations independent of presentation and transport.
2. **Explicit machine mode.** Stable structured results, noninteractive behavior, documented errors and exit status.
3. **Discoverability.** Recognizable names, useful local help and tested examples, capability inspection, versioned manifests/results, and a small initial surface.
4. **Safe data handling.** No implicit overwrite/upload, validation before work, bounded resources, explicit path policies.
5. **Actionable results.** Per-item outcomes, compact summaries, complete durable records, and deterministic verification.
6. **A realistic agent evaluation set.** Include recovery, ambiguity, adversarial content, and repeated runs.

### Add when measurements or workflow constraints justify them

- Batch plans and stale-input checks for expensive or destructive work.
- Durable jobs when execution exceeds normal tool-call lifetimes.
- A typed SDK for rich composition.
- An MCP adapter for hosts that benefit from it.
- Deferred capability discovery for a large tool catalog.
- An alternative compact observation format such as TOON.
- Opt-in session integrations.

### Do not assume

- That CLI is intrinsically more agent-friendly than MCP.
- That a minimal field count or fixed token limit is optimal.
- That valid JSON means a request is authorized or semantically correct.
- That `--yes` is an adequate permission model.
- That visual quality can be inferred from successful encoding.
- That more autonomy or more tools improves outcomes.
- That the tool an agent selects most often is the most useful.
- That shorter documentation or generated code improves every task.
- That the 2024 models' failure rates describe current models.
- That AXI's 100% on selected tasks generalizes to production processing.

## 10. What remains uncertain

**High confidence:** Clear semantics, useful feedback, bounded but sufficient observations, validation, explicit state, predictable noninteractive behavior, and rigorous outcome verification are sound priorities. They have convergent support from direct ACI experiments, newer tool-interface research, API practice, and human studies. This is stronger support for the priorities than for any exact implementation.

**Medium confidence:** A compact JSON interface with batches and a thin CLI is the best starting point for the stated application. This is a low-complexity engineering choice with good interoperability, not a universal empirical winner.

**Low confidence without local experiments:** The optimal output encoding, default fields, page sizes, operation granularity, example set and placement, no-argument behavior, and CLI-versus-MCP performance for the eventual models and tasks.

The reviewed literature does not directly establish that a particular asset-processing CLI feels good to both humans and agents. Much of the earlier causal evidence comes from software engineering and older models; the newer studies add more recent models and API tasks but still do not directly test this application. A careful design should carry over the supported interaction principles, then test the remaining choices with representative processing tasks and actual human supervision.

**What the second pass changed:** It added controlled human API studies and six newer reviewed agent papers, verified ToolSandbox's publication venue, separated established contract practice from empirical agent gains, and reduced confidence in universal workflow boundaries. The newer evidence supports testing names, executable documentation, and discovery, while directly qualifying claims about preference, brevity, and code execution. It also replaced an arbitrary pilot-size suggestion with effect- and uncertainty-based evaluation planning.

## 11. Annotated primary-source bibliography

All online sources were accessed during this investigation on October 19, 2026. Mutable documentation and benchmark pages can change. AXI source citations are pinned to the inspected commit; paper versions and specification versions are identified where used.

### Scholarly sources

**[S1] Yang et al. (2024). SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering. NeurIPS 2024.** Direct ACI experiments; Tables 1 and 3 and Section 5.1 are the most relevant evidence. [Paper, inspected v3](https://arxiv.org/html/2405.15793v3); [verified official proceedings record](https://proceedings.neurips.cc/paper_files/paper/2024/hash/5a7c947568c1b1328ccc5230172e1e7c-Abstract-Conference.html).

**[S1b] SWE-agent maintainers. Project README.** First-party statement that mini-SWE-agent has superseded the larger scaffold for most current development. Implementation evidence, not a new controlled paper. [Repository](https://github.com/SWE-agent/SWE-agent).

**[S2] Wang et al. (2024). Executable Code Actions Elicit Better LLM Agents. ICML 2024, PMLR 235:50208-50232.** Published venue and authoritative bibliographic metadata: [PMLR](https://proceedings.mlr.press/v235/wang24h.html). Detailed companion text inspected: [arXiv v4](https://arxiv.org/html/2402.01030v4), especially Sections 2.2-2.3. Action representation and composition, not result serialization.

**[S3] Liu et al. (2024). Lost in the Middle: How Language Models Use Long Contexts. TACL 12:157-173.** [ACL Anthology](https://aclanthology.org/2024.tacl-1.9/); [DOI](https://doi.org/10.1162/tacl_a_00638). Controlled evidence about context use, indirectly applicable to tool observations.

**[S4] Lu et al. (2025). ToolSandbox: A Stateful, Conversational, Interactive Evaluation Benchmark for LLM Tool Use Capabilities. Findings of NAACL 2025, pp. 1160-1183.** [Verified publication record](https://aclanthology.org/2025.findings-naacl.65/); [DOI](https://doi.org/10.18653/v1/2025.findings-naacl.65); [detailed text inspected, arXiv v2](https://arxiv.org/html/2408.04682v2); [Apple implementation and documentation](https://github.com/apple/ToolSandbox). Stateful evaluation, milestone/minefield checking, and recovery.

**[S5] Yao et al. (2024). Tau-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains.** [Paper, inspected v1](https://arxiv.org/html/2406.12045v1). Final-state evaluation and consistency across trials. Treated as a preprint in this review.

**[S7] Zhan et al. (2024). InjecAgent: Benchmarking Indirect Prompt Injections in Tool-Integrated Large Language Model Agents. Findings of ACL 2024.** [Publication and abstract](https://aclanthology.org/2024.findings-acl.624/). Tool-content attacks; not proof of any one mitigation's effectiveness.

**[S8] Amershi et al. (2019). Guidelines for Human-AI Interaction. CHI 2019.** [Primary author-hosted paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf); [DOI](https://doi.org/10.1145/3290605.3300233). Table 1 on page 3 and study methods/results on pages 5-7. The PDF was read directly; the ACM landing page was not accessible.

**[S9] Xia et al. (2024). Agentless: Demystifying LLM-based Software Engineering Agents.** [Paper record, inspected v2](https://arxiv.org/abs/2407.01489v2); [authors' implementation](https://github.com/OpenAutoCoder/Agentless). Evidence for a simpler prescribed workflow as a serious alternative, not a matched test of all interface choices.

**[S32] Stylos and Myers (2008). The Implications of Method Placement on API Learnability. FSE 2008, pp. 105-112.** [Author-hosted primary paper](https://www.cs.cmu.edu/~NatProg/papers/FSE2008-p105-stylos.pdf). Ten Java programmers, three tasks, randomized task-condition assignment and balanced task order. Sections 4-6 distinguish object-combination time from total task time. Small controlled evidence for discoverability, not a CLI study.

**[S33] Uddin and Robillard (2015). How API Documentation Fails. IEEE Software 32(4):68-75.** [DOI](https://doi.org/10.1109/MS.2014.80); [author-hosted primary paper](https://www.cs.mcgill.ca/~martin/papers/ieeesw2015.pdf). Two surveys, 323 IBM professionals; ten failure categories. Stronger evidence for prioritizing content failures than for one presentation format. Self-report and one-organization limits apply.

**[S34] Sohan, Maurer, Anslow, and Robillard (2017). A Study of the Effectiveness of Usage Examples in REST API Documentation. IEEE VL/HCC, pp. 53-61.** [DOI](https://doi.org/10.1109/VLHCC.2017.8103450); [author-hosted primary paper](https://www.cs.mcgill.ca/~martin/papers/vlhcc2017.pdf). Random assignment of 26 experienced developers to original versus example-enhanced WordPress documentation. Sections III-V include design, significance tests, and the important limitation that better prose without examples was not tested.

**[S35] Nassif and Robillard (2025). Evaluating Interactive Documentation for Programmers. Empirical Software Engineering 30, article 73.** [DOI](https://doi.org/10.1007/s10664-025-10618-0); [author-hosted accepted manuscript](https://www.cs.mcgill.ca/~martin/papers/2025-ese-casdoc.pdf). Qualitative study with 13 students, with both formats available to all participants. Sections 3 and 4.4 describe sampling and constraints. Evidence for information-need-dependent presentation, not a randomized agent-discovery experiment.

**[S36] Kapoor et al. (2024). AI Agents That Matter. arXiv 2407.01502, inspected v1.** [Submission/version record](https://arxiv.org/abs/2407.01502); [full text](https://arxiv.org/html/2407.01502v1). Sections 2, 5-6 and appendices support cost-controlled baselines, meaningful holdouts, and reproducible evaluation. Preprint status is retained here; the HumanEval results do not establish that simple agents dominate every task.

**[S39] Saltzer and Schroeder (1975). The Protection of Information in Computer Systems. Proceedings of the IEEE 63(9):1278-1308.** [DOI](https://doi.org/10.1109/PROC.1975.9939); [author-hosted text](https://web.mit.edu/Saltzer/www/publications/protection/); [Section I.A.3, design principles](https://web.mit.edu/Saltzer/www/publications/protection/Basic.html). Foundational invited tutorial, not a modern agent experiment. Least privilege, fail-safe defaults, complete mediation, simplicity, and understandable controls ground the safety recommendations.

**[S42] Faghih et al. (2025). Tool Preferences in Agentic LLMs are Unreliable. EMNLP 2025, pp. 20954-20969.** [Publisher record and DOI](https://aclanthology.org/2025.emnlp-main.1060/); [published paper](https://aclanthology.org/2025.emnlp-main.1060.pdf); [implementation](https://github.com/kazemf78/llm-unreliable-tool-preferences). Controlled description/order interventions with equivalent tools. Tables 2, 5, and 8-11 distinguish usage shifts from task improvement. Different phases use different task sets; reordered duplicates are not independent tasks.

**[S43] Lee et al. (2026). Don't Adapt Small Language Models for Tools; Adapt Tool Schemas to the Models. ACL 2026, pp. 20695-20719.** [Publisher record and DOI](https://aclanthology.org/2026.acl-long.948/); [published paper](https://aclanthology.org/2026.acl-long.948.pdf); [project repository](https://github.com/holi-lab/PA-Tool). Controlled name/parameter interventions, ablations, end-to-end tasks, and a three-annotator human study. Tables 1-5 include regressions as well as gains. The linked repository root inspected during research hosted a project page, not an identified runnable experiment implementation.

**[S44] Kate et al. (2026). How Good Are LLMs at Processing Tool Outputs? EACL 2026, pp. 2918-2941.** [Publisher record and DOI](https://aclanthology.org/2026.eacl-long.134/); [published paper](https://aclanthology.org/2026.eacl-long.134.pdf); [data generation/evaluation code](https://github.com/LongFuncEval/toolJSONprocessing). Sections 4.3-4.7 and Table 2 separate extraction, filtering, aggregation, schema inclusion, and response detail. The projection result is oracle-assisted; this is not a comparison of JSON with alternative serializations.

**[S45] Fang et al. (2025). PLAY2PROMPT: Zero-shot Tool Instruction Optimization for LLM Agents via Tool Play. Findings of ACL 2025, pp. 26274-26290.** [Publisher record and DOI](https://aclanthology.org/2025.findings-acl.1347/); [published paper](https://aclanthology.org/2025.findings-acl.1347.pdf); [implementation](https://github.com/wfangtw/play2prompt). Tables 1-3 and 6 document performance, component ablations, negative comparisons, and conciseness judgments. Distinguish unweighted category means from weighted means and executable evaluation from simulated/LLM-judged tasks.

**[S46] Shi et al. (2025). Retrieval Models Aren't Tool-Savvy: Benchmarking Tool Retrieval for Large Language Models. Findings of ACL 2025, pp. 24497-24524.** [Publisher record and DOI](https://aclanthology.org/2025.findings-acl.1258/); [published paper](https://aclanthology.org/2025.findings-acl.1258.pdf); [benchmark artifacts](https://github.com/mangopy/tool-retrieval-benchmark). Sections 3, 6-7 and Tables 4-5 address completeness, downstream effects, and assisted conditions. Merged-corpus labels can omit valid alternatives; annotated-tool completeness is not an infallible measure of solvability.

**[S47] Ding et al. (2025). ToolCoder: A Systematic Code-Empowered Tool Learning Framework for Large Language Models. ACL 2025, pp. 17876-17891.** [Publisher record and DOI](https://aclanthology.org/2025.acl-long.874/); [published paper](https://aclanthology.org/2025.acl-long.874.pdf); [implementation](https://github.com/dhx20150812/ToolCoder). Tables 1 and 3 provide conceptual corroboration and a counterexample to universal CodeAct superiority. Architectures/prompts differ and equal compute budgets are not established. Repository instructions were inspected, not executed; some evaluations can mutate a real account.

### First-party empirical reports and implementation guidance

**[S6] Berkeley Function Calling Leaderboard team (2025). BFCL V4, Part 3: Evaluating Format Sensitivity for Tool Calls.** [Report](https://gorilla.cs.berkeley.edu/blogs/17_bfcl_v4_prompt_variation.html), especially Sections 2-5; [implementation](https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard). Primary benchmark report, not treated as peer-reviewed evidence for this particular experiment.

**[S10] Mini-SWE-agent maintainers. FAQ.** [Documentation](https://mini-swe-agent.com/latest/faq/). Bash-only interface and independent subprocess execution. Useful counterweight to claims that a custom tool scaffold is always necessary.

**[S11] Anthropic. Writing effective tools for agents.** [Engineering report](https://www.anthropic.com/engineering/writing-tools-for-agents). Tool granularity, names, output detail, errors, and held-out evaluations. Internal measurements are not fully independently reproducible.

**[S12] Anthropic. Advanced tool use.** [Engineering report](https://www.anthropic.com/engineering/advanced-tool-use). Tool search, programmatic calling, examples, and reported internal measurements.

**[S13] OpenAI. Function calling guide.** [Official documentation](https://developers.openai.com/api/docs/guides/function-calling). Precise descriptions, schemas, invalid states, function counts, and examples. Product guidance, not a controlled comparative study.

**[S14] Prasad, Firshman, Tashian, and Parish. Command Line Interface Guidelines.** [Guide](https://clig.dev/), especially [basics](https://clig.dev/#the-basics), [help](https://clig.dev/#help), and [output](https://clig.dev/#output). Established practitioner guidance, not an agent benchmark.

**[S23] ImageMagick. Security Policy.** [Official documentation](https://imagemagick.org/security-policy/). Domain-specific rationale for decoder/delegate restrictions, resource bounds, and sandboxing.

**[S30] Anthropic. Building effective agents.** [Engineering guidance](https://www.anthropic.com/engineering/building-effective-agents), especially the tools appendix and its absolute-path example. Practitioner evidence; the page now notes that its tooling landscape has evolved since its original publication.

**[S31] Berkeley Function Calling Leaderboard team. BFCL V3: Multi-Turn & Multi-Step Function Calling Evaluation.** [Report](https://gorilla.cs.berkeley.edu/blogs/13_bfcl_v3_multi_turn.html). State-based checking, missing parameters/functions, and long-context test categories.

### Specifications and authoritative API engineering guidance

**[S15] Model Context Protocol. Tools, specification version 2025-06-18.** [Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools). Input/output schemas, structured content, resource/image results, errors, and security considerations. Pinned reference, not a claim that this is the latest protocol version.

**[S16] OpenAPI Initiative. OpenAPI Specification 3.1.1.** [Specification](https://spec.openapis.org/oas/v3.1.1.html). Standard description of HTTP APIs for humans and software.

**[S17] Nottingham et al. (2023). RFC 9457: Problem Details for HTTP APIs.** [RFC](https://www.rfc-editor.org/rfc/rfc9457.html), Sections 3-4. Machine-readable error identity and extensible detail; directly normative for its HTTP format, not for a CLI.

**[S18] Google. AIP-155: Request identification.** [Guidance](https://google.aip.dev/155). Request identity, deduplication, retry safety, and retained results.

**[S19] Google. AIP-151: Long-running operations.** [Guidance](https://google.aip.dev/151). Operation handles, progress, lifecycle, and error separation.

**[S20] Google. AIP-163: Change validation.** [Guidance](https://google.aip.dev/163). Validate-only behavior and applicable permission/validation checks.

**[S21] Google. AIP-180: Backwards compatibility.** [Guidance](https://google.aip.dev/180). Source, wire, and semantic compatibility. Particularly relevant when defaults, pagination, field names, or output types change.

**[S22] JSON Schema. Draft 2020-12 validation specification.** [Specification](https://json-schema.org/draft/2020-12/json-schema-validation). Structural constraints and annotations. Do not confuse JSON Schema's draft naming/history with an IETF Internet Standard or with complete business-rule validation.

**[S37] IEEE and The Open Group (2024). POSIX.1-2024, Issue 8, Base Definitions, Chapter 12: Utility Conventions.** [Normative source](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap12.html), especially Section 12.2, Guidelines 10-13. End-of-options handling, option/operand ordering, and stdin conventions. Long-option designs should not be described as implementing every literal POSIX guideline.

**[S38] Fielding, Nottingham, and Reschke (2022). RFC 9110: HTTP Semantics.** [RFC](https://www.rfc-editor.org/rfc/rfc9110.html); [plain text](https://www.rfc-editor.org/rfc/rfc9110.txt). Sections 9.2.1-9.2.2 define safety and idempotence; Section 13.1.1 defines `If-Match`. Authoritative HTTP semantics whose application to local jobs is explicitly an inference.

**[S40] GNU Project. GNU Coding Standards, Section 4.8: Standards for Command Line Interfaces.** [Command-line guidance](https://www.gnu.org/prep/standards/html_node/Command_002dLine-Interfaces.html); [`--help` behavior](https://www.gnu.org/prep/standards/html_node/_002d_002dhelp.html). Long options, consistent names, `--help`/`--version`, and nonexecuting help. Established ecosystem guidance, not an LLM benchmark.

**[S41] ISO (2018) and NIST. Human-usability framework and definition.** [ISO 9241-11:2018 public abstract](https://www.iso.org/standard/63500.html); [NIST's official usability glossary](https://csrc.nist.gov/glossary/term/usability), citing the ISO definition. Used for the outcome/context distinction and effectiveness, efficiency, and satisfaction. The full paid standard was not inspected, and no detailed design-method requirement is inferred from its abstract.

### AXI and TOON primary artifacts

**[S24] AXI. Landing page and project README.** [Website](https://axi.md/); [pinned README](https://github.com/kunchenguid/axi/blob/6244245644eadb03cbe30ef11caae9a64c5c1e05/README.md). Ten principles and author-reported benchmark tables.

**[S25] AXI. Full principle definitions.** [Pinned skill/specification](https://github.com/kunchenguid/axi/blob/6244245644eadb03cbe30ef11caae9a64c5c1e05/.agents/skills/axi/SKILL.md). Exact behavioral recommendations, including streams, noninteraction, unknown flags, no-argument behavior, and opt-in integrations. This was read as research data, not installed or executed.

**[S26] AXI. GitHub benchmark task set.** [Pinned `bench-github/config/tasks.yaml`](https://github.com/kunchenguid/axi/blob/6244245644eadb03cbe30ef11caae9a64c5c1e05/bench-github/config/tasks.yaml). Read-only tasks and grading hints.

**[S26b] AXI. GitHub benchmark conditions.** [Pinned `bench-github/config/conditions.yaml`](https://github.com/kunchenguid/axi/blob/6244245644eadb03cbe30ef11caae9a64c5c1e05/bench-github/config/conditions.yaml). Differences in instructions and available integrations.

**[S27] AXI. GitHub benchmark grader.** [Pinned `bench-github/src/grader.ts`](https://github.com/kunchenguid/axi/blob/6244245644eadb03cbe30ef11caae9a64c5c1e05/bench-github/src/grader.ts). `buildGradingPrompt`, `formatTrajectory`, and `grade` show trajectory-based LLM judging.

**[S28] AXI. Browser benchmark grader.** [Pinned `bench-browser/src/grader.ts`](https://github.com/kunchenguid/axi/blob/6244245644eadb03cbe30ef11caae9a64c5c1e05/bench-browser/src/grader.ts). Text trajectory judging, image exclusion, and output bounds.

**[S28b] AXI. Browser tasks and conditions.** [Pinned task set](https://github.com/kunchenguid/axi/blob/6244245644eadb03cbe30ef11caae9a64c5c1e05/bench-browser/config/tasks.yaml); [pinned conditions](https://github.com/kunchenguid/axi/blob/6244245644eadb03cbe30ef11caae9a64c5c1e05/bench-browser/config/conditions.yaml).

**[S29] TOON project. Benchmarks.** [Primary benchmark page](https://toonformat.dev/guide/benchmarks). Retrieval accuracy, token counts, dataset shapes, and per-model results. Mutable first-party evidence, not a peer-reviewed end-to-end agent workflow study.
