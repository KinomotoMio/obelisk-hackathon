<!-- Copied from KinomotoMio.github.io dist/writing/why-obelisk/en.md (the published machine-readable version of src/content/writing/why-obelisk/en.mdx). Bundled with the vision docs at the author's request. Re-copy when the original changes. -->

# Why Obelisk

> The work behind Obelisk, and the values beneath what it delivers.

- Canonical: https://kinomotomio.github.io/writing/why-obelisk/
- Machine-readable URL: https://kinomotomio.github.io/writing/why-obelisk/en.md
- Language: EN (en)
- Published: 2026-08-04
- Last modified: 2026-08-04
- Rights: © 2026 KinomotoMio. You are welcome to share the original link. Except for quotations permitted by law, this article may not be republished, redistributed, adapted, or translated without the author's prior written permission. Quotations must credit KinomotoMio and link to the original article.

---

I met [Yuu](https://github.com/tommy0103) at Adventure 2026, where I learned about the work she had been doing on [Obelisk](https://github.com/tommy0103/obelisk). I was convinced of its value almost immediately. The project was already deeply appealing on the surface—both in the quality of its interface and in the technical direction it had chosen—but my reaction came from somewhere more personal, too. Years spent building context had led me toward almost exactly this kind of work: a direction I had long believed would be useful, and had very much wanted to pursue myself.

Yuu had not only made concrete something that had, until then, existed mostly in my head. She had brought to it a depth of technical taste that I lacked—something more rigorous than what I had learned through vibe coding alone. In a moment when so many people are busy playing with concepts, finding someone whose taste genuinely resonates with your own is remarkably difficult. Meeting her felt extraordinarily fortunate.

I want to introduce the work we are doing on Obelisk, and, more importantly, the value judgments beneath what Obelisk appears to deliver.

## The history we fail to mark

One of our most recent concrete experiments began when I suggested that Yuu use Obelisk to look back across her earlier pull-request reviews. She holds code entering the project to a high standard. But a standard that lives largely in the attention and memory of one independent maintainer is difficult to sustain as a community grows. The problem was not how to reject more outside contributions. It was how to help more contributors understand what good work meant in this particular project, without turning Yuu into its permanent interpretive bottleneck.

The result was [a pull request that derived Obelisk's contribution requirements from earlier code reviews](https://github.com/tommy0103/obelisk/pull/27). Several external contributions had arrived in apparently excellent condition: lint-clean, type-safe, and green on their own tests. They had nevertheless stalled for the same small set of reasons. A capability described in the PR was unreachable in the code. A test asserted the implementation instead of the requirement. A migration worked only if it was never interrupted. An existing concept had been invented again under another name. Untrusted transcript content had been treated as trusted input.

These were not style violations. A generic checklist would not have found them. They were judgments specific to the architecture, its history, and the way its owner expected the project to evolve. The eventual `CONTRIBUTING.md` was useful precisely because its rules were not invented in advance. They were recovered from work that had already happened, then made available to people who had not been present when the project learned them.

This exposed two gaps that are easy to confuse. The way a human formulates a problem is not the way an agent searches for evidence. And the instruction a human believes they have given is not necessarily the instruction an agent has received. When we write, "review a pull request for A, B, and C," we are already compressing a large amount of tacit knowledge: where to look, which failure modes matter, which apparent improvements would violate an older decision, and when a result merely looks complete. An agent has different boundaries, different retrieval habits, and different places where it is likely to go wrong.

Left alone, an AI is unlikely to produce every judgment we expect—not necessarily because it lacks intelligence, but because the target itself is not generic. Some of our expectations are intensely personal, even idiosyncratic. A model may produce a clean, defensible, technically sophisticated solution and still miss exactly what would make it feel right to us. General capability cannot faithfully recover a preference that has never been allowed to leave evidence. Asking an agent to infer all of it from the current repository is sometimes asking it to reconstruct a person from traces that do not yet exist.

Most memory systems begin from some version of this diagnosis. If the model cannot infer a preference from the present, preserve more of the past and retrieve it when the preference might matter. The diagnosis is reasonable; the usual remedy is much less convincing. Retrieval is itself a judgment about timing, scope, and authority. A memory that is slightly wrong, or merely right for a different moment, does not enter the context neutrally. It competes with current evidence, redirects attention, and quietly turns an old conclusion into a present constraint. The result is one of the most irritating failures in agent systems: context polluted by something the system was proud to remember.

Context vibe begins from a different ambition. We are not trying to construct one permanent vibe that makes an agent agreeable in every possible situation. We want to recover a situated field of judgment: the taste, expectations, corrections, and room for surprise that matter within a particular kind of collaboration. The scope is part of the artifact. Outside it, the agent should be free to think again rather than continue performing a personality it retrieved from somewhere else.

Retrieval is a judgment

### Similarity can find a memory and still make the context worse

A retrieved item does not enter context neutrally. Before relevance, a system must judge whether the evidence belongs to this scene, remains current, and has the authority to constrain the next decision.

**Tests should assert requirements**

**Prefer exhaustive inline comments**

**Avoid adding comments to obvious code**

**Interrupted migrations must recover**

**Three confident instructions**: High semantic similarity admits contradictory advice from another project and a private note whose authority was never established. Old conclusions compete with present evidence.

**Two scene-valid anchors**: The gate rejects useful-looking material that belongs to another scene. What survives is smaller, inspectable, and explicitly scoped to Obelisk review. The model receives evidence, then remains free to judge.

The point is not to retrieve less by default. It is to make inclusion answerable to the scene instead of to similarity alone.

A real collaboration gradually records the difference. We correct an agent's decisions as it works. Each correction produces both a positive pattern—*this is what I will accept*—and a negative one—*this is what I will reject*. The negative patterns are often more valuable, because we rarely know what must be forbidden until we see the mistake happen.

The difficulty is that humans are bad at recognizing this history while it is being made. We do not stop after every useful correction and ask whether it deserves to become infrastructure. We usually notice that a judgment is valuable only after making it twelve or twenty times. By then, the evidence has been scattered across twelve or twenty sessions. Obelisk makes the act of looking back smaller: the history we failed to mark in the moment can still be recalled when we finally understand what it contains.

## A skill should be discovered, not invented

This changed how I thought about skills. A good skill should not begin as an abstract specification of how an agent ought to behave. It should crystallize from a collaboration that has already succeeded.

The usual sequence is almost the reverse of skill authoring. An agent makes a decision that does not satisfy us. We correct it. It fails differently. We correct it again. Eventually a stable mode of collaboration emerges, the problem is genuinely solved, and the owner is satisfied with the whole process rather than merely its final output. Only then do we have enough evidence to say what the skill is.

In the language I will use later, each of those sessions is a sample. The skill is neither the mind itself nor a complete description of its taste. It is a partial textual projection of a higher-dimensional way of judging, recovered from the points at which that judgment became observable. Deriving a skill from session history is therefore already an instance of the larger operation Obelisk makes possible: sampling the past so that a latent pattern can become available in a form we can read, revise, and use.

Evidence constellation

### The past does not contain a skill. It contains occasions to infer one.

No session is the mind itself, and no timeline makes the pattern true. A useful projection appears only when several situated judgments are selected for a present purpose.

**latent project judgment**

#### A project-specific skill

**A project-specific skill**: Repeated corrections become compact guidance for a particular collaboration. The selected evidence is narrow enough to act on and broad enough to explain why. Useful because the next scene is known.

**A durable conclusion**: A smaller subset supports a conclusion worth carrying forward. Provenance must remain available because another scene may require another reading. A lens over evidence, not a command.

**A situated field of taste**: Heterogeneous judgments sketch a recognizable direction without pretending that taste can be reduced to one instruction or copied in full. The distribution matters more than any single rule.

Switch projections to see why the same historical evidence can honestly support different artifacts.

This is why a prominent "record this as a skill" button would solve the wrong problem. It asks a person to recognize reusable value at the exact moment they are occupied with the work itself. That is contrary to how people actually learn what matters. Retrospective retrieval is the more humane operation: first let people work, then help them recover the repeated corrections they did not know to preserve.

It also suggests why accumulating a large pile of skills can be actively harmful. Agent instructions are not inert files on a shelf. Even a description can become ambient interference, quietly shifting how an agent frames a task. A backend engineer who happens to have installed a contradictory collection of frontend skills may find the agent drifting toward a mode of thought they never intended. More instruction does not automatically produce more alignment; it can simply produce more noise.

The PR-review skill we discussed was an exception for a reason. Its scope was narrow, its evidence came from the repository's own history, and its effect would be to improve a specific relationship: the one between an owner and a contributor. Its value would not come from announcing universal review wisdom. It would come from recovering how this project had already learned to recognize good work.

Nor does the result have to be a skill. It might become a contribution guide, a review workflow, an interface, or some form we have not invented yet. The container is secondary. What matters is whether the history has made the project's values more available without reducing participation to compliance. That deeper object—the thing that can survive across several external forms—is what led us toward context vibe.

## From taste to context vibe

What such a skill preserves is not merely procedure. Beneath the review rules, formatting choices, technical evaluations, and repeated corrections lies something harder to name: taste.

Taste is not one preference. It may appear as an architectural judgment in one session, an aesthetic objection in another, a review standard in a third, or a tiny formatting correction somewhere else. Nor can it be copied one-to-one into an agent. We cannot enumerate every future situation in which taste will need to act, or define a perfectly non-overlapping scope for every preference. At best, we can collect enough samples to reconstruct something like a distribution.

I began calling this a **context vibe**. The word *vibe* matters because it admits that the result is not an exact replica. It is a field built from many instances of taste: a technical assessment, an editorial preference, a review decision, a prompt and the response it rejected, another prompt and the response it accepted. The goal is not to make every agent produce the same answer. It is to let different answers remain recognizably inside the same space of judgment.

But a distribution without a declared domain is just another ambient instruction. A context vibe must say what scene it belongs to: reviewing a contribution, shaping an interface, conducting a research conversation, or making a particular class of tradeoff. The objective is not to make the agent universally more like us. It is to provide enough situated evidence that, inside this scene, the model can use its own intelligence to notice everything that deserves judgment.

This resembles what people already do when they craft prompts for generative models. A language model behaves like a strange function: alter the input and the output changes, yet good inputs can keep many different outputs within a desired distribution. The hard part is rarely stating the entire distribution as a rule. It is finding representative inputs and outputs that reveal its shape.

That is where history becomes more than an archive. Obelisk can help us recover the old input-output pairs through which our taste became visible. Instead of relying on a few examples we happen to remember—or asking a larger model to turn an incomplete description into a more confidently worded incomplete description—we can return to the moments when we actually judged something. Deciding whether a result is what we wanted is often much easier than explaining in advance what we want. Our histories contain those decisions, even when we never promoted them into documentation.

## Context that can travel

This leads to one of the concrete directions we are now considering for Obelisk.

Sharing context is much harder than sharing text. We can export a session into Markdown, send it to someone else, and preserve every visible sentence. Yet the recipient receives something inert. Their agent cannot naturally follow the parent chain, distinguish a tool call from its result, inspect a subagent, recover the working directory in which a decision was made, or ask for the source record behind a suspicious summary. A transcript can be readable without being continuable.

Obelisk has already built half of a more interesting path. Claude Code, Codex, and Kimi Code all describe their sessions differently. Each provider adapter interprets its own source and emits a shared [canonical transcript language](https://github.com/tommy0103/obelisk/blob/main/packages/core/src/providers/types.ts): sessions, messages, roles, tool calls and results, summaries, parent relationships, subagents, workflows, visibility, provenance, and a small number of state transitions. The same record stream can be assembled directly for a human reader or persisted and later reconstructed from SQLite. In the architecture, [SQLite is explicitly a serialization adapter rather than the source of transcript meaning](https://github.com/tommy0103/obelisk/blob/main/docs/adr/0007-canonical-transcript-session-detail-seam.md).

That distinction is easy to miss, but it changes the shape of the opportunity. Obelisk is not merely collecting several vendors' chat logs into one database. It is maintaining an intermediate representation of what happened in a session. Today the flow mostly travels in one direction:

> provider history → canonical records → query and human-readable surfaces

What we are considering is the reverse projection:

> canonical records → a session history another agent can genuinely consume

Semantic conservation

### Portable context should preserve the ability to ask a different question

The canonical IR is not another transcript format. It keeps relationships stable while different consumers take projections suited to reading, continuing work, or carrying forward a conclusion.

**message**

**tool call**

**result**

**branch**

**A legible narrative**: Events are ordered and rendered for comprehension. Structure can be folded away, but source links remain available for inspection.

**A traversable foreign history**: The agent can follow causes, expand branches, and cite evidence without being told that it personally experienced the session.

**A compact, approved lens**: A conclusion travels cheaply with scope and evidence anchors. It summarizes the graph without claiming to replace it.

Change the consumer. The projection changes; provenance, causality, visibility and branch structure remain conserved.

This should not mean forging a native transcript and pretending the receiving agent was present for events it never experienced. Provenance must remain visible. A better model may be to mount a foreign history as an interactive context: something the receiving agent can traverse, expand, question, and cite while still knowing where each event came from. The goal is continuity without impersonation.

The existing intermediate representation gives us a promising seam, not a finished interchange format. Obelisk's own architecture notes acknowledge that provider-specific concepts may currently be projected lossily or ignored. Indexed message and tool content is bounded, while the `raw()` path returns to the provider's original record when more fidelity is required. A portable context therefore needs an explicit answer to what it promises to conserve. At minimum, I think it must preserve the relationships that make work intelligible: who or what produced an event, which result belongs to which action, what was visible, what was retracted, which branch of work a subagent followed, and how to return to original evidence.

This suggests a design with a small, versioned semantic core and provider-specific escape hatches, rather than an enormous universal transcript schema. Target adapters could project that core into the forms different agents understand, while capability metadata makes any loss explicit. Portability would then mean conservation of meaning, not accidental similarity between JSON formats.

It must also remain selective. Portability is not publication. Real sessions contain secrets, private reasoning, failed explorations, irrelevant digressions, and tool output that was safe only inside its original boundary. Obelisk already separates visible content, metadata, and source-level raw records; a shareable projection would need to extend that discipline into user-controlled disclosure. The right unit is unlikely to be “everything in this session.” It is the smallest honest context from which the receiving agent can still understand and interact with the work.

### Memory is a projection, not a replacement

This direction is closely aligned with Obelisk's Memory design. A Memory can be synthesized from work done in one coding agent and consumed later from another because it does not belong to any provider's private format. It is a Markdown conclusion registered with a summary and, when available, provenance back to a project, session, message range, and other anchors.

But Obelisk does not treat Memory as a grand new substrate that should silently fill every prompt. The full content remains in an ordinary file. Recall returns a compact summary and path; an agent can decide whether to read it, ignore it, or verify it against session evidence. Writing or retiring one requires the user's approval. Even a high-value memory expects some understanding from its consumer. It offers a prior judgment, not an instruction that must be obeyed.

The implementation makes the distinction between the two layers unusually clear. Session records are derived evidence: the index can be rebuilt from provider histories. Memories are human-approved syntheses and survive that rebuild. One layer records what happened in a form that can be queried again. The other records what someone concluded was worth carrying forward. Put more compactly:

> A session is evidence, not an answer. A memory is a lens, not a command.

The boundary between them should not be settled too early. For a familiar decision, a memory may be the cleanest and least expensive context. For a novel or high-stakes question, the agent may need to return to the underlying sessions and form a different interpretation. Often the right answer will combine both: recall an earlier synthesis as orientation, then inspect the historical evidence that can confirm, complicate, or overturn it.

This is also why the lightest access may be the clearest—and the least coercive. Many memory systems promise to remember more and inject the result more automatically. Obelisk can take a lighter, quieter path: preserve rich local evidence, expose small and composable retrieval tools, let people see the same substrate their agents query, and expand context only when the task calls for it. Its desktop app and its agent-facing interface already share one index. Any future portable context should preserve that dual legibility—consumable by an agent, inspectable by a person.

There is a deeper connection here to the conceptual space I will describe next. A memory is one projection made from historical points. A flat exported summary is one projection too. Once either is detached from its evidence, every future reader is forced to inherit the same interpretation. A traversable session representation keeps more of the points available. Another person or agent can ask a question we did not anticipate and construct a new projection from the same history.

The purpose of portable context, then, is not to put more old text into a new context window. It is to preserve the ability to think again.

## A query can be a form of thought

One of Obelisk's most consequential interfaces may also be its least visible. It does not merely give an agent another `search` tool and ask it to take one careful step after another. It lets the agent write a small JavaScript program against the history: call several retrieval helpers, follow relationships, filter and group records, compare candidates, and return only the evidence that deserves to enter its context. The [query runs in a bounded sandbox](https://github.com/tommy0103/obelisk/blob/main/packages/core/src/core.ts); the exposed history APIs are read-only, and raw SQL is restricted to `SELECT` and `WITH`. This is controlled freedom in miniature.

Agentic search is often narrated as a virtuous ritual: think, call a tool, read the result, think again, call another tool. That rhythm is useful when each result should genuinely change the next decision. But it becomes wasteful when the intermediate work is mechanical. A model should not have to spend another inference turn narrating every loop, join, filter, retry, and aggregation merely so that the harness can watch it advance one tool call at a time. Step-by-step observability is not the same thing as intelligence. Sometimes it is only bureaucracy imposed on thought.

CodeAct changes which layer must explain itself. The agent can express the deterministic part of a retrieval plan as code, execute it next to the data, and admit only a compact result into the linguistic context where judgment happens. The reasoning has not disappeared. The plumbing has stopped demanding to be written as prose. We expect this to save context and, more importantly, to leave the model with more room for the part of the task that cannot be reduced to a loop. We have not yet quantified that expectation, so it should be read as a design hypothesis rather than a benchmark result.

The broader model ecosystem appears to be moving back toward the same shape. Anthropic's [Programmatic Tool Calling](https://www.anthropic.com/engineering/advanced-tool-use) lets a model orchestrate tools through code so that large intermediate results can be processed without repeatedly entering the model's context. OpenAI's current [model guidance](https://developers.openai.com/api/docs/guides/latest-model) draws a similar boundary: programmatic calling is valuable for bounded filtering, joining, ranking, deduplication, aggregation, and validation, while direct calls remain better when each result must redirect semantic judgment. The important return is not simply that frontier models can issue more calls in parallel. It is that tool use is becoming expressive enough to serve a more complicated internal plan, rather than forcing the plan to collapse into a sequence of externally legible gestures.

Writing code that calls tools and writing code that queries history are therefore close relatives, but they are not identical. From the runtime's perspective, a query may be just another tool invocation. From the agent's epistemic perspective, it is an argument about evidence: which records belong together, which distinctions must survive, and what compact object would be sufficient to answer the question. Tool orchestration transforms an environment through actions. A query transforms an environment into something the agent can know. Agent engineering loses an important distinction when it treats both as generic tool use.

This is also where the higher-dimensional metaphor stops being merely decorative. A CodeAct query chooses samples and defines a projection over them. It is not only fetching old text; it is specifying how scattered historical points should be composed into a temporary object for thought. The better the model becomes at expressing that operation, the less Obelisk needs to prescribe the path in advance. Its job is to preserve the evidence, expose meaningful relations, and make the projection cheap enough to attempt again.

CodeAct as epistemic compression

### Mechanical retrieval should not consume the language in which judgment happens

When every filter and join becomes another turn, the search protocol occupies the same scarce context as the conclusion. CodeAct moves deterministic plumbing beside the data and returns one compact object for thought.

```javascript
const reviews = await find("stalled PR");
const evidence = await Promise.all(
reviews.map(review => detail(review.id))
);
return clusterByFailure(evidence);
```

## Sampling a larger space

There is another way to describe what we are trying to do, one that borrows—loosely—from philosophy, geometry, and set theory.

Imagine that everything we can intuitively construct and express in everyday language forms a space. A particular concept is a sample taken from that space: one point we can name, examine, and communicate. Human inquiry in science, philosophy, and almost every other field proceeds by connecting such points. We begin with concepts available to perception and language, then search for a structure in which their relationship becomes intelligible. What first appears to be several isolated, lower-dimensional intuitions may turn out to be projections of a richer abstraction.

To understand a complex subject deeply, in this picture, is not simply to accumulate more facts about it. It is to discover a higher-dimensional concept and find a sufficiently faithful projection of it into the dimensions we can recognize. The projection will never be the thing in full. It is valuable because it preserves the relationships that matter while making them available to thought.

For most of human history, constructing such projections was extraordinarily difficult. It depended on rare combinations of talent, intelligence, education, time, and access to other minds. People argued with one another, searched libraries, read encyclopedias, and, later, queried search engines. Each method helped us reach more points, but the work of sensing a latent relationship among them remained scarce.

Large language models alter the cost of that operation. They give us something that can feel like a magic function over concepts. We can sample several points from the range we know how to describe, present them to a model, and ask for a plausible mapping toward a space we cannot yet articulate. Ask what two apparently unrelated concepts have in common, and the model attempts to identify dimensions along which both can be understood. The answer may be wrong, shallow, or merely suggestive; nevertheless, the operation that once required unusual access to a patient and knowledgeable interlocutor is now available at any hour, and can be repeated almost without limit.

In its most familiar form, we call this learning. But the same operation appears anywhere concepts are made: in research, design, engineering, criticism, and the early stages of invention. The world we share is built through these movements between samples and abstractions, between what can be said directly and the larger structure we are trying to perceive.

This also clarifies why the history surrounding a model matters so much. A model can propose mappings, but the points we give it determine which region of the space it can help us explore. Generic examples lead toward generic abstractions. A history of real decisions, corrections, rejections, and moments of recognition supplies a much more particular set of samples. Obelisk can recover those samples—not to freeze a person inside their past, but to let a model trace relationships that the person could feel before they could explain them.

Context vibe is one possible name for the shape that appears. It is neither a complete theory of a person's taste nor a rigid encoding of it. It is a workable projection assembled from enough situated judgments that an agent can begin to move through unfamiliar problems without becoming detached from the values that made the earlier work good.

## The limits of the harness

This puts context vibe beside another increasingly popular idea: [Harness Engineering](https://openai.com/index/harness-engineering/). The practice names real and necessary work. Agents need legible environments, clear intent, useful tools, verification, feedback loops, and safe boundaries. We will build these things too. Our disagreement begins only when harness engineering is treated not as one engineering discipline, but as a complete theory of how model capability should be made useful.

A harness is built from what we already know how to specify, observe, test, or forbid. That makes it exceptionally good at keeping an agent inside a valid region of a problem. It can prevent a destructive migration, require a test, expose a hidden dependency, or make an architectural boundary visible. These are genuine gains, and rejecting them in the name of creativity would merely romanticize failure.

But the model I described above is valuable for another reason. As a strange, probabilistic function over concepts, it can sometimes suggest a projection from the points we know toward a structure we do not yet know how to name. If we believe harness engineering can solve everything, we are also claiming that a human can write enough rules to provide a stable route to every higher-dimensional capability worth reaching. Yet a destination that can be fully prescribed in advance already lies, in an important sense, inside our existing map.

The danger is not that a harness makes a model useless. It is that a perfect harness makes the model useful only in ways we already understand. Reliability increases while surprise is designed away. The system becomes excellent at reproducing the boundary of its designers' knowledge, precisely when the most interesting property of the model may be its ability to help them see beyond it.

What we want instead is **controlled freedom**. The control is real: irreversible actions need gates, claims need evidence, and shared systems need enforceable safety. But inside those boundaries, the model should retain room to connect distant points, propose an unfamiliar abstraction, and produce something that no checklist could have specified. The harness should provide a floor, not become the ceiling.

We should not imagine that a context vibe has to be finished before a harness can be designed. The latent project judgment in Figure 02 is *never directly observed*; it becomes more legible through the very work of deciding what the harness should protect. Each time a test catches a real regression, an exception reveals that a rule was too broad, or a reviewer distinguishes a safety boundary from a taste preference, the project produces another situated sample. Context vibe can grow with the harness rather than arrive as its constitution.

As a harness grows, however, its successful past can harden into a closed world. It therefore needs counter-signals from people: not vague permission to ignore every rule, but explicit judgment about which boundaries remain firm, which should become defaults, and where exploration deserves an exception path. [open-your-mind](https://github.com/centitenka/open-your-mind) is a small example of that attitude. Its [SKILL.md](https://github.com/centitenka/open-your-mind/blob/main/SKILL.md) asks an agent to preserve constraints that protect safety and correctness while finding rules whose force has grown larger than the risk they control, then return the consequential choices to the owner. It is a skill built inside a harness to keep the harness from mistaking itself for the whole imagination.

This also reveals two different design regimes that are too often collapsed into one roadmap. In a highly automated regime, people specify the boundary and evaluate the result while the system executes most of the path. The present enthusiasm for harness engineering belongs naturally here. Its central questions are how to make delegation reliable, legible, recoverable, and safe.

The other regime keeps a person lightly but continuously inside the collaboration. The person does not micromanage every tool call, yet they remain present enough to redirect attention, contribute taste, expose a half-formed thought, or recognize that the problem itself has changed. Several current projects approach this space from different directions: [Multica](https://multica.ai/docs) keeps humans and agents in the same task workspace; [Raft](https://docs.raft.build/welcome/) describes agents as teammates while people remain in the conversation to steer; [Syncless](https://docs.syncless.ai/) models the handoffs through which agents move context while judgment remains with responsible people; and [Claude Tag](https://www.anthropic.com/news/introducing-claude-tag) puts one shared Claude into a team's Slack channels, where multiple people can see, continue, and redirect its work. These are not interchangeable products, and not all of them would use our language. What they share is more important: the social surface between people and agents is treated as part of the system rather than as temporary scaffolding around an autonomous worker.

I think this second regime is profoundly underestimated. It is often described as a halfway state we will discard once agents become autonomous enough. That assumes the destination of intelligence is the removal of participation. I suspect the opposite: lightly participatory environments may be one of the most practical ways AI changes the basic coordination patterns of human society. They let intelligence compound through shared attention before it can be fully delegated. At the very least, until the thing people call AGI actually arrives, this is not a consolation prize. It is one of the few places where a new form of collective work can already be built.

Two collaboration regimes

### Automation and participation are different design destinations

One system removes people from the execution path after they set its boundary. The other keeps people, agents, and artifacts in a shared social surface where direction can continue to change.

#### Human at the boundary

The harness defines a valid region. The agent executes most of the path; the person approves, interrupts, or evaluates.

#### Human inside the shared surface

People do not micromanage tool calls. They remain close enough to redirect attention, contribute taste, or recognize that the problem has changed.

The right-hand regime is not failed autonomy. It treats continued human participation as a source of collective intelligence.

Context vibe steers through a different material. It does not attempt to enumerate every acceptable answer. It supplies a field of situated judgments from which the model can infer direction while it moves. In a community, that difference matters twice. An over-engineered contribution process can turn a contributor into the operator of someone else's machine. They may satisfy every gate while gradually losing ownership, curiosity, and enthusiasm. A context vibe should help them understand why the project chooses as it does, then leave enough space for them to contribute something the owner did not already possess.

## Atmosphere is part of the context

There is another kind of context in the conversation where these ideas appeared, and it would be a mistake to edit it away. We were not conducting a formal product workshop. We were trading half-formed thoughts, jokes, screenshots, stickers, misunderstandings, and sudden recognitions. One idea made the next one easier to say. A phrase that was too abstract became clearer when the other person playfully failed to understand it. Excitement made us willing to follow an association further than either of us might have followed it alone.

A good atmosphere makes people more creative.

Atmosphere has causal force

### A conversation does not merely carry ideas. It changes which ideas can appear.

Safety makes an unfinished thought speakable; playful misunderstanding forces it into a clearer shape; recognition gives both people energy to follow the association further.

**“Maybe a skill is not written…”**

The idea is valuable but still too vague to defend.

**“I do not quite understand.”**

A misunderstanding, joke, or correction asks for another articulation without punishing the first attempt.

**“A skill is discovered from history.”**

The result was not waiting intact in either participant. It emerged from the exchange.

This sounds softer than retrieval architecture or skill design, but it is no less structural. Creativity requires enough safety to expose an unfinished idea, enough curiosity to stay with a misunderstanding, and enough energy to make another attempt at articulation. A sterile exchange may be efficient at transferring conclusions while being terrible at producing new ones. Warmth, humor, and aesthetic pleasure are not decorations applied after serious work. They alter which thoughts become available to the people doing it.

Most context engineering asks what information a model needs in order to answer well. That is only half the system. We should also ask what context a human needs in order to think well. A tool can preserve every relevant fact and still diminish the work if its presence makes people guarded, tired, or unimaginative. Conversely, a thoughtful interface and a generous conversational rhythm can invite a person to explore, correct, and create.

This is part of why Obelisk's visual and technical taste mattered to me before I could fully explain its utility. The care visible in the surface suggested care in the relationship the tool wanted to have with its user. And the atmosphere of our own conversation did more than help us describe that relationship: it generated ideas that neither of us had brought into the conversation fully formed.

If context can carry taste, perhaps it can also carry some of the conditions under which taste becomes generative. The purpose would not be to manufacture intimacy or reduce creativity to another optimization target. It would be to recognize that the quality of a working context is measured not only by what it helps an agent retrieve, but also by what it helps a person imagine.

## Recovering the vibe

The word *vibe* has already traveled through two popular phrases. Andrej Karpathy's original description of [vibe coding](https://x.com/karpathy/status/1886192184808149383) was not simply a name for generating code from a natural-language requirement. It described a mode in which you give in to the feedback loop, stop attending closely to the code, and let seeing, saying, running, and adjusting carry the work forward. The phrase was quickly flattened into a label for almost any use of AI in programming.

Later, Simon Willison proposed [vibe engineering](https://simonwillison.net/2025/Oct/7/vibe-engineering/)—partly in jest—to distinguish that loose mode from the work of experienced developers who use language models heavily while remaining accountable for the software they produce. That distinction is useful. Yet the word *vibe* points toward something that even this more responsible definition does not fully contain.

A vibe is not natural language as a substitute for syntax. It is not the absence of standards, and it is not a softer name for a pipeline of tests and guardrails. It is an emergent sense of direction among participants who cannot reduce everything they know to rules. It appears in the rhythm of correction, in the examples that need no explanation, in the permission to offer an unfinished thought, and in the moment when somebody else's response reveals what you were trying to say.

Such a vibe can exist between one person and one coding agent. It can also exist between people, as it did in the conversation from which this essay grew. More importantly, it will almost certainly exist within groups made of both people and agents. Those groups will not be well described as humans operating tools, nor as autonomous agent swarms with a human placed somewhere above them. They will develop shared histories, local tastes, modes of disagreement, and conditions under which their members become more or less creative.

This is the direction we want to explore after Obelisk. The path will not be wild. We will use verification, boundaries, and the techniques now gathered under harness engineering wherever they are needed. But those techniques are means, not the final character of the environment.

The environment we hope to build is one in which every person's creativity and inspiration can be released as fully as possible, and agents act as catalysts within it. Not agents that merely obey, and not agents that replace the difficult pleasure of thinking together, but agents that help a group recover what it knows, reach what it does not yet know, and become capable of ideas that none of its members would have reached alone.

What Obelisk delivers today may look like the ability to search our past. The value beneath it is more ambitious: to make history available as a living context for how humans and agents learn to think together.

I am, in truth, deeply reluctant to publish my opinions in communities. Discussions around these subjects too often become impatient, with everyone trying to demonstrate how singular their position is. I did not write this to prove that my ideas are more original, or possessed of some more refined taste. I wrote it because this friendship makes me happy, and because I wanted to let what I had been thinking settle into words. I hope Yuu, when she has time, can read it with her agents and understand more clearly the values we are trying to carry through our work.

This essay is itself a product of the process it describes. I spoke its central ideas aloud, had an agent help me develop them into prose, and completed the whole thing in tens of minutes rather than days. That does not make the thinking less mine or the experience less complete. I was able to finish a line of thought that mattered to me, and I enjoyed doing it. I believe Yuu will enjoy reading it too.

So I will not hide the use of AI behind a careful disclaimer. I am proud of it. It gave us another way to sustain the atmosphere we value even when we could not sit together face to face. The technology did not substitute for the friendship or the thought. It helped the connection remain generative across distance and time.

We warmly welcome fellow travelers to join this work. We want to move AI forward in practical ways, while keeping human beings—not technical spectacle—at the center of that progress.
