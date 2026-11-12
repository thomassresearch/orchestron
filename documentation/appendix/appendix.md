# Appendix: Optional Authoring Tools

**Navigation:** [Up](../user_documentation.md) | [Previous](../configuration/persistence_and_defaults.md) | [Next](agent_cli.md)

<a id="appendix"></a>

These optional tools let a coding agent create instruments and performances from a musical brief. You can use Orchestron entirely through its graphical interface; the tools are included here for readers who want to automate authoring or inspect the underlying workflow.

Detailed skill links open the repository sources so they are usable from the PDF as well. The example prompts refer to your local checkout.

## Chapter Contents

<!-- manual-contents:start -->
- [Agent CLI](agent_cli.md)
- [Orchestron Patch Creator Skill](patch_creator_skill.md)
- [Orchestron Performance Creator Skill](performance_creator_skill.md)
- [Orchestron Composition Creator Skill](composition_creator_skill.md)
- [Sung Melody Transcription Skill](sung_melody_transcription_skill.md)
<!-- manual-contents:end -->

## Use a Skill in a Coding Agent

A skill is a directory containing a `SKILL.md` instruction file, supporting references, and executable tooling. It guides the agent through the task; the command-line utility performs the operations.

1. Open the Orchestron repository in a coding agent with access to its files and a terminal.
2. Ask the agent to read the chosen `SKILL.md` under `integrations/skills/` and follow its linked references. Keep the whole skill directory available, including its `src`, `references`, and project files.
3. Give a musical brief, the desired instrument or performance name, and the backend URL. State whether you want a new item or an update to an existing one, and whether playback is wanted.
4. Ask the agent to validate the result and report what it saved, compiled, rendered, and actually listened to. Review the resulting instrument or performance in Orchestron.

Explicitly asking an agent to read the file does not require a product-specific skill installation. Automatic skill discovery and shortcut invocation depend on the agent; the prompts in the following chapters use ordinary language and repository paths.

For installing the packaged tools, follow the [plugin installation guide](../../integrations/README.md#build-the-plugin-zip).

The utilities use `uv` and require Python 3.13. Library operations, compilation, performance validation and live sessions need a reachable Orchestron backend, normally `http://localhost:8000/api`. Run the backend using the normal setup procedure (`make run` from the repository root), or provide an existing server's URL. Local patch-spec validation and graph generation can run without the backend. Composition generation, audition and score export also run locally without the backend. The utilities access the library through the API, not by editing SQLite directly.

## Explore the architecture

The optional [interactive architecture guide](../orchestron_architecture_animated.html) shows how an authored score becomes sound. Open the downloaded HTML in a browser; repository previews show its source. This is background reading, not a prerequisite for using Orchestron.

**Navigation:** [Up](../user_documentation.md) | [Previous](../configuration/persistence_and_defaults.md) | [Next](agent_cli.md)
