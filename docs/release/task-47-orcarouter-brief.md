# Task 47: OrcaRouter Provider Presets

## Scope

Add OrcaRouter as an encrypted personal AI provider preset and expose the two
verified free tool-capable models without changing the existing AI API.

## Contract

- Selecting OrcaRouter fills the public API base URL.
- DeepSeek V4 Flash Free is the initial model suggestion.
- DeepSeek V4 Flash Free and Qwen3.8 27B Free remain explicit selectable model
  IDs and users may still enter another compatible model manually.
- API keys remain password inputs and are encrypted only by the existing Worker
  user-secret flow.
- System AI and personal AI selection semantics remain unchanged.

## Boundary

No plaintext key, provider secret, session, database file, or browser profile is
stored in Git or the frontend bundle.
